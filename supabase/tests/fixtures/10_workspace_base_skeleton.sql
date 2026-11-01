-- SOMENTE PARA BANCO DESCARTÁVEL DE TESTE. Esqueleto das tabelas do Workspace que foram
-- criadas FORA das migrations (users, perfis, permissões, RH...). As colunas seguem o que
-- o app grava (usuarios/actions.ts, rh/server-actions.ts); não é o DDL de produção.
create table public.access_profiles (id uuid primary key default gen_random_uuid(), name text not null, description text, created_at timestamptz default now());
create table public.users (
  id uuid primary key references auth.users(id), name text, email text, role text, profile_id uuid references public.access_profiles(id),
  active boolean default true, cpf text, avatar_url text, session_timeout int, created_at timestamptz default now(), updated_at timestamptz default now(),
  sector_id uuid, phone text, temp_password text, employee_id uuid, birth_date date, commercial_role text);
create table public.profile_permissions (id uuid primary key default gen_random_uuid(), profile_id uuid references public.access_profiles(id) on delete cascade, resource_name text not null,
  can_view boolean default false, can_include boolean default false, can_edit boolean default false, can_delete boolean default false, can_activate_inactivate boolean default false,
  created_at timestamptz default now(), unique (profile_id, resource_name));
create table public.user_permissions (id uuid primary key default gen_random_uuid(), user_id uuid references public.users(id) on delete cascade, resource_name text not null,
  can_view boolean default false, can_include boolean default false, can_edit boolean default false, can_delete boolean default false, can_activate_inactivate boolean default false,
  created_at timestamptz default now(), unique (user_id, resource_name));
create table public.profile_schedules (id uuid primary key default gen_random_uuid(), profile_id uuid, day_of_week int, start_time time, end_time time);
create table public.user_schedules (id uuid primary key default gen_random_uuid(), user_id uuid, day_of_week int, start_time time, end_time time);
create table public.sector_links (id uuid primary key default gen_random_uuid(), sector_id text, name text, label text, url text, role text, sort_order int,
  active boolean default true, is_external boolean default false, unique (sector_id, url));
create table public.employees (id uuid primary key default gen_random_uuid(), user_id uuid, name text, cpf text, status text, vt_status text, active boolean default true, created_at timestamptz default now());
create table public.disciplinary_reasons (id uuid primary key default gen_random_uuid(), name text, default_gravity text, active boolean default true, created_at timestamptz default now());
create table public.disciplinary_records (id uuid primary key default gen_random_uuid(), employee_id uuid references public.employees(id), reason_id uuid references public.disciplinary_reasons(id),
  type text, occurrence_date date, application_date date, recurrence_number_by_reason int, total_warnings_at_date int, total_suspensions_at_date int,
  status text, witness_name text, created_at timestamptz default now());
create table public.commercial_entities (id uuid primary key default gen_random_uuid(), name text, slug text, commercial_slug text, role text, created_at timestamptz default now());
create table public.feriados (id uuid primary key default gen_random_uuid(), data date, nome text);
