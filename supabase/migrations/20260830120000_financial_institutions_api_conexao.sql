-- Conexão de API por instituição financeira (decisão 30/08/2026):
-- { disponivel, simulacao, digitacao, propostas, tabela_comissao, relatorio_comissao }.
-- O CRM AlvoConsig mostra a IF em "API Instituições Financeiras" quando
-- simulacao ou digitacao = true.
alter table public.financial_institutions
  add column if not exists api_conexao jsonb not null default '{}'::jsonb;
