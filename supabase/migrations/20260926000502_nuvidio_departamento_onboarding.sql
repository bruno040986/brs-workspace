-- Nuvidio: dois departamentos distintos.
--  * department_padrao_*      → atendimento de clientes de empréstimo (Criar Link)
--  * department_onboarding_*  → cadastro de parceiros (etapa Nuvidio dos Cadastros Recebidos)
-- Antes só havia o "padrão", usado pelos dois fluxos. Na data desta migration o
-- padrão estava vazio em produção, então não há backfill.
alter table public.nuvidio_config
  add column if not exists department_onboarding_id text not null default '',
  add column if not exists department_onboarding_nome text not null default '';
