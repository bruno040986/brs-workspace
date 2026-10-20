-- PRJ-2 T-2: convênio do link de entrada (o engine resolve o convênio da conversa a partir dele).
-- Idempotente. Nulo = sem convênio fixo (o engine tenta pelo que o lead informou, depois pelo único ativo).
alter table public.crm_links_entrada
  add column if not exists convenio_id uuid null references public.convenios (id) on delete set null;
