-- APLICADA em produção em 06/11/2026 pelo dono (editor SQL do Supabase; não consta em supabase_migrations). Arquivo preservado para o repositório refletir o banco.
-- Etapa 1 — índices dos filtros e dos totais do dashboard.
--
-- CREATE INDEX comum (sem CONCURRENTLY): o `supabase db push` roda cada arquivo numa
-- transação e CONCURRENTLY não roda em transação. Hoje é seguro: propostas_credito 336 kB
-- (26 linhas), crm_solicitacoes_operacionais 504 kB (214) -> o lock SHARE (bloqueia escrita,
-- não leitura) dura milissegundos. Se alguma tabela passar de ~100 mil linhas antes de aplicar:
-- rodar cada CREATE INDEX CONCURRENTLY IF NOT EXISTS à mão (psql, fora de transação) ANTES do
-- push; aqui o IF NOT EXISTS vira no-op.
--
-- Totais do dashboard por grupo e mês (nunca por nome de status: grupo/status são códigos):
--   pago       -> propostas grupo='pago' por data_pagamento_cliente no mês      [índice novo]
--   cancelada  -> propostas grupo='cancelado' por finalizada_em no mês          [índice novo]
--               solicitações status='cancelado' por concluido_em no mês         [índice novo]
--   pendente/andamento -> TODOS os abertos, sem mês: propostas_esteira_idx (tenant, grupo,
--               data_atualizacao) já existe; solicitações: crm_solicitacoes_op_abertas_idx já existe
--   parados > N dias (crm_parceiro_config.dias_sem_atualizacao) -> mesmo propostas_esteira_idx
--               com grupo in ('em_andamento','pendente') and data_atualizacao < now() - N dias
-- Filtros IF/convênio/forma/vínculo/atendente: com dezenas de linhas por tenant o índice do
-- tenant basta; idx_prop_credito_if/forma e propostas_atendente_idx já existem. Índice por
-- filtro só quando um tenant passar de ~10 mil propostas (medir com EXPLAIN antes).

-- Linha do tempo do caso (view crm_casos_linha_tempo junta propostas por solicitacao_id;
-- hoje só existe o índice parcial de "proposta viva")
create index if not exists propostas_credito_solicitacao_idx
  on public.propostas_credito (solicitacao_id) where solicitacao_id is not null;

create index if not exists propostas_pagas_mes_idx
  on public.propostas_credito (agente_parceiro_id, data_pagamento_cliente)
  where grupo = 'pago';

create index if not exists propostas_canceladas_mes_idx
  on public.propostas_credito (agente_parceiro_id, finalizada_em)
  where grupo = 'cancelado';

create index if not exists crm_solicitacoes_op_canceladas_mes_idx
  on public.crm_solicitacoes_operacionais (agente_parceiro_id, concluido_em)
  where status = 'cancelado';

