-- Higienização de CPF via Nova Vida TI (NVTI).
--
-- nvti_config: credenciais do web service (usuario/senha/cliente, enviados em
-- BASE64 no GerarToken), método contratado, token cacheado (validade 24h),
-- tetos de gasto e tabela de preço em cascata.
-- nvti_queries: UMA linha por consulta (manual, lote ou serviço) — é a fonte do
-- batimento com a fatura mensal e também o cache de reaproveitamento (resposta
-- de sucesso dentro de cache_days é servida de graça, billed = false).
-- nvti_batches/nvti_batch_items: lotes de CSV/XLSX processados pelo worker
-- (Vercel Cron + kick), mesmo desenho de lock do disparo de WhatsApp.
-- nvti_user_limits/nvti_limit_events: teto individual e auditoria de alterações.

create extension if not exists pgcrypto;

create table if not exists public.nvti_config (
  id uuid primary key default gen_random_uuid(),
  usuario text not null default '',
  senha text not null default '',
  cliente text not null default '',
  metodo text not null default 'NVBOOK_CEL_OBG'
    check (metodo in ('NVBOOK_CEL_OBG', 'NvBookCelObWhats')),
  token text not null default '',
  token_generated_at timestamptz null,
  monthly_cap_brl numeric(12,2) not null default 500 check (monthly_cap_brl >= 0),
  user_monthly_cap_brl numeric(12,2) not null default 15 check (user_monthly_cap_brl >= 0),
  cache_days integer not null default 30 check (cache_days >= 0),
  price_tiers jsonb not null default '[
    {"up_to": 10000,   "unit": 0.06},
    {"up_to": 100000,  "unit": 0.05},
    {"up_to": 500000,  "unit": 0.04},
    {"up_to": 1000000, "unit": 0.03},
    {"up_to": null,    "unit": 0.02}
  ]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace trigger set_timestamp_nvti_config
before update on public.nvti_config
for each row execute function trigger_set_timestamp();

create table if not exists public.nvti_user_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_cap_brl numeric(12,2) not null check (monthly_cap_brl >= 0),
  updated_by uuid null,
  updated_at timestamptz not null default now()
);

create table if not exists public.nvti_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'paused_limit', 'done', 'canceled', 'error')),
  total integer not null default 0,
  processed integer not null default 0,
  cached integer not null default 0,
  errors integer not null default 0,
  created_by uuid not null,
  worker_lock_until timestamptz null,
  worker_lock_by text null,
  last_error text null,
  finished_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nvti_batches_status_idx on public.nvti_batches (status, created_at);
create index if not exists nvti_batches_created_by_idx on public.nvti_batches (created_by, created_at desc);

create or replace trigger set_timestamp_nvti_batches
before update on public.nvti_batches
for each row execute function trigger_set_timestamp();

create table if not exists public.nvti_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.nvti_batches(id) on delete cascade,
  cpf text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'error')),
  query_id uuid null,
  error text null,
  processed_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists nvti_batch_items_batch_idx on public.nvti_batch_items (batch_id, status);

create table if not exists public.nvti_queries (
  id uuid primary key default gen_random_uuid(),
  cpf text not null,
  requested_by uuid null,
  origin text not null check (origin in ('manual', 'batch', 'service')),
  batch_id uuid null,
  service_name text null,
  from_cache boolean not null default false,
  billed boolean not null default false,
  unit_cost_brl numeric(10,4) not null default 0,
  success boolean not null default false,
  error text null,
  response jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists nvti_queries_cpf_idx on public.nvti_queries (cpf, created_at desc);
create index if not exists nvti_queries_month_idx on public.nvti_queries (created_at) where billed;
create index if not exists nvti_queries_user_idx on public.nvti_queries (requested_by, created_at desc);
create index if not exists nvti_queries_batch_idx on public.nvti_queries (batch_id);

create table if not exists public.nvti_limit_events (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global', 'user')),
  user_id uuid null,
  old_value numeric(12,2) null,
  new_value numeric(12,2) not null,
  changed_by uuid not null,
  created_at timestamptz not null default now()
);

-- Agregações usadas pelas telas de consumo e pela checagem de teto individual
-- (evita puxar milhares de linhas para somar no app).
create or replace function public.nvti_user_spend(p_user uuid, p_start timestamptz, p_end timestamptz)
returns numeric
language sql
stable
as $$
  select coalesce(sum(unit_cost_brl), 0)
  from public.nvti_queries
  where billed
    and requested_by = p_user
    and created_at >= p_start
    and created_at < p_end;
$$;

create or replace function public.nvti_spend_by_user(p_start timestamptz, p_end timestamptz)
returns table(
  user_id uuid,
  origin text,
  total bigint,
  billed_count bigint,
  cached_count bigint,
  error_count bigint,
  spend numeric
)
language sql
stable
as $$
  select
    requested_by,
    origin,
    count(*),
    count(*) filter (where billed),
    count(*) filter (where from_cache),
    count(*) filter (where not success),
    coalesce(sum(unit_cost_brl) filter (where billed), 0)
  from public.nvti_queries
  where created_at >= p_start and created_at < p_end
  group by requested_by, origin;
$$;

-- RLS: leitura pelas permissões do subsistema; escrita fica no service role
-- (server actions / worker), como nos demais subsistemas.
do $$
declare
  t regclass;
begin
  t := app_private.enable_rls_if_exists('nvti_config');
  perform app_private.apply_policy(t, 'nvti_config_select_permitted', 'SELECT', 'app_private.has_permission(''sistema-config-nvti'', ''can_view'')');
  perform app_private.apply_policy(t, 'nvti_config_insert_permitted', 'INSERT', null, 'app_private.has_permission(''sistema-config-nvti'', ''can_edit'')');
  perform app_private.apply_policy(
    t,
    'nvti_config_update_permitted',
    'UPDATE',
    'app_private.has_permission(''sistema-config-nvti'', ''can_edit'')',
    'app_private.has_permission(''sistema-config-nvti'', ''can_edit'')'
  );

  t := app_private.enable_rls_if_exists('nvti_batches');
  perform app_private.apply_policy(t, 'nvti_batches_select_permitted', 'SELECT', 'app_private.has_permission(''operacional-nvti'', ''can_view'')');

  t := app_private.enable_rls_if_exists('nvti_batch_items');
  perform app_private.apply_policy(t, 'nvti_batch_items_select_permitted', 'SELECT', 'app_private.has_permission(''operacional-nvti'', ''can_view'')');

  t := app_private.enable_rls_if_exists('nvti_queries');
  perform app_private.apply_policy(t, 'nvti_queries_select_permitted', 'SELECT', 'app_private.has_permission(''operacional-nvti'', ''can_view'')');

  t := app_private.enable_rls_if_exists('nvti_user_limits');
  perform app_private.apply_policy(t, 'nvti_user_limits_select_permitted', 'SELECT', 'app_private.has_permission(''operacional-nvti-limites'', ''can_view'')');

  t := app_private.enable_rls_if_exists('nvti_limit_events');
  perform app_private.apply_policy(t, 'nvti_limit_events_select_permitted', 'SELECT', 'app_private.has_permission(''operacional-nvti-limites'', ''can_view'')');
end $$;

-- Seeds de permissão:
-- uso da ferramenta (consultar/importar) para quem já opera o Operacional ou o
-- Comercial do hub; consumo geral, limites e config para quem já administra as
-- configurações de API (sistema-config-cpf).
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'operacional-nvti', true, true, false, false, false
from public.profile_permissions pp
where pp.resource_name in ('workspace-ops', 'workspace-com')
on conflict (profile_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'operacional-nvti', true, true, false, false, false
from public.user_permissions up
where up.resource_name in ('workspace-ops', 'workspace-com')
on conflict (user_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include;

insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, r.resource_name, true, true, true, true, true
from public.profile_permissions pp
cross join (values ('operacional-nvti-consumo'), ('operacional-nvti-limites'), ('sistema-config-nvti')) as r(resource_name)
where pp.resource_name = 'sistema-config-cpf' and coalesce(pp.can_edit, false)
on conflict (profile_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit,
    can_delete = excluded.can_delete, can_activate_inactivate = excluded.can_activate_inactivate;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, r.resource_name, true, true, true, true, true
from public.user_permissions up
cross join (values ('operacional-nvti-consumo'), ('operacional-nvti-limites'), ('sistema-config-nvti')) as r(resource_name)
where up.resource_name = 'sistema-config-cpf' and coalesce(up.can_edit, false)
on conflict (user_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit,
    can_delete = excluded.can_delete, can_activate_inactivate = excluded.can_activate_inactivate;

notify pgrst, 'reload schema';
