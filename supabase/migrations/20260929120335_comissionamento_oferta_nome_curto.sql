-- Comissionamento fatia 1: oferta (texto livre), nome curto da forma de contrato e
-- tolerância de juros por IF. ADITIVA (nada removido, `nome` legado intocado).
-- Reversão: alter table ... drop column oferta / nome_curto / tolerancia_juros_auto_pp.

alter table public.tabelas_comissao
  add column if not exists oferta text null
    check (oferta is null or char_length(btrim(oferta)) between 1 and 40);

comment on column public.tabelas_comissao.oferta is
  'Rótulo curto livre da oferta/tabela (ex.: "Oferta 1", "Tab 2"). Sem catálogo. Entra na descrição gerada.';
comment on column public.tabelas_comissao.nome is
  'Nome como veio do banco/ARW (legado). Exibição usa a descrição gerada.';

alter table public.formas_contrato
  add column if not exists nome_curto text null
    check (nome_curto is null or char_length(btrim(nome_curto)) between 1 and 30);

comment on column public.formas_contrato.nome_curto is
  'Abreviação para a descrição gerada da tabela; nulo = usa o nome completo.';

alter table public.financial_institutions
  add column if not exists tolerancia_juros_auto_pp numeric(5, 2) not null default 0.50
    check (tolerancia_juros_auto_pp >= 0);

comment on column public.financial_institutions.tolerancia_juros_auto_pp is
  'Variação máxima (pontos percentuais) de juros aceita em atualização automática.';

-- Backfill determinístico da oferta (só onde ainda é nula; nome nunca é alterado).
update public.tabelas_comissao t
   set oferta = 'Oferta ' || substring(t.nome from '(?i)(\d+)\s*oferta')
  from public.financial_institutions fi
 where fi.id = t.institution_id and fi.name = 'Banco Santander'
   and t.oferta is null and t.nome ~* '\d+\s*oferta';

update public.tabelas_comissao t
   set oferta = 'Tab ' || substring(t.nome from '(?i)tabela\s*(\d+)')
  from public.financial_institutions fi
 where fi.id = t.institution_id and fi.name = 'Banco Daycoval'
   and t.oferta is null and t.nome ~* 'tabela\s*\d+';

-- Único nome curto sem ambiguidade; demais formas usam o nome completo (fallback).
update public.formas_contrato
   set nome_curto = 'Novo'
 where lower(btrim(nome)) = 'empréstimo novo' and nome_curto is null;

notify pgrst, 'reload schema';
