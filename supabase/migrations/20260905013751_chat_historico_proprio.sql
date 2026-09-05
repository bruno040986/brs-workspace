-- Foundation for an owned timeline. No backfill or removal of legacy columns.
-- All access goes through the CRM/engine service layer, never public browser reads.
create table public.crm_pessoas (
  id uuid primary key default gen_random_uuid(),
  cpf text unique check (cpf is null or cpf ~ '^[0-9]{11}$'),
  wesales_contact_id text unique,
  created_at timestamptz not null default now(),
  check (cpf is not null or wesales_contact_id is not null)
);
create table public.crm_relacionamentos (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros(id),
  pessoa_id uuid not null references public.crm_pessoas(id),
  carteira boolean not null default false,
  dados_cliente jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(agente_parceiro_id,pessoa_id), unique(id,agente_parceiro_id)
);
create table public.chat_timelines (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros(id),
  relacionamento_id uuid,
  created_at timestamptz not null default now(),
  unique(relacionamento_id), unique(id,agente_parceiro_id),
  foreign key(relacionamento_id,agente_parceiro_id) references public.crm_relacionamentos(id,agente_parceiro_id)
);
create table public.chat_historico_canais (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null,
  timeline_id uuid not null,
  instancia_id uuid not null references public.chat_instancias(id),
  conversa_legada_id uuid not null unique references public.chat_conversas(id),
  inicio timestamptz not null default now(),
  unique(id,agente_parceiro_id),
  foreign key(timeline_id,agente_parceiro_id) references public.chat_timelines(id,agente_parceiro_id)
);
create table public.chat_historico_mensagens (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null,
  timeline_id uuid not null,
  canal_id uuid not null,
  provider_message_id text not null,
  from_me boolean not null,
  conteudo text not null default '',
  anexo jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(canal_id,provider_message_id,from_me),
  foreign key(timeline_id,agente_parceiro_id) references public.chat_timelines(id,agente_parceiro_id),
  foreign key(canal_id,agente_parceiro_id) references public.chat_historico_canais(id,agente_parceiro_id)
);
create index chat_historico_cursor_idx on public.chat_historico_mensagens (agente_parceiro_id,timeline_id,occurred_at desc,id desc);
create table public.chat_historico_checkpoints (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null,
  timeline_id uuid not null,
  tipo text not null check(tipo in ('canal_associado','instancia_trocada','atendente_trocado','encerrado','reaberto')),
  detalhes jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key(timeline_id,agente_parceiro_id) references public.chat_timelines(id,agente_parceiro_id)
);

-- Resolve identity from a tenant-owned lead, never by a phone number.
create function public.crm_assegurar_relacionamento(p_contato_id uuid, p_tenant uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.crm_contatos; pid uuid; rid uuid; cpf_digits text; existing public.crm_pessoas;
begin
  select * into c from public.crm_contatos where id=p_contato_id and agente_parceiro_id=p_tenant;
  if not found then raise exception 'CONTACT_OUTSIDE_TENANT'; end if;
  cpf_digits := nullif(regexp_replace(coalesce(c.cpf,''),'[^0-9]','','g'),'');
  if cpf_digits is not null and length(cpf_digits)<>11 then raise exception 'CPF_INVALID'; end if;
  if cpf_digits is null and nullif(c.wesales_contact_id,'') is null then raise exception 'IDENTITY_REQUIRED'; end if;
  -- Serialize identity resolution so a CPF and WeSales ID cannot be cross-linked by races.
  perform pg_advisory_xact_lock(5930503);
  select * into existing from public.crm_pessoas where
    (cpf_digits is not null and cpf=cpf_digits) or
    (nullif(c.wesales_contact_id,'') is not null and wesales_contact_id=c.wesales_contact_id)
    order by created_at limit 1;
  if found then
    if (existing.cpf is not null and cpf_digits is not null and existing.cpf<>cpf_digits)
      or (existing.wesales_contact_id is not null and nullif(c.wesales_contact_id,'') is not null and existing.wesales_contact_id<>c.wesales_contact_id)
    then raise exception 'IDENTITY_CONFLICT'; end if;
    update public.crm_pessoas set cpf=coalesce(cpf,cpf_digits),
      wesales_contact_id=coalesce(wesales_contact_id,nullif(c.wesales_contact_id,'')) where id=existing.id returning id into pid;
  else
    insert into public.crm_pessoas(cpf,wesales_contact_id) values(cpf_digits,nullif(c.wesales_contact_id,'')) returning id into pid;
  end if;
  insert into public.crm_relacionamentos(agente_parceiro_id,pessoa_id,carteira,dados_cliente)
    values(p_tenant,pid,exists(select 1 from public.crm_clientes_parceiro where agente_parceiro_id=p_tenant and wesales_contact_id=c.wesales_contact_id),
      jsonb_build_object('nome',c.nome,'cpf',cpf_digits,'telefone',c.telefone,'wesales_contact_id',c.wesales_contact_id))
    on conflict(agente_parceiro_id,pessoa_id) do update set
      carteira=crm_relacionamentos.carteira or excluded.carteira,
      dados_cliente=excluded.dados_cliente,updated_at=clock_timestamp()
    returning id into rid;
  return rid;
end; $$;

create function public.chat_assegurar_timeline(p_conversa_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare tenant uuid; inst uuid; contact uuid; rid uuid; tid uuid; old_channel public.chat_historico_canais;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_conversa_id::text,5930503));
  select i.agente_parceiro_id,i.id,c.crm_contato_id into tenant,inst,contact
    from public.chat_conversas c join public.chat_instancias i on i.id=c.instancia_id
    where c.id=p_conversa_id and i.deleted_at is null;
  if tenant is null then raise exception 'TENANT_REQUIRED'; end if;
  select * into old_channel from public.chat_historico_canais where conversa_legada_id=p_conversa_id;
  if contact is not null then rid := public.crm_assegurar_relacionamento(contact,tenant); end if;
  if rid is not null then
    insert into public.chat_timelines(agente_parceiro_id,relacionamento_id) values(tenant,rid)
      on conflict(relacionamento_id) do update set relacionamento_id=excluded.relacionamento_id returning id into tid;
  elsif old_channel.id is not null then return old_channel.timeline_id;
  else insert into public.chat_timelines(agente_parceiro_id) values(tenant) returning id into tid;
  end if;
  if old_channel.id is not null then
    if old_channel.timeline_id<>tid then
      -- Only a provisional timeline can be assigned automatically. Changing an
      -- already identified person requires explicit reconciliation.
      if exists(select 1 from public.chat_timelines where id=old_channel.timeline_id and relacionamento_id is not null)
      then raise exception 'TIMELINE_IDENTITY_CONFLICT'; end if;
      update public.chat_historico_mensagens set timeline_id=tid where canal_id=old_channel.id;
      update public.chat_historico_canais set timeline_id=tid where id=old_channel.id;
      update public.chat_historico_checkpoints set timeline_id=tid where timeline_id=old_channel.timeline_id;
    end if;
  else
    insert into public.chat_historico_canais(agente_parceiro_id,timeline_id,instancia_id,conversa_legada_id)
      values(tenant,tid,inst,p_conversa_id);
    insert into public.chat_historico_checkpoints(agente_parceiro_id,timeline_id,tipo,detalhes)
      values(tenant,tid,'canal_associado',jsonb_build_object('instancia_id',inst,'conversa_legada_id',p_conversa_id));
  end if;
  return tid;
end; $$;

create function public.chat_gravar_historico(p_conversa_id uuid,p_provider_id text,p_from_me boolean,p_conteudo text,p_occurred_at timestamptz,p_anexo jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare tid uuid; channel public.chat_historico_canais; mid uuid;
begin
  if nullif(p_provider_id,'') is null then raise exception 'MESSAGE_ID_REQUIRED'; end if;
  tid := public.chat_assegurar_timeline(p_conversa_id);
  select * into channel from public.chat_historico_canais where conversa_legada_id=p_conversa_id;
  insert into public.chat_historico_mensagens(agente_parceiro_id,timeline_id,canal_id,provider_message_id,from_me,conteudo,occurred_at,anexo)
    values(channel.agente_parceiro_id,tid,channel.id,p_provider_id,p_from_me,coalesce(p_conteudo,''),p_occurred_at,p_anexo)
    on conflict(canal_id,provider_message_id,from_me) do nothing returning id into mid;
  if mid is null then select id into mid from public.chat_historico_mensagens
    where canal_id=channel.id and provider_message_id=p_provider_id and from_me=p_from_me; end if;
  return mid;
end; $$;

do $$ declare t text; begin
  foreach t in array array['crm_pessoas','crm_relacionamentos','chat_timelines','chat_historico_canais','chat_historico_mensagens','chat_historico_checkpoints'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant select, insert, update on public.%I to service_role',t);
  end loop;
end; $$;
revoke all on function public.crm_assegurar_relacionamento(uuid,uuid), public.chat_assegurar_timeline(uuid), public.chat_gravar_historico(uuid,text,boolean,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.crm_assegurar_relacionamento(uuid,uuid), public.chat_assegurar_timeline(uuid), public.chat_gravar_historico(uuid,text,boolean,text,timestamptz,jsonb) to service_role;

-- Storage is absent in the minimal PostgreSQL test fixture.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id,name,public,file_size_limit) values('crm-historico-midia','crm-historico-midia',false,20971520)
      on conflict(id) do nothing;
  end if;
end; $$;
