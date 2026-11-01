-- Decisoes do dono em 01/11/2026. Idempotente.
-- Decisao 4: medidas disciplinares. Colaborador le as proprias: vinculo explicito users.employee_id
-- (app_private.is_own_employee) OU e-mail (employees.email = e-mail do usuario logado, lower()); ambos com o portao do M04 e quem tem rh-colaboradores le o historico. Escrita inalterada.
-- employees nao tem user_id; to_jsonb(e)->>'email' tolera a coluna ausente (esqueleto de teste).
-- Fallback endurecido: usuario interno ativo com sessao liberada (M04), linha ativa em public.users, e-mail confirmado
-- no Auth, e-mail de users = e-mail de auth.users = employees.email. So vale quando users.employee_id e nulo
-- (o vinculo explicito, quando existe, tem prioridade e decide sozinho). Ideal futuro: coluna explicita e unica.
CREATE OR REPLACE FUNCTION app_private.is_own_employee_by_email(target_employee_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app_private.is_active_internal_user() AND EXISTS (
    SELECT 1 FROM public.users pu
    JOIN auth.users au ON au.id = pu.id
    JOIN public.employees e ON e.id = target_employee_id
    WHERE pu.id = auth.uid() AND coalesce(pu.active, true) = true
      AND pu.employee_id IS NULL
      AND au.email_confirmed_at IS NOT NULL
      AND nullif(lower(btrim(to_jsonb(e) ->> 'email')), '') = lower(btrim(pu.email))
      AND lower(btrim(pu.email)) = lower(btrim(au.email)));
$$;
REVOKE ALL ON FUNCTION app_private.is_own_employee_by_email(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.is_own_employee_by_email(uuid) TO authenticated, service_role;

DO $$
BEGIN
  IF to_regclass('public.disciplinary_records') IS NOT NULL THEN
    PERFORM app_private.apply_policy('public.disciplinary_records'::regclass, 'disciplinary_records_select_rh', 'SELECT',
      'app_private.has_permission(''rh-painel'', ''can_view'')
       OR app_private.has_permission(''rh-medidas-disciplinares'', ''can_view'')
       OR app_private.has_permission(''rh-colaboradores'', ''can_view'')
       OR app_private.is_own_employee(employee_id)
       OR app_private.is_own_employee_by_email(employee_id)');
  END IF;
END $$;

-- Decisao 17: retencao. Apaga o que passou de p_dias (padrao 180) em eventos/pausas/codigos/entregas.
-- Preserva: incidentes nao encerrados (e seus eventos/intencoes/diagnosticos), desvios abertos, pausas ainda ativas,
-- auth_bloqueios_admin, seg_config*/destinos e security_audit_demoted_admins_20261031 (nao tocadas).
CREATE OR REPLACE FUNCTION app_private.seg_expurgar(dias int DEFAULT 180)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_corte timestamptz;
  v_res jsonb := '{}'::jsonb;
  n bigint;
BEGIN
  IF dias IS NULL OR dias < 30 THEN RAISE EXCEPTION 'seg_expurgar: dias minimo 30'; END IF;
  v_corte := now() - make_interval(days => dias);

  -- Incidentes encerrados (cascata: intencoes, tentativas, recibos, diagnosticos, incidente_eventos).
  DELETE FROM public.seg_incidentes WHERE estado = 'encerrado' AND atualizado_em < v_corte;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('seg_incidentes_encerrados', n);

  -- Eventos antigos que nenhum incidente aberto referencia (cascata: classificacoes).
  DELETE FROM public.seg_eventos e WHERE e.criado_em < v_corte
    AND NOT EXISTS (SELECT 1 FROM public.seg_incidente_eventos ie WHERE ie.evento_id = e.id);
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('seg_eventos', n);

  DELETE FROM public.seg_monitor_desvios WHERE estado = 'resolvido' AND coalesce(resolvido_em, ultima_vista_em) < v_corte;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('seg_monitor_desvios', n);

  DELETE FROM public.seg_orcamento WHERE janela_inicio < v_corte;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('seg_orcamento', n);

  -- Codigos de e-mail: liberacoes referenciam o desafio (FK sem cascata), entao saem primeiro.
  DELETE FROM public.auth_sessao_liberacoes WHERE expira_em < v_corte;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('auth_sessao_liberacoes', n);
  DELETE FROM public.auth_desafios_email d WHERE d.expira_em < v_corte
    AND NOT EXISTS (SELECT 1 FROM public.auth_sessao_liberacoes l WHERE l.desafio_id = d.id);
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('auth_desafios_email', n);

  -- Pausas de senha / tentativas: so as sem pausa vigente.
  DELETE FROM public.auth_tentativas
   WHERE coalesce(ultima_falha, pausa_ate) < v_corte AND (pausa_ate IS NULL OR pausa_ate < now());
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('auth_tentativas', n);

  DELETE FROM public.acessos_log WHERE criado_em < v_corte;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('acessos_log', n);

  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION app_private.seg_expurgar(int) FROM PUBLIC, anon, authenticated;

-- Wrapper para a rota de cron (PostgREST so expoe public). Somente service_role.
CREATE OR REPLACE FUNCTION public.seg_expurgar(dias int DEFAULT 180)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT app_private.seg_expurgar(dias);
$$;
REVOKE ALL ON FUNCTION public.seg_expurgar(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seg_expurgar(int) TO service_role;
GRANT EXECUTE ON FUNCTION app_private.seg_expurgar(int) TO service_role;
