-- Inbox durável do engine. Somente service_role: payload contém dados de chat.
-- Ativar ENGINE_DURABLE_EVENTS apenas depois de aplicar e validar esta migration.
create table public.chat_engine_jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('chatwoot', 'zapi', 'baileys')),
  scope text not null,
  event_key text not null,
  payload jsonb not null,
  sends_external boolean not null default false,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','uncertain')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (source, scope, event_key),
  check ((status = 'processing') = (lease_until is not null and lease_token is not null))
);
create index chat_engine_jobs_pending_idx on public.chat_engine_jobs (available_at, created_at, id) where status = 'pending';
create index chat_engine_jobs_lease_idx on public.chat_engine_jobs (lease_until) where status = 'processing';
alter table public.chat_engine_jobs enable row level security;
revoke all on public.chat_engine_jobs from public, anon, authenticated;
grant select, insert, update on public.chat_engine_jobs to service_role;

create function public.chat_engine_claim(p_limit integer default 10, p_lease_seconds integer default 120)
returns setof public.chat_engine_jobs language plpgsql security definer set search_path = '' as $$
begin
  -- Envios que podem ter alcançado o provedor não voltam automaticamente à fila.
  update public.chat_engine_jobs set
    status = case when sends_external then 'uncertain' when attempts >= 8 then 'failed' else 'pending' end,
    lease_until = null, lease_token = null, error_code = 'LEASE_EXPIRED'
  where status = 'processing' and lease_until < clock_timestamp();
  return query
    with candidates as (
      select id from public.chat_engine_jobs
      where status = 'pending' and available_at <= clock_timestamp()
      order by available_at, created_at, id
      for update skip locked limit greatest(1, least(p_limit, 50))
    )
    update public.chat_engine_jobs j set status = 'processing', attempts = j.attempts + 1,
      lease_token = gen_random_uuid(),
      lease_until = clock_timestamp() + make_interval(secs => greatest(30, least(p_lease_seconds, 600)))
    from candidates c where j.id = c.id returning j.*;
end; $$;

create function public.chat_engine_finish(p_id uuid, p_token uuid, p_status text, p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if p_status not in ('completed','pending','failed','uncertain') then raise exception 'invalid status'; end if;
  update public.chat_engine_jobs set status = p_status,
    lease_token = null, lease_until = null,
    completed_at = case when p_status = 'completed' then clock_timestamp() else null end,
    error_code = left(p_error, 80),
    available_at = clock_timestamp() + make_interval(secs => least(300, power(2, least(attempts,8))::integer))
  where id = p_id and status = 'processing' and lease_token = p_token
    and lease_until >= clock_timestamp()
    and not (p_status = 'pending' and sends_external);
  get diagnostics changed = row_count;
  return changed = 1;
end; $$;

create function public.chat_engine_renew(p_id uuid, p_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  update public.chat_engine_jobs set lease_until = clock_timestamp() + interval '120 seconds'
  where id = p_id and status = 'processing' and lease_token = p_token and lease_until >= clock_timestamp();
  get diagnostics changed = row_count;
  return changed = 1;
end; $$;

revoke all on function public.chat_engine_claim(integer, integer) from public, anon, authenticated;
revoke all on function public.chat_engine_finish(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.chat_engine_renew(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chat_engine_claim(integer, integer) to service_role;
grant execute on function public.chat_engine_finish(uuid, uuid, text, text) to service_role;
grant execute on function public.chat_engine_renew(uuid, uuid) to service_role;
