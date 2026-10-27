-- ROLLBACK MANUAL de 20261027124308_crm_checkin_ultima_resposta (NÃO é migration: rodar à mão no SQL editor).
-- Efeito: o web novo detecta a coluna ausente (42703) e volta à regra antiga do check-in; o web antigo não usa a coluna.
-- Não toca respostas, ciclos nem eventos da Meta. Idempotente.
-- Depois de rodar, para o `supabase db push` não reaplicar: `supabase migration repair --status reverted 20261027124308`
-- (ou remover o arquivo da migration do repo), conforme o fluxo da publicação.
set lock_timeout = '5s';
drop trigger if exists crm_anuncio_checkin_ultima_resposta_trg on public.crm_anuncio_checkins;
drop function if exists app_private.crm_anuncio_checkin_ultima_resposta();
alter table public.crm_anuncio_checkins drop column if exists ultima_resposta_em;
