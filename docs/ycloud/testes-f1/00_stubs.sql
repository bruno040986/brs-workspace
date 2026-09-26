-- Stubs mínimos das tabelas pré-requisito (formas reais reduzidas)
create extension if not exists pgcrypto;
create table public.users (id uuid primary key default gen_random_uuid());
create table public.agentes_parceiros (id uuid primary key default gen_random_uuid());
create table public.profile_permissions (
  profile_id uuid not null, resource_name text not null,
  can_view boolean, can_include boolean, can_edit boolean,
  can_delete boolean, can_activate_inactivate boolean,
  unique (profile_id, resource_name)
);
create table public.user_permissions (
  user_id uuid not null, resource_name text not null,
  can_view boolean, can_include boolean, can_edit boolean,
  can_delete boolean, can_activate_inactivate boolean,
  unique (user_id, resource_name)
);
create table public.chat_instancias (
  id uuid primary key default gen_random_uuid(),
  provedor text not null check (provedor in ('baileys', 'zapi')),
  numero text null,
  deleted_at timestamptz null
);
create table public.chat_engine_jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('chatwoot', 'zapi', 'baileys')),
  scope text not null,
  event_key text not null,
  unique (source, scope, event_key)
);
create table public.chat_conversas (
  id uuid primary key default gen_random_uuid()
);
-- semeia um "root" para o teste do seed de permissões
insert into public.profile_permissions (profile_id, resource_name, can_view)
  values ('11111111-1111-1111-1111-111111111111', 'sistema-usuarios-root', true);
insert into public.user_permissions (user_id, resource_name, can_view)
  values ('22222222-2222-2222-2222-222222222222', 'sistema-usuarios-root', true);
