-- M06 (incidente BRS 2026-10-31): canais de notificação, orçamento atômico, resumo único após recuperação.
-- Depende do M05 (seg_config, seg_incidentes, seg_notificacao_*). Sem envio aqui: só estado e contadores.
-- Desenho: PLANO-MESTRE §8 e PT02 §5.4-5.7. Idempotente (pode reaplicar).
--   * Tudo em public.seg_*: RLS ligada SEM política, REVOKE de PUBLIC/anon/authenticated, GRANT só service_role.
--   * Todos os canais nascem DESABILITADOS (decisão 5/9). Nenhum segredo e nenhum chat_id nesta migration:
--     token do bot e chat_id vão cifrados (cofre CRM_CREDENTIALS_KEY, AES-256-GCM) para seg_destinos_protegidos
--     pela tela de canais; a migration só guarda configuração NÃO secreta.
--   * Valores numéricos novos em seg_config = PROPOSTA (não decisão do Bruno).

DO $$
BEGIN
  IF to_regclass('public.seg_config') IS NULL OR to_regclass('public.seg_notificacao_intencoes') IS NULL THEN
    RAISE EXCEPTION 'M06: pré-requisito ausente (aplicar a migration M05 antes)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Configuração dos canais (não secreta)
--   telegram : {}                                   (token e chat_id em seg_destinos_protegidos)
--   whatsapp : {instancias:[{ordem,instancia_id,numero_esperado}]}  (+ destino do alerta em seg_destinos_protegidos)
--   email    : {destino}
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seg_canais_config (
  canal text PRIMARY KEY CHECK (canal IN ('telegram', 'whatsapp', 'email')),
  habilitado boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);

INSERT INTO public.seg_canais_config (canal, habilitado, config) VALUES
  ('telegram', false, '{}'::jsonb),
  -- Ordem da decisão 9. Só a 1ª instância existe em chat_instancias hoje; 2ª e 3ª ficam sem id até o Bruno confirmar.
  ('whatsapp', false, jsonb_build_object('instancias', jsonb_build_array(
      jsonb_build_object('ordem', 1, 'instancia_id', '5576d3fc-b482-4084-9de0-c7d37c68c7de', 'numero_esperado', '556131991641'),
      jsonb_build_object('ordem', 2, 'instancia_id', NULL, 'numero_esperado', '5561996036968'),
      jsonb_build_object('ordem', 3, 'instancia_id', NULL, 'numero_esperado', '5561999551641')))),
  ('email', false, jsonb_build_object('destino', 'bruno.rodrigues@brspromotora.com.br'))
ON CONFLICT (canal) DO NOTHING;

-- Segredos e destinos sensíveis (cifrados NA APLICAÇÃO com o cofre; o banco só vê texto cifrado).
CREATE TABLE IF NOT EXISTS public.seg_destinos_protegidos (
  canal text NOT NULL CHECK (canal IN ('telegram', 'whatsapp', 'email')),
  chave text NOT NULL CHECK (chave ~ '^[a-z_]{1,32}$'),     -- telegram: bot_token, chat_id; whatsapp: destino
  valor_cifrado text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (canal, chave)
);
COMMENT ON TABLE public.seg_destinos_protegidos IS 'M06: token do bot, chat_id, telefone de destino. Sempre cifrado pelo cofre; nunca em migration, log ou view.';

-- ---------------------------------------------------------------------------------------------
-- Valores propostos (ON CONFLICT DO NOTHING: ajuste humano nunca é sobrescrito)
-- ---------------------------------------------------------------------------------------------
INSERT INTO public.seg_config (chave, valor, descricao, origem) VALUES
  ('contingencia.telegram_429_critico_s', '120', 'Crítico: sem aceite no Telegram por mais de N s após 429 => 1 contingência WhatsApp', 'proposta, não decisão do Bruno (PT02 §5.4)'),
  ('contingencia.telegram_429_alto_s', '600', 'Alto: prazo de espera pelo Telegram após 429 antes da contingência', 'proposta do executor M06, sem valor no PT02'),
  ('contingencia.telegram_incerto_critico_s', '90', 'Crítico: Telegram incerto => após N s, 1 contingência marcada "possível duplicata"', 'proposta, não decisão do Bruno (PT02 §5.4)'),
  ('contingencia.telegram_5xx_retry_s', '5', 'Telegram 5xx antes de aceite: 1 retry após N s; depois contingência', 'proposta, não decisão do Bruno (PT02 §5.4)'),
  ('orcamento.incidente_hora', '8', 'Tentativas externas por incidente por hora (todos os canais)', 'proposta do executor M06, sem valor no PT02'),
  ('resumo.ultimo_em', to_jsonb(now()), 'Marca do último resumo de recuperação (consumida por seg_resumo_pendente)', 'sistema')
ON CONFLICT (chave) DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- Orçamento atômico por janela. Escopos: global_hora, global_dia, canal_hora, canal_dia, instancia_dia, incidente_hora.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seg_orcamento (
  escopo text NOT NULL CHECK (escopo IN ('global_hora', 'global_dia', 'canal_hora', 'canal_dia', 'instancia_dia', 'incidente_hora')),
  chave text NOT NULL DEFAULT '',
  janela_inicio timestamptz NOT NULL,
  usado int NOT NULL DEFAULT 0 CHECK (usado >= 0),
  PRIMARY KEY (escopo, chave, janela_inicio)
);

-- Consome 1 unidade em TODOS os escopos aplicáveis, ou em nenhum. Serializado por advisory lock (volume baixo,
-- corretude acima de throughput). Slot reservado: não-crítico enxerga (limite - slot_critico) nos limites HORÁRIOS;
-- crítico enxerga o limite cheio. Limites diários valem para todos (nunca acima do teto diário do WhatsApp).
-- p_instancia só para whatsapp. Escopo sem limite configurado = ilimitado (canal telegram/email só sob o global).
CREATE OR REPLACE FUNCTION public.seg_orcamento_consumir(p_canal text, p_incidente uuid DEFAULT NULL, p_instancia text DEFAULT '', p_prioridade text DEFAULT 'alta')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_hora timestamptz := date_trunc('hour', now());
  v_dia timestamptz := (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')) AT TIME ZONE 'America/Sao_Paulo';
  v_slot int := public.seg_cfg('orcamento.slot_critico_hora', 1)::int;
  v_crit boolean := (p_prioridade = 'critica');
  v_big numeric := 1000000000;
  r record;
  v_usado int;
  v_lim numeric;
BEGIN
  IF p_canal NOT IN ('telegram', 'whatsapp', 'email') THEN RAISE EXCEPTION 'seg_canal_invalido'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('seg_orcamento', 0));
  DELETE FROM public.seg_orcamento WHERE janela_inicio < now() - interval '3 days';

  FOR r IN
    SELECT * FROM (VALUES
      ('global_hora',    ''::text,                          v_hora, public.seg_cfg('orcamento.global_hora', 20) - CASE WHEN v_crit THEN 0 ELSE v_slot END),
      ('global_dia',     ''::text,                          v_dia,  public.seg_cfg('orcamento.global_dia', 60)),
      ('canal_hora',     p_canal,                           v_hora, public.seg_cfg('orcamento.' || p_canal || '_hora', v_big) - CASE WHEN v_crit AND public.seg_cfg('orcamento.' || p_canal || '_hora', v_big) < v_big THEN 0 WHEN public.seg_cfg('orcamento.' || p_canal || '_hora', v_big) < v_big THEN v_slot ELSE 0 END),
      ('canal_dia',      p_canal,                           v_dia,  public.seg_cfg('orcamento.' || p_canal || '_dia', v_big)),
      ('instancia_dia',  coalesce(p_instancia, ''),         v_dia,  CASE WHEN p_canal = 'whatsapp' AND coalesce(p_instancia, '') <> '' THEN public.seg_cfg('orcamento.whatsapp_instancia_dia', 10) ELSE v_big END),
      ('incidente_hora', coalesce(p_incidente::text, ''),   v_hora, CASE WHEN p_incidente IS NOT NULL THEN public.seg_cfg('orcamento.incidente_hora', 8) ELSE v_big END)
    ) AS t(escopo, chave, janela, lim)
  LOOP
    v_lim := r.lim;
    SELECT usado INTO v_usado FROM public.seg_orcamento o WHERE o.escopo = r.escopo AND o.chave = r.chave AND o.janela_inicio = r.janela;
    IF coalesce(v_usado, 0) >= v_lim THEN
      RETURN jsonb_build_object('permitido', false, 'motivo', r.escopo);
    END IF;
  END LOOP;

  FOR r IN
    SELECT * FROM (VALUES
      ('global_hora', ''::text, v_hora), ('global_dia', ''::text, v_dia), ('canal_hora', p_canal, v_hora), ('canal_dia', p_canal, v_dia),
      ('instancia_dia', coalesce(p_instancia, ''), v_dia), ('incidente_hora', coalesce(p_incidente::text, ''), v_hora)
    ) AS t(escopo, chave, janela)
  LOOP
    INSERT INTO public.seg_orcamento (escopo, chave, janela_inicio, usado) VALUES (r.escopo, r.chave, r.janela, 1)
    ON CONFLICT (escopo, chave, janela_inicio) DO UPDATE SET usado = public.seg_orcamento.usado + 1;
  END LOOP;
  RETURN jsonb_build_object('permitido', true, 'motivo', NULL);
END $$;

-- ---------------------------------------------------------------------------------------------
-- Resumo único após recuperação (PM §8.2 / §12-14). "Pendente" = desde a marca resumo.ultimo_em existem intenções
-- que NÃO foram aceitas pelo Telegram (suprimidas por orçamento, incertas, falhas, ou entregues por contingência).
-- Só devolve contagens; o backlog continua consultável no painel. Não reemite nada.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seg_resumo_contar(p_desde timestamptz, p_ate timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
           'desde', p_desde,
           'suprimidas_orcamento', count(*) FILTER (WHERE i.estado = 'suprimida_orcamento'),
           'incertas', count(*) FILTER (WHERE i.estado = 'incerta'),
           'falhas', count(*) FILTER (WHERE i.estado = 'falhou'),
           'por_contingencia', count(*) FILTER (WHERE i.estado IN ('aceita', 'entregue', 'lida') AND NOT EXISTS (
               SELECT 1 FROM public.seg_notificacao_tentativas t WHERE t.intencao_id = i.id AND t.canal = 'telegram' AND t.estado = 'aceita')))
    FROM public.seg_notificacao_intencoes i
   WHERE i.tipo <> 'resumo' AND i.finalizado_em IS NOT NULL AND i.finalizado_em > p_desde AND (p_ate IS NULL OR i.finalizado_em <= p_ate)
$$;

CREATE OR REPLACE FUNCTION public.seg_resumo_pendente()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_desde timestamptz := coalesce((SELECT (valor #>> '{}')::timestamptz FROM public.seg_config WHERE chave = 'resumo.ultimo_em'), now() - interval '1 day');
  v_r jsonb := public.seg_resumo_contar(v_desde);
BEGIN
  RETURN v_r || jsonb_build_object('pendente',
     ((v_r ->> 'suprimidas_orcamento')::int + (v_r ->> 'incertas')::int + (v_r ->> 'falhas')::int + (v_r ->> 'por_contingencia')::int) > 0);
END $$;

-- Contagens de um resumo já criado (a janela do incidente sintético é [marca anterior, criação]).
CREATE OR REPLACE FUNCTION public.seg_resumo_dados(p_incidente uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.seg_resumo_contar(janela_inicio, janela_fim) FROM public.seg_incidentes WHERE id = p_incidente AND regra = 'resumo_recuperacao'
$$;

-- Tentativa com operation_id DERIVADO (estável) fornecido pelo dispatcher, gravada ANTES do efeito.
CREATE OR REPLACE FUNCTION public.seg_tentativa_preparar(p_intencao uuid, p_owner text, p_canal text, p_config_ref text, p_operation_id uuid)
RETURNS public.seg_notificacao_tentativas LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_t public.seg_notificacao_tentativas;
BEGIN
  v_t := public.seg_tentativa_preparar(p_intencao, p_owner, p_canal, p_config_ref);
  UPDATE public.seg_notificacao_tentativas SET operation_id = p_operation_id WHERE id = v_t.id RETURNING * INTO v_t;
  RETURN v_t;
END $$;

-- Cria NO MÁXIMO um resumo por marca: incidente sintético + intenção (dedupe_key por marca) e avança a marca na mesma transação.
CREATE OR REPLACE FUNCTION public.seg_resumo_criar()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_p jsonb; v_desde timestamptz; v_inc uuid; v_int uuid; v_num bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('seg_resumo', 0));
  v_p := public.seg_resumo_pendente();
  IF NOT (v_p ->> 'pendente')::boolean THEN RETURN jsonb_build_object('criado', false); END IF;
  v_desde := (v_p ->> 'desde')::timestamptz;
  v_num := nextval('public.seg_incidente_numero_seq');
  INSERT INTO public.seg_incidentes (numero, regra, contexto, chave_correlacao, janela_inicio, janela_fim, gravidade, estado, eventos_total)
  VALUES (v_num, 'resumo_recuperacao', 'telegram', 'resumo_recuperacao|telegram|' || v_desde::text, v_desde, clock_timestamp(), 'media', 'aberto', 0)
  ON CONFLICT (chave_correlacao) DO NOTHING RETURNING id INTO v_inc;
  IF v_inc IS NULL THEN RETURN jsonb_build_object('criado', false); END IF;
  INSERT INTO public.seg_notificacao_intencoes (incidente_id, versao_alerta, tipo, prioridade, dedupe_key, destino_logico)
  VALUES (v_inc, 1, 'resumo', 'media', 'resumo:telegram:' || v_desde::text, 'bruno')
  ON CONFLICT DO NOTHING RETURNING id INTO v_int;
  INSERT INTO public.seg_config (chave, valor, descricao, origem) VALUES ('resumo.ultimo_em', to_jsonb(clock_timestamp()), 'Marca do último resumo de recuperação', 'sistema')
  ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor, atualizado_em = now();
  RETURN jsonb_build_object('criado', v_int IS NOT NULL, 'intencao_id', v_int, 'resumo', v_p);
END $$;

-- ---------------------------------------------------------------------------------------------
-- Falha do próprio dispatcher: evento com chave fixa => no máximo 1 por categoria por hora (idempotente por id_origem).
-- Gravidade 'media': NÃO cria intenção de notificação (M05), logo nunca realimenta o dispatcher.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seg_dispatcher_falha(p_categoria text, p_detalhe text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_cat text := left(regexp_replace(coalesce(p_categoria, 'desconhecida'), '[^a-z0-9_]', '_', 'g'), 40);
BEGIN
  RETURN public.seg_registrar_evento(
    jsonb_build_object('fonte', 'dispatcher', 'id_origem', 'falha:' || v_cat || ':' || to_char(date_trunc('hour', now()), 'YYYYMMDDHH24'),
                       'tipo', 'dispatcher.falha', 'cobertura_fonte', 'dispatcher M06 (mesma Vercel/Supabase: não é monitor independente)',
                       'payload', jsonb_build_object('categoria', v_cat, 'detalhe', left(coalesce(p_detalhe, ''), 200))),
    jsonb_build_array(jsonb_build_object('regra', 'dispatcher_falha', 'contexto', v_cat, 'gravidade', 'media', 'limiar', 1)));
END $$;

-- ---------------------------------------------------------------------------------------------
-- Fechamento: RLS deny-all, REVOKE explícito, GRANT só service_role (mesmo bloco do M05, reaplicável)
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname IN ('seg_canais_config', 'seg_destinos_protegidos', 'seg_orcamento') AND c.relkind = 'r' LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', r.relname);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', r.relname);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('seg_orcamento_consumir', 'seg_resumo_contar', 'seg_resumo_pendente', 'seg_resumo_dados', 'seg_resumo_criar', 'seg_dispatcher_falha', 'seg_tentativa_preparar') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.f);
  END LOOP;
END $$;

DO $$ BEGIN RAISE NOTICE 'M06: migration aplicada'; END $$;
