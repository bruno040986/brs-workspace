-- Presença (B1, lote 2) — revisão Fable 26/09/2026.
-- O broadcast `presenca-conta-<chatwoot_account_id>` carrega o telefone do contato
-- que está digitando; em canal público qualquer portador da chave anon poderia
-- assinar. O canal passa a ser PRIVADO: o Realtime só entrega a quem esta policy
-- autoriza (usuário logado, permissão `conversas`, e só o canal da conta BRS).
-- O engine publica com service role (não passa por RLS).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'presenca_conta_brs_select') then
    create policy presenca_conta_brs_select
      on realtime.messages
      for select to authenticated
      using (
        realtime.topic() = 'presenca-conta-' || (select chatwoot_account_id::text from public.chat_contas where owner_tipo = 'brs' limit 1)
        and app_private.has_permission('conversas', 'can_view')
      );
  end if;
end $$;
