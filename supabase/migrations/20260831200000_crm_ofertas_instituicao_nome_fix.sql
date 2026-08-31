-- Acerto de dados: as REFIN criadas antes do fix do casamento de tabela
-- (código "827004875 - 1 Oferta..." virava "8270048751" e nunca casava)
-- ficaram com o rótulo "Instituição não identificada", apesar de terem o
-- instituicao_id correto. Preenche o nome real a partir do cadastro de IFs.
update public.crm_ofertas o
set instituicao_nome = fi.name
from public.financial_institutions fi
where o.instituicao_id = fi.id
  and o.instituicao_nome = 'Instituição não identificada'
  and o.deleted_at is null;
