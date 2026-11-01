-- Incidente 2026-10-31 — M03-A parte 2: comunicados, chat interno, anon e SECURITY DEFINER.
-- LOCAL, NÃO APLICADA. Depende de 20261101010000_security_initial_rls_hardening.
-- Sem rollback que reabra exposição: para desfazer um efeito colateral, desligue o recurso
-- ou conceda a permissão ao perfil certo; nunca recrie USING (true).
--
-- Evidência dos consumidores (src/):
--  * comunicados / comunicado_target_profiles / comunicado_reads: todas as leituras e
--    escritas de API usam service_role (src/lib/comunicados-service.ts, src/app/api/comunicados/**).
--    O único consumo com a sessão do usuário é o Realtime em HubHeader.tsx:244, que só refaz o badge.
--  * workspace_chat_user_profiles: leitura/escrita via service_role (src/app/api/chat/*,
--    src/lib/interno-chat/data.ts); o navegador só assina o Realtime
--    (MessengerNotificationBridge.tsx:264).
-- Por isso: authenticated perde toda escrita e a leitura passa a exigir USUÁRIO INTERNO ATIVO.
-- Não foi aplicado GRANT por coluna: o Realtime (postgres_changes) depende do SELECT da
-- tabela e a restrição por coluna poderia silenciar eventos; as colunas são do próprio
-- conteúdo do aviso/presença destinado aos internos.

-- ---------------------------------------------------------------------------
-- 0. Preflight
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  faltando text[] := ARRAY[]::text[];
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'comunicados', 'comunicado_target_profiles', 'comunicado_reads', 'workspace_chat_user_profiles']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN faltando := faltando || ('tabela public.' || t); END IF;
  END LOOP;
  IF to_regprocedure('app_private.has_permission(text,text)') IS NULL THEN faltando := faltando || 'app_private.has_permission'; END IF;
  IF array_length(faltando, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'M03-A preflight (parte 2): faltam objetos: %', array_to_string(faltando, ', ');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Identidade interna ativa
-- ---------------------------------------------------------------------------
-- Interno = linha ativa em public.users (só o cadastro administrativo cria) e sem a marca
-- de externo no JWT. Parceiro/CRM entram pelo SSO no mesmo projeto Auth, mas não têm linha.
CREATE OR REPLACE FUNCTION app_private.is_active_internal_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND COALESCE(u.active, true) = true
      AND COALESCE(u.email, '') NOT ILIKE '%@parceiro.brspromotora.com.br'
  )
  AND COALESCE(auth.jwt() -> 'app_metadata' ->> 'external', '') = '';
$$;
REVOKE ALL ON FUNCTION app_private.is_active_internal_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.is_active_internal_user() TO authenticated;

-- O aviso é direcionado a perfis (comunicado_target_profiles); sem alvo = todos os internos.
CREATE OR REPLACE FUNCTION app_private.comunicado_alcanca_usuario(p_comunicado uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.comunicado_target_profiles t WHERE t.comunicado_id = p_comunicado)
      OR EXISTS (
        SELECT 1
        FROM public.comunicado_target_profiles t
        JOIN public.users u ON u.profile_id = t.profile_id
        WHERE t.comunicado_id = p_comunicado
          AND u.id = auth.uid()
          AND COALESCE(u.active, true) = true
      );
$$;
REVOKE ALL ON FUNCTION app_private.comunicado_alcanca_usuario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.comunicado_alcanca_usuario(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. comunicados e tabelas ligadas
-- ---------------------------------------------------------------------------
ALTER TABLE public.comunicados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comunicado_target_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comunicado_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comunicados_select_authenticated ON public.comunicados;
DROP POLICY IF EXISTS comunicados_select_internos ON public.comunicados;
CREATE POLICY comunicados_select_internos ON public.comunicados
  FOR SELECT TO authenticated
  USING (
    app_private.is_active_internal_user()
    AND (
      app_private.has_permission('sistema-comunicados', 'can_view')
      OR (
        status = 'ativo'
        AND now() BETWEEN data_inicio_veiculacao AND data_fim_veiculacao
        AND app_private.comunicado_alcanca_usuario(id)
      )
    )
  );

-- Direcionamento por perfil: sem consumidor com a sessão do usuário (leitura só por service_role).
DROP POLICY IF EXISTS comunicado_target_profiles_select_authenticated ON public.comunicado_target_profiles;

DROP POLICY IF EXISTS comunicado_reads_select_own ON public.comunicado_reads;
CREATE POLICY comunicado_reads_select_own ON public.comunicado_reads
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND app_private.is_active_internal_user());

REVOKE ALL ON public.comunicados, public.comunicado_target_profiles, public.comunicado_reads FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.comunicados FROM authenticated;
REVOKE ALL ON public.comunicado_target_profiles FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.comunicado_reads FROM authenticated;

-- ---------------------------------------------------------------------------
-- 3. workspace_chat_user_profiles (presença, humor, apelido)
-- ---------------------------------------------------------------------------
ALTER TABLE public.workspace_chat_user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_chat_user_profiles_select_authenticated ON public.workspace_chat_user_profiles;
DROP POLICY IF EXISTS workspace_chat_user_profiles_select_internos ON public.workspace_chat_user_profiles;
CREATE POLICY workspace_chat_user_profiles_select_internos ON public.workspace_chat_user_profiles
  FOR SELECT TO authenticated
  USING (app_private.is_active_internal_user());

-- Escrita só pelo servidor (service_role): as rotas /api/chat/presence e /api/chat/profile.
DROP POLICY IF EXISTS workspace_chat_user_profiles_insert_own ON public.workspace_chat_user_profiles;
DROP POLICY IF EXISTS workspace_chat_user_profiles_update_own ON public.workspace_chat_user_profiles;

REVOKE ALL ON public.workspace_chat_user_profiles FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.workspace_chat_user_profiles FROM authenticated;

-- ---------------------------------------------------------------------------
-- 4. anon sem consumidor: tabelas de public com RLS e SEM política para anon/PUBLIC
-- ---------------------------------------------------------------------------
-- Nelas o anon já não lê nada (RLS sem política); revogar remove o privilégio de tabela
-- (inclusive TRUNCATE/REFERENCES/TRIGGER, que ignoram RLS). Tabelas SEM RLS ficam como
-- estão e são listadas por NOTICE para decisão (M03-0), porque revogar poderia quebrar
-- consumidor desconhecido.
DO $$
DECLARE
  r record;
  n_revogadas int := 0;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS tabela
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = c.relname
          AND (p.roles && ARRAY['public', 'anon']::name[])
      )
  LOOP
    EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, anon', r.tabela);
    n_revogadas := n_revogadas + 1;
  END LOOP;
  RAISE NOTICE 'M03-A: anon/PUBLIC revogado em % tabela(s) de public com RLS e sem politica para anon', n_revogadas;

  FOR r IN
    SELECT c.oid::regclass AS tabela
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
  LOOP
    RAISE NOTICE 'M03-A ATENCAO: % esta SEM RLS (anon/authenticated podem ter acesso total); decidir no M03-0', r.tabela;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. SECURITY DEFINER: EXECUTE mínimo e search_path fixo (Workspace, secdef.txt)
-- ---------------------------------------------------------------------------
-- Funções de gatilho: o gatilho dispara sem EXECUTE do chamador; ninguém precisa chamá-las.
-- wa_*: chamadas só pelo worker/ações do servidor com service_role (src/lib/disparo-whatsapp/*).
DO $$
DECLARE
  assinatura text;
  alvo regprocedure;
BEGIN
  FOREACH assinatura IN ARRAY ARRAY[
    'app_private.helpdesk_comentario_notificar()',
    'app_private.helpdesk_historico_etapa()',
    'app_private.helpdesk_notificar()',
    'app_private.helpdesk_registrar_historico()',
    'app_private.limpar_chat_atendimento_sinais()',
    'public.wa_campaign_recipients_counter_trg()',
    'public.workspace_chat_ao_criar_usuario()',
    'public.wa_bump_slot(uuid)',
    'public.wa_campaign_recount(uuid)',
    'public.wa_claim_next_recipient(uuid)'
  ] LOOP
    alvo := to_regprocedure(assinatura);
    IF alvo IS NULL THEN
      RAISE NOTICE 'M03-A: funcao % nao existe neste ambiente; ignorada', assinatura;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', alvo);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', alvo);
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', alvo);
  END LOOP;
END $$;

-- Nenhuma SECURITY DEFINER de public/app_private fica executável por anon/PUBLIC (nenhum
-- consumidor anônimo nas RPCs: todas as chamadas .rpc() do código usam a sessão do usuário
-- ou service_role). authenticated só permanece nas funções de apoio de RLS abaixo; qualquer
-- outra que reste com authenticated é apenas listada, sem alteração, para o M03-0.
DO $$
DECLARE
  f record;
  permitidas_authenticated constant text[] := ARRAY[
    'has_permission', 'is_own_employee', 'is_active_internal_user', 'comunicado_alcanca_usuario',
    'crm_usuario_do_auth', 'crm_chat_membro_do_canal', 'crm_agente_parceiro_do_usuario'];
  n_anon int := 0;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS assinatura, p.proname::text AS nome,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'app_private') AND p.prosecdef
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    IF has_function_privilege('anon', f.assinatura, 'EXECUTE') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.assinatura);
      -- authenticated que dependia só do PUBLIC mantém o acesso que já tinha (grant explícito).
      IF f.auth_exec THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.assinatura);
      END IF;
      n_anon := n_anon + 1;
    END IF;
    IF f.auth_exec AND NOT (f.nome = ANY (permitidas_authenticated)) THEN
      RAISE NOTICE 'M03-A: SECURITY DEFINER % ainda executavel por authenticated (nao alterada)', f.assinatura;
    END IF;
  END LOOP;
  RAISE NOTICE 'M03-A: EXECUTE de anon/PUBLIC revogado em % funcao(oes) SECURITY DEFINER', n_anon;
END $$;
