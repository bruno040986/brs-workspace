-- Biblioteca global de Ações e Gatilhos do SCP.
-- A tela é independente de processo e serve como base reutilizável para
-- o futuro Construtor de Processos.

create table if not exists public.scp_automation_actions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  type text not null,
  description text null,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists scp_automation_actions_code_unique_idx
  on public.scp_automation_actions ((lower(trim(code))));

create index if not exists scp_automation_actions_is_active_idx
  on public.scp_automation_actions (is_active);

create index if not exists scp_automation_actions_deleted_at_idx
  on public.scp_automation_actions (deleted_at);

do $$
declare
  t regclass;
begin
  t := app_private.enable_rls_if_exists('scp_automation_actions');
  perform app_private.apply_policy(t, 'scp_automation_actions_select_permitted', 'SELECT', 'app_private.has_permission(''scp-acoes-gatilhos'', ''can_view'')');
  perform app_private.apply_policy(t, 'scp_automation_actions_insert_permitted', 'INSERT', null, 'app_private.has_permission(''scp-acoes-gatilhos'', ''can_include'')');
  perform app_private.apply_policy(
    t,
    'scp_automation_actions_update_permitted',
    'UPDATE',
    'app_private.has_permission(''scp-acoes-gatilhos'', ''can_edit'') OR app_private.has_permission(''scp-acoes-gatilhos'', ''can_activate_inactivate'')',
    'app_private.has_permission(''scp-acoes-gatilhos'', ''can_edit'') OR app_private.has_permission(''scp-acoes-gatilhos'', ''can_activate_inactivate'')'
  );
  perform app_private.apply_policy(
    t,
    'scp_automation_actions_delete_permitted',
    'DELETE',
    'app_private.has_permission(''scp-acoes-gatilhos'', ''can_delete'')'
  );
end $$;

create table if not exists public.scp_automation_triggers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  type text not null,
  description text null,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists scp_automation_triggers_code_unique_idx
  on public.scp_automation_triggers ((lower(trim(code))));

create index if not exists scp_automation_triggers_is_active_idx
  on public.scp_automation_triggers (is_active);

create index if not exists scp_automation_triggers_deleted_at_idx
  on public.scp_automation_triggers (deleted_at);

do $$
declare
  t regclass;
begin
  t := app_private.enable_rls_if_exists('scp_automation_triggers');
  perform app_private.apply_policy(t, 'scp_automation_triggers_select_permitted', 'SELECT', 'app_private.has_permission(''scp-acoes-gatilhos'', ''can_view'')');
  perform app_private.apply_policy(t, 'scp_automation_triggers_insert_permitted', 'INSERT', null, 'app_private.has_permission(''scp-acoes-gatilhos'', ''can_include'')');
  perform app_private.apply_policy(
    t,
    'scp_automation_triggers_update_permitted',
    'UPDATE',
    'app_private.has_permission(''scp-acoes-gatilhos'', ''can_edit'') OR app_private.has_permission(''scp-acoes-gatilhos'', ''can_activate_inactivate'')',
    'app_private.has_permission(''scp-acoes-gatilhos'', ''can_edit'') OR app_private.has_permission(''scp-acoes-gatilhos'', ''can_activate_inactivate'')'
  );
  perform app_private.apply_policy(
    t,
    'scp_automation_triggers_delete_permitted',
    'DELETE',
    'app_private.has_permission(''scp-acoes-gatilhos'', ''can_delete'')'
  );
end $$;

insert into public.profile_permissions (
  profile_id,
  resource_name,
  can_view,
  can_include,
  can_edit,
  can_delete,
  can_activate_inactivate
)
select distinct
  pp.profile_id,
  'scp-acoes-gatilhos',
  true,
  true,
  true,
  false,
  true
from public.profile_permissions pp
where pp.resource_name in (
  'scp-processos',
  'scp-construtor',
  'scp-documentos',
  'scp-emails',
  'scp-whatsapp'
)
on conflict (profile_id, resource_name) do update
set
  can_view = excluded.can_view,
  can_include = excluded.can_include,
  can_edit = excluded.can_edit,
  can_delete = excluded.can_delete,
  can_activate_inactivate = excluded.can_activate_inactivate;

insert into public.user_permissions (
  user_id,
  resource_name,
  can_view,
  can_include,
  can_edit,
  can_delete,
  can_activate_inactivate
)
select distinct
  up.user_id,
  'scp-acoes-gatilhos',
  true,
  true,
  true,
  false,
  true
from public.user_permissions up
where up.resource_name in (
  'scp-processos',
  'scp-construtor',
  'scp-documentos',
  'scp-emails',
  'scp-whatsapp'
)
on conflict (user_id, resource_name) do update
set
  can_view = excluded.can_view,
  can_include = excluded.can_include,
  can_edit = excluded.can_edit,
  can_delete = excluded.can_delete,
  can_activate_inactivate = excluded.can_activate_inactivate;

do $$
begin
  if exists (select 1 from pg_proc where proname = 'trigger_set_timestamp') then
    if not exists (select 1 from pg_trigger where tgname = 'set_timestamp_scp_automation_actions') then
      create trigger set_timestamp_scp_automation_actions
      before update on public.scp_automation_actions
      for each row
      execute function trigger_set_timestamp();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'set_timestamp_scp_automation_triggers') then
      create trigger set_timestamp_scp_automation_triggers
      before update on public.scp_automation_triggers
      for each row
      execute function trigger_set_timestamp();
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';

