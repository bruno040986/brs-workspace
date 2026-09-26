-- Cadastros Recebidos v2 — Fatia 4: etapa "Limite Operacional" entre ARW e
-- Contrato (decisão do Bruno, 25/09/2026). Valor padrão R$ 1.000.000,00,
-- aprovação com autor, data e justificativa quando diferente do padrão. O
-- valor também fica no agente (limite vigente): o aditivo futuro parte dele.
alter table public.corban_onboarding_processos
  drop constraint if exists corban_onboarding_processos_etapa_atual_check;
alter table public.corban_onboarding_processos
  add constraint corban_onboarding_processos_etapa_atual_check
  check (etapa_atual in ('validacao','analise','nuvidio','arw','limite','contrato','termo','boas_vindas','concluido'));

alter table public.corban_onboarding_processos
  add column if not exists limite_operacional numeric(14,2) null,
  add column if not exists limite_justificativa text null,
  add column if not exists limite_aprovado_por uuid null,
  add column if not exists limite_aprovado_em timestamptz null;

alter table public.agentes_parceiros
  add column if not exists limite_operacional numeric(14,2) null;

notify pgrst, 'reload schema';
