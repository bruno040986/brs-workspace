-- Gateways de pagamento Pix do Portal Parceiro (spec
-- SPEC-GATEWAYS-PAGAMENTO.md). Workspace é dono da tabela e da tela de
-- config; o portal LÊ via service role (com fallback em env até ativar).
--
-- RLS deny-all: RLS habilitado SEM policies — credencial nunca sai pelo
-- PostgREST para authenticated/anon; somente service role acessa.

create table if not exists public.gateway_pagamentos (
  id text primary key,
  nome text not null,
  ativo boolean not null default false,
  modo text not null default 'teste' check (modo in ('teste', 'producao')),
  credenciais jsonb not null default '{}'::jsonb,
  taxa_percentual_bps integer null check (taxa_percentual_bps is null or taxa_percentual_bps >= 0),
  taxa_fixa_centavos integer null check (taxa_fixa_centavos is null or taxa_fixa_centavos >= 0),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid null references auth.users (id)
);

alter table public.gateway_pagamentos enable row level security;
-- Sem policies de propósito (deny-all para authenticated/anon).

insert into public.gateway_pagamentos (id, nome, ativo, taxa_percentual_bps, taxa_fixa_centavos)
values
  ('mercadopago', 'Mercado Pago', false, 99, null),
  ('abacatepay', 'AbacatePay', false, null, 80)
on conflict (id) do nothing;

-- Permissão da tela de config (padrão NVTI: quem administra as APIs).
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'sistema-config-gateways', true, true, true, false, true
from public.profile_permissions pp
where pp.resource_name = 'sistema-config-cpf' and coalesce(pp.can_edit, false)
on conflict (profile_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit,
    can_activate_inactivate = excluded.can_activate_inactivate;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'sistema-config-gateways', true, true, true, false, true
from public.user_permissions up
where up.resource_name = 'sistema-config-cpf' and coalesce(up.can_edit, false)
on conflict (user_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit,
    can_activate_inactivate = excluded.can_activate_inactivate;

notify pgrst, 'reload schema';
