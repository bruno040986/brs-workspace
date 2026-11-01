-- M06 complemento 2 (revisao M06, correcoes pos-revisao 3): escopo regra_dia (a) isenta gravidade critica (nao checa nem conta),
-- (b) devolve 'adiado': true na negacao (o dispatcher ADIA para o proximo dia em vez de descartar; o resumo unico informa), (c) conta por INCIDENTE
-- (escopo auxiliar regra_dia_inc): tentativas de fallback de canal do mesmo incidente consomem 1 so. Recria a funcao; nao altera migrations anteriores. Idempotente.
DO $$
DECLARE c text;
BEGIN
  IF to_regclass('public.seg_orcamento') IS NULL THEN RAISE EXCEPTION 'M06 complemento 2: aplicar M06 e complemento antes'; END IF;
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.seg_orcamento'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%escopo%' LOOP
    EXECUTE format('ALTER TABLE public.seg_orcamento DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE public.seg_orcamento ADD CONSTRAINT seg_orcamento_escopo_check
    CHECK (escopo IN ('global_hora', 'global_dia', 'canal_hora', 'canal_dia', 'instancia_dia', 'incidente_hora', 'regra_dia', 'regra_dia_inc'));
END $$;

CREATE OR REPLACE FUNCTION public.seg_orcamento_consumir(p_canal text, p_incidente uuid DEFAULT NULL, p_instancia text DEFAULT '', p_prioridade text DEFAULT 'alta')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_hora timestamptz := date_trunc('hour', now());
  v_dia timestamptz := (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')) AT TIME ZONE 'America/Sao_Paulo';
  v_slot int := public.seg_cfg('orcamento.slot_critico_hora', 1)::int;
  v_slot_dia int := public.seg_cfg('orcamento.slot_critico_dia', 5)::int;
  v_regra text := coalesce((SELECT regra FROM public.seg_incidentes WHERE id = p_incidente), '');
  v_crit boolean := (p_prioridade = 'critica');
  v_big numeric := 1000000000;
  r record;
  v_usado int;
  v_lim numeric;
  v_ja boolean := false;
  v_novo boolean := false;
BEGIN
  IF p_canal NOT IN ('telegram', 'whatsapp', 'email') THEN RAISE EXCEPTION 'seg_canal_invalido'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('seg_orcamento', 0));
  DELETE FROM public.seg_orcamento WHERE janela_inicio < now() - interval '3 days';
  -- regra_dia conta por INCIDENTE (fallback de canal nao consome); critica e isenta (nao checa nem conta); sem incidente/regra nao se aplica.
  IF NOT v_crit AND p_incidente IS NOT NULL AND v_regra <> '' THEN
    v_ja := EXISTS (SELECT 1 FROM public.seg_orcamento WHERE escopo = 'regra_dia_inc' AND chave = p_incidente::text AND janela_inicio = v_dia);
    v_novo := NOT v_ja;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('global_hora',    ''::text,                          v_hora, public.seg_cfg('orcamento.global_hora', 20) - CASE WHEN v_crit THEN 0 ELSE v_slot END),
      ('global_dia',     ''::text,                          v_dia,  public.seg_cfg('orcamento.global_dia', 60) - CASE WHEN v_crit THEN 0 ELSE least(v_slot_dia, floor(public.seg_cfg('orcamento.global_dia', 60) / 3)) END),
      ('canal_hora',     p_canal,                           v_hora, public.seg_cfg('orcamento.' || p_canal || '_hora', v_big) - CASE WHEN v_crit AND public.seg_cfg('orcamento.' || p_canal || '_hora', v_big) < v_big THEN 0 WHEN public.seg_cfg('orcamento.' || p_canal || '_hora', v_big) < v_big THEN v_slot ELSE 0 END),
      ('canal_dia',      p_canal,                           v_dia,  public.seg_cfg('orcamento.' || p_canal || '_dia', v_big) - CASE WHEN NOT v_crit AND public.seg_cfg('orcamento.' || p_canal || '_dia', v_big) < v_big THEN least(v_slot_dia, floor(public.seg_cfg('orcamento.' || p_canal || '_dia', v_big) / 3)) ELSE 0 END),
      ('regra_dia',      v_regra,                           v_dia,  CASE WHEN v_novo THEN public.seg_cfg('orcamento.regra_dia', 10) ELSE v_big END),
      ('instancia_dia',  coalesce(p_instancia, ''),         v_dia,  CASE WHEN p_canal = 'whatsapp' AND coalesce(p_instancia, '') <> '' THEN public.seg_cfg('orcamento.whatsapp_instancia_dia', 10) ELSE v_big END),
      ('incidente_hora', coalesce(p_incidente::text, ''),   v_hora, CASE WHEN p_incidente IS NOT NULL THEN public.seg_cfg('orcamento.incidente_hora', 8) ELSE v_big END)
    ) AS t(escopo, chave, janela, lim)
  LOOP
    v_lim := r.lim;
    SELECT usado INTO v_usado FROM public.seg_orcamento o WHERE o.escopo = r.escopo AND o.chave = r.chave AND o.janela_inicio = r.janela;
    IF coalesce(v_usado, 0) >= v_lim THEN
      RETURN jsonb_build_object('permitido', false, 'motivo', r.escopo, 'adiado', r.escopo = 'regra_dia');
    END IF;
  END LOOP;

  FOR r IN
    SELECT * FROM (VALUES
      ('global_hora', ''::text, v_hora), ('global_dia', ''::text, v_dia), ('canal_hora', p_canal, v_hora), ('canal_dia', p_canal, v_dia), ('instancia_dia', coalesce(p_instancia, ''), v_dia), ('incidente_hora', coalesce(p_incidente::text, ''), v_hora)
    ) AS t(escopo, chave, janela)
  LOOP
    INSERT INTO public.seg_orcamento (escopo, chave, janela_inicio, usado) VALUES (r.escopo, r.chave, r.janela, 1)
    ON CONFLICT (escopo, chave, janela_inicio) DO UPDATE SET usado = public.seg_orcamento.usado + 1;
  END LOOP;
  IF v_novo THEN
    INSERT INTO public.seg_orcamento (escopo, chave, janela_inicio, usado) VALUES ('regra_dia', v_regra, v_dia, 1)
    ON CONFLICT (escopo, chave, janela_inicio) DO UPDATE SET usado = public.seg_orcamento.usado + 1;
    INSERT INTO public.seg_orcamento (escopo, chave, janela_inicio, usado) VALUES ('regra_dia_inc', p_incidente::text, v_dia, 1)
    ON CONFLICT (escopo, chave, janela_inicio) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('permitido', true, 'motivo', NULL);
END $$;


-- Resumo unico: inclui intencoes ADIADAS por regra_dia (tentativa com categoria_erro 'orcamento_regra_dia' na janela).
CREATE OR REPLACE FUNCTION public.seg_resumo_contar(p_desde timestamptz, p_ate timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
           'desde', p_desde,
           'suprimidas_orcamento', count(*) FILTER (WHERE i.estado = 'suprimida_orcamento'),
           'incertas', count(*) FILTER (WHERE i.estado = 'incerta'),
           'falhas', count(*) FILTER (WHERE i.estado = 'falhou'),
           'por_contingencia', count(*) FILTER (WHERE i.estado IN ('aceita', 'entregue', 'lida') AND NOT EXISTS (
               SELECT 1 FROM public.seg_notificacao_tentativas t WHERE t.intencao_id = i.id AND t.canal = 'telegram' AND t.estado = 'aceita')),
           'adiadas_regra', (SELECT count(DISTINCT t.intencao_id) FROM public.seg_notificacao_tentativas t JOIN public.seg_notificacao_intencoes i2 ON i2.id = t.intencao_id
                              WHERE t.categoria_erro = 'orcamento_regra_dia' AND i2.tipo <> 'resumo' AND t.criado_em > p_desde AND (p_ate IS NULL OR t.criado_em <= p_ate)))
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
     ((v_r ->> 'suprimidas_orcamento')::int + (v_r ->> 'incertas')::int + (v_r ->> 'falhas')::int + (v_r ->> 'por_contingencia')::int + (v_r ->> 'adiadas_regra')::int) > 0);
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('seg_orcamento_consumir', 'seg_resumo_contar', 'seg_resumo_pendente') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.f);
  END LOOP;
END $$;

DO $$ BEGIN RAISE NOTICE 'M06: complemento 2 aplicado'; END $$;
