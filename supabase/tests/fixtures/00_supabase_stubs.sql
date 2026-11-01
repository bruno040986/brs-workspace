-- SOMENTE PARA BANCO DESCARTÁVEL DE TESTE (Postgres puro, sem Auth/Storage/Realtime reais).
-- Cria o mínimo que as migrations do Workspace esperam do Supabase: roles, schema auth
-- (users, identities, uid/role/jwt), storage, realtime, publication e os GRANTs padrão
-- que o Supabase concede a anon/authenticated/service_role em public.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists unaccent;
create extension if not exists citext;
create extension if not exists "uuid-ossp" with schema extensions;
create schema if not exists auth;
create table auth.users (id uuid primary key, aud text, role text, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}',
  banned_until timestamptz, created_at timestamptz default now(), updated_at timestamptz);
create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid, provider text, identity_data jsonb, updated_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', ''))::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'anon') $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create schema if not exists storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
create schema if not exists realtime;
create table realtime.messages (id bigserial primary key);
create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '') $$;
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
end $$;
create schema if not exists vault;
create schema if not exists cron;
create schema if not exists net;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
