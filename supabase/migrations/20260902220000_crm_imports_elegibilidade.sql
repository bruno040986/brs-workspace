-- "Elegibilidade" vira um 3º tipo de importação em Importações (decisão
-- 02/09/2026): equivalente à Importação de Bases/Motor de Crédito, mas
-- genérico pra qualquer convênio, não só CLT — confirmação de elegibilidade
-- de crédito por instituição financeira, sem margem/oferta calculada.
alter table public.crm_imports drop constraint if exists crm_imports_tipo_check;
alter table public.crm_imports add constraint crm_imports_tipo_check check (tipo in ('refin', 'margem', 'elegibilidade'));
