-- Fixture para *_chat_anuncio_ocorrencias.sql (Workspace). COPIAR para
-- brs-alvoconsig/tests/db/anuncio-lead-fixture.sql. Roda ANTES da migration;
-- tests/db/anuncio-lead.sql roda DEPOIS. Sobre o bootstrap.sql do CRM e as
-- migrations anteriores da lista do test-db.mjs (crm_solicitacoes_operacionais,
-- agentes_ia_fundacao com chat_conversas.origem_anuncio, saude com crm_perfis).
-- Só dados sintéticos (ids 0006, nenhum telefone/CPF real).
-- Em scripts/test-db.mjs: sufixo 'chat_anuncio_ocorrencias' no fim de `sufixos`,
-- fixtures._chat_anuncio_ocorrencias = 'tests/db/anuncio-lead-fixture.sql' e
-- suíte nova ['tests/db/anuncio-lead.sql'].

-- Colunas que a migration lê e o bootstrap não tem (com default: não quebra os INSERT antigos)
alter table public.chat_conversas add column if not exists created_at timestamptz not null default now();
alter table public.crm_contatos add column if not exists created_at timestamptz not null default now();

-- propostas_credito mínima (colunas e CHECKs de produção que o relatório usa)
create table if not exists public.propostas_credito (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid null,
  contato_id uuid null references public.crm_contatos (id) on delete set null,
  status text not null default 'criada' check (status in ('simulando', 'criada', 'aguardando_assinatura', 'aguardando_aprovacao', 'aguardando_liberacao_interna', 'pendente', 'aguardando_pagamento', 'paga', 'cancelada', 'erro')),
  grupo text null check (grupo in ('em_andamento', 'pendente', 'pago', 'cancelado')),
  valor_liquido numeric null,
  finalizada_em timestamptz null,
  data_pagamento_cliente date null,
  created_at timestamptz not null default now()
);

-- Perfis globais (mesmos ids das outras fixtures)
insert into public.crm_perfis values
  ('00000000-0000-0000-0000-0000000000a1', null, 'master'),
  ('00000000-0000-0000-0000-0000000000a2', null, 'operacional'),
  ('00000000-0000-0000-0000-0000000000a3', null, 'atendente')
on conflict do nothing;

-- Parceiros A e B
insert into public.agentes_parceiros values
  ('00000000-0000-0000-0006-000000000001'), ('00000000-0000-0000-0006-000000000002')
on conflict do nothing;
insert into public.chat_instancias (id, agente_parceiro_id) values
  ('00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-000000000001'),
  ('00000000-0000-0000-0006-0000000000a2', '00000000-0000-0000-0006-000000000001'),
  ('00000000-0000-0000-0006-0000000000b1', '00000000-0000-0000-0006-000000000002');

-- Conversa antiga com origem_anuncio (alvo do backfill), criada em T-5d
insert into public.chat_conversas (id, instancia_id, origem_anuncio, created_at) values
  ('00000000-0000-0000-0006-0000000002a9', '00000000-0000-0000-0006-0000000000a1',
   '{"fonte":"ctwa","source_type":"ad","source_id":"AD_BACK","source_url":"https://www.instagram.com/p/x","headline":"Teste","body":"Corpo","media_type":"image","ctwa_clid":"clid-back","tem_miniatura":true,"thumbnail_url":"https://x.fbcdn.net/t.jpg"}',
   timestamptz '2026-09-01 12:00+00' - interval '5 days');
