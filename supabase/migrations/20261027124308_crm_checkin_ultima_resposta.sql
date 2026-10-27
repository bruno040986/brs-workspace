-- Check-in de anúncio: regra das 2 horas (decisão do Bruno, 2026-10-27).
--  1. Check-in respondido some e só volta a ser pedido 2 h depois da ÚLTIMA resposta (ou confirmação); passadas as
--     2 h as perguntas voltam a ser pedidas no MESMO ciclo (o atendente confirma as respostas atuais ou corrige).
--  2. Encerrar a conversa exige (re)confirmar o check-in no momento do encerramento, mesmo dentro das 2 h.
--
-- CONTRATO (o que o web do CRM pode assumir):
--  * crm_anuncio_checkins.ultima_resposta_em timestamptz (nulo = nunca respondido): carimbada pelo trigger abaixo a
--    cada resposta REAL gravada pela RPC crm_anuncio_checkin_responder (oportunidade/tipos/venda/margem/refin), e
--    pelo web (update direto, service_role) quando o atendente CONFIRMA as respostas atuais sem mudar nada.
--  * A RPC crm_anuncio_checkin_responder e a fila crm_meta_eventos NÃO mudam: a repetição a cada 2 h é no mesmo
--    ciclo, então continua no máximo 1 QualifiedLead e 1 Purchase por ciclo (event_id brs:<ciclo>:ql/:purchase);
--    confirmar não toca eventos; corrigir segue a regra de sempre (motivo, autoria, 7 dias, nunca reenviar).
--    Ciclo novo (novos eventos) só com clique CTWA novo depois do encerramento do ciclo (P4), como antes.
--  * O web sem esta coluna continua com a regra antiga (detecta 42703 e cai para o comportamento anterior).
--
-- ORDEM DE PUBLICAÇÃO: pode subir antes ou depois do web (o web novo funciona com e sem a coluna; o web antigo ignora).
-- ROLLBACK: supabase/rollback/20261027124308_crm_checkin_ultima_resposta_rollback.sql (o web novo volta à regra antiga).
-- Idempotente: pode rodar duas vezes sem efeito na segunda. RLS/grants não mudam (tabela só service_role).

-- `supabase db push` não roda a migration em transação: `set local` não vale.
set lock_timeout = '5s';

alter table public.crm_anuncio_checkins add column if not exists ultima_resposta_em timestamptz null;
comment on column public.crm_anuncio_checkins.ultima_resposta_em is
  'Última resposta OU confirmação do check-in (nulo = nunca respondido). O check-in volta a ser pedido 2 h depois dela; o encerramento da conversa exige confirmação recente. Carimbada pelo trigger crm_anuncio_checkin_ultima_resposta_trg e pela confirmação do web.';

-- Backfill: ciclos já respondidos ganham a data da resposta mais recente (greatest ignora nulos).
update public.crm_anuncio_checkins
   set ultima_resposta_em = greatest(oportunidade_em, venda_em, margem_em, refin_em)
 where ultima_resposta_em is null
   and coalesce(oportunidade_em, venda_em, margem_em, refin_em) is not null;

-- Carimbo automático: só quando uma resposta realmente mudou (a RPC regrava todas as colunas no update).
create or replace function app_private.crm_anuncio_checkin_ultima_resposta()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.oportunidade_em is distinct from old.oportunidade_em
     or new.oportunidade_tipos is distinct from old.oportunidade_tipos
     or new.venda_em is distinct from old.venda_em
     or new.margem_em is distinct from old.margem_em
     or new.refin_em is distinct from old.refin_em then
    new.ultima_resposta_em := now();
  end if;
  return new;
end $$;
revoke all on function app_private.crm_anuncio_checkin_ultima_resposta() from public, anon, authenticated;

drop trigger if exists crm_anuncio_checkin_ultima_resposta_trg on public.crm_anuncio_checkins;
create trigger crm_anuncio_checkin_ultima_resposta_trg
  before update of oportunidade_em, oportunidade_tipos, venda_em, margem_em, refin_em on public.crm_anuncio_checkins
  for each row execute function app_private.crm_anuncio_checkin_ultima_resposta();
