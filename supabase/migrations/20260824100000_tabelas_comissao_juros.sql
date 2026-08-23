-- Taxa de juros na Tabela de Comissão (pedido Bruno 24/08/2026).
-- Não existe no ARW — informação própria do Workspace. Tipos: fixa (um campo)
-- ou faixa (mín/máx, ex.: portabilidade). Percentual ao mês, 4 casas.

alter table public.tabelas_comissao
  add column if not exists taxa_juros_tipo text null
    check (taxa_juros_tipo is null or taxa_juros_tipo in ('fixa', 'faixa')),
  add column if not exists taxa_juros numeric(8, 4) null,
  add column if not exists taxa_juros_min numeric(8, 4) null,
  add column if not exists taxa_juros_max numeric(8, 4) null;

notify pgrst, 'reload schema';
