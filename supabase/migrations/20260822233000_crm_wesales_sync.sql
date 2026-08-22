-- Sincronização CRM AlvoConsig ↔ WeSales (etapa 9).

-- Oportunidade do contato no FUNIL DE VENDAS (criada de forma lazy no primeiro
-- movimento de estágio).
alter table public.crm_contatos
  add column if not exists wesales_opportunity_id text null;

-- Eventos recebidos do WeSales (caminho inverso, camada de segurança —
-- edições manuais da equipe interna no WeSales refletem no espelho local).
create table if not exists public.crm_wesales_webhook_events (
  id uuid primary key default gen_random_uuid(),
  tipo text not null default '',
  payload jsonb not null default '{}'::jsonb,
  processado boolean not null default false,
  erro text null,
  created_at timestamptz not null default now()
);

create index if not exists crm_wesales_webhook_events_pendentes_idx
  on public.crm_wesales_webhook_events (processado, created_at);

do $$
declare
  t regclass;
begin
  t := app_private.enable_rls_if_exists('crm_wesales_webhook_events');
  perform app_private.apply_policy(t, 'crm_wesales_webhook_events_select_permitted', 'SELECT', 'app_private.has_permission(''alvoconsig-gestao'', ''can_view'')');
end $$;

notify pgrst, 'reload schema';
