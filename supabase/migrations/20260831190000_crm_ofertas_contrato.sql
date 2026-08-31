-- REFIN é por CONTRATO: um lead pode ter 2+ contratos refinanciáveis na MESMA
-- tabela/prazo (caso real df3-3, 31/08/2026: 28 REFIN pra 22 leads). A
-- identidade antiga não distinguia contrato, então duas ofertas legítimas
-- colidiam no índice único e o INSERT em lote da alocação caía INTEIRO —
-- crm_ofertas ficava zerada e o menu Ofertas do CRM vazio.
alter table public.crm_ofertas add column if not exists contrato text null;

drop index if exists crm_ofertas_identidade_uidx;
create unique index crm_ofertas_identidade_uidx
  on public.crm_ofertas (
    contato_id,
    produto,
    coalesce(tabela_comissao_id::text, codigo_tabela_banco, ''),
    coalesce(prazo, 0),
    coalesce(contrato, '')
  ) where deleted_at is null;
