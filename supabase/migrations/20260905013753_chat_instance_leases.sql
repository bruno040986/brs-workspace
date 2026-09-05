-- ---------------------------------------------------------------------------
-- Posse distribuída (opt-in) dos sockets Baileys: uma réplica do engine por
-- instância, pra duas réplicas não disputarem o mesmo número. Ligar SÓ depois
-- desta migration, com CHAT_INSTANCE_LEASES=true em TODAS as réplicas.
--
-- Revisão Fable 05/09/2026 (migration veio do repo do CRM; migrations do
-- Supabase compartilhado saem só do brs-workspace): tabela e funções passam a
-- ser exclusivas do service_role — como estava, qualquer usuário logado podia
-- chamar chat_instance_lease_claim/release e derrubar a posse de um número.
-- ---------------------------------------------------------------------------
create table public.chat_instance_leases (
  instance_id uuid primary key references public.chat_instancias(id) on delete cascade,
  owner text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.chat_instance_leases enable row level security;
revoke all on public.chat_instance_leases from public, anon, authenticated;
grant select, insert, update, delete on public.chat_instance_leases to service_role;

create function public.chat_instance_lease_claim(p_instance_id uuid, p_owner text, p_lease_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  insert into public.chat_instance_leases(instance_id, owner, expires_at)
  values (p_instance_id, p_owner, clock_timestamp() + make_interval(secs => greatest(30, p_lease_seconds)))
  on conflict (instance_id) do update
    set owner = excluded.owner, expires_at = excluded.expires_at, updated_at = clock_timestamp()
    where chat_instance_leases.owner = p_owner or chat_instance_leases.expires_at < clock_timestamp();
  return found;
end $$;

create function public.chat_instance_lease_renew(p_instance_id uuid, p_owner text, p_lease_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.chat_instance_leases
    set expires_at = clock_timestamp() + make_interval(secs => greatest(30, p_lease_seconds)), updated_at = clock_timestamp()
    where instance_id = p_instance_id and owner = p_owner and expires_at >= clock_timestamp();
  return found;
end $$;

create function public.chat_instance_lease_release(p_instance_id uuid, p_owner text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  delete from public.chat_instance_leases where instance_id = p_instance_id and owner = p_owner;
  return found;
end $$;

revoke all on function public.chat_instance_lease_claim(uuid, text, integer), public.chat_instance_lease_renew(uuid, text, integer), public.chat_instance_lease_release(uuid, text) from public, anon, authenticated;
grant execute on function public.chat_instance_lease_claim(uuid, text, integer), public.chat_instance_lease_renew(uuid, text, integer), public.chat_instance_lease_release(uuid, text) to service_role;
