-- ============================================================================
-- Landing do convênio — públicos em destaque (cards por público atendido)
-- `publicos_destaque`: array (máx. 8) de
--   { publico_id uuid (publicos_atendidos.id do convênio), titulo text (≤60),
--     texto text (≤300), imagem_url text|null (URL pública do bucket convenios-publico) }
-- Validação de shape fica na aplicação (validarRuntimePayload); aqui só array e tamanho.
-- Sem FK (jsonb): público desvinculado/inativo é descartado na montagem do snapshot.
-- Aditivo: versões antigas ficam com '[]'.
-- ============================================================================

alter table public.convenio_conteudo_site
  add column if not exists publicos_destaque jsonb not null default '[]'::jsonb;

alter table public.convenio_conteudo_site drop constraint if exists convenio_conteudo_site_publicos_destaque_check;
alter table public.convenio_conteudo_site add constraint convenio_conteudo_site_publicos_destaque_check
  check (jsonb_typeof(publicos_destaque) = 'array' and jsonb_array_length(publicos_destaque) <= 8);

notify pgrst, 'reload schema';
