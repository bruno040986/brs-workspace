-- Módulo Agenda & Tarefas (Fase 1)
-- Itens de agenda/tarefas de equipe, notificações genéricas do sino e
-- comentários reutilizáveis por registro (entity_type + entity_id).

-- ============================================================
-- Itens de agenda (tarefa, reunião virtual, reunião presencial,
-- evento externo). Fonte da verdade é o Workspace; o Google
-- Calendar é espelho (google_event_id, Fase 2).
-- ============================================================
create table if not exists public.agenda_items (
  id uuid primary key default gen_random_uuid(),
  item_type text not null check (item_type in ('tarefa', 'reuniao_virtual', 'reuniao_presencial', 'evento_externo')),
  title text not null,
  description text not null default '',
  all_day boolean not null default true,
  due_date date null,
  start_at timestamptz null,
  end_at timestamptz null,
  priority text not null default 'media' check (priority in ('alta', 'media', 'baixa')),
  status text null check (status in ('pendente', 'em_andamento', 'aguardando', 'feito')),
  visibility text not null default 'publica' check (visibility in ('publica', 'privada')),
  meeting_link_mode text not null default 'nenhum' check (meeting_link_mode in ('nenhum', 'gerar_meet', 'externo')),
  meeting_link text not null default '',
  recurrence jsonb null,
  google_event_id text null,
  google_owner_user_id uuid null references public.users(id) on delete set null,
  created_by uuid not null references public.users(id) on delete restrict,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agenda_items_tarefa_status check (item_type <> 'tarefa' or status is not null)
);

create index if not exists agenda_items_type_status_idx on public.agenda_items (item_type, status);
create index if not exists agenda_items_due_date_idx on public.agenda_items (due_date);
create index if not exists agenda_items_start_at_idx on public.agenda_items (start_at);
create index if not exists agenda_items_created_by_idx on public.agenda_items (created_by);
create index if not exists agenda_items_deleted_at_idx on public.agenda_items (deleted_at);

-- Envolvidos no item + lista de autorizados de itens privados.
create table if not exists public.agenda_item_participants (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.agenda_items(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'envolvido' check (role in ('envolvido', 'autorizado')),
  created_at timestamptz not null default now(),
  unique (item_id, user_id, role)
);

create index if not exists agenda_item_participants_item_idx on public.agenda_item_participants (item_id);
create index if not exists agenda_item_participants_user_idx on public.agenda_item_participants (user_id);

-- Vínculo polimórfico com registros do Workspace (Instituição
-- Financeira, Promotora, Agente/Corban, etc.). label guarda o nome
-- exibido no momento do vínculo para leitura sem join.
create table if not exists public.agenda_item_links (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.agenda_items(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  label text not null default '',
  created_at timestamptz not null default now(),
  unique (item_id, entity_type, entity_id)
);

create index if not exists agenda_item_links_entity_idx on public.agenda_item_links (entity_type, entity_id);

-- "Feito nesta ocorrência" de tarefas recorrentes (Fase 3 usa; o
-- schema já nasce pronto para não migrar depois).
create table if not exists public.agenda_task_occurrences (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.agenda_items(id) on delete cascade,
  occurrence_date date not null,
  done_at timestamptz null,
  done_by uuid null references public.users(id) on delete set null,
  unique (item_id, occurrence_date)
);

-- ============================================================
-- Notificações genéricas do sino (o Workspace não tinha tabela
-- genérica — Elogios e Comunicados continuam como estão).
-- ============================================================
create table if not exists public.workspace_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null default '',
  href text not null default '',
  entity_type text null,
  entity_id uuid null,
  actor_user_id uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz null
);

create index if not exists workspace_notifications_user_read_idx on public.workspace_notifications (user_id, read_at);
create index if not exists workspace_notifications_user_created_idx on public.workspace_notifications (user_id, created_at desc);

-- ============================================================
-- Comentários com linha do tempo, reutilizáveis por registro
-- (agenda_item hoje; agente_parceiro e outros no futuro).
-- ============================================================
create table if not exists public.record_comments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  user_id uuid not null references public.users(id) on delete restrict,
  body text not null check (char_length(body) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists record_comments_entity_idx on public.record_comments (entity_type, entity_id, created_at);

-- ============================================================
-- RLS
-- ============================================================
do $$
declare
  t regclass;
begin
  t := app_private.enable_rls_if_exists('agenda_items');
  perform app_private.apply_policy(t, 'agenda_items_select_permitted', 'SELECT', 'app_private.has_permission(''workspace-agenda'', ''can_view'')');
  perform app_private.apply_policy(t, 'agenda_items_insert_permitted', 'INSERT', null, 'app_private.has_permission(''workspace-agenda'', ''can_include'')');
  perform app_private.apply_policy(t, 'agenda_items_update_permitted', 'UPDATE',
    'app_private.has_permission(''workspace-agenda'', ''can_edit'')',
    'app_private.has_permission(''workspace-agenda'', ''can_edit'')');

  t := app_private.enable_rls_if_exists('agenda_item_participants');
  perform app_private.apply_policy(t, 'agenda_item_participants_select_permitted', 'SELECT', 'app_private.has_permission(''workspace-agenda'', ''can_view'')');
  perform app_private.apply_policy(t, 'agenda_item_participants_insert_permitted', 'INSERT', null, 'app_private.has_permission(''workspace-agenda'', ''can_include'')');
  perform app_private.apply_policy(t, 'agenda_item_participants_update_permitted', 'UPDATE',
    'app_private.has_permission(''workspace-agenda'', ''can_edit'')',
    'app_private.has_permission(''workspace-agenda'', ''can_edit'')');

  t := app_private.enable_rls_if_exists('agenda_item_links');
  perform app_private.apply_policy(t, 'agenda_item_links_select_permitted', 'SELECT', 'app_private.has_permission(''workspace-agenda'', ''can_view'')');
  perform app_private.apply_policy(t, 'agenda_item_links_insert_permitted', 'INSERT', null, 'app_private.has_permission(''workspace-agenda'', ''can_include'')');

  t := app_private.enable_rls_if_exists('agenda_task_occurrences');
  perform app_private.apply_policy(t, 'agenda_task_occurrences_select_permitted', 'SELECT', 'app_private.has_permission(''workspace-agenda'', ''can_view'')');
  perform app_private.apply_policy(t, 'agenda_task_occurrences_insert_permitted', 'INSERT', null, 'app_private.has_permission(''workspace-agenda'', ''can_edit'')');
  perform app_private.apply_policy(t, 'agenda_task_occurrences_update_permitted', 'UPDATE',
    'app_private.has_permission(''workspace-agenda'', ''can_edit'')',
    'app_private.has_permission(''workspace-agenda'', ''can_edit'')');

  -- Notificações: cada usuário lê e marca como lidas apenas as suas.
  -- Criação é feita pela camada de serviço (service role).
  t := app_private.enable_rls_if_exists('workspace_notifications');
  perform app_private.apply_policy(t, 'workspace_notifications_select_own', 'SELECT', 'user_id = (select auth.uid())');
  perform app_private.apply_policy(t, 'workspace_notifications_update_own', 'UPDATE',
    'user_id = (select auth.uid())',
    'user_id = (select auth.uid())');

  -- Comentários: leitura/escrita passa pelas server actions (service
  -- role), que validam a permissão do recurso dono do registro.
  t := app_private.enable_rls_if_exists('record_comments');
  perform app_private.apply_policy(t, 'record_comments_select_own', 'SELECT', 'user_id = (select auth.uid())');
end $$;

-- Realtime do sino: INSERTs em workspace_notifications chegam ao
-- navegador do destinatário (mesmo mecanismo dos Elogios).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workspace_notifications'
    ) then
      alter publication supabase_realtime add table public.workspace_notifications;
    end if;
  end if;
end $$;

-- ============================================================
-- Permissão: agenda é transversal — libera para todos os perfis.
-- ============================================================
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select p.id, 'workspace-agenda', true, true, true, true, true
from public.access_profiles p
on conflict (profile_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit,
    can_delete = excluded.can_delete, can_activate_inactivate = excluded.can_activate_inactivate;

notify pgrst, 'reload schema';
