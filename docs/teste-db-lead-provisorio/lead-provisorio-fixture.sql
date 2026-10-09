-- Fixture para *_crm_contatos_lead_provisorio.sql (Workspace). COPIAR para
-- brs-alvoconsig/tests/db/lead-provisorio-fixture.sql. Roda ANTES da migration;
-- tests/db/lead-provisorio.sql roda DEPOIS. Sobre o bootstrap.sql do CRM.
--
-- ATENÇÃO: rodar numa SUÍTE PRÓPRIA (prefixo + este fixture + migration +
-- asserções), NÃO no prefixo comum: o CHECK de id obrigatório faria as suítes
-- antigas que inserem crm_contatos sem wesales_contact_id (agentes-ia.sql,
-- history.sql) falharem com 23514, como em produção.
--
-- Reproduz de produção (VERIFICADO em pg_constraint/pg_indexes, 07/10/2026) o
-- que o bootstrap não tem e a migration lê: unicidade de id e de CPF, o CHECK
-- antigo NOT VALID (20260825130000) e a fila crm_wesales_queue (20260822130000
-- + checks atuais). Colunas novas com default para não quebrar os INSERT
-- posicionais do bootstrap.
alter table public.crm_contatos
  add column if not exists origem text not null default 'alocacao'
    check (origem in ('alocacao', 'receptivo', 'manual', 'ia'));
alter table public.crm_contatos
  add constraint crm_contatos_wesales_contact_id_key unique (wesales_contact_id);
create unique index crm_contatos_cpf_unique_idx on public.crm_contatos (cpf);

insert into public.agentes_parceiros (id) values
  ('00000000-0000-0000-0007-000000000001'),
  ('00000000-0000-0000-0007-000000000002');

-- Linhas "legadas" ANTES do CHECK NOT VALID: a1 com id, a2 sem id (cenário que
-- hoje não existe em produção, mas a migration precisa tratar).
insert into public.crm_contatos (id, agente_parceiro_id, cpf, wesales_contact_id, nome, telefone) values
  ('00000000-0000-0000-0007-0000000000a1', '00000000-0000-0000-0007-000000000001', '00000000001', 'ws-legado-1', 'Pessoa sintética 1', '5511000007001'),
  ('00000000-0000-0000-0007-0000000000a2', '00000000-0000-0000-0007-000000000001', '00000000002', null, 'Pessoa sintética 2', '5511000007002');

alter table public.crm_contatos
  add constraint crm_contatos_wesales_contact_id_obrigatorio
  check (wesales_contact_id is not null) not valid;

create table public.crm_wesales_queue (
  id uuid primary key default gen_random_uuid(),
  operacao text not null,
  contato_id uuid null references public.crm_contatos (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pendente'
    check (status in ('pendente', 'processando', 'concluido', 'erro', 'descartado')),
  tentativas integer not null default 0,
  proximo_retry_em timestamptz not null default now(),
  ultimo_erro text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_wesales_queue_operacao_check check (operacao in (
    'upsert_contato','atualizar_dono','atualizar_campo','mover_estagio','mover_oferta',
    'adicionar_nota','aplicar_tag','remover_tag','sincronizar_estagio','sincronizar_atendimento'))
);
create index crm_wesales_queue_pendentes_idx
  on public.crm_wesales_queue (status, proximo_retry_em)
  where status in ('pendente', 'erro');
-- Histórico concluído duplicado para o mesmo contato (como em produção): não
-- pode impedir a criação do índice único parcial.
insert into public.crm_wesales_queue (operacao, contato_id, status) values
  ('upsert_contato', '00000000-0000-0000-0007-0000000000a1', 'concluido'),
  ('upsert_contato', '00000000-0000-0000-0007-0000000000a1', 'concluido'),
  ('upsert_contato', '00000000-0000-0000-0007-0000000000a1', 'descartado');
