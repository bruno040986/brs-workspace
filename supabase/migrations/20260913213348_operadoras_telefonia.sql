-- Operadoras de telefonia (cadastro do Workspace, divisão Cadastros) —
-- plano v3 do CRM AlvoConsig (docs/PLANO-ATENDIMENTO-DISPARO-E-SIMULACAO-
-- V3-2026-09-13.md §3): cada instância de WhatsApp aponta para a operadora
-- do chip, com logotipo quadrado 500×500 no card. Mesmo desenho das
-- averbadoras (nome + logo_url em data URL + is_active + soft delete). O
-- CRM só lê (service role).
create table if not exists public.operadoras_telefonia (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  logo_url text null, -- data URL base64 (quadrado 500x500), como averbadoras/financial_institutions
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists operadoras_telefonia_nome_uidx
  on public.operadoras_telefonia ((lower(trim(nome)))) where deleted_at is null;
create trigger set_timestamp_operadoras_telefonia
  before update on public.operadoras_telefonia
  for each row execute function trigger_set_timestamp();
alter table public.operadoras_telefonia enable row level security;

-- Permissão nova (seed p/ root) — REGRA FIXA ponto 4.
--   workspace-operadoras-telefonia → menu Cadastros › Operadoras de Telefonia
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'workspace-operadoras-telefonia', true, true, true, false, true
from public.profile_permissions pp
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit, can_activate_inactivate = excluded.can_activate_inactivate;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'workspace-operadoras-telefonia', true, true, true, false, true
from public.user_permissions up
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit, can_activate_inactivate = excluded.can_activate_inactivate;

notify pgrst, 'reload schema';
