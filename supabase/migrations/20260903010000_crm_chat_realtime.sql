-- ---------------------------------------------------------------------------
-- Chat Interno — Supabase Realtime pra mensagens (02/09/2026, fase 1 do
-- projeto de velocidade pedido pelo Bruno: troca o poll de 5s por entrega ao
-- vivo antes de liberar o CRM pra novos tenants).
--
-- Esta é a PRIMEIRA vez que uma tabela do CRM abre leitura direta pro papel
-- "authenticated" — até aqui a regra era "tudo do CRM é servido via service
-- role com filtro por parceiro na app" (comentário na migration
-- 20260830090000_crm_atendimento.sql, que habilitou RLS SEM nenhuma policy
-- nessas tabelas — RLS ligado + zero policy = authenticated não lê nada).
-- Supabase Realtime (Postgres Changes) só entrega uma linha pro navegador se
-- a policy de SELECT da tabela permitir pro usuário logado — por isso essa
-- abertura é necessária, mas o escopo é o mais estreito possível: só SELECT,
-- só em crm_chat_mensagens, só quem é membro ATIVO do canal — reaproveitando
-- a MESMA checagem que o servidor já faz em canalDoUsuario() (chat-interno-
-- actions.ts), nenhuma regra de autorização nova sendo inventada aqui.
-- ---------------------------------------------------------------------------

create or replace function app_private.crm_chat_membro_do_canal(p_canal_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from crm_chat_membros m
    join crm_usuarios u on u.id = m.crm_usuario_id
    where m.canal_id = p_canal_id
      and u.auth_user_id = auth.uid()
      and u.ativo = true
  );
$$;

revoke all on function app_private.crm_chat_membro_do_canal(uuid) from public;
grant execute on function app_private.crm_chat_membro_do_canal(uuid) to authenticated;

do $$ begin
  create policy crm_chat_mensagens_select_membro on public.crm_chat_mensagens
    for select to authenticated
    using (app_private.crm_chat_membro_do_canal(canal_id));
exception when duplicate_object then null; end $$;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crm_chat_mensagens'
  ) then
    alter publication supabase_realtime add table public.crm_chat_mensagens;
  end if;
end $$;
