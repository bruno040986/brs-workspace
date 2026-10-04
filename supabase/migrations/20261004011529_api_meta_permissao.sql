-- Card "API Meta" em Provedores e APIs: config da API de Conversões da Meta.
-- Linha única id=1; token cifrado no cofre (AES-256-GCM, CRM_CREDENTIALS_KEY),
-- RLS ligada sem policy (só service role lê), igual giphy_config.
create table if not exists public.api_meta_config (
  id integer primary key check (id = 1),
  token_enc text null,
  test_event_code text null,
  dataset_id text null,
  dataset_nome text null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users (id)
);
alter table public.api_meta_config enable row level security;
revoke all on public.api_meta_config from anon, authenticated;

-- Permissão nova (seed p/ root) — REGRA FIXA ponto 4.
--   sistema-config-api-meta → card "API Meta" em Provedores e APIs
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'sistema-config-api-meta', true, true, true, false, false
from public.profile_permissions pp
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'sistema-config-api-meta', true, true, true, false, false
from public.user_permissions up
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

notify pgrst, 'reload schema';
