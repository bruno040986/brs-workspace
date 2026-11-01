-- SOMENTE BANCO DESCARTAVEL. Stubs das tabelas do Supabase Auth que a M04 le (colunas reais usadas).
create table if not exists auth.sessions (id uuid primary key, user_id uuid not null, factor_id uuid, aal text default 'aal1',
  not_after timestamptz, created_at timestamptz default now());
create table if not exists auth.mfa_factors (id uuid primary key, user_id uuid not null, factor_type text default 'totp', status text default 'unverified');
create table if not exists auth.mfa_amr_claims (id uuid primary key default gen_random_uuid(), session_id uuid not null, authentication_method text not null);
grant select on auth.sessions, auth.mfa_factors, auth.mfa_amr_claims to authenticated, service_role;
