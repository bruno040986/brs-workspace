-- A3 (lote 2 de paridade com o Digisac): edição de mensagem do WhatsApp.
-- O Chatwoot não tem endpoint de edição: guardamos aqui o texto atual de cada
-- mensagem editada (nossa, via engine, ou do contato, via messages.update do
-- Baileys) e a thread mostra este texto com o selo "editada". O original fica no
-- Chatwoot. Uma linha por mensagem (a última edição vence).

create table if not exists public.chat_mensagem_edicoes (
  chatwoot_message_id integer primary key,
  conta_id uuid not null references public.chat_contas (id) on delete cascade,
  wa_id text not null,
  texto_novo text not null,
  origem text not null check (origem in ('nos', 'contato')),
  editado_em timestamptz not null default now()
);

alter table public.chat_mensagem_edicoes enable row level security;
revoke all on public.chat_mensagem_edicoes from public, anon, authenticated;
grant select, insert, update, delete on public.chat_mensagem_edicoes to service_role;
-- Leitura pelo Realtime da tela (mesmo padrão de chat_mensagem_status/reacoes).
grant select on public.chat_mensagem_edicoes to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_mensagem_edicoes' and policyname = 'chat_mensagem_edicoes_select_brs') then
    create policy chat_mensagem_edicoes_select_brs
      on public.chat_mensagem_edicoes
      for select to authenticated
      using (
        conta_id = (select id from public.chat_contas where owner_tipo = 'brs' limit 1)
        and app_private.has_permission('conversas', 'can_view')
      );
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_mensagem_edicoes'
  ) then
    alter publication supabase_realtime add table public.chat_mensagem_edicoes;
  end if;
end $$;

notify pgrst, 'reload schema';
