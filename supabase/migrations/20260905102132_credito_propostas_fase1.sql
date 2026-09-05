-- Propostas de Crédito — Fatia 1 (05/09/2026): modelo canônico IF-agnóstico
-- para integração com Instituições Financeiras de crédito (FyDigital é a 1ª).
-- O Workspace é o dono canônico; o Portal Parceiro só consome API interna.
-- Aqui NÃO há adaptador de IF nem chamadas externas — só o modelo de dados,
-- o inbox durável de webhooks e a config por IF (cofre). O adaptador FyDigital
-- (OAuth + assinatura RS256 + decifra webhook + mapa de enums) é a Fatia 4.
-- Reaproveita financial_institutions, convenios, formas_contrato,
-- agentes_parceiros e nuvidio_convites. RLS server-only (service role via
-- actions), como a folha.

-- ===========================================================================
-- 1) Simulações de crédito (nascem ANTES da proposta; podem ser improdutivas)
--    Fluxo: simulando → simulada (esperando virar proposta) →
--    convertida | expirada (após TTL, default 24h) | erro. Soft-expire: a
--    linha fica como 'expirada' (métrica de conversão), não é apagada.
-- ===========================================================================
create table if not exists public.simulacoes_credito (
  id uuid primary key default gen_random_uuid(),
  instituicao_financeira_id uuid not null references public.financial_institutions (id),
  convenio_id uuid references public.convenios (id),
  forma_contrato_id uuid references public.formas_contrato (id),
  agente_parceiro_id uuid references public.agentes_parceiros (id),

  cpf text not null,
  nome_cliente text not null default '',
  -- Parâmetros do catálogo da IF (ids do empregador/órgão/tabela/produto)
  id_empregador text,
  id_orgao text,
  id_tabela_fin text,
  id_produto text,
  tipo_proposta text,                        -- ex.: CartaoMaisSaqueParcelado
  valor_sol_total numeric,
  valor_sol_parcela numeric,
  num_parcelas integer,

  status text not null default 'simulando'
    check (status in ('simulando','simulada','convertida','expirada','erro')),
  id_simulacao_if text,                      -- id_simulacao devolvido pela IF
  resultado jsonb not null default '{}'::jsonb,  -- retorno bruto (taxas/IOF/valores)
  observacao text not null default '',
  request_id text,                           -- correlação com o webhook da IF
  expira_em timestamptz,                     -- criação + TTL (default 24h, ver config)

  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- 2) Proposta de crédito (canônica, IF-agnóstica)
-- ===========================================================================
create table if not exists public.propostas_credito (
  id uuid primary key default gen_random_uuid(),
  instituicao_financeira_id uuid not null references public.financial_institutions (id),
  convenio_id uuid references public.convenios (id),
  forma_contrato_id uuid references public.formas_contrato (id),
  agente_parceiro_id uuid references public.agentes_parceiros (id),
  simulacao_id uuid references public.simulacoes_credito (id),

  cpf text not null,
  nome_cliente text not null default '',
  telefone_cliente text,
  valor_solicitado numeric,
  valor_parcela numeric,
  num_parcelas integer,

  -- Status CANÔNICO nosso (a UI só conhece este; o adaptador mapeia o enum da IF)
  status text not null default 'criada'
    check (status in (
      'simulando','criada','aguardando_assinatura','aguardando_aprovacao',
      'aguardando_liberacao_interna','pendente','aguardando_pagamento',
      'paga','cancelada','erro'
    )),

  liberacao_automatica boolean not null default true,  -- false = "paradinha" (Nuvidio)
  nuvidio_convite_id uuid references public.nuvidio_convites (id),

  id_externo_if text,                        -- id_proposta na IF
  status_if_bruto text,                      -- status/enum bruto da IF (auditoria)
  situacao_if_bruto text,                    -- situacao/enum bruto da IF (auditoria)
  request_id text,                           -- correlação com os webhooks
  observacao text not null default '',
  payload_bruto jsonb not null default '{}'::jsonb,   -- último payload cru (auditoria)

  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- 3) Extensão Cartão (até 2 linhas por proposta: saque + margem)
-- ===========================================================================
create table if not exists public.proposta_cartao_operacoes (
  id uuid primary key default gen_random_uuid(),
  proposta_id uuid not null references public.propostas_credito (id) on delete cascade,
  tipo text not null check (tipo in ('saque','margem')),
  valor numeric,
  percentual numeric,
  num_parcelas integer,
  valor_parcela numeric,
  created_at timestamptz not null default now(),
  unique (proposta_id, tipo)
);

-- ===========================================================================
-- 4) Extensão Portabilidade/Refin (N contratos de origem → 1 proposta nova)
-- ===========================================================================
create table if not exists public.proposta_contratos_origem (
  id uuid primary key default gen_random_uuid(),
  proposta_id uuid not null references public.propostas_credito (id) on delete cascade,
  tipo text not null check (tipo in ('portabilidade','refin')),
  banco_origem text,
  contrato_origem text,
  saldo_devedor numeric,
  parcela numeric,
  num_parcelas_restantes integer,
  created_at timestamptz not null default now()
);

-- ===========================================================================
-- 5) Inbox durável de webhooks (status só chega por push — não pode perder)
--    Grava cru, responde 200 rápido, processa depois. Idempotente por hash do
--    evento (dedupe de entregas repetidas); 'acompanhamento' repetido com o
--    mesmo request_id é evento distinto e passa (hash difere).
-- ===========================================================================
create table if not exists public.if_webhook_eventos (
  id uuid primary key default gen_random_uuid(),
  instituicao_financeira_id uuid references public.financial_institutions (id),
  webhook text,                              -- 'identificador','criar_proposta','acompanhamento'…
  tipo_webhook text,                         -- 'Consig' / 'FY'
  request_id text,                           -- casa com a proposta/simulação
  id_externo text,                           -- id_proposta na IF (quando presente)
  proposta_id uuid references public.propostas_credito (id),
  simulacao_id uuid references public.simulacoes_credito (id),
  payload jsonb not null default '{}'::jsonb,
  assinatura_valida boolean not null default false,  -- verificação RS256 (fail-closed)
  evento_hash text,                          -- sha256 do payload cru (dedupe)
  processado boolean not null default false,
  processado_em timestamptz,
  erro text,
  recebido_em timestamptz not null default now()
);
create unique index if not exists uq_if_webhook_hash on public.if_webhook_eventos (evento_hash) where evento_hash is not null;

-- ===========================================================================
-- 6) Config por IF (credenciais no cofre AES) + cache do Bearer + TTL simulação
-- ===========================================================================
create table if not exists public.if_credito_config (
  id uuid primary key default gen_random_uuid(),
  instituicao_financeira_id uuid not null unique references public.financial_institutions (id),
  ambiente text not null default 'homologacao' check (ambiente in ('producao','homologacao')),
  base_url text,                             -- ex.: https://api-hom.fy.digital/
  client_id text,
  client_secret_enc text,                    -- cofre
  empresa_private_key_enc text,              -- cofre (assina o JWT dos requests)
  empresa_public_key_enc text,               -- cofre
  api_public_key_enc text,                   -- cofre (decifra as respostas/webhooks)
  simulacao_ttl_horas integer not null default 24,
  access_token_enc text,                     -- cache do Bearer (cofre)
  token_expira_em timestamptz,
  ativo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- Índices
-- ===========================================================================
create index if not exists idx_sim_credito_status on public.simulacoes_credito (status, expira_em);
create index if not exists idx_sim_credito_cpf on public.simulacoes_credito (cpf);
create index if not exists idx_sim_credito_req on public.simulacoes_credito (request_id);
create index if not exists idx_prop_credito_status on public.propostas_credito (status);
create index if not exists idx_prop_credito_forma on public.propostas_credito (forma_contrato_id);
create index if not exists idx_prop_credito_if on public.propostas_credito (instituicao_financeira_id);
create index if not exists idx_prop_credito_cpf on public.propostas_credito (cpf);
create index if not exists idx_prop_credito_req on public.propostas_credito (request_id);
create index if not exists idx_prop_credito_ext on public.propostas_credito (id_externo_if);
create index if not exists idx_prop_cartao_prop on public.proposta_cartao_operacoes (proposta_id);
create index if not exists idx_prop_origem_prop on public.proposta_contratos_origem (proposta_id);
create index if not exists idx_if_webhook_pend on public.if_webhook_eventos (processado, recebido_em);
create index if not exists idx_if_webhook_req on public.if_webhook_eventos (request_id);
create index if not exists idx_if_webhook_ext on public.if_webhook_eventos (id_externo);

-- ===========================================================================
-- RLS — tudo passa por service role nas actions (permissões
-- operacional-painel-operacoes / sistema-config-if-credito). Sem policy.
-- ===========================================================================
alter table public.simulacoes_credito enable row level security;
alter table public.propostas_credito enable row level security;
alter table public.proposta_cartao_operacoes enable row level security;
alter table public.proposta_contratos_origem enable row level security;
alter table public.if_webhook_eventos enable row level security;
alter table public.if_credito_config enable row level security;

-- ===========================================================================
-- Permissões novas (seed p/ root) — REGRA FIXA ponto 4.
--   operacional-painel-operacoes → Painel de Operações (divisão Operacional)
--   sistema-config-if-credito    → card "APIs de Instituições Financeiras de Crédito"
-- ===========================================================================
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, r.resource_name, true, true, true, false, false
from public.profile_permissions pp
cross join (values ('operacional-painel-operacoes'), ('sistema-config-if-credito')) as r(resource_name)
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, r.resource_name, true, true, true, false, false
from public.user_permissions up
cross join (values ('operacional-painel-operacoes'), ('sistema-config-if-credito')) as r(resource_name)
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

notify pgrst, 'reload schema';
