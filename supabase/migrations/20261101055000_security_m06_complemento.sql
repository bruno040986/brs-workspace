-- M06 complemento (revisão M06 B1): (1) slot crítico reservado também em global_dia/canal_dia (orcamento.slot_critico_dia, proposta 5);
-- (a reserva diária é limitada a 1/3 do teto, para tetos pequenos continuarem utilizáveis); (2) novo escopo regra_dia (orcamento.regra_dia, proposta 10/dia por regra do incidente): flood de uma regra (ex. login_reincidencia)
-- não consome a cota de signup/privilégio/MFA. A regra é lida do incidente (assinatura da função inalterada). Idempotente.
DO $$
DECLARE c text;
BEGIN
  IF to_regclass('public.seg_orcamento') IS NULL THEN RAISE EXCEPTION 'M06 complemento: aplicar a migration M06 antes'; END IF;
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.seg_orcamento'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%escopo%' LOOP
    EXECUTE format('ALTER TABLE public.seg_orcamento DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE public.seg_orcamento ADD CONSTRAINT seg_orcamento_escopo_check
    CHECK (escopo IN ('global_hora', 'global_dia', 'canal_hora', 'canal_dia', 'instancia_dia', 'incidente_hora', 'regra_dia'));
END $$;

INSERT INTO public.seg_config (chave, valor, descricao, origem) VALUES
  ('orcamento.slot_critico_dia', '5', 'Reserva diária (global e por canal) que só alertas críticos podem usar', 'proposta do executor M06 (B1 da revisão)'),
  ('orcamento.regra_dia', '10', 'Teto de tentativas externas por regra por dia (impede que uma regra consuma o orçamento das outras)', 'proposta do executor M06 (B1 da revisão)')
ON CONFLICT (chave) DO NOTHING;

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
BEGIN
  IF p_canal NOT IN ('telegram', 'whatsapp', 'email') THEN RAISE EXCEPTION 'seg_canal_invalido'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('seg_orcamento', 0));
  DELETE FROM public.seg_orcamento WHERE janela_inicio < now() - interval '3 days';

  FOR r IN
    SELECT * FROM (VALUES
      ('global_hora',    ''::text,                          v_hora, public.seg_cfg('orcamento.global_hora', 20) - CASE WHEN v_crit THEN 0 ELSE v_slot END),
      ('global_dia',     ''::text,                          v_dia,  public.seg_cfg('orcamento.global_dia', 60) - CASE WHEN v_crit THEN 0 ELSE least(v_slot_dia, floor(public.seg_cfg('orcamento.global_dia', 60) / 3)) END),
      ('canal_hora',     p_canal,                           v_hora, public.seg_cfg('orcamento.' || p_canal || '_hora', v_big) - CASE WHEN v_crit AND public.seg_cfg('orcamento.' || p_canal || '_hora', v_big) < v_big THEN 0 WHEN public.seg_cfg('orcamento.' || p_canal || '_hora', v_big) < v_big THEN v_slot ELSE 0 END),
      ('canal_dia',      p_canal,                           v_dia,  public.seg_cfg('orcamento.' || p_canal || '_dia', v_big) - CASE WHEN NOT v_crit AND public.seg_cfg('orcamento.' || p_canal || '_dia', v_big) < v_big THEN least(v_slot_dia, floor(public.seg_cfg('orcamento.' || p_canal || '_dia', v_big) / 3)) ELSE 0 END),
      ('regra_dia',      v_regra,                           v_dia,  CASE WHEN v_regra <> '' THEN public.seg_cfg('orcamento.regra_dia', 10) ELSE v_big END),
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
      ('global_hora', ''::text, v_hora), ('global_dia', ''::text, v_dia), ('canal_hora', p_canal, v_hora), ('canal_dia', p_canal, v_dia), ('regra_dia', v_regra, v_dia),
      ('instancia_dia', coalesce(p_instancia, ''), v_dia), ('incidente_hora', coalesce(p_incidente::text, ''), v_hora)
    ) AS t(escopo, chave, janela)
  LOOP
    INSERT INTO public.seg_orcamento (escopo, chave, janela_inicio, usado) VALUES (r.escopo, r.chave, r.janela, 1)
    ON CONFLICT (escopo, chave, janela_inicio) DO UPDATE SET usado = public.seg_orcamento.usado + 1;
  END LOOP;
  RETURN jsonb_build_object('permitido', true, 'motivo', NULL);
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'seg_orcamento_consumir' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.f);
  END LOOP;
END $$;

DO $$ BEGIN RAISE NOTICE 'M06: complemento aplicado'; END $$;
