-- Agenda & Tarefas — convidados externos (e-mail livre + sugestões dos
-- vínculos). O convite em si é entregue pelo Google Calendar ao
-- espelhar o compromisso (attendees aceitam qualquer domínio).

create table if not exists public.agenda_item_guests (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.agenda_items(id) on delete cascade,
  email text not null,
  name text not null default '',
  -- 'manual' (digitado), 'vinculo' (sugestão aceita) ou 'google'
  -- (veio no convite de um evento importado do Google).
  source text not null default 'manual' check (source in ('manual', 'vinculo', 'google')),
  created_at timestamptz not null default now(),
  unique (item_id, email)
);

create index if not exists agenda_item_guests_item_idx on public.agenda_item_guests (item_id);

do $$
declare
  t regclass;
begin
  t := app_private.enable_rls_if_exists('agenda_item_guests');
  perform app_private.apply_policy(t, 'agenda_item_guests_select_permitted', 'SELECT', 'app_private.has_permission(''workspace-agenda'', ''can_view'')');
  perform app_private.apply_policy(t, 'agenda_item_guests_insert_permitted', 'INSERT', null, 'app_private.has_permission(''workspace-agenda'', ''can_include'')');
end $$;

notify pgrst, 'reload schema';
