-- Tela de Atendimento do CRM AlvoConsig (decisões 29/08/2026):
-- vínculo conversa↔lead, fixadas, comentários internos, observações/atividades/
-- compromissos/arquivos, roteiros de ligação, chat interno, campos novos de
-- contato/oferta, recarga da conta virtual e configuração da consulta CPF paga.

-- ---------------------------------------------------------------------------
-- 1. Conversas ↔ leads
-- ---------------------------------------------------------------------------
alter table public.chat_conversas
  add column if not exists crm_contato_id uuid null references public.crm_contatos (id) on delete set null,
  add column if not exists telefone_e164 text null;

create index if not exists chat_conversas_crm_contato_idx on public.chat_conversas (crm_contato_id);
create index if not exists chat_conversas_telefone_idx on public.chat_conversas (telefone_e164);

-- Rodízio das instâncias de disparo: 1º contato sai pela que está há mais tempo sem enviar.
alter table public.chat_instancias
  add column if not exists ultimo_envio_em timestamptz null;

-- Fixar conversas no topo (por usuário, até 3 — limite aplicado no app).
create table if not exists public.chat_conversas_fixadas (
  chatwoot_conversation_id integer not null,
  crm_usuario_id uuid not null references public.crm_usuarios (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (chatwoot_conversation_id, crm_usuario_id)
);

-- Comentários internos na conversa (não vão pro lead; visíveis pra equipe do parceiro).
create table if not exists public.chat_comentarios_internos (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  chatwoot_conversation_id integer not null,
  autor_crm_usuario_id uuid null references public.crm_usuarios (id) on delete set null,
  conteudo text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_comentarios_internos_conv_idx
  on public.chat_comentarios_internos (agente_parceiro_id, chatwoot_conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- 2. Contatos e ofertas — campos novos
-- ---------------------------------------------------------------------------
alter table public.crm_contatos
  add column if not exists sobrenome text null,
  add column if not exists fonte_contato text null,
  add column if not exists melhor_horario text null,
  add column if not exists origem text not null default 'alocacao',
  add column if not exists dados_incompletos boolean generated always as (
    coalesce(cpf, '') = '' or coalesce(email, '') = ''
  ) stored;

do $$ begin
  alter table public.crm_contatos
    add constraint crm_contatos_origem_check check (origem in ('alocacao', 'receptivo', 'manual'));
exception when duplicate_object then null; end $$;

create index if not exists crm_contatos_incompletos_idx
  on public.crm_contatos (agente_parceiro_id, created_at)
  where dados_incompletos and deleted_at is null;

alter table public.crm_ofertas
  add column if not exists origem text not null default 'coeficiente',
  add column if not exists validade date null,
  add column if not exists numero_simulacao text null;

do $$ begin
  alter table public.crm_ofertas
    add constraint crm_ofertas_origem_check check (origem in ('coeficiente', 'simulacao_online', 'import'));
exception when duplicate_object then null; end $$;

alter table public.crm_usuarios
  add column if not exists responsavel_simulacoes boolean not null default false;

-- ---------------------------------------------------------------------------
-- 3. Ferramentas do painel do lead
-- ---------------------------------------------------------------------------
create table if not exists public.crm_observacoes (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  contato_id uuid not null references public.crm_contatos (id) on delete cascade,
  autor_crm_usuario_id uuid null references public.crm_usuarios (id) on delete set null,
  conteudo text not null,
  wesales_note_id text null,
  sincronizada_em timestamptz null,
  created_at timestamptz not null default now()
);
create index if not exists crm_observacoes_contato_idx on public.crm_observacoes (contato_id, created_at desc);
create index if not exists crm_observacoes_pendentes_idx on public.crm_observacoes (created_at) where sincronizada_em is null;

create table if not exists public.crm_atividades (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  contato_id uuid not null references public.crm_contatos (id) on delete cascade,
  autor_crm_usuario_id uuid null references public.crm_usuarios (id) on delete set null,
  tipo text not null check (tipo in ('simulacao_enviada', 'oferta_enviada', 'simulacao_online', 'manual')),
  titulo text not null,
  detalhes jsonb not null default '{}'::jsonb,
  wesales_note_id text null,
  sincronizada_em timestamptz null,
  created_at timestamptz not null default now()
);
create index if not exists crm_atividades_contato_idx on public.crm_atividades (contato_id, created_at desc);
create index if not exists crm_atividades_pendentes_idx on public.crm_atividades (created_at) where sincronizada_em is null;

create table if not exists public.crm_compromissos (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  contato_id uuid null references public.crm_contatos (id) on delete set null,
  crm_usuario_id uuid not null references public.crm_usuarios (id) on delete cascade,
  criado_por uuid null references public.crm_usuarios (id) on delete set null,
  titulo text not null,
  inicio timestamptz not null,
  lembrete_min integer not null default 15 check (lembrete_min >= 0),
  lembrete_enviado_em timestamptz null,
  concluido_em timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_compromissos_usuario_idx on public.crm_compromissos (crm_usuario_id, inicio);
create index if not exists crm_compromissos_lembrete_idx on public.crm_compromissos (inicio) where lembrete_enviado_em is null and concluido_em is null;

create table if not exists public.crm_arquivos (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  contato_id uuid not null references public.crm_contatos (id) on delete cascade,
  autor_crm_usuario_id uuid null references public.crm_usuarios (id) on delete set null,
  nome text not null,
  storage_path text not null,
  mime text null,
  tamanho_bytes bigint null,
  origem text not null default 'upload' check (origem in ('upload', 'chat')),
  wesales_note_id text null,
  sincronizada_em timestamptz null,
  created_at timestamptz not null default now()
);
create index if not exists crm_arquivos_contato_idx on public.crm_arquivos (contato_id, created_at desc);

-- Roteiros de ligação (biblioteca por produto; a campanha escolhe em config.roteiros).
create table if not exists public.crm_roteiros (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  nome text not null,
  produto text not null check (produto in ('novo', 'cartao_rmc', 'cartao_rcc', 'refin', 'geral')),
  texto text not null,
  criado_por uuid null references public.crm_usuarios (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);
create index if not exists crm_roteiros_parceiro_idx on public.crm_roteiros (agente_parceiro_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 4. Chat interno (master ↔ atendentes) — no Supabase, não no Chatwoot
-- ---------------------------------------------------------------------------
create table if not exists public.crm_chat_canais (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  tipo text not null check (tipo in ('direto', 'equipe', 'pessoal')),
  nome text null,
  -- chave de dedup: 'equipe' | 'pessoal:<usuario>' | 'direto:<menor_id>:<maior_id>'
  chave text not null,
  created_at timestamptz not null default now(),
  unique (agente_parceiro_id, chave)
);

create table if not exists public.crm_chat_membros (
  canal_id uuid not null references public.crm_chat_canais (id) on delete cascade,
  crm_usuario_id uuid not null references public.crm_usuarios (id) on delete cascade,
  lido_ate timestamptz null,
  primary key (canal_id, crm_usuario_id)
);

create table if not exists public.crm_chat_mensagens (
  id uuid primary key default gen_random_uuid(),
  canal_id uuid not null references public.crm_chat_canais (id) on delete cascade,
  autor_crm_usuario_id uuid null references public.crm_usuarios (id) on delete set null,
  tipo text not null default 'texto'
    check (tipo in ('texto', 'solicitacao_simulacao', 'oferta_simulada', 'lembrete', 'sistema')),
  conteudo text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists crm_chat_mensagens_canal_idx on public.crm_chat_mensagens (canal_id, created_at);

-- ---------------------------------------------------------------------------
-- 5. Conta virtual: recarga + consulta CPF paga
-- ---------------------------------------------------------------------------
alter table public.parceiro_cobrancas_pix
  alter column lote_id drop not null,
  add column if not exists tipo text not null default 'lote',
  add column if not exists agente_parceiro_id uuid null references public.agentes_parceiros (id);

do $$ begin
  alter table public.parceiro_cobrancas_pix
    add constraint parceiro_cobrancas_pix_tipo_check check (tipo in ('lote', 'recarga'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.parceiro_cobrancas_pix
    add constraint parceiro_cobrancas_pix_lote_coerente check (tipo <> 'lote' or lote_id is not null);
exception when duplicate_object then null; end $$;

-- Lote CSV: parte paga com saldo da carteira (o Pix cobre só o restante).
alter table public.nvti_lotes_parceiro
  add column if not exists pago_com_saldo_centavos bigint not null default 0 check (pago_com_saldo_centavos >= 0);

-- Configuração interna da consulta CPF por parceiro (o parceiro nunca vê).
alter table public.crm_parceiro_config
  add column if not exists consulta_acordo_centavos integer null check (consulta_acordo_centavos is null or consulta_acordo_centavos >= 0),
  add column if not exists consulta_faixa_modo text not null default 'individual',
  add column if not exists consulta_cobra_cache boolean not null default true;

do $$ begin
  alter table public.crm_parceiro_config
    add constraint crm_parceiro_config_faixa_modo_check check (consulta_faixa_modo in ('individual', 'global'));
exception when duplicate_object then null; end $$;

-- Log de cada consulta unitária paga (auditoria + contagem de faixa individual).
create table if not exists public.parceiro_consultas_cpf (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  user_id uuid not null,
  crm_usuario_id uuid null references public.crm_usuarios (id) on delete set null,
  contato_id uuid null references public.crm_contatos (id) on delete set null,
  cpf text not null,
  preco_centavos integer not null check (preco_centavos >= 0),
  custo_brs_centavos integer not null default 0,
  cache_hit boolean not null default false,
  lancamento_id uuid null references public.parceiro_lancamentos (id),
  status text not null default 'ok' check (status in ('ok', 'erro', 'estornada')),
  erro text null,
  created_at timestamptz not null default now()
);
create index if not exists parceiro_consultas_cpf_parceiro_mes_idx on public.parceiro_consultas_cpf (agente_parceiro_id, created_at);

-- Preço padrão por faixa pros parceiros: price_tiers[].parceiro (centavos em reais, ex. 0.08).
update public.nvti_config
set price_tiers = (
  select coalesce(jsonb_agg(
    case when t ? 'parceiro' then t else t || jsonb_build_object('parceiro', 0.08) end
    order by ord
  ), price_tiers)
  from jsonb_array_elements(price_tiers) with ordinality as x(t, ord)
)
where price_tiers is not null;

-- ---------------------------------------------------------------------------
-- 6. RLS: tudo do CRM é servido via service role com filtro por parceiro na app.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  t := app_private.enable_rls_if_exists('chat_conversas_fixadas');
  t := app_private.enable_rls_if_exists('chat_comentarios_internos');
  t := app_private.enable_rls_if_exists('crm_observacoes');
  t := app_private.enable_rls_if_exists('crm_atividades');
  t := app_private.enable_rls_if_exists('crm_compromissos');
  t := app_private.enable_rls_if_exists('crm_arquivos');
  t := app_private.enable_rls_if_exists('crm_roteiros');
  t := app_private.enable_rls_if_exists('crm_chat_canais');
  t := app_private.enable_rls_if_exists('crm_chat_membros');
  t := app_private.enable_rls_if_exists('crm_chat_mensagens');
  t := app_private.enable_rls_if_exists('parceiro_consultas_cpf');
end $$;

-- O parceiro (portal) enxerga o próprio log de consultas no extrato.
do $$ begin
  create policy parceiro_consultas_cpf_select_own on public.parceiro_consultas_cpf
    for select to authenticated using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- updated_at
do $$ begin
  create trigger set_timestamp_crm_compromissos before update on public.crm_compromissos
    for each row execute function trigger_set_timestamp();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger set_timestamp_crm_roteiros before update on public.crm_roteiros
    for each row execute function trigger_set_timestamp();
exception when duplicate_object then null; end $$;
