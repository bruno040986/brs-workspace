-- Galeria de banners da home do Workspace, administrada em Configurações.
-- Cada banner tem tempo de exposição próprio e vigência opcional (início/fim).

create table if not exists public.hub_banners (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  image_url text not null,
  storage_path text null,
  display_seconds integer not null default 8 check (display_seconds between 1 and 600),
  starts_at timestamptz null,
  ends_at timestamptz null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hub_banners_is_active_idx
  on public.hub_banners (is_active);

create index if not exists hub_banners_sort_order_idx
  on public.hub_banners (sort_order);

create index if not exists hub_banners_deleted_at_idx
  on public.hub_banners (deleted_at);

do $$
declare
  t regclass;
begin
  t := app_private.enable_rls_if_exists('hub_banners');
  -- A home é visível a qualquer usuário autenticado; a administração exige permissão.
  perform app_private.apply_policy(t, 'hub_banners_select_authenticated', 'SELECT', 'auth.uid() is not null');
  perform app_private.apply_policy(t, 'hub_banners_insert_permitted', 'INSERT', null, 'app_private.has_permission(''sistema-config-banners'', ''can_include'')');
  perform app_private.apply_policy(
    t,
    'hub_banners_update_permitted',
    'UPDATE',
    'app_private.has_permission(''sistema-config-banners'', ''can_edit'') OR app_private.has_permission(''sistema-config-banners'', ''can_activate_inactivate'') OR app_private.has_permission(''sistema-config-banners'', ''can_delete'')',
    'app_private.has_permission(''sistema-config-banners'', ''can_edit'') OR app_private.has_permission(''sistema-config-banners'', ''can_activate_inactivate'') OR app_private.has_permission(''sistema-config-banners'', ''can_delete'')'
  );
end $$;

INSERT INTO storage.buckets (id, name, public)
SELECT 'hub-banners', 'hub-banners', true
WHERE NOT EXISTS (
  SELECT 1
  FROM storage.buckets
  WHERE id = 'hub-banners'
);

notify pgrst, 'reload schema';
