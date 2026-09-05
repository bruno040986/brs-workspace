-- ---------------------------------------------------------------------------
-- Solicitação operacional (simulação / digitação) como REGISTRO PRÓPRIO
-- (plano AlvoConsig, seção 7). Hoje o pedido de simulação vive só como
-- mensagem do chat interno (crm_chat_mensagens.tipo='solicitacao_simulacao'),
-- o que descumpre "não depender de encontrar uma mensagem pra recuperar o
-- trabalho operacional" e inviabiliza o painel por escopo.
--
-- Revisão Fable sobre o rascunho do Sonnet (05/09):
--  * contato_id era NOT NULL sem `on delete` — o expurgo legado de campanha
--    (crm_campanha_encerrar apaga crm_contatos) falharia na primeira
--    solicitação existente. Agora é nullable + set null, e a identidade
--    estável fica em relacionamento_id (crm_relacionamentos, que sobrevive
--    ao expurgo — preencher via crm_assegurar_relacionamento na criação).
--  * oferta_id idem: crm_ofertas cascateia com o contato → set null; o
--    snapshot_condicoes é justamente pra não depender da oferta existir.
--  * updated_at que faltava; eventos ganham índice.
--
-- Estados: solicitado → em_atendimento → (aguardando_informacoes ⇄
-- em_atendimento) → respondido | cancelado. tempo_aguardando_ms acumula
-- TODO período em aguardando_informacoes; reatribuir não zera nada (plano:
-- "não apagar atrasos ao reatribuir"). Assumir é compare-and-swap na app:
--   update ... set atribuido_a=$u, status='em_atendimento'
--     where id=$id and atribuido_a is null returning id;
--
-- Painel por escopo é consulta, não tabela: atendente = solicitado_por=$eu;
-- operacional = status em aberto do tenant; master = tudo do tenant.
-- Acesso só via service_role com filtro de parceiro na app (padrão do CRM).
-- ---------------------------------------------------------------------------
create table public.crm_solicitacoes_operacionais (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id),
  tipo text not null check (tipo in ('simulacao', 'digitacao')),
  status text not null default 'solicitado'
    check (status in ('solicitado', 'em_atendimento', 'aguardando_informacoes', 'respondido', 'cancelado')),
  -- cópia de campanha (temporária) e identidade estável (sobrevive ao expurgo)
  contato_id uuid null references public.crm_contatos (id) on delete set null,
  relacionamento_id uuid null references public.crm_relacionamentos (id),
  solicitado_por uuid not null references public.crm_usuarios (id),
  atribuido_a uuid null references public.crm_usuarios (id),
  -- digitação: oferta escolhida + snapshot das condições aceitas NA HORA
  oferta_id uuid null references public.crm_ofertas (id) on delete set null,
  snapshot_condicoes jsonb null,
  -- simulação: produto/parcela/prazo/banco/observação (mesmo payload da mensagem de hoje)
  payload jsonb not null default '{}'::jsonb,
  -- aviso no chat só notifica; o registro é este
  canal_chat_interno_id uuid null references public.crm_chat_canais (id) on delete set null,
  mensagem_chat_id uuid null references public.crm_chat_mensagens (id) on delete set null,
  criado_em timestamptz not null default now(),
  primeira_resposta_em timestamptz null,
  concluido_em timestamptz null,
  aguardando_desde timestamptz null,
  tempo_aguardando_ms bigint not null default 0 check (tempo_aguardando_ms >= 0),
  updated_at timestamptz not null default now(),
  check (relacionamento_id is not null or contato_id is not null)
);
create index crm_solicitacoes_op_parceiro_idx
  on public.crm_solicitacoes_operacionais (agente_parceiro_id, status, criado_em desc);
create index crm_solicitacoes_op_abertas_idx
  on public.crm_solicitacoes_operacionais (agente_parceiro_id, atribuido_a, criado_em)
  where status in ('solicitado', 'em_atendimento', 'aguardando_informacoes');
create index crm_solicitacoes_op_solicitante_idx
  on public.crm_solicitacoes_operacionais (solicitado_por, criado_em desc);
alter table public.crm_solicitacoes_operacionais enable row level security;
revoke all on public.crm_solicitacoes_operacionais from public, anon, authenticated;
grant select, insert, update on public.crm_solicitacoes_operacionais to service_role;

-- Histórico de transições (métricas "reproduzíveis pelos eventos", plano seção 7).
create table public.crm_solicitacoes_eventos (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.crm_solicitacoes_operacionais (id) on delete cascade,
  agente_parceiro_id uuid not null references public.agentes_parceiros (id),
  autor_crm_usuario_id uuid null references public.crm_usuarios (id) on delete set null,
  status_de text null,
  status_para text not null,
  atribuido_de uuid null,
  atribuido_para uuid null,
  nota text null,
  created_at timestamptz not null default now()
);
create index crm_solicitacoes_eventos_idx on public.crm_solicitacoes_eventos (solicitacao_id, created_at);
alter table public.crm_solicitacoes_eventos enable row level security;
revoke all on public.crm_solicitacoes_eventos from public, anon, authenticated;
grant select, insert on public.crm_solicitacoes_eventos to service_role;
