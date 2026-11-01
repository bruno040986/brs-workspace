-- Decisoes do dono em 01/11/2026. Idempotente.
-- Decisao 4: medidas disciplinares. Colaborador le as proprias: vinculo explicito users.employee_id
-- (app_private.is_own_employee) OU e-mail (employees.email = e-mail do usuario logado, lower()); ambos com o portao do M04 e quem tem rh-colaboradores le o historico. Escrita inalterada.
-- employees nao tem user_id; to_jsonb(e)->>'email' tolera a coluna ausente (esqueleto de teste).
CREATE OR REPLACE FUNCTION app_private.is_own_employee_by_email(target_employee_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app_private.sessao_interna_ok() AND EXISTS (
    SELECT 1 FROM public.employees e JOIN auth.users u ON u.id = auth.uid()
    WHERE e.id = target_employee_id
      AND nullif(lower(btrim(to_jsonb(e) ->> 'email')), '') = lower(btrim(u.email)));
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
