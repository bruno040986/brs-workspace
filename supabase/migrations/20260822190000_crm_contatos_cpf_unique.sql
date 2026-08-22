-- CPF é a identidade do contato no CRM AlvoConsig (histórico vinculado ao
-- contato, não à instância). Índice único viabiliza upsert por CPF no
-- importador de mailing. Nullable: contatos sem CPF continuam permitidos
-- (unique ignora NULLs).
drop index if exists public.crm_contatos_cpf_idx;
create unique index if not exists crm_contatos_cpf_unique_idx
  on public.crm_contatos (cpf);
