-- M03-A complemento (correcoes da REVISAO-M03A.md). Roda entre 20261101020000 e a M04 (030000).
-- Idempotente. Nao recria nenhuma politica aberta.

-- 1) Politicas {public}/true que o inventario remoto (M03-0) achou e a parte 2 nao cobria.
--    As politicas por has_permission (profile_schedules_select_user_admin, user_schedules_select_user_admin,
--    sector_links_select_by_workspace_or_admin e as de escrita) permanecem.
--    Consumidores: usuarios/actions.ts e lib/nav/links-menu.ts usam service_role; links/actions.ts usa sessao
--    com permissao de rota. Nenhum le como anon.
DROP POLICY IF EXISTS "Permitir leitura de horários de perfil" ON public.profile_schedules;
DROP POLICY IF EXISTS "Permitir leitura de horários de usuário" ON public.user_schedules;
DROP POLICY IF EXISTS "Permitir leitura para todos" ON public.sector_links;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profile_schedules','user_schedules','sector_links'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    END IF;
  END LOOP;
END $$;

-- 2) Storage: "Sistema gerencia avatares" (ALL, {public}) deixava qualquer papel, inclusive anon,
--    inserir/alterar/apagar em avatars. Uploads reais usam service_role (usuarios/actions.ts, rh/parceiros/actions.ts).
--    "Avatares Públicos" (SELECT, {public}) tambem sai: com ela anon le o bucket pela Storage API mesmo privado.
--    Leitura passa a ser so para authenticated. DECISAO DO BRUNO: se o bucket voltar a ser publico por desenho,
--    recriar SELECT TO public (ou marcar o bucket public=true) e reativar os getPublicUrl.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Sistema gerencia avatares" ON storage.objects;
    DROP POLICY IF EXISTS "Avatares Públicos" ON storage.objects;
    DROP POLICY IF EXISTS "avatars_select_authenticated" ON storage.objects;
    CREATE POLICY "avatars_select_authenticated" ON storage.objects
      FOR SELECT TO authenticated USING (bucket_id = 'avatars');
  END IF;
END $$;

-- 3) Rebaixamento (feito pela 20261101010000): lista nominal, e-mail mascarado, para o Bruno confirmar.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT user_id, email FROM public.security_audit_demoted_admins_20261031 ORDER BY rebaixado_em LOOP
    RAISE NOTICE 'M03-A: rebaixada % (%)', r.user_id,
      left(split_part(r.email, '@', 1), 2) || '***@' || split_part(r.email, '@', 2);
  END LOOP;
END $$;
