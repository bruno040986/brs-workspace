-- =============================================================================
-- CRM AlvoConsig — Disparo de WhatsApp Não Oficial (03/09/2026)
--
-- Decisões (conversa Bruno × Opus 5, 03/09/2026):
--
-- 1. REGRA 3+3 — o tipo de campanha só é habilitado com no mínimo 3 instâncias
--    de disparo ativas E 3 templates por instância ativa (4 números → 12
--    templates). Na criação da campanha a regra é a mesma, mas com associação
--    EXPLÍCITA: cada instância selecionada recebe a SUA lista de ≥3 templates
--    (é essa lista que a rotação percorre).
--
-- 2. ROTAÇÃO (Latin square) — na volta L, a instância na posição i usa o
--    template de índice (i + L) mod (nº de templates DAQUELA instância). Isso
--    dá volta 0 = (nº1,tpl1)(nº2,tpl2)(nº3,tpl3), volta 1 = (nº1,tpl2)
--    (nº2,tpl3)(nº3,tpl1)... — a combinação instância×template só se repete
--    depois de esgotar o ciclo daquela instância. A fila é materializada
--    ANTES (uma linha por lead, já com instância/template/volta resolvidos),
--    o worker só executa o que está agendado.
--
-- 3. DELAY — sorteio uniforme em [delay_min_ms, delay_max_ms] com resolução de
--    MILISSEGUNDO, gravado em `delay_ms` na própria linha da fila. Sorteios
--    independentes (sem tendência crescente/decrescente) e o app redesenha se
--    cair exatamente igual ao delay anterior da mesma campanha. Um item por
--    parceiro por vez — nunca dois números disparando junto.
--
-- 4. VISIBILIDADE — conversa criada por disparo NÃO entra na fila do
--    Atendimento enquanto o cliente não responder (senão a tela vira uma lista
--    de conversas que não existem). chat_conversas ganha origem + respondida;
--    o inbound do engine vira respondida=true e é AÍ que ela aparece. Abrir o
--    lead direto sempre mostra tudo, disparo incluso.
-- =============================================================================

-- 1. Visibilidade no Atendimento -------------------------------------------
alter table public.chat_conversas
  add column if not exists origem text not null default 'organica'
    check (origem in ('organica', 'disparo')),
  -- só faz sentido quando origem = 'disparo': marca que o cliente respondeu
  -- (e portanto a conversa passa a aparecer na fila do Atendimento).
  add column if not exists respondida boolean not null default false,
  add column if not exists respondida_em timestamptz null;

create index if not exists chat_conversas_disparo_idx
  on public.chat_conversas (origem, respondida) where origem = 'disparo';

-- 2. Instâncias participantes da campanha ----------------------------------
create table if not exists public.crm_campanha_disparo_instancias (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.crm_campanhas_parceiro (id) on delete cascade,
  instancia_id uuid not null references public.chat_instancias (id) on delete restrict,
  -- posição i no Latin square (0-based), define a ordem do rodízio
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  unique (campanha_id, instancia_id)
);
create index if not exists crm_campanha_disparo_instancias_campanha_idx
  on public.crm_campanha_disparo_instancias (campanha_id, ordem);

-- 3. Templates de CADA instância dentro da campanha ------------------------
create table if not exists public.crm_campanha_disparo_templates (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.crm_campanhas_parceiro (id) on delete cascade,
  instancia_id uuid not null references public.chat_instancias (id) on delete restrict,
  template_id uuid not null references public.crm_templates_mensagem (id) on delete restrict,
  -- posição do template na lista DAQUELA instância (0-based)
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  unique (campanha_id, instancia_id, template_id)
);
create index if not exists crm_campanha_disparo_templates_campanha_idx
  on public.crm_campanha_disparo_templates (campanha_id, instancia_id, ordem);

-- 4. Fila de disparo --------------------------------------------------------
create table if not exists public.crm_disparo_fila (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.crm_campanhas_parceiro (id) on delete cascade,
  -- denormalizado: o worker serializa POR PARCEIRO (um envio por vez no pool
  -- de números dele), então precisa filtrar por isso sem join.
  agente_parceiro_id uuid not null references public.agentes_parceiros (id),
  contato_id uuid null references public.crm_contatos (id) on delete set null,
  telefone_e164 text not null,
  instancia_id uuid not null references public.chat_instancias (id) on delete restrict,
  template_id uuid not null references public.crm_templates_mensagem (id) on delete restrict,
  -- posição da instância (i) e volta (L) que geraram este par — auditoria da
  -- rotação: dá pra provar que a combinação não repetiu antes da hora.
  posicao_instancia integer not null,
  volta integer not null,
  ordem_global integer not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'enviando', 'enviado', 'falhou', 'cancelado')),
  agendado_para timestamptz not null default now(),
  -- delay sorteado (ms) entre o item anterior e este; guardado pra auditoria e
  -- pra garantir que o próximo sorteio não saia idêntico.
  delay_ms integer null,
  tentativas integer not null default 0,
  enviado_em timestamptz null,
  chatwoot_conversation_id integer null,
  ultimo_erro text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_disparo_fila_worker_idx
  on public.crm_disparo_fila (agente_parceiro_id, status, agendado_para)
  where status in ('pendente', 'enviando');
create index if not exists crm_disparo_fila_campanha_idx
  on public.crm_disparo_fila (campanha_id, status, ordem_global);
-- um lead não entra duas vezes na mesma campanha de disparo
create unique index if not exists crm_disparo_fila_campanha_contato_idx
  on public.crm_disparo_fila (campanha_id, contato_id) where contato_id is not null;

drop trigger if exists set_timestamp on public.crm_disparo_fila;
create trigger set_timestamp before update on public.crm_disparo_fila
  for each row execute function trigger_set_timestamp();

-- 5. RLS — mesmo padrão do resto do CRM: tudo servido via service role com
--    filtro por parceiro na app; nenhuma policy pra authenticated.
alter table public.crm_campanha_disparo_instancias enable row level security;
alter table public.crm_campanha_disparo_templates enable row level security;
alter table public.crm_disparo_fila enable row level security;
