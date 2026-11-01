-- M04 — Login interno em cinco etapas (Workspace). NÃO APLICAR EM PRODUÇÃO sem revisão e sem
-- que os usuários internos tenham como ativar o autenticador (ver docs/security/2026-10-31/RELATORIO-M04.md).
--
-- Desenho (PROJETO-TECNICO-02 §4(B)): a etapa 5 (liberação) é um ESTADO DO SERVIDOR gravado em
-- tabela inacessível ao cliente, preso a user_id + session_id + finalidade + validade.
--   * app_private.sessao_interna_liberada() é chamada DENTRO de app_private.has_permission e
--     is_own_employee: toda permissão interna passa a exigir sessão liberada (PostgREST, Storage,
--     Realtime e RPCs que usam permissão).
--   * identidade NÃO interna (sem linha ativa em public.users, ou com marca external/parceiro) não
--     é afetada: o gate só se aplica quando app_private.is_active_internal_user() é verdadeiro.
--   * as tabelas abaixo têm RLS ligada SEM política (deny-all) e sem GRANT para anon/authenticated;
--     só service_role e as funções SECURITY DEFINER leem/escrevem.
--   * contadores/pausas são atômicos no banco (SELECT ... FOR UPDATE); nunca em memória/cliente.
--   * NÃO há bloqueio automático de 24 h: 3 erros => pausa de 5 min; reincidência => 15/30/60/120/240 min.
--     Bloqueio longo só administrativo (auth_bloqueios_admin), com quem bloqueou/desbloqueou.
-- Idempotente (create if not exists / create or replace / drop trigger if exists).

DO $$
DECLARE faltando text[] := '{}';
BEGIN
  IF to_regprocedure('app_private.has_permission(text,text)') IS NULL THEN faltando := faltando || 'app_private.has_permission'; END IF;
  IF to_regprocedure('app_private.is_own_employee(uuid)') IS NULL THEN faltando := faltando || 'app_private.is_own_employee'; END IF;
  IF to_regprocedure('app_private.is_active_internal_user()') IS NULL THEN faltando := faltando || 'app_private.is_active_internal_user (M03-A 20261101020000)'; END IF;
  IF to_regclass('public.users') IS NULL THEN faltando := faltando || 'public.users'; END IF;
  IF to_regclass('auth.sessions') IS NULL THEN faltando := faltando || 'auth.sessions'; END IF;
  IF to_regclass('auth.mfa_amr_claims') IS NULL THEN faltando := faltando || 'auth.mfa_amr_claims'; END IF;
  IF to_regclass('auth.mfa_factors') IS NULL THEN faltando := faltando || 'auth.mfa_factors'; END IF;
  IF array_length(faltando, 1) > 0 THEN
    RAISE EXCEPTION 'M04: pre-requisito ausente: %', array_to_string(faltando, ', ');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Tabelas (todas deny-all para anon/authenticated)
-- ---------------------------------------------------------------------------

-- Fator TOTP reconhecido: um fator verificado fora deste registro não libera ninguém.
CREATE TABLE IF NOT EXISTS public.auth_mfa_fatores (
  factor_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  aprovado_em timestamptz NOT NULL DEFAULT now(),
  aprovado_na_sessao uuid,
  removido_em timestamptz,
  removido_motivo text
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_mfa_fatores_um_ativo_por_usuario
  ON public.auth_mfa_fatores (user_id) WHERE removido_em IS NULL;

-- Desafio de e-mail (etapa 4). O código nunca é gravado: só HMAC calculado pelo servidor.
CREATE TABLE IF NOT EXISTS public.auth_desafios_email (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  finalidade text NOT NULL CHECK (finalidade IN ('acesso_workspace', 'ativacao_fator')),
  destino_email text NOT NULL,            -- copiado de public.users pelo banco; nunca vem do cliente
  codigo_hash text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  tentativas int NOT NULL DEFAULT 0,
  max_tentativas int NOT NULL,
  consumido_em timestamptz,
  invalidado_em timestamptz,
  motivo_invalidacao text,
  entrega_estado text NOT NULL DEFAULT 'pendente' CHECK (entrega_estado IN ('pendente', 'aceita', 'falhou', 'incerta')),
  entrega_ref text
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_desafios_email_um_ativo
  ON public.auth_desafios_email (session_id, finalidade) WHERE consumido_em IS NULL AND invalidado_em IS NULL;
CREATE INDEX IF NOT EXISTS auth_desafios_email_user_criado ON public.auth_desafios_email (user_id, criado_em DESC);

-- Liberação (etapa 5) por (user, sessão, finalidade). 'ativacao_fator' é só a prova curta de que o
-- titular recebeu o e-mail antes de cadastrar o autenticador; 'acesso_workspace' é o acesso.
CREATE TABLE IF NOT EXISTS public.auth_sessao_liberacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  finalidade text NOT NULL CHECK (finalidade IN ('acesso_workspace', 'ativacao_fator')),
  desafio_id uuid NOT NULL UNIQUE REFERENCES public.auth_desafios_email(id),
  criada_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  revogada_em timestamptz,
  motivo_revogacao text,
  UNIQUE (session_id, finalidade)
);
CREATE INDEX IF NOT EXISTS auth_sessao_liberacoes_user ON public.auth_sessao_liberacoes (user_id);

-- Contadores por etapa. chave = HMAC do e-mail informado (senha) ou user_id (totp/email).
CREATE TABLE IF NOT EXISTS public.auth_tentativas (
  chave text NOT NULL,
  etapa text NOT NULL CHECK (etapa IN ('senha', 'totp', 'email')),
  falhas int NOT NULL DEFAULT 0,        -- falhas desde a última pausa
  pausas int NOT NULL DEFAULT 0,        -- reincidência (decai após 24 h sem falha)
  pausa_ate timestamptz,
  ultima_falha timestamptz,
  PRIMARY KEY (chave, etapa)
);

-- Bloqueio administrativo (decisão de uma pessoa; nunca automático).
CREATE TABLE IF NOT EXISTS public.auth_bloqueios_admin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bloqueado_em timestamptz NOT NULL DEFAULT now(),
  ate timestamptz,                      -- NULL = até desbloqueio manual
  motivo text,
  bloqueado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  removido_em timestamptz,
  removido_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  removido_motivo text
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_bloqueios_admin_um_ativo ON public.auth_bloqueios_admin (user_id) WHERE removido_em IS NULL;

-- Logs de acesso (menu Usuários > Logs de acessos). Sem código, senha, segredo TOTP, cookie ou token.
CREATE TABLE IF NOT EXISTS public.acessos_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  criado_em timestamptz NOT NULL DEFAULT now(),
  sistema text NOT NULL DEFAULT 'workspace',
  etapa text NOT NULL CHECK (etapa IN ('senha', 'identidade', 'totp', 'email', 'ativacao', 'sessao', 'logout', 'admin', 'permissao')),
  resultado text NOT NULL CHECK (resultado IN ('sucesso', 'falha', 'pausa', 'bloqueado', 'erro_infra', 'negado', 'alerta')),
  motivo text NOT NULL CHECK (motivo ~ '^[a-z0-9_]{1,48}$'),
  identidade_informada text,            -- e-mail digitado (cortado em 254), NÃO confirma existência
  user_id_validado uuid,                -- só preenchido quando o Auth/DB validaram a identidade
  session_id uuid,
  request_id text,
  ip_observado text,                    -- observado no cabeçalho; sem atribuição de autoria
  user_agent_observado text,
  pausa_ate timestamptz,
  bloqueio_id uuid,
  desbloqueado_por uuid,
  alerta boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS acessos_log_criado ON public.acessos_log (criado_em DESC);
CREATE INDEX IF NOT EXISTS acessos_log_user ON public.acessos_log (user_id_validado, criado_em DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['auth_mfa_fatores', 'auth_desafios_email', 'auth_sessao_liberacoes', 'auth_tentativas', 'auth_bloqueios_admin', 'acessos_log'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('COMMENT ON TABLE public.%I IS %L', t, 'M04 login em cinco etapas: RLS deny-all; só service_role e funções SECURITY DEFINER.');
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Pausas e a função de liberação
-- ---------------------------------------------------------------------------

-- 1ª pausa 5 min; reincidência cresce até o teto de 4 h. Nunca 24 h automático (decisão 01/11 nº 3).
CREATE OR REPLACE FUNCTION app_private.auth_pausa_minutos(p_pausas int)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_pausas <= 0 THEN 0 WHEN p_pausas = 1 THEN 5 WHEN p_pausas = 2 THEN 15
              WHEN p_pausas = 3 THEN 30 WHEN p_pausas = 4 THEN 60 WHEN p_pausas = 5 THEN 120 ELSE 240 END;
$$;

-- Núcleo (service_role): a sessão (user, session, aal) está liberada para o Workspace?
-- Exige: liberação válida e não revogada; sessão existente e não vencida no Auth; usuário ativo e
-- sem bloqueio administrativo; método de senha E de TOTP no histórico da sessão (magic link/OTP/OAuth
-- nunca chegam aqui); fator TOTP verificado, aprovado no nosso registro e igual ao factor_id da sessão.
CREATE OR REPLACE FUNCTION app_private.sessao_liberada_para(p_user uuid, p_session uuid, p_aal text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_user IS NOT NULL AND p_session IS NOT NULL AND coalesce(p_aal, '') = 'aal2'
    AND EXISTS (
      SELECT 1
      FROM public.auth_sessao_liberacoes l
      JOIN auth.sessions s ON s.id = l.session_id AND s.user_id = l.user_id
      JOIN public.users u ON u.id = l.user_id AND coalesce(u.active, true)
      JOIN public.auth_mfa_fatores f ON f.factor_id = s.factor_id AND f.user_id = l.user_id AND f.removido_em IS NULL
      JOIN auth.mfa_factors mf ON mf.id = f.factor_id AND mf.user_id = l.user_id AND mf.status::text = 'verified'
      WHERE l.user_id = p_user AND l.session_id = p_session AND l.finalidade = 'acesso_workspace'
        AND l.revogada_em IS NULL AND l.expira_em > now()
        AND (s.not_after IS NULL OR s.not_after > now())
        AND EXISTS (SELECT 1 FROM auth.mfa_amr_claims a WHERE a.session_id = s.id AND a.authentication_method = 'password')
        AND EXISTS (SELECT 1 FROM auth.mfa_amr_claims a WHERE a.session_id = s.id AND a.authentication_method = 'totp')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.auth_bloqueios_admin b
      WHERE b.user_id = p_user AND b.removido_em IS NULL AND (b.ate IS NULL OR b.ate > now())
    );
$$;

-- Versão para RLS: lê user/session/aal do JWT assinado da requisição. FALSE para quem não é
-- interno (use sessao_interna_ok() quando "não interno" deve passar).
CREATE OR REPLACE FUNCTION app_private.sessao_interna_liberada()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app_private.is_active_internal_user()
    AND app_private.sessao_liberada_para(
      auth.uid(),
      CASE WHEN auth.jwt() ->> 'session_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN (auth.jwt() ->> 'session_id')::uuid END,
      auth.jwt() ->> 'aal');
$$;

-- Gate de uso interno em has_permission/is_own_employee: identidade não interna passa direto
-- (continua sujeita ao resto da política); interna precisa de sessão liberada.
CREATE OR REPLACE FUNCTION app_private.sessao_interna_ok()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT NOT app_private.is_active_internal_user() OR app_private.sessao_interna_liberada();
$$;

-- has_permission: mesmo corpo da 20260601132916 + gate no final.
CREATE OR REPLACE FUNCTION app_private.has_permission(
  resource text,
  permission_action text DEFAULT 'can_view'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH current_user_row AS (
    SELECT id, profile_id
    FROM public.users
    WHERE id = auth.uid()
      AND COALESCE(active, true) = true
    LIMIT 1
  ),
  direct_permission AS (
    SELECT
      up.resource_name,
      up.can_view,
      up.can_include,
      up.can_edit,
      up.can_delete,
      up.can_activate_inactivate
    FROM public.user_permissions up
    JOIN current_user_row u ON u.id = up.user_id
    WHERE up.resource_name = resource
    LIMIT 1
  ),
  profile_permission AS (
    SELECT
      pp.resource_name,
      pp.can_view,
      pp.can_include,
      pp.can_edit,
      pp.can_delete,
      pp.can_activate_inactivate
    FROM public.profile_permissions pp
    JOIN current_user_row u ON u.profile_id = pp.profile_id
    WHERE pp.resource_name = resource
      AND NOT EXISTS (SELECT 1 FROM direct_permission)
    LIMIT 1
  ),
  effective_permission AS (
    SELECT * FROM direct_permission
    UNION ALL
    SELECT * FROM profile_permission
  )
  SELECT COALESCE((
    SELECT CASE permission_action
      WHEN 'can_view' THEN COALESCE(can_view, false)
      WHEN 'can_include' THEN COALESCE(can_include, false)
      WHEN 'can_edit' THEN COALESCE(can_edit, false)
      WHEN 'can_delete' THEN COALESCE(can_delete, false)
      WHEN 'can_activate_inactivate' THEN COALESCE(can_activate_inactivate, false)
      ELSE false
    END
    FROM effective_permission
    LIMIT 1
  ), false)
  -- M04: toda permissão interna exige sessão liberada nas 5 etapas.
  AND (SELECT app_private.sessao_interna_ok());
$$;

CREATE OR REPLACE FUNCTION app_private.is_own_employee(target_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND employee_id = target_employee_id
      AND COALESCE(active, true) = true
  )
  AND (SELECT app_private.sessao_interna_ok());
$$;

REVOKE ALL ON FUNCTION app_private.auth_pausa_minutos(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.sessao_liberada_para(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.sessao_interna_liberada() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.sessao_interna_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.auth_pausa_minutos(int) TO service_role;
GRANT EXECUTE ON FUNCTION app_private.sessao_liberada_para(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION app_private.sessao_interna_liberada() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.sessao_interna_ok() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. RPCs do servidor (EXECUTE só service_role; o servidor extrai user/sessão do JWT verificado)
-- ---------------------------------------------------------------------------

-- Segundos de pausa restantes para (chave, etapa); 0 = livre.
CREATE OR REPLACE FUNCTION public.auth_pausa_atual(p_chave text, p_etapa text)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT greatest(0, ceil(extract(epoch FROM (t.pausa_ate - now()))))::int
                   FROM public.auth_tentativas t WHERE t.chave = p_chave AND t.etapa = p_etapa), 0);
$$;

-- Registra UMA falha (senha/totp/email), atomicamente. 3 falhas na janela de 15 min => pausa.
-- Em pausa ativa não soma nada (devolve a pausa restante). Erro de infraestrutura NÃO chama isto.
CREATE OR REPLACE FUNCTION public.auth_registrar_falha(p_chave text, p_etapa text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.auth_tentativas%ROWTYPE; novo_alerta boolean := false; minutos int;
BEGIN
  IF p_chave IS NULL OR length(p_chave) = 0 OR p_etapa NOT IN ('senha', 'totp', 'email') THEN
    RAISE EXCEPTION 'auth_registrar_falha: parametros invalidos';
  END IF;
  INSERT INTO public.auth_tentativas (chave, etapa) VALUES (p_chave, p_etapa) ON CONFLICT DO NOTHING;
  SELECT * INTO r FROM public.auth_tentativas WHERE chave = p_chave AND etapa = p_etapa FOR UPDATE;

  IF r.pausa_ate IS NOT NULL AND r.pausa_ate > now() THEN
    RETURN jsonb_build_object('pausa_seg', ceil(extract(epoch FROM (r.pausa_ate - now())))::int, 'restantes', 0, 'alerta', false, 'pausas', r.pausas);
  END IF;
  IF r.ultima_falha IS NOT NULL AND r.ultima_falha < now() - interval '24 hours' THEN r.pausas := 0; END IF;
  IF r.ultima_falha IS NOT NULL AND r.ultima_falha < now() - interval '15 minutes' THEN r.falhas := 0; END IF;

  r.falhas := r.falhas + 1;
  r.ultima_falha := now();
  IF r.falhas >= 3 THEN
    r.pausas := r.pausas + 1;
    minutos := app_private.auth_pausa_minutos(r.pausas);
    r.pausa_ate := now() + make_interval(mins => minutos);
    r.falhas := 0;
    novo_alerta := r.pausas >= 2;
  END IF;
  UPDATE public.auth_tentativas SET falhas = r.falhas, pausas = r.pausas, pausa_ate = r.pausa_ate, ultima_falha = r.ultima_falha
   WHERE chave = p_chave AND etapa = p_etapa;
  RETURN jsonb_build_object(
    'pausa_seg', CASE WHEN r.pausa_ate IS NOT NULL AND r.pausa_ate > now() THEN ceil(extract(epoch FROM (r.pausa_ate - now())))::int ELSE 0 END,
    'restantes', greatest(0, 3 - r.falhas), 'alerta', novo_alerta, 'pausas', r.pausas);
END $$;

CREATE OR REPLACE FUNCTION public.auth_registrar_sucesso(p_chave text, p_etapa text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.auth_tentativas SET falhas = 0, pausas = 0, pausa_ate = NULL WHERE chave = p_chave AND etapa = p_etapa;
$$;

-- Cria o desafio de e-mail. O destino é lido de public.users aqui dentro; o cliente nunca informa.
-- Atômico por (user, sessão) via advisory lock. Retorna {status, desafio_id, destino, espera_seg}.
-- status: ok | negado | etapa_anterior | pausa | reenvio_cedo | limite
CREATE OR REPLACE FUNCTION public.auth_criar_desafio(
  p_user uuid, p_session uuid, p_finalidade text, p_hash text,
  p_ttl_seg int DEFAULT 600, p_max_tent int DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users%ROWTYPE; s auth.sessions%ROWTYPE; ultimo timestamptz; n int; esp int; novo uuid := gen_random_uuid();
BEGIN
  IF p_finalidade NOT IN ('acesso_workspace', 'ativacao_fator') OR p_hash IS NULL OR length(p_hash) < 32 THEN
    RETURN jsonb_build_object('status', 'negado');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_session::text, 0));

  SELECT * INTO u FROM public.users WHERE id = p_user;
  IF NOT FOUND OR NOT coalesce(u.active, true) OR coalesce(u.email, '') = '' OR lower(u.email) !~ '@brspromotora\.com\.br$' THEN
    RETURN jsonb_build_object('status', 'negado');
  END IF;
  IF EXISTS (SELECT 1 FROM public.auth_bloqueios_admin b WHERE b.user_id = p_user AND b.removido_em IS NULL AND (b.ate IS NULL OR b.ate > now())) THEN
    RETURN jsonb_build_object('status', 'negado');
  END IF;
  SELECT * INTO s FROM auth.sessions WHERE id = p_session AND user_id = p_user AND (not_after IS NULL OR not_after > now());
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM auth.mfa_amr_claims a WHERE a.session_id = p_session AND a.authentication_method = 'password') THEN
    RETURN jsonb_build_object('status', 'negado');
  END IF;

  IF p_finalidade = 'acesso_workspace' THEN
    -- precisa de TOTP verificado, aprovado e ligado a ESTA sessão
    IF NOT EXISTS (
      SELECT 1 FROM public.auth_mfa_fatores f
      JOIN auth.mfa_factors mf ON mf.id = f.factor_id AND mf.user_id = p_user AND mf.status::text = 'verified'
      WHERE f.user_id = p_user AND f.removido_em IS NULL AND f.factor_id = s.factor_id
        AND EXISTS (SELECT 1 FROM auth.mfa_amr_claims a WHERE a.session_id = p_session AND a.authentication_method = 'totp')
    ) THEN RETURN jsonb_build_object('status', 'etapa_anterior'); END IF;
  ELSE
    -- ativação: só se o usuário ainda NÃO tem fator aprovado (troca exige remoção administrativa antes)
    IF EXISTS (SELECT 1 FROM public.auth_mfa_fatores f WHERE f.user_id = p_user AND f.removido_em IS NULL) THEN
      RETURN jsonb_build_object('status', 'negado');
    END IF;
  END IF;

  esp := public.auth_pausa_atual(p_user::text, 'email');
  IF esp > 0 THEN RETURN jsonb_build_object('status', 'pausa', 'espera_seg', esp); END IF;

  SELECT max(criado_em) INTO ultimo FROM public.auth_desafios_email WHERE session_id = p_session AND finalidade = p_finalidade;
  IF ultimo IS NOT NULL AND ultimo > now() - interval '60 seconds' THEN
    RETURN jsonb_build_object('status', 'reenvio_cedo', 'espera_seg', ceil(extract(epoch FROM (ultimo + interval '60 seconds' - now())))::int);
  END IF;
  SELECT count(*), min(criado_em) INTO n, ultimo FROM public.auth_desafios_email
   WHERE session_id = p_session AND criado_em > now() - interval '15 minutes';
  IF n >= 3 THEN
    RETURN jsonb_build_object('status', 'limite', 'espera_seg', greatest(1, ceil(extract(epoch FROM (ultimo + interval '15 minutes' - now())))::int));
  END IF;
  SELECT count(*), min(criado_em) INTO n, ultimo FROM public.auth_desafios_email
   WHERE user_id = p_user AND criado_em > now() - interval '24 hours';
  IF n >= 10 THEN
    RETURN jsonb_build_object('status', 'limite', 'espera_seg', greatest(1, ceil(extract(epoch FROM (ultimo + interval '24 hours' - now())))::int));
  END IF;

  UPDATE public.auth_desafios_email SET invalidado_em = now(), motivo_invalidacao = 'substituido'
   WHERE session_id = p_session AND finalidade = p_finalidade AND consumido_em IS NULL AND invalidado_em IS NULL;
  INSERT INTO public.auth_desafios_email (id, user_id, session_id, finalidade, destino_email, codigo_hash, expira_em, max_tentativas)
  VALUES (novo, p_user, p_session, p_finalidade, u.email, p_hash, now() + make_interval(secs => greatest(60, least(p_ttl_seg, 900))), greatest(1, least(p_max_tent, 10)));
  RETURN jsonb_build_object('status', 'ok', 'desafio_id', novo, 'destino', u.email);
END $$;

-- Resultado da entrega. Falha/indisponibilidade invalida o desafio (nunca libera).
CREATE OR REPLACE FUNCTION public.auth_entrega_desafio(p_id uuid, p_estado text, p_ref text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.auth_desafios_email
     SET entrega_estado = p_estado, entrega_ref = left(p_ref, 120),
         invalidado_em = CASE WHEN p_estado IN ('falhou', 'incerta') AND consumido_em IS NULL THEN coalesce(invalidado_em, now()) ELSE invalidado_em END,
         motivo_invalidacao = CASE WHEN p_estado IN ('falhou', 'incerta') AND consumido_em IS NULL THEN coalesce(motivo_invalidacao, 'entrega_' || p_estado) ELSE motivo_invalidacao END
   WHERE id = p_id AND p_estado IN ('pendente', 'aceita', 'falhou', 'incerta');
$$;

-- Consumo atômico do código. Retorna {status, restantes, pausa_seg, alerta, expira_em}.
-- status: liberado | incorreto | expirado | esgotado | inexistente | pausa | etapa_anterior
-- "inexistente" cobre desafio de outra sessão e código já consumido (reutilização).
CREATE OR REPLACE FUNCTION public.auth_verificar_desafio(p_user uuid, p_session uuid, p_finalidade text, p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.auth_desafios_email%ROWTYPE; esp int; f jsonb; validade timestamptz; s auth.sessions%ROWTYPE;
BEGIN
  IF p_finalidade NOT IN ('acesso_workspace', 'ativacao_fator') THEN RETURN jsonb_build_object('status', 'inexistente'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_session::text, 0));
  esp := public.auth_pausa_atual(p_user::text, 'email');
  IF esp > 0 THEN RETURN jsonb_build_object('status', 'pausa', 'pausa_seg', esp); END IF;

  SELECT * INTO d FROM public.auth_desafios_email
   WHERE user_id = p_user AND session_id = p_session AND finalidade = p_finalidade
     AND consumido_em IS NULL AND invalidado_em IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'inexistente'); END IF;

  IF d.expira_em <= now() THEN
    UPDATE public.auth_desafios_email SET invalidado_em = now(), motivo_invalidacao = 'expirado' WHERE id = d.id;
    RETURN jsonb_build_object('status', 'expirado');
  END IF;
  IF d.tentativas >= d.max_tentativas THEN
    UPDATE public.auth_desafios_email SET invalidado_em = now(), motivo_invalidacao = 'esgotado' WHERE id = d.id;
    RETURN jsonb_build_object('status', 'esgotado');
  END IF;

  UPDATE public.auth_desafios_email SET tentativas = tentativas + 1 WHERE id = d.id;
  IF d.codigo_hash IS DISTINCT FROM p_hash THEN
    f := public.auth_registrar_falha(p_user::text, 'email');
    IF d.tentativas + 1 >= d.max_tentativas THEN
      UPDATE public.auth_desafios_email SET invalidado_em = now(), motivo_invalidacao = 'esgotado' WHERE id = d.id;
      RETURN jsonb_build_object('status', 'esgotado', 'pausa_seg', f -> 'pausa_seg', 'alerta', f -> 'alerta');
    END IF;
    RETURN jsonb_build_object('status', 'incorreto', 'restantes', d.max_tentativas - d.tentativas - 1,
                              'pausa_seg', f -> 'pausa_seg', 'alerta', f -> 'alerta');
  END IF;

  -- código certo: a sessão ainda precisa estar no estado anterior (defesa em profundidade)
  SELECT * INTO s FROM auth.sessions WHERE id = p_session AND user_id = p_user AND (not_after IS NULL OR not_after > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'inexistente'); END IF;
  IF p_finalidade = 'acesso_workspace' AND NOT EXISTS (
       SELECT 1 FROM public.auth_mfa_fatores ff WHERE ff.user_id = p_user AND ff.removido_em IS NULL AND ff.factor_id = s.factor_id) THEN
    RETURN jsonb_build_object('status', 'etapa_anterior');
  END IF;

  UPDATE public.auth_desafios_email SET consumido_em = now() WHERE id = d.id;
  PERFORM public.auth_registrar_sucesso(p_user::text, 'email');
  -- Validade do acesso: o menor entre 12 h e 23:59 de São Paulo do dia. Ativação: prova de 10 min.
  validade := CASE WHEN p_finalidade = 'acesso_workspace' THEN
      least(now() + interval '12 hours',
            (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '23 hours 59 minutes') AT TIME ZONE 'America/Sao_Paulo')
    ELSE now() + interval '10 minutes' END;
  IF validade <= now() THEN validade := now() + interval '1 minute'; END IF;
  INSERT INTO public.auth_sessao_liberacoes (user_id, session_id, finalidade, desafio_id, expira_em)
  VALUES (p_user, p_session, p_finalidade, d.id, validade)
  ON CONFLICT (session_id, finalidade) DO UPDATE
    SET desafio_id = excluded.desafio_id, criada_em = now(), expira_em = excluded.expira_em, revogada_em = NULL, motivo_revogacao = NULL, user_id = excluded.user_id;
  RETURN jsonb_build_object('status', 'liberado', 'expira_em', validade);
END $$;

-- A prova de ativação existe, vale, e o usuário ainda não tem fator aprovado? (antes do mfa.enroll)
CREATE OR REPLACE FUNCTION public.auth_pode_ativar_fator(p_user uuid, p_session uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.auth_sessao_liberacoes l
    WHERE l.user_id = p_user AND l.session_id = p_session AND l.finalidade = 'ativacao_fator'
      AND l.revogada_em IS NULL AND l.expira_em > now())
  AND NOT EXISTS (SELECT 1 FROM public.auth_mfa_fatores f WHERE f.user_id = p_user AND f.removido_em IS NULL)
  AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user AND coalesce(u.active, true));
$$;

-- Aprova o fator recém-verificado. Só com prova de ativação válida (e-mail do titular confirmado
-- nesta sessão) e sem fator aprovado anterior. Consome a prova. Retorna ok | sem_prova | fator_invalido.
CREATE OR REPLACE FUNCTION public.auth_aprovar_fator(p_user uuid, p_session uuid, p_factor_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text, 1));
  IF NOT public.auth_pode_ativar_fator(p_user, p_session) THEN RETURN 'sem_prova'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.mfa_factors mf WHERE mf.id = p_factor_id AND mf.user_id = p_user
                   AND mf.status::text = 'verified' AND mf.factor_type::text = 'totp') THEN
    RETURN 'fator_invalido';
  END IF;
  INSERT INTO public.auth_mfa_fatores (factor_id, user_id, aprovado_na_sessao) VALUES (p_factor_id, p_user, p_session);
  UPDATE public.auth_sessao_liberacoes SET revogada_em = now(), motivo_revogacao = 'prova_ativacao_usada'
   WHERE user_id = p_user AND session_id = p_session AND finalidade = 'ativacao_fator' AND revogada_em IS NULL;
  RETURN 'ok';
END $$;

-- Revoga liberações (logout, troca de senha/e-mail, desativação...). p_exceto_session mantém uma sessão.
-- Também invalida desafios pendentes (o destino/identidade pode ter mudado). Retorna quantas revogou.
CREATE OR REPLACE FUNCTION public.auth_revogar_liberacoes(p_user uuid, p_motivo text, p_exceto_session uuid DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int;
BEGIN
  UPDATE public.auth_sessao_liberacoes SET revogada_em = now(), motivo_revogacao = left(coalesce(p_motivo, 'revogada'), 60)
   WHERE user_id = p_user AND revogada_em IS NULL AND (p_exceto_session IS NULL OR session_id <> p_exceto_session);
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.auth_desafios_email SET invalidado_em = now(), motivo_invalidacao = left(coalesce(p_motivo, 'revogada'), 60)
   WHERE user_id = p_user AND consumido_em IS NULL AND invalidado_em IS NULL AND (p_exceto_session IS NULL OR session_id <> p_exceto_session);
  RETURN n;
END $$;

-- Remoção de fator (troca de telefone/perda): marca removido, revoga TUDO; nova ativação refaz o e-mail.
CREATE OR REPLACE FUNCTION public.auth_remover_fator(p_user uuid, p_motivo text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.auth_mfa_fatores SET removido_em = now(), removido_motivo = left(coalesce(p_motivo, 'removido'), 60)
   WHERE user_id = p_user AND removido_em IS NULL;
  RETURN public.auth_revogar_liberacoes(p_user, 'fator_removido', NULL);
END $$;

-- Estado consolidado da sessão para o servidor decidir a etapa (sem expor segredo).
CREATE OR REPLACE FUNCTION public.auth_estado_sessao(p_user uuid, p_session uuid, p_aal text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'liberada', app_private.sessao_liberada_para(p_user, p_session, p_aal),
    'tem_fator', EXISTS (SELECT 1 FROM public.auth_mfa_fatores f WHERE f.user_id = p_user AND f.removido_em IS NULL),
    'fator_id', (SELECT f.factor_id FROM public.auth_mfa_fatores f WHERE f.user_id = p_user AND f.removido_em IS NULL LIMIT 1),
    'prova_ativacao', public.auth_pode_ativar_fator(p_user, p_session),
    'desafio_pendente', EXISTS (SELECT 1 FROM public.auth_desafios_email d WHERE d.user_id = p_user AND d.session_id = p_session
                                 AND d.consumido_em IS NULL AND d.invalidado_em IS NULL AND d.expira_em > now()),
    'pausa_email_seg', public.auth_pausa_atual(p_user::text, 'email'),
    'pausa_totp_seg', public.auth_pausa_atual(p_user::text, 'totp'),
    'bloqueado_admin', EXISTS (SELECT 1 FROM public.auth_bloqueios_admin b WHERE b.user_id = p_user AND b.removido_em IS NULL AND (b.ate IS NULL OR b.ate > now())),
    'interno_ativo', EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user AND coalesce(u.active, true)));
$$;

-- Bloqueio administrativo (única forma de bloqueio longo). p_ate NULL = até desbloqueio manual.
CREATE OR REPLACE FUNCTION public.auth_bloquear_usuario(p_user uuid, p_ate timestamptz, p_motivo text, p_por uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE novo uuid;
BEGIN
  IF p_por IS NULL THEN RAISE EXCEPTION 'bloqueio administrativo exige quem bloqueou'; END IF;
  UPDATE public.auth_bloqueios_admin SET removido_em = now(), removido_por = p_por, removido_motivo = 'substituido'
   WHERE user_id = p_user AND removido_em IS NULL;
  INSERT INTO public.auth_bloqueios_admin (user_id, ate, motivo, bloqueado_por) VALUES (p_user, p_ate, left(p_motivo, 300), p_por) RETURNING id INTO novo;
  PERFORM public.auth_revogar_liberacoes(p_user, 'bloqueio_admin', NULL);
  RETURN novo;
END $$;

CREATE OR REPLACE FUNCTION public.auth_desbloquear_usuario(p_user uuid, p_por uuid, p_motivo text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int;
BEGIN
  IF p_por IS NULL THEN RAISE EXCEPTION 'desbloqueio exige quem liberou'; END IF;
  UPDATE public.auth_bloqueios_admin SET removido_em = now(), removido_por = p_por, removido_motivo = left(p_motivo, 300)
   WHERE user_id = p_user AND removido_em IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  -- desbloquear também zera as pausas automáticas de TOTP/e-mail do usuário
  UPDATE public.auth_tentativas SET falhas = 0, pausas = 0, pausa_ate = NULL WHERE chave = p_user::text;
  RETURN n;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Ciclo de vida no banco (independe do código da aplicação)
-- ---------------------------------------------------------------------------
-- Desativar usuário, trocar e-mail ou banir no Auth: revoga liberações e desafios imediatamente.
CREATE OR REPLACE FUNCTION app_private.auth_revogar_por_mudanca_cadastro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_SCHEMA = 'public' THEN
    IF (OLD.active IS DISTINCT FROM NEW.active AND NOT coalesce(NEW.active, true)) THEN
      PERFORM public.auth_revogar_liberacoes(NEW.id, 'usuario_desativado', NULL);
    ELSIF (OLD.email IS DISTINCT FROM NEW.email) THEN
      PERFORM public.auth_revogar_liberacoes(NEW.id, 'email_alterado', NULL);
    END IF;
  ELSE
    IF (OLD.email IS DISTINCT FROM NEW.email) OR (NEW.banned_until IS NOT NULL AND NEW.banned_until IS DISTINCT FROM OLD.banned_until) THEN
      PERFORM public.auth_revogar_liberacoes(NEW.id, 'auth_email_ou_ban', NULL);
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.auth_revogar_por_mudanca_cadastro() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS m04_users_revogar_liberacoes ON public.users;
CREATE TRIGGER m04_users_revogar_liberacoes AFTER UPDATE OF active, email ON public.users
  FOR EACH ROW EXECUTE FUNCTION app_private.auth_revogar_por_mudanca_cadastro();
DROP TRIGGER IF EXISTS m04_authusers_revogar_liberacoes ON auth.users;
CREATE TRIGGER m04_authusers_revogar_liberacoes AFTER UPDATE OF email, banned_until ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app_private.auth_revogar_por_mudanca_cadastro();

-- ---------------------------------------------------------------------------
-- 5. ACL final das RPCs (o default do Supabase concede EXECUTE a anon/authenticated)
-- ---------------------------------------------------------------------------
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.auth_pausa_atual(text,text)', 'public.auth_registrar_falha(text,text)', 'public.auth_registrar_sucesso(text,text)',
    'public.auth_criar_desafio(uuid,uuid,text,text,int,int)', 'public.auth_entrega_desafio(uuid,text,text)',
    'public.auth_verificar_desafio(uuid,uuid,text,text)', 'public.auth_pode_ativar_fator(uuid,uuid)',
    'public.auth_aprovar_fator(uuid,uuid,uuid)', 'public.auth_revogar_liberacoes(uuid,text,uuid)',
    'public.auth_remover_fator(uuid,text)', 'public.auth_estado_sessao(uuid,uuid,text)',
    'public.auth_bloquear_usuario(uuid,timestamptz,text,uuid)', 'public.auth_desbloquear_usuario(uuid,uuid,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
  RAISE NOTICE 'M04: login em cinco etapas instalado (gate em has_permission/is_own_employee)';
END $$;
