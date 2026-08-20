-- Agenda & Tarefas — Fase 3: sincronização inbound Google → Workspace.
-- origin marca de onde o item nasceu; o estado de sync guarda o
-- syncToken incremental do Google Calendar por usuário conectado.

alter table public.agenda_items
  add column if not exists origin text not null default 'workspace'
  check (origin in ('workspace', 'google'));

-- Um item por evento Google (evita importar o mesmo evento pelo sync
-- de cada convidado — o segundo sync só adiciona o participante).
create unique index if not exists agenda_items_google_event_unique_idx
  on public.agenda_items (google_event_id)
  where google_event_id is not null and deleted_at is null;

create table if not exists public.agenda_google_sync_state (
  user_id uuid primary key references public.users(id) on delete cascade,
  sync_token text null,
  last_synced_at timestamptz null,
  last_error text null,
  updated_at timestamptz not null default now()
);

-- Tabela interna do worker: acesso só pela service role.
do $$
declare
  t regclass;
begin
  t := app_private.enable_rls_if_exists('agenda_google_sync_state');
end $$;

notify pgrst, 'reload schema';
