-- YCloud (WhatsApp Oficial) — F4: cobrança pela BEM DIGITAL.
-- Contrato: docs/YCLOUD-F0-CONTRATOS-2026-09-26.md (ADR-8 revisado 27/09).
-- Aditiva; nada aqui muda o comportamento do Pix do Portal (o resolver do
-- portal filtra id in ('mercadopago','abacatepay') e ignora linhas novas —
-- verificado em brs-portal-parceiro/src/lib/pix/config.ts).

-- ---------------------------------------------------------------------------
-- 1. gateway_pagamentos: N contas por gateway, identificadas por CNPJ e
--    resolvidas por FINALIDADE (nunca por "o gateway"). Linhas existentes
--    (BRS) são carimbadas com a finalidade do Pix do parceiro. A conta da
--    Bem Digital será cadastrada pela tela (id 'mercadopago-bemdigital'),
--    com finalidade 'assinatura_wa_oficial' e meios {pix,cartao}.
-- ---------------------------------------------------------------------------
alter table public.gateway_pagamentos
  add column if not exists cnpj text null,
  add column if not exists razao_social text null,
  add column if not exists finalidades text[] not null default '{}'::text[],
  add column if not exists meios text[] not null default '{pix}'::text[];

comment on column public.gateway_pagamentos.finalidades is
  'Para que esta CONTA vale: pix_parceiro (Portal/NVTI, BRS) e/ou assinatura_wa_oficial (mensalidade YCloud, Bem Digital). O resolver da aplicação exige exatamente 1 conta ATIVA por finalidade.';

update public.gateway_pagamentos
   set finalidades = '{pix_parceiro}'::text[],
       razao_social = coalesce(razao_social, 'BRS Promotora')
 where id in ('mercadopago', 'abacatepay')
   and finalidades = '{}'::text[];

-- ---------------------------------------------------------------------------
-- 2. Trial gratuito ÚNICO POR NÚMERO em todo o sistema (decisão 26/09).
--    numero_e164 já NORMALIZADO pela aplicação (só dígitos; variantes do
--    nono dígito brasileiro colapsam na mesma chave). Sobrevive a soft
--    delete, desvinculação e troca de parceiro.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_wa_oficial_trials (
  id uuid primary key default gen_random_uuid(),
  numero_e164 text not null unique check (numero_e164 ~ '^[0-9]{8,15}$'),
  agente_parceiro_id_original uuid null references public.agentes_parceiros (id),
  instancia_id_atual uuid null references public.chat_instancias (id),
  inicio_em timestamptz not null default now(),
  fim_em timestamptz not null
);
alter table public.crm_wa_oficial_trials enable row level security;

-- Histórico append-only de números associados (auditoria + alerta de reuso).
create table if not exists public.crm_wa_oficial_numero_vinculos (
  id uuid primary key default gen_random_uuid(),
  numero_e164 text not null check (numero_e164 ~ '^[0-9]{8,15}$'),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id),
  instancia_id uuid null references public.chat_instancias (id),
  trial_concedido boolean not null,
  vinculada_em timestamptz not null default now(),
  desvinculada_em timestamptz null
);
alter table public.crm_wa_oficial_numero_vinculos enable row level security;
create index if not exists crm_wa_oficial_numero_vinculos_numero_idx
  on public.crm_wa_oficial_numero_vinculos (numero_e164, vinculada_em desc);

-- ---------------------------------------------------------------------------
-- 3. Assinaturas (R$ 49/mês por número). O DIREITO DE ENVIO é derivado
--    (função de status+carimbos+agora, matriz §6 do plano revisado), nunca
--    lido cru do status do gateway. trial_fim_em é cópia do trial na
--    ativação p/ o engine decidir com UMA linha.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_wa_oficial_assinaturas (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id),
  instancia_id uuid not null unique references public.chat_instancias (id),
  numero_e164 text not null check (numero_e164 ~ '^[0-9]{8,15}$'),
  valor_centavos integer not null default 4900 check (valor_centavos > 0),
  gateway text not null default 'mercadopago',
  gateway_conta_id text null references public.gateway_pagamentos (id),
  gateway_customer_id text null,
  gateway_subscription_id text null unique,
  status text not null check (status in
    ('trial', 'sem_pagamento', 'ativa', 'inadimplente', 'bloqueada',
     'cancelamento_agendado', 'cancelada')),
  trial_fim_em timestamptz null,
  periodo_pago_ate timestamptz null,
  inicio_inadimplencia timestamptz null,   -- gravado UMA vez por ciclo
  carencia_ate timestamptz null,
  cancelamento_em_fim_ciclo boolean not null default false,
  cancelada_em timestamptz null,
  aceite_termos jsonb not null,            -- {versao, user_id, data, ip}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crm_wa_oficial_assinaturas enable row level security;
create index if not exists crm_wa_oficial_assinaturas_parceiro_idx
  on public.crm_wa_oficial_assinaturas (agente_parceiro_id);

-- ---------------------------------------------------------------------------
-- 4. Cobranças (competência a competência) e eventos do gateway
--    (idempotência do webhook: unique gateway+evento).
-- ---------------------------------------------------------------------------
create table if not exists public.crm_wa_oficial_cobrancas (
  id uuid primary key default gen_random_uuid(),
  assinatura_id uuid not null references public.crm_wa_oficial_assinaturas (id),
  competencia date not null,
  valor_centavos integer not null,
  moeda text not null default 'BRL',
  status text not null check (status in ('pendente', 'aprovada', 'recusada', 'estornada')),
  gateway_payment_id text null unique,
  payload jsonb null,
  criado_em timestamptz not null default now(),
  confirmado_em timestamptz null,
  unique (assinatura_id, competencia)
);
alter table public.crm_wa_oficial_cobrancas enable row level security;

create table if not exists public.crm_wa_oficial_gateway_eventos (
  id uuid primary key default gen_random_uuid(),
  gateway text not null,
  evento_id text not null,
  topico text null,
  recurso_id text null,
  payload jsonb null,
  recebido_em timestamptz not null default now(),
  processado_em timestamptz null,
  resultado text null,
  unique (gateway, evento_id)
);
alter table public.crm_wa_oficial_gateway_eventos enable row level security;

notify pgrst, 'reload schema';
