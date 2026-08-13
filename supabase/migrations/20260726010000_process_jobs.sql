-- Migração: process_jobs — fila durável do motor de execução do SCP
-- Data: 2026-07-26
--
-- O coração do motor: cada trabalho a executar (entrar em etapa, rodar ação,
-- checar assinatura, avançar etapa) vira uma linha aqui. Drenada por um cron.
--
-- Idempotência: dedupe_key UNIQUE impede enfileirar/executar a mesma ação 2x.
-- Retentativa: attempts/max_attempts + run_after (backoff) reagendam falhas.
-- Retomável: sobrevive a reinícios; nada se perde entre execuções do cron.
--
-- Acesso só por service role (cron/ações). RLS ligada sem políticas.
-- NÃO APLICADA. Revisar e rodar com acompanhamento (produção).

CREATE TABLE IF NOT EXISTS process_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID REFERENCES process_instances(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed', 'canceled')),
  run_after TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  locked_at TIMESTAMP WITH TIME ZONE,
  locked_by TEXT,
  last_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Idempotência: uma ação com a mesma dedupe_key nunca é enfileirada duas vezes.
CREATE UNIQUE INDEX IF NOT EXISTS process_jobs_dedupe_uniq
  ON process_jobs (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND dedupe_key <> '';

-- Índice do loop do cron: pega pendentes vencidos em ordem.
CREATE INDEX IF NOT EXISTS process_jobs_due_idx ON process_jobs (status, run_after);
CREATE INDEX IF NOT EXISTS process_jobs_instance_idx ON process_jobs (instance_id);

ALTER TABLE process_jobs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trigger_set_timestamp') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_timestamp_process_jobs') THEN
      CREATE TRIGGER set_timestamp_process_jobs
      BEFORE UPDATE ON process_jobs
      FOR EACH ROW
      EXECUTE FUNCTION trigger_set_timestamp();
    END IF;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
