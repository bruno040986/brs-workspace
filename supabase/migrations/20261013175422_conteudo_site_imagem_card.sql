-- ============================================================================
-- Landing do convênio — imagem própria do card de /solucoes/consignado-*
-- `imagem_card_url`: URL pública do bucket convenios-publico (validada na aplicação, 2:1 recomendado 1200 × 600)
-- `imagem_card_alt`: texto alternativo opcional
-- Aditivo, sem backfill: versões antigas ficam com null e o card segue no fallback
-- (logotipo → brasão → foto Prédio da galeria). Sem mudança na RPC de publicar (ela só
-- vira flags e grava o snapshot) nem no trigger de updated_at (compara a linha inteira).
-- ============================================================================

alter table public.convenio_conteudo_site
  add column if not exists imagem_card_url text null,
  add column if not exists imagem_card_alt text null;

notify pgrst, 'reload schema';
