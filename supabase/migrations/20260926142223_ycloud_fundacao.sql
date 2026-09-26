-- YCloud (WhatsApp Oficial) — fundação de schema. Fatia F1 do plano
-- docs/YCLOUD-F0-CONTRATOS-2026-09-26.md (ADRs 1, 3, 4, 5, 9).
-- Aditiva: nada aqui remove dado ou muda comportamento de Baileys/Z-API.

-- ---------------------------------------------------------------------------
-- 1. ycloud_conexoes — dona da API Key (da CONTA YCloud, não do número),
--    do webhook endpoint e do vínculo de proprietário (ADR-1).
--    Segredos no cofre AES-256-GCM (CRM_CREDENTIALS_KEY); RLS sem policy.
-- ---------------------------------------------------------------------------
create table if not exists public.ycloud_conexoes (
  id uuid primary key default gen_random_uuid(),
  owner_tipo text not null check (owner_tipo in ('brs', 'parceiro')),
  agente_parceiro_id uuid null references public.agentes_parceiros (id),
  nome text not null,
  api_key_cifrada text not null,
  webhook_endpoint_id text null,
  webhook_secret_cifrado text null,
  webhook_criado_em timestamptz null,
  status text not null default 'ativa' check (status in ('ativa', 'invalida', 'removida')),
  ultimo_teste_em timestamptz null,
  criado_por uuid null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ycloud_conexoes_parceiro_exige_agente
    check (owner_tipo <> 'parceiro' or agente_parceiro_id is not null),
  constraint ycloud_conexoes_brs_sem_agente
    check (owner_tipo <> 'brs' or agente_parceiro_id is null)
);
alter table public.ycloud_conexoes enable row level security;

-- v1: uma conexão ativa por parceiro e uma da BRS (deduplica ativação concorrente)
create unique index if not exists ycloud_conexoes_parceiro_ativa_uidx
  on public.ycloud_conexoes (agente_parceiro_id)
  where owner_tipo = 'parceiro' and status = 'ativa';
create unique index if not exists ycloud_conexoes_brs_ativa_uidx
  on public.ycloud_conexoes (owner_tipo)
  where owner_tipo = 'brs' and status = 'ativa';

-- ---------------------------------------------------------------------------
-- 2. chat_instancias: provedor 'ycloud' + vínculo com a conexão/WABA.
--    O CHECK original foi criado inline (nome gerado); drop por catálogo.
-- ---------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.chat_instancias'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%provedor%'
  loop
    execute format('alter table public.chat_instancias drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.chat_instancias
  add constraint chat_instancias_provedor_check
  check (provedor in ('baileys', 'zapi', 'ycloud'));

alter table public.chat_instancias
  add column if not exists ycloud_conexao_id uuid null references public.ycloud_conexoes (id),
  add column if not exists ycloud_waba_id text null,
  add column if not exists ycloud_phone_number_id text null;

-- instância ycloud sempre aponta pra conexão; número não se repete entre
-- tenants nem em ativação concorrente (ADR-1)
alter table public.chat_instancias
  add constraint chat_instancias_ycloud_exige_conexao
  check (provedor <> 'ycloud' or ycloud_conexao_id is not null);
create unique index if not exists chat_instancias_ycloud_numero_uidx
  on public.chat_instancias (numero)
  where provedor = 'ycloud' and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 3. chat_engine_jobs: source 'ycloud' (inbox durável obrigatória, ADR-3).
-- ---------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.chat_engine_jobs'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%source%'
  loop
    execute format('alter table public.chat_engine_jobs drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.chat_engine_jobs
  add constraint chat_engine_jobs_source_check
  check (source in ('chatwoot', 'zapi', 'baileys', 'ycloud'));

-- ---------------------------------------------------------------------------
-- 4. chat_conversas: janela de 24 h no servidor (ADR-6) e identidade BSUID
--    (ADR-5). Colunas nullable; só o fluxo YCloud preenche as duas últimas.
-- ---------------------------------------------------------------------------
alter table public.chat_conversas
  add column if not exists ultima_mensagem_cliente_em timestamptz null,
  add column if not exists ycloud_user_id text null,
  add column if not exists ycloud_parent_user_id text null;

-- ---------------------------------------------------------------------------
-- 5. Espelhos YCloud (ADR-4, ADR-9). Snapshot separado de histórico;
--    custo em numeric, nunca float. RLS sem policy em tudo.
-- ---------------------------------------------------------------------------
create table if not exists public.ycloud_numeros_saude (
  instancia_id uuid primary key references public.chat_instancias (id) on delete cascade,
  quality_rating text null,
  messaging_limit text null,
  bm_messaging_limit text null,          -- limite do PORTFÓLIO: é este que vale
  status text null,
  name_status text null,
  verified_name text null,
  update_event text null,
  quality_update_event text null,
  is_oba boolean null,
  observado_em timestamptz not null,
  payload jsonb null
);
alter table public.ycloud_numeros_saude enable row level security;

create table if not exists public.ycloud_numeros_saude_eventos (
  id uuid primary key default gen_random_uuid(),
  instancia_id uuid not null references public.chat_instancias (id) on delete cascade,
  tipo text not null,
  de jsonb null,
  para jsonb null,
  evento_id text null unique,            -- id do evento YCloud (dedupe)
  ocorrido_em timestamptz not null,
  payload jsonb null,
  created_at timestamptz not null default now()
);
alter table public.ycloud_numeros_saude_eventos enable row level security;
create index if not exists ycloud_numeros_saude_eventos_inst_idx
  on public.ycloud_numeros_saude_eventos (instancia_id, ocorrido_em desc);

create table if not exists public.ycloud_templates (
  id uuid primary key default gen_random_uuid(),
  conexao_id uuid not null references public.ycloud_conexoes (id) on delete cascade,
  waba_id text not null,
  nome text not null,
  idioma text not null,
  categoria text null,
  status text null,
  quality_rating text null,
  componentes jsonb null,
  sincronizado_em timestamptz not null default now(),
  status_update_evento_id text null,
  unique (conexao_id, waba_id, nome, idioma)
);
alter table public.ycloud_templates enable row level security;

create table if not exists public.ycloud_saldos (
  conexao_id uuid not null references public.ycloud_conexoes (id) on delete cascade,
  moeda text not null,
  saldo numeric(14, 4) not null,
  observado_em timestamptz not null,
  primary key (conexao_id, moeda)
);
alter table public.ycloud_saldos enable row level security;

-- Correlação e custo por mensagem (ADR-4): 4 IDs nunca fundidos, carimbo por
-- status (forward-only por campo), status órfão entra por ycloud_id.
create table if not exists public.ycloud_mensagens (
  id uuid primary key default gen_random_uuid(),
  instancia_id uuid not null references public.chat_instancias (id) on delete cascade,
  ycloud_id text not null unique,
  operation_id uuid null,
  wamid text null,
  direcao text not null check (direcao in ('in', 'out')),
  status text null,
  accepted_em timestamptz null,
  sent_em timestamptz null,
  delivered_em timestamptz null,
  read_em timestamptz null,
  failed_em timestamptz null,
  erro jsonb null,
  total_price numeric(12, 6) null,
  currency text null,
  pricing_category text null,
  pricing_type text null,
  preco_final boolean not null default false,
  payload jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ycloud_mensagens enable row level security;
create index if not exists ycloud_mensagens_inst_idx
  on public.ycloud_mensagens (instancia_id, created_at desc);
create index if not exists ycloud_mensagens_operation_idx
  on public.ycloud_mensagens (operation_id) where operation_id is not null;
create index if not exists ycloud_mensagens_wamid_idx
  on public.ycloud_mensagens (wamid) where wamid is not null;

-- ---------------------------------------------------------------------------
-- 6. Permissões novas (seed p/ root, padrão giphy_config). Os 3 pontos de
--    código (SYSTEM_MODULES, divisoes.ts, permissions.ts) sobem na MESMA
--    entrega das telas (S1) — regra fixa: menu nunca sobe sem permissão, e
--    o seed já estar aplicado dispensa migration na fatia do Sonnet.
--   sistema-config-whatsapp-oficial  → card Provedores › WhatsApp Oficial (YCloud)
--   conversas-whatsapp-oficial-saude → painel de saúde na Central de Atendimento
-- ---------------------------------------------------------------------------
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, perm.nome, true, true, true, false, false
from public.profile_permissions pp
cross join (values ('sistema-config-whatsapp-oficial'), ('conversas-whatsapp-oficial-saude')) as perm (nome)
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, perm.nome, true, true, true, false, false
from public.user_permissions up
cross join (values ('sistema-config-whatsapp-oficial'), ('conversas-whatsapp-oficial-saude')) as perm (nome)
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

notify pgrst, 'reload schema';
