-- Migration para suporte a recargas de instâncias na Central de Conversas (BRS Workspace)
-- Torna agente_parceiro_id opcional na tabela chat_instancia_recargas, já que as instâncias BRS pertencem ao owner_tipo 'brs'.

alter table public.chat_instancia_recargas
  alter column agente_parceiro_id drop not null;

notify pgrst, 'reload schema';
