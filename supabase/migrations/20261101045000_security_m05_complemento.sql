-- M05 complemento (revisão REVISAO-M05.md: I-1, I-2, I-3, I-4, M-1). Não altera a 040000 já commitada; reaplica 4 funções (CREATE OR REPLACE).
-- Idempotente. Mantém EXECUTE só para service_role.

CREATE OR REPLACE FUNCTION public.seg_sanitizar(p jsonb, p_nivel int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE k text; v jsonb; r jsonb; a jsonb; i int; s text;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  IF p_nivel = 0 AND octet_length(p::text) > 16384 THEN -- corta ANTES de recursar (custo de CPU)
    RETURN jsonb_build_object('truncado', true, 'bytes', octet_length(p::text));
  END IF;
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
  v_ident text;
BEGIN
  IF p_evento IS NULL OR jsonb_typeof(p_evento) <> 'object' THEN RAISE EXCEPTION 'seg_evento_invalido'; END IF;
  IF jsonb_typeof(coalesce(p_classificacoes, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'seg_classificacoes_invalidas'; END IF;

  v_payload := public.seg_sanitizar(coalesce(p_evento -> 'payload', '{}'::jsonb));
  IF jsonb_typeof(v_payload) <> 'object' THEN v_payload := jsonb_build_object('valor', v_payload); END IF;
  IF octet_length(v_payload::text) > 8192 THEN
    v_payload := jsonb_build_object('truncado', true, 'bytes', octet_length(v_payload::text));
  END IF;
  -- identidade informada só é gravada se parecer e-mail/CPF; senão hash curto (pode ser senha digitada no campo errado)
  v_ident := nullif(left(btrim(p_evento ->> 'identidade_informada'), 254), '');
  IF v_ident IS NOT NULL AND v_ident !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' AND v_ident !~ '^(\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$' THEN
    v_ident := 'formato_invalido:' || left(encode(sha256(convert_to(lower(v_ident), 'UTF8')), 'hex'), 16);
  END IF;
  v_hash := encode(sha256(convert_to(
    coalesce(p_evento ->> 'fonte', '') || '|' || coalesce(p_evento ->> 'tipo', '') || '|' || coalesce(p_evento ->> 'id_origem', '') || '|' || v_payload::text, 'UTF8')), 'hex');

  INSERT INTO public.seg_eventos (ocorrido_em, fonte, id_origem, tipo, identidade_informada, identidade_validada_user_id,
                                  request_id, ip_observado, user_agent_observado, cobertura_fonte, payload, payload_hash)
  VALUES (coalesce(nullif(p_evento ->> 'ocorrido_em', '')::timestamptz, now()),
          p_evento ->> 'fonte', nullif(p_evento ->> 'id_origem', ''), p_evento ->> 'tipo',
          v_ident,
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
    v_ctx := regexp_replace(v_ctx, '^__', '_'); -- '__*' é reservado ao agregado/volume anômalo
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
              WHEN g.quem IN ('PUBLIC', 'anon') AND NOT g.rls AND g.privs && ARRAY['SELECT'] THEN 'anon_le_sem_rls'
              WHEN g.quem = 'authenticated' AND NOT g.rls AND g.privs && ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] THEN 'authenticated_escreve_sem_rls'
              WHEN g.quem = 'authenticated' AND NOT g.rls AND g.privs && ARRAY['SELECT'] THEN 'authenticated_le_sem_rls' END,
         CASE WHEN g.quem IN ('PUBLIC', 'anon') AND NOT g.rls AND g.privs && ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] THEN 'critica'
              WHEN g.quem IN ('PUBLIC', 'anon') AND NOT g.rls AND g.privs && ARRAY['SELECT'] THEN 'alta'
              WHEN g.quem = 'authenticated' AND NOT g.rls AND g.privs && ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] THEN 'critica'
              WHEN g.quem = 'authenticated' AND NOT g.rls AND g.privs && ARRAY['SELECT'] THEN 'alta' END
    FROM g;

  -- função SECURITY DEFINER executável por PUBLIC/anon/authenticated (exposta via PostgREST /rpc)
  RETURN QUERY
  SELECT 'funcao'::text, n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         jsonb_build_object('quem', to_jsonb(array_agg(DISTINCT CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END ORDER BY CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END))),
         'funcao_definer_executavel'::text, 'alta'::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   WHERE n.nspname = 'public' AND p.prosecdef AND p.prorettype <> 'trigger'::regtype
     AND (a.grantee = 0 OR a.grantee::regrole::text IN ('anon', 'authenticated')) AND a.privilege_type = 'EXECUTE'
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
   GROUP BY n.nspname, p.oid, p.proname;

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

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('seg_sanitizar', 'seg_registrar_evento', 'seg_monitor_itens', 'seg_monitor_snapshot') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.f);
  END LOOP;
END $$;

DO $$ BEGIN RAISE NOTICE 'M05: complemento aplicado'; END $$;
