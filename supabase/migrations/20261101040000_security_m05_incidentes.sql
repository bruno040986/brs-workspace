-- M05 (incidente BRS 2026-10-31): núcleo durável de eventos, incidentes, intenções de notificação e monitor de configuração.
-- Sem IA, sem Telegram/WhatsApp (isso é M06): aqui só se persiste e se cria intenção PENDENTE.
-- Desenho: INCIDENTE-2026-10-31-PROJETO-TECNICO-02.md §5 (C) e §7.5. Idempotente (pode reaplicar).
--   * Tudo em public.seg_*: RLS ligada SEM política (deny-all para anon/authenticated), REVOKE explícito,
--     acesso por service_role; leitura do painel via views seg_v_*; funções com search_path fixo e EXECUTE só service_role.
--   * Estados independentes: incidente / diagnóstico IA / intenção / tentativa por canal / recibo.
--   * Persistência antes do efeito: evento + incidente + intenção na MESMA transação (seg_registrar_evento).
--   * Valores numéricos em seg_config = PROPOSTAS do projeto técnico §5.6 (não são decisão do Bruno).

DO $$
DECLARE faltando text[] := '{}';
BEGIN
  IF to_regclass('public.users') IS NULL THEN faltando := faltando || 'public.users'; END IF;
  IF to_regclass('public.user_permissions') IS NULL THEN faltando := faltando || 'public.user_permissions'; END IF;
  IF to_regclass('public.profile_permissions') IS NULL THEN faltando := faltando || 'public.profile_permissions'; END IF;
  IF to_regclass('storage.buckets') IS NULL THEN faltando := faltando || 'storage.buckets'; END IF;
  IF cardinality(faltando) > 0 THEN
    RAISE EXCEPTION 'M05: pré-requisito ausente: %', array_to_string(faltando, ', ');
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Configuração editável (PROPOSTAS). ON CONFLICT DO NOTHING: ajuste humano nunca é sobrescrito.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seg_config (
  chave text PRIMARY KEY,
  valor jsonb NOT NULL,
  descricao text,
  origem text NOT NULL DEFAULT 'proposta, não decisão do Bruno',
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.seg_config IS 'M05: limites/janelas/orçamentos. Valores semeados são PROPOSTA (projeto técnico 02 §5.6), não decisão do Bruno.';

INSERT INTO public.seg_config (chave, valor, descricao, origem) VALUES
  ('agrup.janela_minutos', '10', 'Janela de agrupamento por chave de incidente (min)', 'proposta, não decisão do Bruno (PT02 §5.6)'),
  ('agrup.resumo_minutos', '15', 'Resumo a cada N min enquanto o incidente está ativo (consumido pelo M06)', 'proposta, não decisão do Bruno (PT02 §5.6)'),
  ('card.max_chaves_por_regra_hora', '50', 'Máx. de chaves distintas por regra por hora; excedente vira 1 incidente agregado "volume anômalo"', 'proposta, não decisão do Bruno (PT02 §5.6)'),
  ('incidente.max_eventos_vinculados', '200', 'Máx. de eventos ligados a um incidente (excedente só incrementa eventos_suprimidos)', 'proposta, não decisão do Bruno (PT02 §5.6: entrada IA ≤ 200 eventos)'),
  ('orcamento.global_hora', '20', 'Mensagens/h ao Bruno, todos os canais (M06)', 'proposta, não decisão do Bruno (PT02 §5.6)'),
  ('orcamento.global_dia', '60', 'Mensagens/dia ao Bruno, todos os canais (M06)', 'proposta, não decisão do Bruno (PT02 §5.6)'),
  ('orcamento.whatsapp_hora', '6', 'WhatsApp, todas as instâncias somadas, por hora (M06)', 'proposta, não decisão do Bruno (PT02 §5.6)'),
  ('orcamento.whatsapp_dia', '20', 'WhatsApp, todas as instâncias somadas, por dia (M06)', 'proposta, não decisão do Bruno (PT02 §5.6)'),
  ('orcamento.whatsapp_instancia_dia', '10', 'Teto por instância WhatsApp por dia (M06)', 'proposta, não decisão do Bruno (PT02 §5.6)'),
  ('orcamento.slot_critico_hora', '1', 'Slot reservado por hora só para crítico (M06)', 'proposta, não decisão do Bruno (PT02 §5.6)'),
  ('ia.diagnosticos_por_incidente', '1', 'Diagnósticos por incidente (M08)', 'proposta, não decisão do Bruno (PT02 §5.6)'),
  ('ia.reanalises_max', '2', 'Reanálises por incidente (M08)', 'proposta, não decisão do Bruno (PT02 §5.6)'),
  ('ia.chamadas_dia', '30', 'Chamadas de IA por dia (M08)', 'proposta, não decisão do Bruno (PT02 §5.6)'),
  ('ia.eventos_por_consulta', '200', 'Eventos por consulta à IA (M08)', 'proposta, não decisão do Bruno (PT02 §5.6)'),
  ('ia.retomada_max_pendentes_por_janela', '5', 'Diagnósticos pendentes reprocessados por janela de 10 min (M08)', 'proposta, não decisão do Bruno (PT02 §5.3)'),
  ('saude.alerta_intervalo_minutos', '30', '1 alerta de saúde por dependência a cada N min (M06)', 'proposta, não decisão do Bruno (PT02 §5.6)'),
  ('lease.intencao_segundos', '120', 'Lease da intenção em envio (M06)', 'proposta do executor M05, sem valor no PT02'),
  ('regra.login_falhas_identificador.limiar', '5', 'Falhas de login por identificador informado na janela até abrir incidente', 'proposta do executor M05, sem valor no PT02 (M04 pausa em 3)'),
  ('regra.login_falhas_origem.limiar', '15', 'Falhas de login por origem (IP observado) na janela até abrir incidente', 'proposta do executor M05, sem valor no PT02'),
  ('monitor.buckets_publicos_permitidos', '[]', 'Ids de buckets que PODEM ser públicos (ex.: logos/banners em bucket separado)', 'decisão 4 (2026-11-01): lista inicial vazia'),
  ('monitor.auth_user_sem_cadastro_min', '10', 'Minutos de tolerância antes de tratar auth.users sem public.users como possível signup', 'proposta do executor M05')
ON CONFLICT (chave) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seg_cfg(p_chave text, p_padrao numeric)
RETURNS numeric LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT coalesce((SELECT (valor #>> '{}')::numeric FROM public.seg_config WHERE chave = p_chave AND jsonb_typeof(valor) = 'number'), p_padrao)
$$;

-- ---------------------------------------------------------------------------------------------
-- Sanitização de payload (defesa em profundidade; o TS também sanitiza)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seg_sanitizar(p jsonb, p_nivel int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE k text; v jsonb; r jsonb; a jsonb; i int; s text;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  IF p_nivel > 4 THEN RETURN to_jsonb('[profundo]'::text); END IF;
  CASE jsonb_typeof(p)
    WHEN 'object' THEN
      r := '{}'::jsonb;
      FOR k, v IN SELECT key, value FROM jsonb_each(p) LIMIT 40 LOOP
        IF k ~* '(pass|senha|secret|segredo|token|codigo|code|otp|cookie|authorization|apikey|api_key|jwt|bearer|credential|totp|signature|assinatura)' THEN
          r := r || jsonb_build_object(left(k, 60), '[removido]');
        ELSE
          r := r || jsonb_build_object(left(k, 60), public.seg_sanitizar(v, p_nivel + 1));
        END IF;
      END LOOP;
      RETURN r;
    WHEN 'array' THEN
      a := '[]'::jsonb;
      FOR i IN 0 .. least(jsonb_array_length(p), 20) - 1 LOOP
        a := a || jsonb_build_array(public.seg_sanitizar(p -> i, p_nivel + 1));
      END LOOP;
      RETURN a;
    WHEN 'string' THEN
      s := p #>> '{}';
      IF s ~ '^(eyJ[A-Za-z0-9_-]{5,}\.|Bearer\s)' OR s ~ '[A-Za-z0-9_-]{40,}' THEN RETURN to_jsonb('[removido]'::text); END IF;
      RETURN to_jsonb(left(s, 300));
    ELSE
      RETURN p;
  END CASE;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.seg_incidente_numero_seq;

CREATE TABLE IF NOT EXISTS public.seg_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  fonte text NOT NULL CHECK (fonte ~ '^[a-z0-9_.-]{1,40}$'),
  id_origem text CHECK (id_origem IS NULL OR length(id_origem) <= 120),
  tipo text NOT NULL CHECK (tipo ~ '^[a-z0-9_.]{1,60}$'),
  estado text NOT NULL DEFAULT 'recebido' CHECK (estado IN ('recebido', 'correlacionado', 'descartado_regra')),
  identidade_informada text CHECK (identidade_informada IS NULL OR length(identidade_informada) <= 254), -- o que o cliente digitou; NÃO prova autoria
  identidade_validada_user_id uuid,                                                                        -- só se o servidor validou
  request_id text CHECK (request_id IS NULL OR length(request_id) <= 120),
  ip_observado text CHECK (ip_observado IS NULL OR length(ip_observado) <= 64),                            -- dado não confiável, sem atribuição
  user_agent_observado text CHECK (user_agent_observado IS NULL OR length(user_agent_observado) <= 300),
  cobertura_fonte text CHECK (cobertura_fonte IS NULL OR length(cobertura_fonte) <= 200),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash text NOT NULL,
  UNIQUE (fonte, id_origem)
);
CREATE INDEX IF NOT EXISTS seg_eventos_criado ON public.seg_eventos (criado_em DESC);

CREATE TABLE IF NOT EXISTS public.seg_incidentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero bigint NOT NULL UNIQUE DEFAULT nextval('public.seg_incidente_numero_seq'),
  codigo text GENERATED ALWAYS AS ('INC-' || numero::text) STORED, -- só citar depois do COMMIT
  regra text NOT NULL,
  contexto text NOT NULL,
  chave_correlacao text NOT NULL UNIQUE,        -- regra | contexto | bucket da janela
  janela_inicio timestamptz NOT NULL,
  janela_fim timestamptz NOT NULL,
  gravidade text NOT NULL CHECK (gravidade IN ('baixa', 'media', 'alta', 'critica')),
  estado text NOT NULL DEFAULT 'aberto' CHECK (estado IN ('aberto', 'em_analise', 'contido', 'encerrado')),
  versao_alerta int NOT NULL DEFAULT 1,
  agregado boolean NOT NULL DEFAULT false,       -- true = "volume anômalo" (limite de cardinalidade estourado)
  eventos_total int NOT NULL DEFAULT 0,
  eventos_suprimidos int NOT NULL DEFAULT 0,
  primeiro_evento_em timestamptz NOT NULL DEFAULT now(),
  ultimo_evento_em timestamptz NOT NULL DEFAULT now(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seg_incidentes_regra_criado ON public.seg_incidentes (regra, criado_em DESC);
CREATE INDEX IF NOT EXISTS seg_incidentes_estado ON public.seg_incidentes (estado, atualizado_em DESC);

CREATE TABLE IF NOT EXISTS public.seg_evento_classificacoes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  evento_id uuid NOT NULL REFERENCES public.seg_eventos(id) ON DELETE CASCADE,
  regra text NOT NULL,
  contexto text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  incidente_id uuid REFERENCES public.seg_incidentes(id) ON DELETE SET NULL,
  UNIQUE (evento_id, regra, contexto)
);
CREATE INDEX IF NOT EXISTS seg_evcl_regra_ctx ON public.seg_evento_classificacoes (regra, contexto, criado_em DESC);

CREATE TABLE IF NOT EXISTS public.seg_incidente_eventos (
  incidente_id uuid NOT NULL REFERENCES public.seg_incidentes(id) ON DELETE CASCADE,
  evento_id uuid NOT NULL REFERENCES public.seg_eventos(id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (incidente_id, evento_id)
);
CREATE INDEX IF NOT EXISTS seg_inc_ev_evento ON public.seg_incidente_eventos (evento_id);

CREATE TABLE IF NOT EXISTS public.seg_diagnosticos_ia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incidente_id uuid NOT NULL REFERENCES public.seg_incidentes(id) ON DELETE CASCADE,
  versao_alerta int NOT NULL DEFAULT 1,
  tipo text NOT NULL DEFAULT 'diagnostico',
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('nao_solicitado', 'pendente', 'em_execucao', 'concluido', 'indisponivel', 'adiado', 'invalido')),
  motivo_categoria text CHECK (motivo_categoria IS NULL OR motivo_categoria ~ '^[a-z0-9_]{1,48}$'),
  motivo_sanitizado text CHECK (motivo_sanitizado IS NULL OR length(motivo_sanitizado) <= 300),
  request_id_provedor text,
  tentativas int NOT NULL DEFAULT 0,
  lease_ate timestamptz,
  custo_estimado numeric(12, 6),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (incidente_id, versao_alerta, tipo)
);

CREATE TABLE IF NOT EXISTS public.seg_notificacao_intencoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),             -- delivery_intent_id
  incidente_id uuid NOT NULL REFERENCES public.seg_incidentes(id) ON DELETE CASCADE,
  versao_alerta int NOT NULL,
  destino_logico text NOT NULL DEFAULT 'bruno',
  tipo text NOT NULL DEFAULT 'alerta' CHECK (tipo IN ('alerta', 'resumo', 'analise')),
  prioridade text NOT NULL CHECK (prioridade IN ('baixa', 'media', 'alta', 'critica')),
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'em_envio', 'aceita', 'entregue', 'lida', 'incerta', 'falhou', 'suprimida_orcamento', 'cancelada')),
  lease_until timestamptz,
  lease_owner text,
  claims int NOT NULL DEFAULT 0,
  proxima_tentativa_em timestamptz,
  dedupe_key text NOT NULL UNIQUE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz,
  UNIQUE (incidente_id, versao_alerta, destino_logico, tipo),
  CHECK ((estado = 'em_envio') = (lease_owner IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS seg_intencoes_fila ON public.seg_notificacao_intencoes (estado, proxima_tentativa_em, criado_em);

CREATE TABLE IF NOT EXISTS public.seg_notificacao_tentativas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intencao_id uuid NOT NULL REFERENCES public.seg_notificacao_intencoes(id) ON DELETE CASCADE,
  n int NOT NULL,
  canal text NOT NULL CHECK (canal IN ('telegram', 'whatsapp', 'email')),
  config_ref text NOT NULL DEFAULT '',                       -- id da instância/destino na configuração; nunca número/token
  operation_id uuid NOT NULL DEFAULT gen_random_uuid(),      -- estável por tentativa, vai ao engine
  estado text NOT NULL DEFAULT 'preparada' CHECK (estado IN ('preparada', 'enviando', 'aceita', 'rejeitada_comprovada', 'incerta', 'limitada')),
  resultado text CHECK (resultado IS NULL OR length(resultado) <= 200),
  http_status int,
  categoria_erro text CHECK (categoria_erro IS NULL OR categoria_erro ~ '^[a-z0-9_]{1,48}$'),
  retry_after_ate timestamptz,
  provider_message_id text,
  raw_sanitizado jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (intencao_id, canal, config_ref, n)
);

CREATE TABLE IF NOT EXISTS public.seg_recibos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tentativa_id uuid NOT NULL REFERENCES public.seg_notificacao_tentativas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('aceito', 'entregue', 'lido', 'falha_entrega')),
  origem text NOT NULL CHECK (length(origem) <= 60),         -- quem informou (webhook do provedor, resposta síncrona...)
  fonte_id text NOT NULL DEFAULT '',
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tentativa_id, tipo, fonte_id)
);

CREATE TABLE IF NOT EXISTS public.seg_monitor_baseline (
  item_tipo text NOT NULL,
  item_chave text NOT NULL,
  valor jsonb NOT NULL,
  violacao_aceita boolean NOT NULL DEFAULT false,
  definido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_tipo, item_chave)
);

CREATE TABLE IF NOT EXISTS public.seg_monitor_desvios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detectado_em timestamptz NOT NULL DEFAULT now(),
  ultima_vista_em timestamptz NOT NULL DEFAULT now(),
  item_tipo text NOT NULL,
  item_chave text NOT NULL,
  tipo_desvio text NOT NULL CHECK (tipo_desvio IN ('violacao', 'novo', 'alterado', 'removido')),
  gravidade text NOT NULL CHECK (gravidade IN ('baixa', 'media', 'alta', 'critica')),
  motivo text,
  antes jsonb,
  depois jsonb,
  estado text NOT NULL DEFAULT 'aberto' CHECK (estado IN ('aberto', 'resolvido')),
  resolvido_em timestamptz,
  incidente_id uuid REFERENCES public.seg_incidentes(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS seg_monitor_desvios_aberto ON public.seg_monitor_desvios (item_tipo, item_chave, tipo_desvio) WHERE estado = 'aberto';

-- ---------------------------------------------------------------------------------------------
-- Núcleo: registrar evento, agrupar ou abrir incidente (atômico, advisory lock por chave)
-- p_evento: {fonte,id_origem?,tipo,ocorrido_em?,identidade_informada?,identidade_validada_user_id?,request_id?,
--            ip_observado?,user_agent_observado?,cobertura_fonte?,payload?}
-- p_classificacoes: [{regra,contexto?,gravidade?,limiar?,janela_min?}]
-- Retorna {evento_id, duplicado, incidentes:[{regra,incidente_id,codigo,novo,agregado,aguardando}]}
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seg_grav_rank(g text) RETURNS int LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE g WHEN 'baixa' THEN 1 WHEN 'media' THEN 2 WHEN 'alta' THEN 3 WHEN 'critica' THEN 4 ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION public.seg_registrar_evento(p_evento jsonb, p_classificacoes jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_payload jsonb;
  v_ev_id uuid;
  v_hash text;
  c jsonb;
  v_regra text; v_ctx text; v_grav text; v_limiar int; v_jan int; v_bucket bigint; v_chave text;
  v_inc public.seg_incidentes;
  v_novo boolean; v_agr boolean; v_aguard int;
  v_max_card int := public.seg_cfg('card.max_chaves_por_regra_hora', 50)::int;
  v_max_ev int := public.seg_cfg('incidente.max_eventos_vinculados', 200)::int;
  v_vinc int;
  v_res jsonb := '[]'::jsonb;
BEGIN
  IF p_evento IS NULL OR jsonb_typeof(p_evento) <> 'object' THEN RAISE EXCEPTION 'seg_evento_invalido'; END IF;
  IF jsonb_typeof(coalesce(p_classificacoes, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'seg_classificacoes_invalidas'; END IF;

  v_payload := public.seg_sanitizar(coalesce(p_evento -> 'payload', '{}'::jsonb));
  IF jsonb_typeof(v_payload) <> 'object' THEN v_payload := jsonb_build_object('valor', v_payload); END IF;
  IF octet_length(v_payload::text) > 8192 THEN
    v_payload := jsonb_build_object('truncado', true, 'bytes', octet_length(v_payload::text));
  END IF;
  v_hash := encode(sha256(convert_to(
    coalesce(p_evento ->> 'fonte', '') || '|' || coalesce(p_evento ->> 'tipo', '') || '|' || coalesce(p_evento ->> 'id_origem', '') || '|' || v_payload::text, 'UTF8')), 'hex');

  INSERT INTO public.seg_eventos (ocorrido_em, fonte, id_origem, tipo, identidade_informada, identidade_validada_user_id,
                                  request_id, ip_observado, user_agent_observado, cobertura_fonte, payload, payload_hash)
  VALUES (coalesce(nullif(p_evento ->> 'ocorrido_em', '')::timestamptz, now()),
          p_evento ->> 'fonte', nullif(p_evento ->> 'id_origem', ''), p_evento ->> 'tipo',
          left(nullif(p_evento ->> 'identidade_informada', ''), 254),
          nullif(p_evento ->> 'identidade_validada_user_id', '')::uuid,
          left(nullif(p_evento ->> 'request_id', ''), 120), left(nullif(p_evento ->> 'ip_observado', ''), 64),
          left(nullif(p_evento ->> 'user_agent_observado', ''), 300), left(nullif(p_evento ->> 'cobertura_fonte', ''), 200),
          v_payload, v_hash)
  ON CONFLICT (fonte, id_origem) DO NOTHING
  RETURNING id INTO v_ev_id;

  IF v_ev_id IS NULL THEN -- reprocessamento do mesmo evento: idempotente, nada novo
    SELECT id INTO v_ev_id FROM public.seg_eventos WHERE fonte = p_evento ->> 'fonte' AND id_origem = p_evento ->> 'id_origem';
    RETURN jsonb_build_object('evento_id', v_ev_id, 'duplicado', true, 'incidentes', coalesce((
      SELECT jsonb_agg(jsonb_build_object('regra', i.regra, 'incidente_id', i.id, 'codigo', i.codigo, 'novo', false))
      FROM public.seg_incidente_eventos l JOIN public.seg_incidentes i ON i.id = l.incidente_id WHERE l.evento_id = v_ev_id), '[]'::jsonb));
  END IF;

  FOR c IN SELECT * FROM jsonb_array_elements(coalesce(p_classificacoes, '[]'::jsonb)) LIMIT 10 LOOP
    v_regra := c ->> 'regra';
    IF v_regra IS NULL OR v_regra !~ '^[a-z0-9_]{1,60}$' THEN RAISE EXCEPTION 'seg_regra_invalida'; END IF;
    v_ctx := left(coalesce(nullif(c ->> 'contexto', ''), 'global'), 120);
    v_grav := coalesce(c ->> 'gravidade', 'media');
    IF public.seg_grav_rank(v_grav) = 0 THEN RAISE EXCEPTION 'seg_gravidade_invalida'; END IF;
    v_limiar := greatest(1, coalesce((c ->> 'limiar')::int, public.seg_cfg('regra.' || v_regra || '.limiar', 1)::int));
    v_jan := greatest(1, coalesce((c ->> 'janela_min')::int, public.seg_cfg('regra.' || v_regra || '.janela_min', public.seg_cfg('agrup.janela_minutos', 10))::int));
    v_bucket := floor(extract(epoch FROM now()) / (v_jan * 60))::bigint;
    v_chave := v_regra || '|' || v_ctx || '|' || v_bucket::text;
    v_novo := false; v_agr := false; v_aguard := NULL;

    PERFORM pg_advisory_xact_lock(hashtextextended('seg:' || v_chave, 0));
    INSERT INTO public.seg_evento_classificacoes (evento_id, regra, contexto) VALUES (v_ev_id, v_regra, v_ctx) ON CONFLICT DO NOTHING;

    SELECT * INTO v_inc FROM public.seg_incidentes WHERE chave_correlacao = v_chave;
    IF NOT FOUND THEN
      -- limiar: eventos ainda sem incidente na janela (inclui este)
      SELECT count(*) INTO v_aguard FROM public.seg_evento_classificacoes
       WHERE regra = v_regra AND contexto = v_ctx AND incidente_id IS NULL AND criado_em >= now() - make_interval(mins => v_jan);
      IF v_aguard < v_limiar THEN
        v_res := v_res || jsonb_build_object('regra', v_regra, 'incidente_id', NULL, 'novo', false, 'aguardando', v_aguard || '/' || v_limiar);
        CONTINUE;
      END IF;

      -- cardinalidade: máx. N chaves distintas por regra por hora; excedente cai no incidente agregado
      PERFORM pg_advisory_xact_lock(hashtextextended('seg:card:' || v_regra, 0));
      IF (SELECT count(*) FROM public.seg_incidentes WHERE regra = v_regra AND NOT agregado AND criado_em > now() - interval '1 hour') >= v_max_card THEN
        v_agr := true;
        v_ctx := '__volume_anomalo__';
        v_chave := v_regra || '|__agregado__|' || floor(extract(epoch FROM now()) / 3600)::bigint::text;
        PERFORM pg_advisory_xact_lock(hashtextextended('seg:' || v_chave, 0));
        SELECT * INTO v_inc FROM public.seg_incidentes WHERE chave_correlacao = v_chave;
      END IF;

      IF v_inc.id IS NULL THEN
        INSERT INTO public.seg_incidentes (regra, contexto, chave_correlacao, janela_inicio, janela_fim, gravidade, agregado)
        VALUES (v_regra, v_ctx, v_chave,
                to_timestamp(v_bucket * v_jan * 60), to_timestamp((v_bucket + 1) * v_jan * 60),
                CASE WHEN v_agr AND public.seg_grav_rank(v_grav) < 2 THEN 'media' ELSE v_grav END, v_agr)
        RETURNING * INTO v_inc;
        v_novo := true;
        -- liga os eventos que esperavam o limiar (até o teto)
        WITH alvo AS (
          SELECT id, evento_id FROM public.seg_evento_classificacoes
           WHERE regra = v_regra AND (contexto = v_ctx OR v_agr) AND incidente_id IS NULL AND criado_em >= now() - make_interval(mins => v_jan)
           ORDER BY criado_em DESC LIMIT v_max_ev),
        liga AS (INSERT INTO public.seg_incidente_eventos (incidente_id, evento_id) SELECT v_inc.id, evento_id FROM alvo ON CONFLICT DO NOTHING RETURNING 1)
        UPDATE public.seg_evento_classificacoes e SET incidente_id = v_inc.id FROM alvo WHERE e.id = alvo.id;
        UPDATE public.seg_eventos SET estado = 'correlacionado'
         WHERE id IN (SELECT evento_id FROM public.seg_incidente_eventos WHERE incidente_id = v_inc.id);
        UPDATE public.seg_incidentes i SET eventos_total = (SELECT count(*) FROM public.seg_incidente_eventos WHERE incidente_id = i.id),
               eventos_suprimidos = CASE WHEN v_agr THEN 1 ELSE 0 END, atualizado_em = now()
         WHERE i.id = v_inc.id RETURNING * INTO v_inc;
      END IF;
    END IF;

    IF NOT v_novo THEN -- incidente já existia (ou o agregado já existia): anexar
      SELECT count(*) INTO v_vinc FROM public.seg_incidente_eventos WHERE incidente_id = v_inc.id;
      IF v_vinc < v_max_ev THEN
        INSERT INTO public.seg_incidente_eventos (incidente_id, evento_id) VALUES (v_inc.id, v_ev_id) ON CONFLICT DO NOTHING;
        UPDATE public.seg_eventos SET estado = 'correlacionado' WHERE id = v_ev_id;
      END IF;
      UPDATE public.seg_evento_classificacoes SET incidente_id = v_inc.id WHERE evento_id = v_ev_id AND regra = v_regra AND contexto = v_ctx;
      UPDATE public.seg_incidentes SET eventos_total = eventos_total + 1,
             eventos_suprimidos = eventos_suprimidos + CASE WHEN v_agr OR agregado OR v_vinc >= v_max_ev THEN 1 ELSE 0 END,
             ultimo_evento_em = now(), atualizado_em = now()
       WHERE id = v_inc.id RETURNING * INTO v_inc;
      IF public.seg_grav_rank(v_grav) > public.seg_grav_rank(v_inc.gravidade) THEN -- escalada: nova versão do alerta
        UPDATE public.seg_incidentes SET gravidade = v_grav, versao_alerta = versao_alerta + 1, atualizado_em = now()
         WHERE id = v_inc.id RETURNING * INTO v_inc;
      END IF;
    END IF;

    IF v_inc.gravidade IN ('alta', 'critica') THEN -- sem esperar IA (decisão §1.3-e); médio/baixo vão para resumo (M06)
      INSERT INTO public.seg_notificacao_intencoes (incidente_id, versao_alerta, prioridade, dedupe_key)
      VALUES (v_inc.id, v_inc.versao_alerta, v_inc.gravidade, v_inc.id::text || ':' || v_inc.versao_alerta::text || ':bruno:alerta')
      ON CONFLICT DO NOTHING;
    END IF;

    v_res := v_res || jsonb_build_object('regra', v_regra, 'incidente_id', v_inc.id, 'codigo', v_inc.codigo, 'novo', v_novo, 'agregado', v_inc.agregado);
    v_inc := NULL;
  END LOOP;

  RETURN jsonb_build_object('evento_id', v_ev_id, 'duplicado', false, 'incidentes', v_res);
END $$;

-- ---------------------------------------------------------------------------------------------
-- Intenções: claim com lease, tentativa gravada ANTES da chamada, finish, recibos
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seg_intencao_claim(p_owner text, p_limite int DEFAULT 5, p_lease_segundos int DEFAULT NULL)
RETURNS SETOF public.seg_notificacao_intencoes LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_lease int := coalesce(p_lease_segundos, public.seg_cfg('lease.intencao_segundos', 120)::int);
BEGIN
  IF coalesce(p_owner, '') = '' OR length(p_owner) > 80 THEN RAISE EXCEPTION 'seg_owner_invalido'; END IF;
  -- varredura: lease vencido. Com tentativa 'enviando' (o provedor pode ter aceito) => incerta, NUNCA reenvia.
  -- Sem tentativa 'enviando' (persistência antes do efeito prova que nada saiu) => volta a pendente.
  WITH venc AS (
    SELECT i.id, EXISTS (SELECT 1 FROM public.seg_notificacao_tentativas t WHERE t.intencao_id = i.id AND t.estado = 'enviando') AS saiu
      FROM public.seg_notificacao_intencoes i
     WHERE i.estado = 'em_envio' AND i.lease_until < now() FOR UPDATE SKIP LOCKED),
  t1 AS (UPDATE public.seg_notificacao_tentativas t SET estado = 'incerta', resultado = 'lease_expirou_apos_envio', atualizado_em = now()
          FROM venc WHERE t.intencao_id = venc.id AND venc.saiu AND t.estado = 'enviando' RETURNING 1),
  t2 AS (UPDATE public.seg_notificacao_tentativas t SET estado = 'rejeitada_comprovada', categoria_erro = 'lease_antes_do_envio', atualizado_em = now()
          FROM venc WHERE t.intencao_id = venc.id AND NOT venc.saiu AND t.estado = 'preparada' RETURNING 1)
  UPDATE public.seg_notificacao_intencoes i
     SET estado = CASE WHEN venc.saiu THEN 'incerta' ELSE 'pendente' END,
         lease_owner = NULL, lease_until = NULL, atualizado_em = now(),
         finalizado_em = CASE WHEN venc.saiu THEN now() END
    FROM venc WHERE i.id = venc.id;

  RETURN QUERY
  UPDATE public.seg_notificacao_intencoes i
     SET estado = 'em_envio', lease_owner = p_owner, lease_until = now() + make_interval(secs => v_lease),
         claims = i.claims + 1, atualizado_em = now()
   WHERE i.id IN (SELECT x.id FROM public.seg_notificacao_intencoes x
                   WHERE x.estado = 'pendente' AND coalesce(x.proxima_tentativa_em, now()) <= now()
                   ORDER BY public.seg_grav_rank(x.prioridade) DESC, x.criado_em
                   LIMIT greatest(1, least(coalesce(p_limite, 5), 50)) FOR UPDATE SKIP LOCKED)
  RETURNING i.*;
END $$;

CREATE OR REPLACE FUNCTION public.seg_tentativa_preparar(p_intencao uuid, p_owner text, p_canal text, p_config_ref text DEFAULT '')
RETURNS public.seg_notificacao_tentativas LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_t public.seg_notificacao_tentativas; v_n int;
BEGIN
  PERFORM 1 FROM public.seg_notificacao_intencoes
   WHERE id = p_intencao AND estado = 'em_envio' AND lease_owner = p_owner AND lease_until >= now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'seg_lease_perdido'; END IF; -- nunca chamar provedor sem ser dono do lease
  SELECT coalesce(max(n), 0) + 1 INTO v_n FROM public.seg_notificacao_tentativas WHERE intencao_id = p_intencao AND canal = p_canal AND config_ref = coalesce(p_config_ref, '');
  INSERT INTO public.seg_notificacao_tentativas (intencao_id, n, canal, config_ref, estado)
  VALUES (p_intencao, v_n, p_canal, coalesce(p_config_ref, ''), 'enviando') RETURNING * INTO v_t;
  RETURN v_t;
END $$;

CREATE OR REPLACE FUNCTION public.seg_intencao_finish(p_id uuid, p_owner text, p_estado text, p_retry_apos timestamptz DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_estado NOT IN ('pendente', 'aceita', 'entregue', 'lida', 'incerta', 'falhou', 'suprimida_orcamento', 'cancelada') THEN
    RAISE EXCEPTION 'seg_estado_invalido';
  END IF;
  UPDATE public.seg_notificacao_intencoes
     SET estado = p_estado, lease_owner = NULL, lease_until = NULL, atualizado_em = now(),
         proxima_tentativa_em = CASE WHEN p_estado = 'pendente' THEN coalesce(p_retry_apos, now()) END,
         finalizado_em = CASE WHEN p_estado = 'pendente' THEN NULL ELSE now() END
   WHERE id = p_id AND estado = 'em_envio' AND lease_owner = p_owner AND lease_until >= now(); -- lease vencido: a varredura decide (incerta)
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.seg_recibo_registrar(p_tentativa uuid, p_tipo text, p_origem text, p_fonte_id text DEFAULT '')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_int uuid; v_novo text;
BEGIN
  INSERT INTO public.seg_recibos (tentativa_id, tipo, origem, fonte_id) VALUES (p_tentativa, p_tipo, p_origem, coalesce(p_fonte_id, ''))
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT intencao_id INTO v_int FROM public.seg_notificacao_tentativas WHERE id = p_tentativa;
  v_novo := CASE p_tipo WHEN 'aceito' THEN 'aceita' WHEN 'entregue' THEN 'entregue' WHEN 'lido' THEN 'lida' END;
  IF v_novo IS NOT NULL THEN -- só avança (aceita < entregue < lida); ausência de recibo nunca rebaixa nada
    UPDATE public.seg_notificacao_intencoes SET estado = v_novo, atualizado_em = now()
     WHERE id = v_int AND estado IN ('aceita', 'entregue', 'incerta')
       AND array_position(ARRAY['incerta', 'aceita', 'entregue', 'lida'], estado) < array_position(ARRAY['incerta', 'aceita', 'entregue', 'lida'], v_novo);
  END IF;
  RETURN true;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Monitor de configuração: lê pg_policies / ACL de tabelas / buckets / auth.users sem cadastro e compara
-- com a baseline. Config do Auth (signup, provedores, expiração) NÃO é legível pelo banco: LACUNA.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seg_monitor_itens()
RETURNS TABLE (item_tipo text, item_chave text, valor jsonb, violacao text, gravidade text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_perm jsonb := coalesce((SELECT cf.valor FROM public.seg_config cf WHERE cf.chave = 'monitor.buckets_publicos_permitidos'), '[]'::jsonb);
        v_tol int := public.seg_cfg('monitor.auth_user_sem_cadastro_min', 10)::int;
BEGIN
  RETURN QUERY
  SELECT 'policy', p.schemaname || '.' || p.tablename || '.' || p.policyname,
         jsonb_build_object('cmd', p.cmd, 'roles', to_jsonb(p.roles), 'permissive', p.permissive, 'qual', p.qual, 'with_check', p.with_check),
         CASE WHEN (p.roles && ARRAY['public', 'anon']::name[]) AND (coalesce(p.qual, 'true') = 'true' AND coalesce(p.with_check, 'true') = 'true')
                   AND p.permissive = 'PERMISSIVE' THEN 'politica_publica_true'
              WHEN (p.roles && ARRAY['authenticated']::name[]) AND coalesce(p.qual, 'true') = 'true' AND coalesce(p.with_check, 'true') = 'true'
                   AND p.permissive = 'PERMISSIVE' AND p.schemaname = 'public' THEN 'politica_authenticated_true' END,
         CASE WHEN (p.roles && ARRAY['public', 'anon']::name[]) AND (coalesce(p.qual, 'true') = 'true' AND coalesce(p.with_check, 'true') = 'true')
                   AND p.permissive = 'PERMISSIVE' THEN 'critica'
              WHEN (p.roles && ARRAY['authenticated']::name[]) AND coalesce(p.qual, 'true') = 'true' AND coalesce(p.with_check, 'true') = 'true'
                   AND p.permissive = 'PERMISSIVE' AND p.schemaname = 'public' THEN 'alta' END
    FROM pg_policies p WHERE p.schemaname IN ('public', 'storage');

  RETURN QUERY
  WITH g AS (
    SELECT n.nspname AS s, c.relname AS t, CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS quem,
           array_agg(DISTINCT a.privilege_type ORDER BY a.privilege_type) AS privs, c.relrowsecurity AS rls
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     WHERE n.nspname IN ('public', 'storage') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND (a.grantee = 0 OR a.grantee::regrole::text IN ('anon', 'authenticated'))
     GROUP BY n.nspname, c.relname, a.grantee, c.relrowsecurity)
  SELECT 'grant', g.s || '.' || g.t || '|' || g.quem,
         jsonb_build_object('privs', to_jsonb(g.privs), 'rls', g.rls),
         CASE WHEN g.quem IN ('PUBLIC', 'anon') AND NOT g.rls AND g.privs && ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] THEN 'anon_escreve_sem_rls'
              WHEN g.quem IN ('PUBLIC', 'anon') AND NOT g.rls AND g.privs && ARRAY['SELECT'] THEN 'anon_le_sem_rls' END,
         CASE WHEN g.quem IN ('PUBLIC', 'anon') AND NOT g.rls AND g.privs && ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] THEN 'critica'
              WHEN g.quem IN ('PUBLIC', 'anon') AND NOT g.rls AND g.privs && ARRAY['SELECT'] THEN 'alta' END
    FROM g;

  RETURN QUERY
  SELECT 'bucket', b.id::text,
         jsonb_build_object('public', b.public, 'file_size_limit', b.file_size_limit, 'allowed_mime_types', to_jsonb(b.allowed_mime_types)),
         CASE WHEN b.public AND NOT v_perm ? b.id::text THEN 'bucket_publico' END,
         CASE WHEN b.public AND NOT v_perm ? b.id::text THEN 'critica' END
    FROM storage.buckets b;

  IF to_regclass('auth.users') IS NOT NULL THEN -- proxy de signup: conta no Auth sem cadastro interno (cadastro legítimo cria os dois em segundos)
    RETURN QUERY EXECUTE format($q$
      SELECT 'auth_user_sem_cadastro'::text, au.id::text,
             jsonb_build_object('criado_em', au.created_at, 'provedor', au.raw_app_meta_data ->> 'provider'),
             'conta_auth_sem_cadastro_interno'::text, 'alta'::text
        FROM auth.users au
       WHERE au.created_at < now() - make_interval(mins => %s)
         AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = au.id)$q$, v_tol);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.seg_monitor_baseline_definir(p_aceitar_violacoes boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_viol int;
BEGIN
  SELECT count(*) INTO v_viol FROM public.seg_monitor_itens() WHERE violacao IS NOT NULL;
  IF v_viol > 0 AND NOT p_aceitar_violacoes THEN
    RAISE EXCEPTION 'seg_baseline_com_violacoes: % itens violam regra; revise e chame com p_aceitar_violacoes=true se forem conhecidos', v_viol;
  END IF;
  DELETE FROM public.seg_monitor_baseline;
  INSERT INTO public.seg_monitor_baseline (item_tipo, item_chave, valor, violacao_aceita)
  SELECT i.item_tipo, i.item_chave, i.valor, i.violacao IS NOT NULL FROM public.seg_monitor_itens() i;
  RETURN jsonb_build_object('itens', (SELECT count(*) FROM public.seg_monitor_baseline), 'violacoes_aceitas', v_viol);
END $$;

CREATE OR REPLACE FUNCTION public.seg_monitor_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_tem_base boolean; x record; v_res jsonb; v_novos int := 0; v_crit int := 0; v_total int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('seg:monitor', 0));
  v_tem_base := EXISTS (SELECT 1 FROM public.seg_monitor_baseline);

  CREATE TEMP TABLE IF NOT EXISTS _seg_cand (item_tipo text, item_chave text, tipo_desvio text, gravidade text, motivo text, antes jsonb, depois jsonb) ON COMMIT DROP;
  TRUNCATE _seg_cand;

  INSERT INTO _seg_cand
  SELECT c.item_tipo, c.item_chave,
         CASE WHEN NOT v_tem_base THEN 'violacao' WHEN b.item_chave IS NULL THEN 'novo' ELSE 'alterado' END,
         coalesce(c.gravidade, 'media'), c.violacao, b.valor, c.valor
    FROM public.seg_monitor_itens() c
    LEFT JOIN public.seg_monitor_baseline b ON b.item_tipo = c.item_tipo AND b.item_chave = c.item_chave
   WHERE CASE WHEN NOT v_tem_base THEN c.violacao IS NOT NULL
              ELSE b.item_chave IS NULL OR b.valor IS DISTINCT FROM c.valor END;
  INSERT INTO _seg_cand
  SELECT b.item_tipo, b.item_chave, 'removido', 'baixa', NULL, b.valor, NULL
    FROM public.seg_monitor_baseline b
   WHERE v_tem_base AND NOT EXISTS (SELECT 1 FROM public.seg_monitor_itens() c WHERE c.item_tipo = b.item_tipo AND c.item_chave = b.item_chave);

  UPDATE public.seg_monitor_desvios d SET estado = 'resolvido', resolvido_em = now()
   WHERE d.estado = 'aberto' AND NOT EXISTS (SELECT 1 FROM _seg_cand c WHERE c.item_tipo = d.item_tipo AND c.item_chave = d.item_chave AND c.tipo_desvio = d.tipo_desvio);

  FOR x IN
    INSERT INTO public.seg_monitor_desvios (item_tipo, item_chave, tipo_desvio, gravidade, motivo, antes, depois)
    SELECT item_tipo, item_chave, tipo_desvio, gravidade, motivo, antes, depois FROM _seg_cand
    ON CONFLICT (item_tipo, item_chave, tipo_desvio) WHERE estado = 'aberto'
    DO UPDATE SET ultima_vista_em = now(), depois = excluded.depois, gravidade = excluded.gravidade
    RETURNING id, item_tipo, item_chave, tipo_desvio, gravidade, motivo, (xmax = 0) AS inserido
  LOOP
    IF x.inserido THEN
      v_novos := v_novos + 1;
      IF x.gravidade = 'critica' THEN v_crit := v_crit + 1; END IF;
      IF public.seg_grav_rank(x.gravidade) >= 3 THEN -- só alta/crítica abre incidente; o resto fica na tabela de desvios
        v_res := public.seg_registrar_evento(
          jsonb_build_object('fonte', 'monitor_config', 'id_origem', 'desvio:' || x.id::text, 'tipo', 'config.desvio',
                             'cobertura_fonte', 'pg_policies/pg_class.relacl/storage.buckets/auth.users; config do Auth: lacuna',
                             'payload', jsonb_build_object('item_tipo', x.item_tipo, 'item_chave', x.item_chave, 'tipo_desvio', x.tipo_desvio,
                                                           'gravidade', x.gravidade, 'motivo', x.motivo)),
          jsonb_build_array(jsonb_build_object('regra', 'monitor_config_' || x.item_tipo, 'contexto', 'desvio_' || x.gravidade, 'gravidade', x.gravidade)));
        UPDATE public.seg_monitor_desvios SET incidente_id = (v_res -> 'incidentes' -> 0 ->> 'incidente_id')::uuid WHERE id = x.id;
      END IF;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_total FROM public.seg_monitor_desvios WHERE estado = 'aberto';
  v_res := jsonb_build_object('em', now(), 'baseline', v_tem_base, 'desvios_novos', v_novos, 'criticos_novos', v_crit, 'desvios_abertos', v_total,
    'lacunas', jsonb_build_array('config do Auth (signup, provedores, expiração do JWT, MFA) nao e legivel pelo banco: usar inventario manual/Management API autorizado'));
  INSERT INTO public.seg_config (chave, valor, descricao, origem) VALUES ('monitor.ultima_execucao', v_res, 'Último snapshot (saúde do coletor)', 'sistema')
  ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor, atualizado_em = now();
  RETURN v_res;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Views de leitura (painel/MCP). Executam como dono (ignoram RLS); só service_role as lê.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.seg_v_incidentes AS
SELECT i.id, i.numero, i.codigo, i.regra, i.contexto, i.gravidade, i.estado, i.versao_alerta, i.agregado, i.eventos_total, i.eventos_suprimidos,
       i.janela_inicio, i.janela_fim, i.primeiro_evento_em, i.ultimo_evento_em, i.criado_em, i.atualizado_em,
       (SELECT count(*) FROM public.seg_notificacao_intencoes n WHERE n.incidente_id = i.id AND n.estado IN ('pendente', 'em_envio')) AS intencoes_abertas,
       (SELECT count(*) FROM public.seg_notificacao_intencoes n WHERE n.incidente_id = i.id) AS intencoes_total
  FROM public.seg_incidentes i;

CREATE OR REPLACE VIEW public.seg_v_incidente_eventos AS
SELECT l.incidente_id, e.id AS evento_id, e.ocorrido_em, e.fonte, e.tipo, e.identidade_informada, e.identidade_validada_user_id,
       e.request_id, e.ip_observado, e.user_agent_observado, e.cobertura_fonte, e.payload, e.payload_hash
  FROM public.seg_incidente_eventos l JOIN public.seg_eventos e ON e.id = l.evento_id;

CREATE OR REPLACE VIEW public.seg_v_intencoes AS
SELECT n.id, n.incidente_id, n.versao_alerta, n.destino_logico, n.tipo, n.prioridade, n.estado, n.lease_until, n.lease_owner, n.claims,
       n.proxima_tentativa_em, n.criado_em, n.finalizado_em,
       (SELECT count(*) FROM public.seg_notificacao_tentativas t WHERE t.intencao_id = n.id) AS tentativas
  FROM public.seg_notificacao_intencoes n;

-- ---------------------------------------------------------------------------------------------
-- Fechamento: RLS deny-all, REVOKE explícito, GRANT só service_role
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname LIKE E'seg\\_%' AND c.relkind IN ('r', 'v', 'S') LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', r.relname);
    IF r.relkind = 'r' THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname); -- sem política = deny-all
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', r.relname);
    ELSIF r.relkind = 'v' THEN
      EXECUTE format('GRANT SELECT ON public.%I TO service_role', r.relname);
    ELSE
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO service_role', r.relname);
    END IF;
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE E'seg\\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.f);
  END LOOP;
END $$;

-- Recurso de permissão novo (o Workspace não tem tabela de recursos: o recurso nasce com a primeira linha em
-- user_permissions/profile_permissions). Menor privilégio: SÓ o Bruno, só leitura. Demais perfis: manualmente pela tela de Perfis.
INSERT INTO public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
SELECT u.id, 'seguranca-incidentes', true, false, false, false, false
  FROM public.users u WHERE lower(u.email) = 'bruno.rodrigues@brspromotora.com.br'
ON CONFLICT (user_id, resource_name) DO NOTHING;

DO $$ BEGIN RAISE NOTICE 'M05: migration aplicada'; END $$;
