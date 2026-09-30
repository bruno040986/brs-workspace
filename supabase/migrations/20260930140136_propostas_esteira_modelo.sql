-- Esteira de digitação — Fatia 3: modelo da proposta manual do CRM.
-- Evolui propostas_credito (canônica, 20260905102132; confirmada VAZIA em
-- produção em 30/09/2026 — count = 0) com ALTER, sem recriar. Cria
-- propostas_eventos (linha do tempo, append-only) e propostas_documentos
-- (referência + snapshot). Tenant = agente_parceiro_id (não existe tenant_id).
-- Spec §4.3–§4.5, §4.8, §8. Idempotente; sem DROP de dado.

-- ---------------------------------------------------------------------------
-- 0) Alvos de FK composta com o tenant (defesa em profundidade: um filho nunca
--    aponta pra proposta/usuário/solicitação de OUTRO parceiro, mesmo com bug
--    de filtro na app). Índices únicos (id, agente_parceiro_id) são redundantes
--    com a PK, mas o Postgres exige o alvo exato.
-- ---------------------------------------------------------------------------
create unique index if not exists crm_usuarios_id_parceiro_uq
  on public.crm_usuarios (id, agente_parceiro_id);
create unique index if not exists crm_solicitacoes_op_id_parceiro_uq
  on public.crm_solicitacoes_operacionais (id, agente_parceiro_id);

-- ---------------------------------------------------------------------------
-- 1) propostas_credito — colunas novas (§4.3)
-- ---------------------------------------------------------------------------
alter table public.propostas_credito
  alter column instituicao_financeira_id drop not null;   -- texto livre como fallback

alter table public.propostas_credito
  add column if not exists origem text not null default 'api' check (origem in ('manual', 'api', 'arw')),
  add column if not exists solicitacao_id uuid null,      -- FK composta abaixo
  -- identidade do lead (contato é temporário, relacionamento é estável)
  add column if not exists contato_id uuid null references public.crm_contatos (id) on delete set null,
  add column if not exists relacionamento_id uuid null references public.crm_relacionamentos (id),
  add column if not exists lead_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists condicoes_snapshot jsonb not null default '{}'::jsonb,
  -- catálogo OU texto livre
  add column if not exists instituicao_texto text null,
  add column if not exists convenio_texto text null,
  add column if not exists forma_contrato_texto text null,
  add column if not exists tabela_comissao_id uuid null references public.tabelas_comissao (id),
  add column if not exists tabela_texto text null,
  add column if not exists tipo_formalizacao_id uuid null references public.tipos_formalizacao (id),
  add column if not exists pendente_normalizacao boolean generated always as (
      (instituicao_financeira_id is null and instituicao_texto is not null)
   or (convenio_id is null and convenio_texto is not null)
   or (forma_contrato_id is null and forma_contrato_texto is not null)
   or (tabela_comissao_id is null and tabela_texto is not null)) stored,
  -- status do catálogo + grupo denormalizado (filtro/contagem/índice sem join)
  add column if not exists status_proposta_id uuid null references public.propostas_status (id),
  add column if not exists situacao_proposta_id uuid null references public.propostas_situacoes (id),
  add column if not exists grupo text null check (grupo in ('em_andamento', 'pendente', 'pago', 'cancelado')),
  -- identificação na IF (id_externo_if já existe = Nº Proposta)
  add column if not exists numero_contrato text null,
  -- valores (valor_parcela/num_parcelas/valor_solicitado já existem)
  add column if not exists valor_bruto numeric(14,2) null,
  add column if not exists valor_liquido numeric(14,2) null,
  add column if not exists valor_base numeric(14,2) null,
  add column if not exists data_pagamento_cliente date null,
  -- pessoas do CRM (created_by aponta pra public.users = funcionário BRS)
  add column if not exists atendente_crm_usuario_id uuid null,
  add column if not exists operacional_crm_usuario_id uuid null,
  add column if not exists trava_expira_em timestamptz null,
  -- tempos
  add column if not exists digitada_em timestamptz null,       -- fila = digitada_em is null
  add column if not exists data_atualizacao timestamptz not null default now(),
  add column if not exists finalizada_em timestamptz null;

do $$ begin
  -- alvo das FKs compostas dos filhos
  if not exists (select 1 from pg_constraint where conname = 'propostas_credito_id_tenant_uq') then
    alter table public.propostas_credito add constraint propostas_credito_id_tenant_uq unique (id, agente_parceiro_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'propostas_credito_if_check') then
    alter table public.propostas_credito add constraint propostas_credito_if_check
      check (instituicao_financeira_id is not null or instituicao_texto is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'propostas_credito_manual_check') then
    alter table public.propostas_credito add constraint propostas_credito_manual_check
      check (origem <> 'manual' or (agente_parceiro_id is not null and atendente_crm_usuario_id is not null));
  end if;
  -- FKs compostas com o tenant (MATCH SIMPLE: com coluna nula não checa —
  -- proposta 'api' sem parceiro continua livre; proposta manual é amarrada)
  if not exists (select 1 from pg_constraint where conname = 'propostas_credito_solicitacao_tenant_fk') then
    alter table public.propostas_credito add constraint propostas_credito_solicitacao_tenant_fk
      foreign key (solicitacao_id, agente_parceiro_id)
      references public.crm_solicitacoes_operacionais (id, agente_parceiro_id) on delete set null (solicitacao_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'propostas_credito_atendente_tenant_fk') then
    alter table public.propostas_credito add constraint propostas_credito_atendente_tenant_fk
      foreign key (atendente_crm_usuario_id, agente_parceiro_id)
      references public.crm_usuarios (id, agente_parceiro_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'propostas_credito_operacional_tenant_fk') then
    alter table public.propostas_credito add constraint propostas_credito_operacional_tenant_fk
      foreign key (operacional_crm_usuario_id, agente_parceiro_id)
      references public.crm_usuarios (id, agente_parceiro_id);
  end if;
end $$;

-- Índices (esteira + conciliação futura, §4.3)
create index if not exists propostas_esteira_idx
  on public.propostas_credito (agente_parceiro_id, grupo, data_atualizacao);
create index if not exists propostas_fila_idx
  on public.propostas_credito (agente_parceiro_id, created_at)
  where digitada_em is null and grupo in ('em_andamento', 'pendente');
create index if not exists propostas_atendente_idx
  on public.propostas_credito (atendente_crm_usuario_id, data_atualizacao desc);
create index if not exists propostas_operac_idx
  on public.propostas_credito (operacional_crm_usuario_id)
  where grupo in ('em_andamento', 'pendente');
create index if not exists propostas_conciliacao_idx   -- conciliação futura; NÃO único
  on public.propostas_credito (instituicao_financeira_id, numero_contrato, cpf)
  where numero_contrato is not null;
create unique index if not exists propostas_solicitacao_viva_uq   -- 1 proposta viva por simulação
  on public.propostas_credito (solicitacao_id)
  where grupo in ('em_andamento', 'pendente');
create index if not exists propostas_normalizar_idx
  on public.propostas_credito (created_at) where pendente_normalizacao;

-- ---------------------------------------------------------------------------
-- 2) Linha do tempo + comentários (append-only) — §4.4
-- ---------------------------------------------------------------------------
create table if not exists public.propostas_eventos (
  id uuid primary key default gen_random_uuid(),
  proposta_id uuid not null,
  agente_parceiro_id uuid not null,
  tipo text not null check (tipo in (
    'criada', 'assumida', 'trava_expirada', 'digitada', 'status', 'situacao', 'campos',
    'pendencia', 'pendencia_respondida', 'comentario', 'documento', 'cancelada', 'reaberta', 'alerta_inatividade')),
  autor_crm_usuario_id uuid null,                  -- null = sistema (cron)
  status_de uuid null references public.propostas_status (id),
  status_para uuid null references public.propostas_status (id),
  situacao_de uuid null references public.propostas_situacoes (id),
  situacao_para uuid null references public.propostas_situacoes (id),
  nota text null,                                  -- motivo da pendência/cancelamento; texto do comentário
  dados jsonb not null default '{}'::jsonb,        -- diff de campos, ids de documento, aceite do cliente etc.
  created_at timestamptz not null default now(),
  foreign key (proposta_id, agente_parceiro_id)
    references public.propostas_credito (id, agente_parceiro_id) on delete cascade,
  foreign key (autor_crm_usuario_id, agente_parceiro_id)
    references public.crm_usuarios (id, agente_parceiro_id) on delete set null (autor_crm_usuario_id)
);
create index if not exists propostas_eventos_idx on public.propostas_eventos (proposta_id, created_at);
-- alerta_inatividade "uma vez por período" e cron de SLA consultam por tipo
create index if not exists propostas_eventos_tipo_idx on public.propostas_eventos (agente_parceiro_id, tipo, created_at);

-- ---------------------------------------------------------------------------
-- 3) Documentos por referência + snapshot (bucket/path/sha256 sobrevivem ao
--    expurgo de crm_arquivos) — §4.5. Soft delete via removido_em.
-- ---------------------------------------------------------------------------
create table if not exists public.propostas_documentos (
  id uuid primary key default gen_random_uuid(),
  proposta_id uuid not null,
  agente_parceiro_id uuid not null,
  origem text not null check (origem in ('chat', 'arquivo_lead', 'solicitacao', 'upload')),
  crm_arquivo_id uuid null references public.crm_arquivos (id) on delete set null,
  bucket text not null,
  storage_path text not null,                      -- sempre com prefixo do tenant (conferido no servidor)
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  nome text not null,
  mime text null,
  tamanho_bytes bigint null check (tamanho_bytes is null or tamanho_bytes >= 0),
  chat_ref jsonb null,                             -- {conversationId, messageId, attachmentId}
  adicionado_por uuid null,
  removido_em timestamptz null,
  created_at timestamptz not null default now(),
  unique (proposta_id, sha256),
  foreign key (proposta_id, agente_parceiro_id)
    references public.propostas_credito (id, agente_parceiro_id) on delete cascade,
  foreign key (adicionado_por, agente_parceiro_id)
    references public.crm_usuarios (id, agente_parceiro_id) on delete set null (adicionado_por)
);
-- excluirArquivo recusa apagar arquivo referenciado por proposta ativa
create index if not exists propostas_documentos_path_idx
  on public.propostas_documentos (agente_parceiro_id, storage_path) where removido_em is null;

-- ---------------------------------------------------------------------------
-- 4) RLS: sem policy, tudo via service_role + filtro obrigatório por
--    agente_parceiro_id na action (§4.8). Eventos são append-only.
-- ---------------------------------------------------------------------------
alter table public.propostas_credito enable row level security;
alter table public.propostas_eventos enable row level security;
alter table public.propostas_documentos enable row level security;
revoke all on public.propostas_credito, public.propostas_eventos, public.propostas_documentos
  from public, anon, authenticated;
grant select, insert, update on public.propostas_credito to service_role;
revoke delete on public.propostas_eventos from service_role;
grant select, insert on public.propostas_eventos to service_role;
grant select, insert, update on public.propostas_documentos to service_role;

-- ---------------------------------------------------------------------------
-- 5) Permissões novas do CRM (§8) nos perfis globais
-- ---------------------------------------------------------------------------
with p as (select id, chave from public.crm_perfis where agente_parceiro_id is null),
m(chave, permissao) as (values
  ('master', 'propostas.solicitar_digitacao'), ('master', 'propostas.ver_minhas'), ('master', 'propostas.ver_todas'),
  ('master', 'propostas.digitar'), ('master', 'propostas.gerir'),
  ('operacional', 'propostas.solicitar_digitacao'), ('operacional', 'propostas.ver_minhas'), ('operacional', 'propostas.ver_todas'),
  ('operacional', 'propostas.digitar'),
  ('atendente', 'propostas.solicitar_digitacao'), ('atendente', 'propostas.ver_minhas')
)
insert into public.crm_perfis_permissoes (perfil_id, permissao)
select p.id, m.permissao from m join p on p.chave = m.chave
on conflict do nothing;

notify pgrst, 'reload schema';
