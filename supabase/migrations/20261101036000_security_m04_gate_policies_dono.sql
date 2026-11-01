-- M04 I5 - gate da sessao liberada nas policies "por dono" e no SELECT de avatars. Idempotente.
-- Antes: com a Data API religada, sessao AAL1 (so senha) lia/escrevia o proprio registro nessas tabelas internas.
-- Policy RESTRICTIVE (AND com as permissivas existentes): para interno exige sessao liberada; nao interno
-- (parceiro) passa por sessao_interna_ok() = true e segue so as regras antigas. service_role ignora RLS.
-- Tabelas ausentes no ambiente sao puladas (aviso). Exclui tabelas de parceiro/CRM (crm_*, parceiro_*, nvti_lotes_parceiro...).
DO $$
BEGIN
  IF to_regprocedure('app_private.sessao_interna_ok()') IS NULL THEN
    RAISE EXCEPTION 'M04 gate policies: aplique antes 20261101030000_security_m04_login_cinco_etapas.sql';
  END IF;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'comunicado_reads', 'praise_notifications', 'record_comments', 'user_google_auth', 'workspace_notifications',
    'workspace_chat_conversations', 'workspace_chat_messages', 'workspace_chat_participants', 'workspace_chat_user_profiles',
    'hub_banners', 'marketing_arte_associacoes'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'M04 gate policies: tabela % ausente, pulada', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS m04_gate_sessao_interna ON public.%I', t);
    EXECUTE format('CREATE POLICY m04_gate_sessao_interna ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT app_private.sessao_interna_ok())) WITH CHECK ((SELECT app_private.sessao_interna_ok()))', t);
  END LOOP;

  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS "avatars_select_authenticated" ON storage.objects;
    CREATE POLICY "avatars_select_authenticated" ON storage.objects
      FOR SELECT TO authenticated USING (bucket_id = 'avatars' AND (SELECT app_private.sessao_interna_ok()));
  END IF;
  RAISE NOTICE 'M04: gate nas policies por dono e em avatars instalado';
END $$;
