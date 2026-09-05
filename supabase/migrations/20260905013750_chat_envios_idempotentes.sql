create table public.chat_envios_operacoes (
  instancia_id uuid not null references public.chat_instancias(id),
  operation_id uuid not null,
  fingerprint text not null,
  status text not null default 'processing' check(status in ('processing','completed','uncertain')),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(instancia_id,operation_id)
);
alter table public.chat_envios_operacoes enable row level security;
revoke all on public.chat_envios_operacoes from public,anon,authenticated;
grant select,insert,update on public.chat_envios_operacoes to service_role;
