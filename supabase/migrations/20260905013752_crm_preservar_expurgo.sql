-- ---------------------------------------------------------------------------
-- Preserva os artefatos do tenant ANTES do expurgo legado de crm_contatos
-- (crm_campanha_encerrar em 20260825130000 deleta tabulações e depois os
-- contatos). Não adiciona nenhuma exclusão; o expurgo existente continua dono
-- das linhas temporárias. Acesso ao arquivo só via service role, com a
-- visibilidade decidida por crm_relacionamento_visivel().
--
-- Revisão Fable 05/09/2026: o trigger NUNCA aborta o DELETE. Se a identidade
-- não puder ser resolvida (contato sem CPF de 11 dígitos e sem
-- wesales_contact_id, ou conflito CPF×WeSales), o registro é arquivado com
-- relacionamento_id nulo e o motivo em identidade_erro — o dado fica
-- preservado, o expurgo segue e a reconciliação vira um fluxo explícito
-- posterior. Contato sem tenant (agente_parceiro_id nulo) não tem dono pra
-- preservar e passa direto.
-- ---------------------------------------------------------------------------
create table public.crm_historico_registros (
  id uuid primary key default gen_random_uuid(),
  relacionamento_id uuid null,
  agente_parceiro_id uuid not null,
  tabela_origem text not null,
  registro_origem_id uuid not null,
  contato_origem_id uuid not null,
  dados jsonb not null,
  -- nulo = identidade resolvida; senão, o SQLERRM de crm_assegurar_relacionamento
  identidade_erro text null,
  preservado_em timestamptz not null default now(),
  unique(tabela_origem,registro_origem_id),
  foreign key(relacionamento_id,agente_parceiro_id) references public.crm_relacionamentos(id,agente_parceiro_id)
);
create index crm_historico_registros_rel_idx on public.crm_historico_registros(agente_parceiro_id,relacionamento_id,tabela_origem,preservado_em desc);
create index crm_historico_registros_sem_identidade_idx on public.crm_historico_registros(agente_parceiro_id,preservado_em desc) where relacionamento_id is null;
alter table public.crm_historico_registros enable row level security;
revoke all on public.crm_historico_registros from public,anon,authenticated;
grant select,insert,update on public.crm_historico_registros to service_role;

create function app_private.crm_preservar_contato_expurgo()
returns trigger language plpgsql security definer set search_path='' as $$
declare rid uuid; erro text; t text;
begin
  if old.agente_parceiro_id is null then return old; end if;
  begin
    rid := public.crm_assegurar_relacionamento(old.id,old.agente_parceiro_id);
  exception when others then
    rid := null; erro := left(sqlerrm,120);
  end;
  insert into public.crm_historico_registros(relacionamento_id,agente_parceiro_id,tabela_origem,registro_origem_id,contato_origem_id,dados,identidade_erro)
    values(rid,old.agente_parceiro_id,'crm_contatos',old.id,old.id,to_jsonb(old),erro)
    on conflict(tabela_origem,registro_origem_id) do update set
      dados=excluded.dados,
      relacionamento_id=coalesce(excluded.relacionamento_id,crm_historico_registros.relacionamento_id),
      identidade_erro=excluded.identidade_erro,
      preservado_em=clock_timestamp();
  foreach t in array array['crm_observacoes','crm_atividades','crm_arquivos','crm_ofertas','crm_tabulacoes'] loop
    if to_regclass('public.'||t) is not null then
      execute format('insert into public.crm_historico_registros(relacionamento_id,agente_parceiro_id,tabela_origem,registro_origem_id,contato_origem_id,dados,identidade_erro)
        select $1,$2,$3,id,contato_id,to_jsonb(r),$5 from public.%I r where contato_id=$4
        on conflict(tabela_origem,registro_origem_id) do update set
          dados=excluded.dados,
          relacionamento_id=coalesce(excluded.relacionamento_id,crm_historico_registros.relacionamento_id),
          identidade_erro=excluded.identidade_erro,
          preservado_em=clock_timestamp()',t)
        using rid,old.agente_parceiro_id,t,old.id,erro;
    end if;
  end loop;
  return old;
end; $$;
create trigger crm_preservar_contato_before_delete before delete on public.crm_contatos
  for each row execute function app_private.crm_preservar_contato_expurgo();

-- O expurgo legado deleta as tabulações explicitamente ANTES do contato.
create function app_private.crm_preservar_tabulacao_expurgo()
returns trigger language plpgsql security definer set search_path='' as $$
declare tenant uuid; rid uuid; erro text;
begin
  select agente_parceiro_id into tenant from public.crm_contatos where id=old.contato_id;
  if tenant is null then return old; end if;
  begin
    rid := public.crm_assegurar_relacionamento(old.contato_id,tenant);
  exception when others then
    rid := null; erro := left(sqlerrm,120);
  end;
  insert into public.crm_historico_registros(relacionamento_id,agente_parceiro_id,tabela_origem,registro_origem_id,contato_origem_id,dados,identidade_erro)
    values(rid,tenant,'crm_tabulacoes',old.id,old.contato_id,to_jsonb(old),erro)
    on conflict(tabela_origem,registro_origem_id) do update set
      dados=excluded.dados,
      relacionamento_id=coalesce(excluded.relacionamento_id,crm_historico_registros.relacionamento_id),
      identidade_erro=excluded.identidade_erro,
      preservado_em=clock_timestamp();
  return old;
end; $$;
create trigger crm_preservar_tabulacao_before_delete before delete on public.crm_tabulacoes
  for each row execute function app_private.crm_preservar_tabulacao_expurgo();
revoke all on function app_private.crm_preservar_contato_expurgo(),app_private.crm_preservar_tabulacao_expurgo() from public,anon,authenticated;

create function public.crm_relacionamento_visivel(p_id uuid,p_tenant uuid,p_usuario uuid,p_ver_todos boolean)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.crm_relacionamentos r
    join public.crm_pessoas p on p.id=r.pessoa_id
    join public.crm_parceiro_config cfg on cfg.agente_parceiro_id=r.agente_parceiro_id and cfg.habilitado
    where r.id=p_id and r.agente_parceiro_id=p_tenant and (
      (
        (r.carteira or exists(select 1 from public.crm_clientes_parceiro cp where cp.agente_parceiro_id=p_tenant and cp.wesales_contact_id=p.wesales_contact_id))
        and (p_ver_todos or exists(select 1 from public.crm_historico_registros a
          where a.relacionamento_id=r.id and a.tabela_origem='crm_contatos' and a.dados->>'atendente_id'=p_usuario::text))
      )
      or exists(select 1 from public.crm_contatos c where c.agente_parceiro_id=p_tenant and c.deleted_at is null
        and ((p.cpf is not null and regexp_replace(coalesce(c.cpf,''),'[^0-9]','','g')=p.cpf)
          or (p.wesales_contact_id is not null and c.wesales_contact_id=p.wesales_contact_id))
        and (p_ver_todos or c.atendente_id=p_usuario)
        and (r.carteira or not exists(select 1 from public.crm_dono_leads d where d.wesales_contact_id=p.wesales_contact_id)
          or exists(select 1 from public.crm_dono_leads d where d.wesales_contact_id=p.wesales_contact_id and d.agente_parceiro_id=p_tenant and d.revogado_em is null))
      )
    )
  );
$$;
revoke all on function public.crm_relacionamento_visivel(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.crm_relacionamento_visivel(uuid,uuid,uuid,boolean) to service_role;
