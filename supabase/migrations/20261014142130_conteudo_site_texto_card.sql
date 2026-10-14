-- ============================================================================
-- Landing do convênio — subtexto do card de /consignado-municipal|estadual
-- `texto_card`: texto puro (máx. 160, validado na aplicação). Null = o site usa o texto padrão.
-- Aditivo, sem backfill. RPC de publicar e trigger de updated_at não mudam.
-- ============================================================================

alter table public.convenio_conteudo_site
  add column if not exists texto_card text null;

notify pgrst, 'reload schema';
