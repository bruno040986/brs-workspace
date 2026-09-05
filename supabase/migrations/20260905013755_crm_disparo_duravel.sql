alter table public.crm_disparo_fila add column lease_token uuid, add column lease_until timestamptz;
alter table public.crm_disparo_fila drop constraint crm_disparo_fila_status_check;
alter table public.crm_disparo_fila add constraint crm_disparo_fila_status_check
  check(status in ('pendente','enviando','enviado','falhou','cancelado','incerto'));
create table public.crm_disparo_cadencia (
  agente_parceiro_id uuid primary key references public.agentes_parceiros(id),
  ultimo_envio_em timestamptz,
  ocupado_ate timestamptz
);
alter table public.crm_disparo_cadencia enable row level security;
revoke all on public.crm_disparo_cadencia from public,anon,authenticated;
grant select,insert,update on public.crm_disparo_cadencia to service_role;

create function public.crm_disparo_claim(p_limit integer default 25)
returns setof public.crm_disparo_fila language plpgsql security definer set search_path='' as $$
declare partner record; gate public.crm_disparo_cadencia; item public.crm_disparo_fila;
begin
  -- O provedor pode ter aceitado essas mensagens: nunca reciclar às cegas.
  -- lease_until nulo = linha 'enviando' do worker antigo (sem lease); ao migrar
  -- o cron pra crm_disparo_claim, essas também viram 'incerto' e exigem conciliação.
  update public.crm_disparo_fila set status='incerto',ultimo_erro='Processamento interrompido; conciliação necessária.',lease_token=null,lease_until=null
    where status='enviando' and (lease_until is null or lease_until<clock_timestamp());
  for partner in
    select f.agente_parceiro_id,min(f.agendado_para) as due
    from public.crm_disparo_fila f join public.crm_campanhas_parceiro c on c.id=f.campanha_id and c.agente_parceiro_id=f.agente_parceiro_id
    where f.status='pendente' and c.status='ativa' and f.agendado_para<=clock_timestamp()
    group by f.agente_parceiro_id order by min(f.agendado_para),f.agente_parceiro_id
  loop
    if p_limit<=0 then exit; end if;
    if not pg_try_advisory_xact_lock(hashtextextended(partner.agente_parceiro_id::text,5930509)) then continue; end if;
    insert into public.crm_disparo_cadencia(agente_parceiro_id) values(partner.agente_parceiro_id) on conflict do nothing;
    select * into gate from public.crm_disparo_cadencia where agente_parceiro_id=partner.agente_parceiro_id for update;
    if gate.ocupado_ate>clock_timestamp() then continue; end if;
    -- Expired ownership still imposes a full interval after the uncertainty.
    if gate.ocupado_ate is not null then
      update public.crm_disparo_cadencia set ultimo_envio_em=clock_timestamp(),ocupado_ate=null where agente_parceiro_id=partner.agente_parceiro_id;
      continue;
    end if;
    select f.* into item from public.crm_disparo_fila f
      join public.crm_campanhas_parceiro c on c.id=f.campanha_id and c.agente_parceiro_id=f.agente_parceiro_id
      where f.agente_parceiro_id=partner.agente_parceiro_id and f.status='pendente' and c.status='ativa'
      order by f.agendado_para,f.ordem_global,f.id limit 1 for update of f skip locked;
    if not found or item.agendado_para>clock_timestamp() then continue; end if;
    if gate.ultimo_envio_em is not null and gate.ultimo_envio_em+make_interval(secs=>greatest(coalesce(item.delay_ms,5000),5000)/1000.0)>clock_timestamp() then continue; end if;
    update public.crm_disparo_fila set status='enviando',tentativas=tentativas+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes'
      where id=item.id returning * into item;
    update public.crm_disparo_cadencia set ocupado_ate=item.lease_until where agente_parceiro_id=partner.agente_parceiro_id;
    return next item;
    p_limit:=p_limit-1;
  end loop;
end; $$;

create function public.crm_disparo_finish(p_id uuid,p_token uuid,p_status text,p_error text default null,p_conversation integer default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare item public.crm_disparo_fila;
begin
  if p_status not in ('enviado','incerto','pendente','falhou','cancelado') then raise exception 'INVALID_STATUS'; end if;
  update public.crm_disparo_fila set status=p_status,lease_token=null,lease_until=null,ultimo_erro=left(p_error,400),
    enviado_em=case when p_status='enviado' then clock_timestamp() else enviado_em end,
    chatwoot_conversation_id=coalesce(p_conversation,chatwoot_conversation_id),
    agendado_para=case when p_status='pendente' then clock_timestamp()+interval '5 minutes' else agendado_para end
    where id=p_id and status='enviando' and lease_token=p_token and lease_until>=clock_timestamp() returning * into item;
  if not found then return false; end if;
  update public.crm_disparo_cadencia set ocupado_ate=null,
    ultimo_envio_em=case when p_status in ('enviado','incerto') then clock_timestamp() else ultimo_envio_em end
    where agente_parceiro_id=item.agente_parceiro_id;
  return true;
end; $$;
revoke all on function public.crm_disparo_claim(integer),public.crm_disparo_finish(uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.crm_disparo_claim(integer),public.crm_disparo_finish(uuid,uuid,text,text,integer) to service_role;
