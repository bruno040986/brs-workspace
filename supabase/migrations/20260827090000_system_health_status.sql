-- Estado simples de saúde de serviços externos monitorados (hoje: Supabase
-- Auth), usado pelo cron /api/cron/auth-healthcheck para saber se já está em
-- estado "degradado" (evita reenviar alerta a cada execução) e disparar um
-- aviso de recuperação quando volta ao normal.
create table if not exists public.system_health_status (
  chave text primary key,
  status text not null default 'ok' check (status in ('ok', 'degradado')),
  falhas_consecutivas integer not null default 0,
  ultimo_alerta_em timestamptz null,
  updated_at timestamptz not null default now()
);

create trigger set_timestamp_system_health_status
  before update on public.system_health_status
  for each row execute function trigger_set_timestamp();
