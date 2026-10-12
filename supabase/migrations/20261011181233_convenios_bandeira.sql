-- ============================================================================
-- Convênios — bandeira (PRJ-1/T-21, ajuste)
-- A bandeira passa a ter card próprio, ao lado de logotipo e brasão (proporção
-- livre, recomendado 3:2). Arquivo no bucket público `convenios-publico`
-- ({convenio_id}/bandeira-{uuid}.{ext}); o banco guarda a URL pública.
-- Aditivo: o tipo 'bandeira' da galeria continua aceito por compatibilidade.
-- ============================================================================

alter table public.convenios add column if not exists bandeira_url text null;

notify pgrst, 'reload schema';
