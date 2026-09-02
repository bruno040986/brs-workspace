-- "Cadastro de Leads em lote" (decisão 02/09/2026): tela separada, insert-only
-- — nunca atualiza/sobrescreve contato já existente — usa a MESMA tabela de
-- auditoria de importações (histórico único), só mais um tipo.
alter table public.crm_imports drop constraint if exists crm_imports_tipo_check;
alter table public.crm_imports add constraint crm_imports_tipo_check check (tipo in ('refin', 'margem', 'elegibilidade', 'cadastro'));
