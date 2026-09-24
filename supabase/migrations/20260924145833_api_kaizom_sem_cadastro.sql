-- API Kaizom — NVTI orientada, não automática (decisão do Bruno 24/09/2026).
-- "Verificar cadastros no WeSales" carimba `wesales_verificado_em` e grava
-- `wesales_contact_id` quando o CPF já é contato; "Enviar" só grava margem em
-- quem tem contato — linha aprovada sem contato vira `sem_cadastro` (nunca
-- cria contato "nu"). Quem tem permissão da NVTI pode submeter os
-- `sem_cadastro` a um lote nvti_batches (custo explícito no aviso).
alter table public.motor_credito_consultas
  add column if not exists wesales_verificado_em timestamptz;

alter table public.motor_credito_consultas drop constraint if exists motor_credito_consultas_status_check;
alter table public.motor_credito_consultas add constraint motor_credito_consultas_status_check
  check (status in ('pendente', 'aprovada', 'rejeitada', 'falha', 'sem_cadastro', 'enviando', 'enviada', 'erro_envio'));

notify pgrst, 'reload schema';
