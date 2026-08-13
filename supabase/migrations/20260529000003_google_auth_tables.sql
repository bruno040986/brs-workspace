-- Migration: Armazenamento de tokens do Google OAuth2
-- Data: 2026-05-29

CREATE TABLE IF NOT EXISTS user_google_auth (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_vinculado TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expiry_date TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(user_id)
);

-- Configurações globais do Google (para não usar apenas ENV)
CREATE TABLE IF NOT EXISTS system_google_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Inserir registro inicial vazio se não existir
INSERT INTO system_google_config (client_id, client_secret)
SELECT '', ''
WHERE NOT EXISTS (SELECT 1 FROM system_google_config);
