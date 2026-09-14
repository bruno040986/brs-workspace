-- BRS Messenger M0 (14/09/2026): ticks (✓/✓✓/lida) e reações chegam por
-- Supabase Realtime em vez do poll de 6 s da thread.
--
-- As duas tabelas são escritas só pelo engine (service role) e lidas pelo
-- Workspace via admin client (getMensagens). Para o navegador do atendente
-- receber `postgres_changes`, precisa (1) estar na publication e (2) ter
-- policy de SELECT — o Realtime aplica RLS. A policy repete a regra de
-- `chat_eventos_select_permitted` (permissão `conversas`) e restringe à
-- conta BRS: parceiro do CRM (também `authenticated`, mesmo Supabase) não
-- recebe evento da conta BRS, e o atendente da BRS não recebe dos parceiros.

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_mensagem_status' and policyname = 'chat_mensagem_status_select_brs') then
    create policy chat_mensagem_status_select_brs
      on public.chat_mensagem_status
      for select to authenticated
      using (
        conta_id = (select id from public.chat_contas where owner_tipo = 'brs' limit 1)
        and app_private.has_permission('conversas', 'can_view')
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_mensagem_reacoes' and policyname = 'chat_mensagem_reacoes_select_brs') then
    create policy chat_mensagem_reacoes_select_brs
      on public.chat_mensagem_reacoes
      for select to authenticated
      using (
        conta_id = (select id from public.chat_contas where owner_tipo = 'brs' limit 1)
        and app_private.has_permission('conversas', 'can_view')
      );
  end if;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['chat_mensagem_status', 'chat_mensagem_reacoes'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
