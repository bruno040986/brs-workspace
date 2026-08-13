-- Migração: coluna is_active para modelos de e-mail e WhatsApp do SCP
-- Data: 2026-07-27
--
-- As telas "Modelos de E-mails" e "Modelos de WhatsApp" passaram a ter uma
-- lista (tabela) com ação de Ativar/Inativar. Adicionamos a coluna booleana
-- `is_active` (default TRUE) para suportar esse estado sem apagar o modelo.
--
-- Aditiva e segura (default TRUE => todos os modelos existentes continuam
-- ativos). Ainda assim, aplicar com acompanhamento (banco de produção).

ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.whatsapp_templates
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

NOTIFY pgrst, 'reload schema';
