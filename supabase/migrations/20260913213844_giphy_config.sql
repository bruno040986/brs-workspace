-- Card "Figurinhas/GIFs" em Provedores e APIs (plano v3 §5): chave da API
-- do GIPHY, uma pra todo o grupo (Workspace, CRM AlvoConsig e o que vier),
-- no mesmo molde de quark_config/nuvidio_config — linha única id=1, chave
-- cifrada no cofre (AES-256-GCM, CRM_CREDENTIALS_KEY, compartilhada entre
-- Workspace e CRM), RLS ligada sem policy (só service role lê). O Tenor foi
-- descontinuado pelo Google em 30/06/2026; GIPHY é o substituto.
create table if not exists public.giphy_config (
  id integer primary key check (id = 1),
  api_key_enc text null,
  rating text not null default 'g' check (rating in ('g', 'pg', 'pg-13')),
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users (id)
);
alter table public.giphy_config enable row level security;

-- Permissão nova (seed p/ root) — REGRA FIXA ponto 4.
--   sistema-config-figurinhas-gifs → card "Figurinhas/GIFs" em Provedores e APIs
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'sistema-config-figurinhas-gifs', true, true, true, false, false
from public.profile_permissions pp
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'sistema-config-figurinhas-gifs', true, true, true, false, false
from public.user_permissions up
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

notify pgrst, 'reload schema';
