-- ============================================================================
-- Landing do convênio — FAQ da Base de Conhecimento ocultável
-- A landing publica a UNIÃO de (a) FAQ ativo da Base de Conhecimento do convênio
-- (faq_itens próprios do convênio + gerais vinculados em convenio_faq_vinculos),
-- menos os ids listados aqui, e (b) as perguntas só da landing (`faqs` jsonb).
-- `faq_ocultas`: ids de faq_itens ocultados NESTA versão do conteúdo. Sem FK
-- (array); id que deixou de existir é simplesmente ignorado na publicação.
-- Aditivo: versões antigas ficam com '{}' (= mostram toda a base).
-- ============================================================================

alter table public.convenio_conteudo_site
  add column if not exists faq_ocultas uuid[] not null default '{}';

notify pgrst, 'reload schema';
