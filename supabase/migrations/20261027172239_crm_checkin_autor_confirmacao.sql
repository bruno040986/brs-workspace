-- Check-in de anúncio: auditoria da confirmação (revisão da regra das 2 h, 2026-10-27).
-- O botão "Confirmar respostas" (action confirmarCheckin do web) só carimbava ultima_resposta_em; agora grava também
-- QUEM confirmou e QUANDO, no mesmo update.
--
-- CONTRATO (o que o web do CRM pode assumir):
--  * crm_anuncio_checkins.ultima_confirmacao_por uuid (mesmo tipo/FK de oportunidade_por/venda_por) e
--    ultima_confirmacao_em timestamptz: nulos = nunca confirmado pelo botão. Gravadas só pelo web (service_role),
--    junto de ultima_resposta_em. Respostas reais seguem com autoria em oportunidade_por/venda_por (RPC).
--  * Nada mais muda: RPC crm_anuncio_checkin_responder, trigger da regra das 2 h e fila crm_meta_eventos intactos.
--  * O web sem estas colunas repete o update só com ultima_resposta_em (detecta 42703/PGRST204).
--
-- ORDEM DE PUBLICAÇÃO: pode subir antes ou depois do web.
-- ROLLBACK: supabase/rollback/20261027172239_crm_checkin_autor_confirmacao_rollback.sql
-- Idempotente: pode rodar duas vezes sem efeito na segunda. RLS/grants não mudam (tabela só service_role).

-- `supabase db push` não roda a migration em transação: `set local` não vale.
set lock_timeout = '5s';

alter table public.crm_anuncio_checkins
  add column if not exists ultima_confirmacao_por uuid null references public.crm_usuarios (id) on delete set null,
  add column if not exists ultima_confirmacao_em timestamptz null;

comment on column public.crm_anuncio_checkins.ultima_confirmacao_por is
  'Quem clicou em "Confirmar respostas" por último (auditoria; nulo = nunca confirmado pelo botão).';
comment on column public.crm_anuncio_checkins.ultima_confirmacao_em is
  'Quando foi a última confirmação pelo botão "Confirmar respostas" (auditoria).';
