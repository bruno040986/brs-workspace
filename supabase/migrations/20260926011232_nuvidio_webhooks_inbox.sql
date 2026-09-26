-- Nuvidio — fatia 1 do PLANO-NUVIDIO-CONFORMIDADE-2026-09-26:
-- (a) colunas de estado que os webhooks alimentam; (b) inbox durável: TODO
-- webhook entra aqui antes de qualquer regra, com o payload bruto — o que não
-- casar com convite fica visível em Provedores › Nuvidio e pode ser reprocessado.

alter table public.nuvidio_convites
  add column if not exists call_id text not null default '',
  add column if not exists short_link text not null default '',
  add column if not exists fila_entrou_em timestamptz null,
  add column if not exists fila_saiu_em timestamptz null,
  add column if not exists gravacao_disponivel boolean not null default false;

create index if not exists idx_nuvidio_convites_call
  on public.nuvidio_convites (call_id) where call_id <> '';

create table if not exists public.nuvidio_webhooks_recebidos (
  id uuid primary key default gen_random_uuid(),
  hook_type text not null default '',
  invite_id text not null default '',
  call_id text not null default '',
  convite_id uuid null references public.nuvidio_convites (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  recebido_em timestamptz not null default now(),
  processado_em timestamptz null,
  erro text not null default ''
);

create index if not exists idx_nuvidio_wh_recentes
  on public.nuvidio_webhooks_recebidos (recebido_em desc);
create index if not exists idx_nuvidio_wh_sem_convite
  on public.nuvidio_webhooks_recebidos (recebido_em desc) where convite_id is null;

-- só o service role lê/escreve (sem policies)
alter table public.nuvidio_webhooks_recebidos enable row level security;
