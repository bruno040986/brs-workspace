-- Migração: Documentos da Assinafy + caixa de entrada de webhooks
-- Data: 2026-07-26
--
-- Persiste cada documento gerado na Assinafy (vínculo com o parceiro/processo,
-- status, links de assinatura) para que o webhook e a reconciliação por polling
-- saibam qual registro atualizar quando as assinaturas avançam.
--
-- Acesso apenas por service role (webhook e ações server-side). RLS ligada sem
-- políticas = nega acesso direto de clientes; o service role ignora RLS.
--
-- NÃO APLICADA. Revisar e rodar com acompanhamento (banco de produção).

-- =========================================================================
-- 1. assinafy_documents — um registro por documento gerado
-- =========================================================================

CREATE TABLE IF NOT EXISTS assinafy_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id TEXT UNIQUE NOT NULL,
  partner_id UUID REFERENCES agentes_parceiros(id) ON DELETE SET NULL,
  process_instance_id UUID REFERENCES process_instances(id) ON DELETE SET NULL,
  template_id TEXT,
  template_name TEXT,
  environment TEXT,
  status TEXT,
  signers JSONB NOT NULL DEFAULT '[]'::jsonb,
  signing_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_event TEXT,
  last_event_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS assinafy_documents_partner_id_idx ON assinafy_documents(partner_id);
CREATE INDEX IF NOT EXISTS assinafy_documents_status_idx ON assinafy_documents(status);
CREATE INDEX IF NOT EXISTS assinafy_documents_process_instance_idx ON assinafy_documents(process_instance_id);

ALTER TABLE assinafy_documents ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- 2. assinafy_webhook_inbox — dedup + auditoria dos eventos recebidos
-- =========================================================================

CREATE TABLE IF NOT EXISTS assinafy_webhook_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT,
  event TEXT,
  document_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed BOOLEAN NOT NULL DEFAULT false,
  received_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- external_id é a chave de deduplicação (o `id` do envelope do webhook).
CREATE UNIQUE INDEX IF NOT EXISTS assinafy_webhook_inbox_external_id_uniq
  ON assinafy_webhook_inbox (external_id)
  WHERE external_id IS NOT NULL AND external_id <> '';

CREATE INDEX IF NOT EXISTS assinafy_webhook_inbox_document_id_idx ON assinafy_webhook_inbox(document_id);

ALTER TABLE assinafy_webhook_inbox ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- 3. Trigger de updated_at (reusa trigger_set_timestamp se existir)
-- =========================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trigger_set_timestamp') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_timestamp_assinafy_documents') THEN
      CREATE TRIGGER set_timestamp_assinafy_documents
      BEFORE UPDATE ON assinafy_documents
      FOR EACH ROW
      EXECUTE FUNCTION trigger_set_timestamp();
    END IF;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
