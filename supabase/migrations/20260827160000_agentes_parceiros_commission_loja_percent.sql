-- Coluna referenciada pelo código (src/lib/agente-corban.ts, campo "Percentual
-- de Comissão Loja") desde 03/07/2026, mas nunca criada no banco — qualquer
-- save do Agente Corban falhava com "Could not find the 'commission_loja_percent'
-- column of 'agentes_parceiros' in the schema cache", mesmo editando campos
-- sem relação (o upsert envia o registro inteiro de uma vez).
-- Percentual guardado como sequência de dígitos em centésimos (ex.: "300" =
-- 3,00%), mesmo padrão de normalizePercentDigits/formatPercentValue.
alter table public.agentes_parceiros
  add column if not exists commission_loja_percent text null;
