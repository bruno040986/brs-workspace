create extension if not exists pgcrypto;
create table public.agentes_parceiros (id uuid primary key default gen_random_uuid());
create table public.chat_instancias (id uuid primary key default gen_random_uuid());
create table public.gateway_pagamentos (
  id text primary key, nome text not null, ativo boolean not null default false,
  modo text not null default 'teste' check (modo in ('teste','producao')),
  credenciais jsonb not null default '{}'::jsonb,
  taxa_percentual_bps integer null, taxa_fixa_centavos integer null,
  atualizado_em timestamptz not null default now(), atualizado_por uuid null
);
insert into gateway_pagamentos (id, nome, ativo) values ('mercadopago','Mercado Pago',true), ('abacatepay','AbacatePay',false);
