-- ---------------------------------------------------------------------------
-- Limite de envios por dia POR NÚMERO (instância de disparo), definido pela
-- BRS por parceiro na aba AlvoConsig do Agente Corban — decisão do Bruno
-- 05/09/2026 (plano seção 6, "limites por instância"). null = sem teto (só a
-- cadência). Contagem no dia civil de São Paulo, só status 'enviado'
-- (enviado_em); 'incerto' não entra — pode ter saído, mas não temos como
-- afirmar, e contar dobrado travaria o número por engano.
--
-- crm_disparo_claim passa a pular o item cujo número já bateu o teto hoje e
-- pega o próximo pendente do parceiro cujo número ainda tem saldo. Item
-- pulado continua 'pendente' e sai quando o dia virar. Isso altera a ordem
-- estrita ordem_global só nesse caso — documentado, aceitável: o rodízio
-- volta ao normal quando todos os números têm saldo.
-- ---------------------------------------------------------------------------
alter table public.crm_parceiro_config
  add column if not exists disparo_max_envios_dia_por_instancia integer null
    check (disparo_max_envios_dia_por_instancia is null
           or (disparo_max_envios_dia_por_instancia >= 1 and disparo_max_envios_dia_por_instancia <= 5000));
comment on column public.crm_parceiro_config.disparo_max_envios_dia_por_instancia is
  'Teto de envios de disparo por dia (São Paulo) por número do parceiro; null = sem teto.';

create or replace function public.crm_disparo_claim(p_limit integer default 25)
returns setof public.crm_disparo_fila language plpgsql security definer set search_path='' as $$
declare partner record; gate public.crm_disparo_cadencia; item public.crm_disparo_fila; teto integer; inicio_dia timestamptz;
begin
  -- O provedor pode ter aceitado essas mensagens: nunca reciclar às cegas.
  update public.crm_disparo_fila set status='incerto',ultimo_erro='Processamento interrompido; conciliação necessária.',lease_token=null,lease_until=null
    where status='enviando' and (lease_until is null or lease_until<clock_timestamp());
  inicio_dia := (date_trunc('day', clock_timestamp() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
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
    if gate.ocupado_ate is not null then
      update public.crm_disparo_cadencia set ultimo_envio_em=clock_timestamp(),ocupado_ate=null where agente_parceiro_id=partner.agente_parceiro_id;
      continue;
    end if;
    select disparo_max_envios_dia_por_instancia into teto from public.crm_parceiro_config where agente_parceiro_id=partner.agente_parceiro_id;
    select f.* into item from public.crm_disparo_fila f
      join public.crm_campanhas_parceiro c on c.id=f.campanha_id and c.agente_parceiro_id=f.agente_parceiro_id
      where f.agente_parceiro_id=partner.agente_parceiro_id and f.status='pendente' and c.status='ativa'
        and f.agendado_para<=clock_timestamp()
        and (teto is null or (
          select count(*) from public.crm_disparo_fila e
          where e.instancia_id=f.instancia_id and e.status='enviado' and e.enviado_em>=inicio_dia
        ) < teto)
      order by f.agendado_para,f.ordem_global,f.id limit 1 for update of f skip locked;
    if not found then continue; end if;
    if gate.ultimo_envio_em is not null and gate.ultimo_envio_em+make_interval(secs=>greatest(coalesce(item.delay_ms,5000),5000)/1000.0)>clock_timestamp() then continue; end if;
    update public.crm_disparo_fila set status='enviando',tentativas=tentativas+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes'
      where id=item.id returning * into item;
    update public.crm_disparo_cadencia set ocupado_ate=item.lease_until where agente_parceiro_id=partner.agente_parceiro_id;
    return next item;
    p_limit:=p_limit-1;
  end loop;
end; $$;
-- grants já existem na versão anterior (revoke public/anon/authenticated; execute p/ service_role);
-- create or replace preserva.

create index if not exists crm_disparo_fila_enviados_dia_idx
  on public.crm_disparo_fila (instancia_id, enviado_em) where status = 'enviado';
