-- Biblioteca padrão do sistema para templates de WhatsApp não oficial.
-- Linhas globais em crm_templates_mensagem: agente_parceiro_id NULL + sistema = true
-- (mesmo precedente de crm_perfis). Parceiro "usa" copiando: origem_template_id aponta
-- para a linha do sistema (on delete set null). Aditiva e idempotente.
--
-- O QUE TESTAR (banco):
--  1. insert com sistema=true e agente_parceiro_id NOT NULL  -> viola crm_templates_mensagem_sistema_parceiro_chk
--  2. insert com sistema=false e agente_parceiro_id NULL     -> viola o mesmo check
--  3. dois sistema=true com a mesma chave (deleted_at nulo, arquivado ou não) -> viola crm_templates_mensagem_chave_sistema_idx;
--     com um deles deleted_at preenchido, passa
--  4. categoria com > 60 caracteres                          -> viola o check de categoria
--  5. linhas existentes de parceiro seguem válidas (sistema=false, parceiro preenchido)
-- arquivado_em: arquivar template do SISTEMA grava só isto (ativo=true e deleted_at NULL).
-- Linhas do sistema em uso por fila/composição/campanhas em andamento não podem ficar
-- inativas nem excluídas (cron/worker/voz recusam ativo=false ou deleted_at). Arquivada =
-- some da biblioteca para novas cópias, mas segue enviável. Continua ocupando a chave no
-- índice único (deleted_at nulo), então o seed reaplicado não a duplica.
-- RLS: policy SELECT existente (alvoconsig-gestao/can_view) não filtra por parceiro, então já
-- enxerga as linhas globais; o CRM usa service role. Nenhum ajuste de policy necessário.

alter table public.crm_templates_mensagem
  add column if not exists categoria text null,
  add column if not exists sistema boolean not null default false,
  add column if not exists arquivado_em timestamptz null,
  add column if not exists chave text null,
  add column if not exists origem_template_id uuid null
    references public.crm_templates_mensagem (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_templates_mensagem_categoria_len_chk') then
    alter table public.crm_templates_mensagem
      add constraint crm_templates_mensagem_categoria_len_chk
      check (categoria is null or char_length(categoria) <= 60);
  end if;
end $$;

alter table public.crm_templates_mensagem alter column agente_parceiro_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_templates_mensagem_sistema_parceiro_chk') then
    alter table public.crm_templates_mensagem
      add constraint crm_templates_mensagem_sistema_parceiro_chk
      check (sistema = (agente_parceiro_id is null)) not valid;
  end if;
end $$;
-- linhas existentes: sistema=false e parceiro preenchido, então valida sem surpresa
alter table public.crm_templates_mensagem validate constraint crm_templates_mensagem_sistema_parceiro_chk;

create unique index if not exists crm_templates_mensagem_chave_sistema_idx
  on public.crm_templates_mensagem (chave) where sistema and deleted_at is null;
create index if not exists crm_templates_mensagem_categoria_idx
  on public.crm_templates_mensagem (categoria);
create index if not exists crm_templates_mensagem_sistema_canal_idx
  on public.crm_templates_mensagem (sistema, canal) where deleted_at is null;

-- SEED: ver migration seguinte

notify pgrst, 'reload schema';
