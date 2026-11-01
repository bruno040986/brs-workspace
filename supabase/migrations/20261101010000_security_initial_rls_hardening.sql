-- Incidente 2026-10-31 — M03-A parte 1 (N01 revisada): RH, portabilidade e handle_new_user.
-- LOCAL, NÃO APLICADA. Aplicar só com conexão administrativa, Data API ainda desligada
-- e OK explícito do Bruno. Ordem: esta migration, depois 20261101020000_security_m03a_workspace_containment.
--
-- 1. disciplinary_records: as 4 políticas de RH de 20260601132916 continuam corretas; o
--    vazamento (3 linhas visíveis na simulação autenticada) vem de política legada criada
--    fora das migrations. Política fora da lista é removida SÓ se for comprovadamente
--    permissiva (USING/CHECK true) ou de nome legado conhecido; qualquer outra política
--    desconhecida ABORTA a migration (nada é removido em silêncio). O operador confirma
--    uma política desconhecida com:  set brs.m03a_drop_policies = 'nome1,nome2';
-- 2. regras_portabilidade_ifs/globais: 20260922220000 criou USING (true) para PUBLIC
--    (inclui anon) em leitura e escrita. Troca por permissão por operação no recurso
--    operacional-simulador-portabilidade (o mesmo que a rota exige em src/lib/auth/permissions.ts).
-- 3. handle_new_user deixa de criar public.users/admin. O cadastro legítimo
--    (saveUserDirectly) já faz upsert completo; signup direto no Auth não ganha linha
--    em public.users e, portanto, nenhuma permissão em app_private.has_permission.
-- 4. Contas que o trigger antigo promoveu a admin sem cadastro interno são rebaixadas,
--    desativadas, banidas no Auth e listadas em public.security_audit_demoted_admins_20261031
--    para o Bruno reativar quem for legítimo (decisão 8 de 01/11).
--
-- Não há rollback automático. Reverter NUNCA significa reabrir USING (true): desligue o
-- recurso (tire a permissão do perfil) em vez de restaurar política aberta.

-- ---------------------------------------------------------------------------
-- 0. Preflight: aborta se faltar objeto de que a migration depende
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  faltando text[] := ARRAY[]::text[];
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'user_permissions', 'disciplinary_records',
                           'regras_portabilidade_ifs', 'regras_portabilidade_globais']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN faltando := faltando || ('tabela public.' || t); END IF;
  END LOOP;
  IF to_regprocedure('app_private.has_permission(text,text)') IS NULL THEN faltando := faltando || 'app_private.has_permission'; END IF;
  IF to_regprocedure('app_private.apply_policy(regclass,text,text,text,text)') IS NULL THEN faltando := faltando || 'app_private.apply_policy'; END IF;
  IF to_regprocedure('app_private.enable_rls_if_exists(text)') IS NULL THEN faltando := faltando || 'app_private.enable_rls_if_exists'; END IF;
  IF to_regprocedure('public.handle_new_user()') IS NULL THEN faltando := faltando || 'public.handle_new_user'; END IF;
  IF array_length(faltando, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'M03-A preflight: faltam objetos: %', array_to_string(faltando, ', ');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Auxiliar (temporária): remove política comprovadamente permissiva ou autorizada,
-- aborta diante de qualquer outra política fora da lista permitida.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.m03a_limpar_politicas(t regclass, permitidas text[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  p record;
  conhecidas constant text[] := ARRAY['acesso_total', 'acesso medidas', 'acesso medidas disciplinares',
    'Allow all for authenticated', 'Permitir gestão total', 'Enable all for authenticated users'];
  autorizadas text[] := string_to_array(replace(coalesce(current_setting('brs.m03a_drop_policies', true), ''), ' ', ''), ',');
  desconhecidas text[] := ARRAY[]::text[];
BEGIN
  FOR p IN
    SELECT policyname::text AS nome, cmd, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = (SELECT relname FROM pg_class WHERE oid = t)
      AND policyname::text <> ALL (permitidas)
  LOOP
    IF p.nome = ANY (conhecidas)
       OR p.nome = ANY (autorizadas)
       OR (coalesce(p.qual, 'true') IN ('true', '(true)') AND coalesce(p.with_check, 'true') IN ('true', '(true)')) THEN
      RAISE NOTICE '% : removendo politica % (cmd=%, roles=%, using=%, check=%)',
        t, p.nome, p.cmd, p.roles, p.qual, p.with_check;
      EXECUTE format('DROP POLICY %I ON %s', p.nome, t);
    ELSE
      desconhecidas := desconhecidas || format('%s (cmd=%s, roles=%s, using=%s, check=%s)', p.nome, p.cmd, p.roles, p.qual, p.with_check);
    END IF;
  END LOOP;
  IF array_length(desconhecidas, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'M03-A: % tem politica(s) desconhecida(s) fora da lista; confira em pg_policies e, se forem para remover, rode: set brs.m03a_drop_policies = ''nome1,nome2''. Politicas: %',
      t, array_to_string(desconhecidas, ' | ');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. disciplinary_records
-- ---------------------------------------------------------------------------
DO $$
DECLARE t regclass;
BEGIN
  t := app_private.enable_rls_if_exists('disciplinary_records');
  PERFORM pg_temp.m03a_limpar_politicas(t, ARRAY[
    'disciplinary_records_select_rh', 'disciplinary_records_insert_rh',
    'disciplinary_records_update_rh', 'disciplinary_records_delete_rh']);

  PERFORM app_private.apply_policy(t, 'disciplinary_records_select_rh', 'SELECT', 'app_private.has_permission(''rh-painel'', ''can_view'') OR app_private.has_permission(''rh-medidas-disciplinares'', ''can_view'')');
  PERFORM app_private.apply_policy(t, 'disciplinary_records_insert_rh', 'INSERT', NULL, 'app_private.has_permission(''rh-medidas-disciplinares'', ''can_include'')');
  PERFORM app_private.apply_policy(t, 'disciplinary_records_update_rh', 'UPDATE', 'app_private.has_permission(''rh-medidas-disciplinares'', ''can_edit'')', 'app_private.has_permission(''rh-medidas-disciplinares'', ''can_edit'')');
  PERFORM app_private.apply_policy(t, 'disciplinary_records_delete_rh', 'DELETE', 'app_private.has_permission(''rh-medidas-disciplinares'', ''can_delete'')');

  -- anon não tem consumidor; TRUNCATE ignora RLS.
  EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, anon', t);
  EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON %s FROM authenticated', t);
END $$;

-- ---------------------------------------------------------------------------
-- 2. regras_portabilidade_ifs / regras_portabilidade_globais
-- ---------------------------------------------------------------------------
DO $$
DECLARE t regclass;
BEGIN
  t := app_private.enable_rls_if_exists('regras_portabilidade_ifs');
  PERFORM pg_temp.m03a_limpar_politicas(t, ARRAY[
    'regras_portabilidade_ifs_select_permitted', 'regras_portabilidade_ifs_insert_permitted',
    'regras_portabilidade_ifs_update_permitted', 'regras_portabilidade_ifs_delete_permitted']);

  -- saveRegraIfPortabilidade faz upsert (INSERT ... ON CONFLICT DO UPDATE): regra nova
  -- exige can_include; editar regra existente exige can_edit (+ can_view para o conflito).
  PERFORM app_private.apply_policy(t, 'regras_portabilidade_ifs_select_permitted', 'SELECT', 'app_private.has_permission(''operacional-simulador-portabilidade'', ''can_view'')');
  PERFORM app_private.apply_policy(t, 'regras_portabilidade_ifs_insert_permitted', 'INSERT', NULL, 'app_private.has_permission(''operacional-simulador-portabilidade'', ''can_include'')');
  PERFORM app_private.apply_policy(t, 'regras_portabilidade_ifs_update_permitted', 'UPDATE', 'app_private.has_permission(''operacional-simulador-portabilidade'', ''can_edit'')', 'app_private.has_permission(''operacional-simulador-portabilidade'', ''can_edit'')');
  PERFORM app_private.apply_policy(t, 'regras_portabilidade_ifs_delete_permitted', 'DELETE', 'app_private.has_permission(''operacional-simulador-portabilidade'', ''can_delete'')');
  EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, anon', t);
  EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON %s FROM authenticated', t);

  t := app_private.enable_rls_if_exists('regras_portabilidade_globais');
  PERFORM pg_temp.m03a_limpar_politicas(t, ARRAY[
    'regras_portabilidade_globais_select_permitted', 'regras_portabilidade_globais_insert_permitted']);

  -- O coeficiente global é histórico: saveCoeficienteGlobalPortabilidade só insere uma
  -- linha nova e a leitura pega a mais recente. Gravar é a ação "editar" da tela, por
  -- isso INSERT exige can_edit. Sem UPDATE/DELETE para authenticated (sem consumidor).
  PERFORM app_private.apply_policy(t, 'regras_portabilidade_globais_select_permitted', 'SELECT', 'app_private.has_permission(''operacional-simulador-portabilidade'', ''can_view'')');
  PERFORM app_private.apply_policy(t, 'regras_portabilidade_globais_insert_permitted', 'INSERT', NULL, 'app_private.has_permission(''operacional-simulador-portabilidade'', ''can_edit'')');
  EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, anon', t);
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON %s FROM authenticated', t);
END $$;

-- ---------------------------------------------------------------------------
-- 3. handle_new_user: sem espelho automático e sem promoção a admin
-- ---------------------------------------------------------------------------
-- O trigger em auth.users continua existindo, mas a função não cria mais nada.
-- Quem cria usuário interno é o servidor (saveUserDirectly), com
-- requirePermission('sistema-usuarios-cadastro', 'can_include').
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Rebaixar contas admin criadas só pelo trigger antigo (sem cadastro interno)
-- ---------------------------------------------------------------------------
-- Assinatura do trigger antigo: INSERT (id, name, email, role='admin') e mais nada.
-- Cadastro interno de verdade tem cpf (o formulário exige), perfil, employee_id ou
-- permissões individuais. Quem tem qualquer um desses NÃO é tocado.
CREATE TABLE IF NOT EXISTS public.security_audit_demoted_admins_20261031 (
  user_id uuid PRIMARY KEY,
  email text,
  name text,
  role_anterior text,
  active_anterior boolean,
  criado_em_users timestamptz,
  rebaixado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.security_audit_demoted_admins_20261031 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_audit_demoted_admins_20261031 FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.security_audit_demoted_admins_20261031 TO service_role;
COMMENT ON TABLE public.security_audit_demoted_admins_20261031 IS
  'Incidente 2026-10-31: contas @brspromotora.com.br promovidas a admin pelo trigger antigo sem cadastro interno, rebaixadas e desativadas pela migration M03-A. O Bruno reativa quem for legitimo (setUserActive no painel de usuarios + role).';

WITH candidatas AS (
  SELECT u.id, u.email, u.name, u.role, u.active, u.created_at
  FROM public.users u
  WHERE u.role = 'admin'
    AND u.email ILIKE '%@brspromotora.com.br'
    AND u.email NOT ILIKE '%@parceiro.brspromotora.com.br'
    AND u.profile_id IS NULL
    AND u.employee_id IS NULL
    AND u.cpf IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.user_permissions up WHERE up.user_id = u.id)
), registradas AS (
  INSERT INTO public.security_audit_demoted_admins_20261031 (user_id, email, name, role_anterior, active_anterior, criado_em_users)
  SELECT id, email, name, role, active, created_at FROM candidatas
  ON CONFLICT (user_id) DO NOTHING
  RETURNING user_id
), rebaixadas AS (
  UPDATE public.users u
  SET role = 'consulta', active = false
  FROM registradas r
  WHERE u.id = r.user_id
  RETURNING u.id
)
UPDATE auth.users a
SET banned_until = now() + interval '876000 hours'
FROM rebaixadas r
WHERE a.id = r.id;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.security_audit_demoted_admins_20261031;
  RAISE NOTICE 'M03-A: % conta(s) admin sem cadastro interno rebaixada(s) e desativada(s); lista em public.security_audit_demoted_admins_20261031', n;
END $$;
