-- M05 complemento 2 (revisão M05/M06): item REMOVIDO de policy/grant/bucket/função sai do monitor com gravidade mínima 'alta'
-- (policy RESTRICTIVE removida = 'critica'); antes saía 'baixa' e nunca notificava. Reaplica só seg_monitor_snapshot. Idempotente.
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
         -- desvio novo/alterado de policy/grant/bucket/funcao relativo à baseline: no mínimo 'alta' (gera incidente e intenção)
         CASE WHEN v_tem_base AND c.item_tipo IN ('policy', 'grant', 'bucket', 'funcao') AND public.seg_grav_rank(coalesce(c.gravidade, 'media')) < 3 THEN 'alta'
              ELSE coalesce(c.gravidade, 'media') END, c.violacao, b.valor, c.valor
    FROM public.seg_monitor_itens() c
    LEFT JOIN public.seg_monitor_baseline b ON b.item_tipo = c.item_tipo AND b.item_chave = c.item_chave
   WHERE CASE WHEN NOT v_tem_base THEN c.violacao IS NOT NULL
              ELSE b.item_chave IS NULL OR b.valor IS DISTINCT FROM c.valor END;
  INSERT INTO _seg_cand
  SELECT b.item_tipo, b.item_chave, 'removido',
         -- item REMOVIDO de policy/grant/bucket/funcao: no mínimo 'alta'; policy RESTRICTIVE removida = 'critica' (abre acesso)
         CASE WHEN b.item_tipo = 'policy' AND b.valor ->> 'permissive' = 'RESTRICTIVE' THEN 'critica'
              WHEN b.item_tipo IN ('policy', 'grant', 'bucket', 'funcao') THEN 'alta'
              ELSE 'baixa' END, NULL, b.valor, NULL
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

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'seg_monitor_snapshot' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.f);
  END LOOP;
END $$;

DO $$ BEGIN RAISE NOTICE 'M05: complemento 2 aplicado'; END $$;
