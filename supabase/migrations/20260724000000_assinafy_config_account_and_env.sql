-- Migração: Assinafy — account_id e ambiente
-- Data: 2026-07-24
--
-- A tabela assinafy_config guardava apenas a api_key. A API da Assinafy escopa
-- quase todos os endpoints por conta de workspace:
--
--   POST /v1/accounts/{accountId}/documents      (upload do PDF)
--   POST /v1/accounts/{accountId}/signers        (criar signatários)
--   PUT  /v1/accounts/{accountId}/webhooks/subscriptions
--
-- Sem o account_id a integração não sai do lugar. O ambiente permite desenvolver
-- contra o sandbox (sandbox.assinafy.com.br) sem consumir créditos de produção
-- nem disparar convites de assinatura reais.
--
-- NÃO APLICADA. Revisar e rodar com acompanhamento.

ALTER TABLE IF EXISTS assinafy_config
  ADD COLUMN IF NOT EXISTS account_id TEXT;

ALTER TABLE IF EXISTS assinafy_config
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'production';

-- Só os dois ambientes que a Assinafy expõe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'assinafy_config_environment_check'
  ) THEN
    ALTER TABLE assinafy_config
      ADD CONSTRAINT assinafy_config_environment_check
      CHECK (environment IN ('sandbox', 'production'));
  END IF;
END $$;

-- Segredo compartilhado para validar a origem dos webhooks recebidos.
ALTER TABLE IF EXISTS assinafy_config
  ADD COLUMN IF NOT EXISTS webhook_secret TEXT;

COMMENT ON COLUMN assinafy_config.account_id IS
  'ID da conta de workspace na Assinafy (Minha Conta → Workspaces). Obrigatório para chamar a API.';
COMMENT ON COLUMN assinafy_config.environment IS
  'sandbox = https://sandbox.assinafy.com.br | production = https://api.assinafy.com.br';
COMMENT ON COLUMN assinafy_config.webhook_secret IS
  'Segredo usado para validar que um webhook recebido veio mesmo da Assinafy.';

NOTIFY pgrst, 'reload schema';
