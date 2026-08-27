-- Horário de expediente do atendente (CRM AlvoConsig), preenchido pelo
-- parceiro master na tela de Configurações > Atendentes.
-- Formato: { "dias": [1..7] (1=domingo..7=sábado), "inicio": "HH:MM", "fim": "HH:MM" }
-- ou null quando não configurado (sem restrição de horário).
alter table public.crm_usuarios
  add column if not exists horario_expediente jsonb null;
