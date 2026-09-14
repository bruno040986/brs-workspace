-- Custo de Observability na Vercel (13/09/2026): trocar polling do layout raiz
-- por Supabase Realtime. Para o navegador receber `postgres_changes`, a
-- tabela precisa (1) estar na publication `supabase_realtime` e (2) ter
-- policy de SELECT para o usuário que assina — o Realtime aplica RLS.
--
-- Achado: o HubHeader já assinava `praise_notifications`, mas a tabela não
-- estava na publication E não tinha policy nenhuma (RLS ligada) — canal morto,
-- por isso existia o poll de 30 s "segurando". As tabelas do chat interno
-- (`workspace_chat_*`) já têm policies por participante; só faltava publicar.

-- 1) praise_notifications: cada usuário lê só as próprias (mesmo desenho de
--    workspace_notifications_select_own).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'praise_notifications'
      and policyname = 'praise_notifications_select_own'
  ) then
    create policy praise_notifications_select_own
      on public.praise_notifications
      for select to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

-- 2) Publication (idempotente — ALTER PUBLICATION ADD falha se já estiver).
do $$
declare
  t text;
begin
  foreach t in array array[
    'praise_notifications',
    'workspace_chat_messages',
    'workspace_chat_participants',
    'workspace_chat_user_profiles',
    'comunicados'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
