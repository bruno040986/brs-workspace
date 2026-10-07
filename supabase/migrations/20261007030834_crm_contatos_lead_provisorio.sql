-- Lead provisório com sincronização para o WeSales (Bruno, 07/10/2026).
--
-- O WeSales é a base de dados: TODO lead precisa existir lá. Até agora o CHECK
-- `crm_contatos_wesales_contact_id_obrigatorio` (20260825130000, NOT VALID)
-- recusava qualquer lead sem `wesales_contact_id` (23514), por isso "Criar
-- lead" do chat e o pré-cadastro da IA nunca funcionaram. Agora o CRM pode
-- gravar o lead PROVISÓRIO (`wesales_sync_status = 'pendente'`, sempre com
-- CPF) e o worker da fila `crm_wesales_queue` (operação `upsert_contato`) o
-- cria/vincula no WeSales e marca 'sincronizado'.
--
-- Contrato com o web/engine (nomes EXATOS):
--   crm_contatos.wesales_sync_status  'pendente' | 'sincronizado' | 'erro' | 'conflito'
--   crm_contatos.wesales_sync_erro    só um CÓDIGO (ex.: wesales_401,
--                                     cpf_divergente, dono_outro_parceiro),
--                                     NUNCA dados pessoais nem corpo de resposta
--   Sem id WeSales só com status pendente/erro/conflito; o padrão
--   'sincronizado' faz o código antigo continuar falhando como hoje (23514)
--   até o novo ser publicado.
--   Fila: no máximo UMA `upsert_contato` ativa (pendente/erro/processando)
--   por contato. Prazo da trava = `proximo_retry_em` (o worker grava
--   now() + 10 min ao travar e retoma `processando` vencido); sem coluna nova.
--
-- Unicidade preservada: `crm_contatos_wesales_contact_id_key` (id, vários NULL
-- permitidos) e `crm_contatos_cpf_unique_idx` (CPF na tabela inteira) NÃO mudam.
--
-- ORDEM DE PUBLICAÇÃO: esta migration ANTES do web (worker + "Criar lead") e do
-- engine (pré-cadastro da IA), que gravam as colunas novas.
--
-- Idempotente: pode rodar duas vezes sem efeito na segunda.

-- `set` (sessão), não `set local`: vale para toda a migration, com ou sem transação.
-- crm_contatos recebe escrita o tempo todo; falha rápido e dá para repetir.
set lock_timeout = '5s';

-- 1. Status de sincronização (default constante: sem reescrita da tabela).
alter table public.crm_contatos
  add column if not exists wesales_sync_status text not null default 'sincronizado',
  add column if not exists wesales_sync_erro text null;

alter table public.crm_contatos
  drop constraint if exists crm_contatos_wesales_sync_status_check;
alter table public.crm_contatos
  add constraint crm_contatos_wesales_sync_status_check
  check (wesales_sync_status in ('pendente', 'sincronizado', 'erro', 'conflito'));

comment on column public.crm_contatos.wesales_sync_status is
  'Sincronização com o WeSales: pendente (provisório na fila), sincronizado, erro, conflito (dono em outro parceiro / identidade divergente; decisão humana).';
comment on column public.crm_contatos.wesales_sync_erro is
  'Só um código do último erro de sincronização (ex.: wesales_401, cpf_divergente, dono_outro_parceiro). Nunca dados pessoais.';

-- 2. Linhas antigas sem id viram 'erro' (hoje 0 de 1161) e o CHECK passa a
--    aceitar provisórios. Num único DO (um só comando = atômico), para o CHECK
--    nunca ficar ausente entre o drop e o add. O UPDATE vem DEPOIS do drop: o
--    CHECK antigo (NOT VALID) recusaria o UPDATE de uma linha sem id.
--    VALIDADO (sem NOT VALID): todas as linhas atuais têm id. O filtro por
--    'sincronizado' evita sobrescrever provisórios se a migration for
--    repetida depois do web publicado.
do $$
begin
  alter table public.crm_contatos
    drop constraint if exists crm_contatos_wesales_contact_id_obrigatorio;

  update public.crm_contatos
     set wesales_sync_status = 'erro',
         wesales_sync_erro = coalesce(wesales_sync_erro, 'sem_wesales_contact_id')
   where wesales_contact_id is null
     and wesales_sync_status = 'sincronizado';

  alter table public.crm_contatos
    add constraint crm_contatos_wesales_contact_id_obrigatorio
    check (wesales_contact_id is not null
           or wesales_sync_status in ('pendente', 'erro', 'conflito'));
end
$$;

-- 3. Fila: uma única `upsert_contato` ativa por contato (o enfileiramento usa
--    ON CONFLICT DO NOTHING / trata 23505). ~19,5 mil linhas, 0 duplicadas
--    ativas (VERIFICADO 07/10): o índice é criado em instantes.
create unique index if not exists crm_wesales_queue_upsert_contato_ativo_uniq
  on public.crm_wesales_queue (contato_id)
  where operacao = 'upsert_contato' and status in ('pendente', 'erro', 'processando');

-- 4. Índice de coleta passa a cobrir `processando` (retomada de trava vencida
--    por `proximo_retry_em`). Substitui crm_wesales_queue_pendentes_idx, cujo
--    predicado (pendente, erro) está contido no novo.
create index if not exists crm_wesales_queue_ativos_idx
  on public.crm_wesales_queue (status, proximo_retry_em)
  where status in ('pendente', 'erro', 'processando');
drop index if exists public.crm_wesales_queue_pendentes_idx;

reset lock_timeout;
notify pgrst, 'reload schema';

-- ROLLBACK (manual; só com o web/engine antigos no ar). Provisórios que já
-- existirem continuam gravados (NOT VALID), mas qualquer UPDATE neles volta a
-- falhar com 23514 enquanto não ganharem id:
--   set lock_timeout = '5s';
--   create index if not exists crm_wesales_queue_pendentes_idx
--     on public.crm_wesales_queue (status, proximo_retry_em) where status in ('pendente', 'erro');
--   drop index if exists public.crm_wesales_queue_ativos_idx;
--   drop index if exists public.crm_wesales_queue_upsert_contato_ativo_uniq;
--   do $$ begin
--     alter table public.crm_contatos drop constraint if exists crm_contatos_wesales_contact_id_obrigatorio;
--     alter table public.crm_contatos add constraint crm_contatos_wesales_contact_id_obrigatorio
--       check (wesales_contact_id is not null) not valid;
--   end $$;
--   alter table public.crm_contatos
--     drop constraint if exists crm_contatos_wesales_sync_status_check,
--     drop column if exists wesales_sync_erro,
--     drop column if exists wesales_sync_status;
--   reset lock_timeout;
--   notify pgrst, 'reload schema';
