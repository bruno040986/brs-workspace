-- ROLLBACK MANUAL de 20261027172239_crm_checkin_autor_confirmacao (NÃO é migration: rodar à mão no SQL editor).
-- Efeito: perde o registro de quem/quando confirmou; o web novo detecta as colunas ausentes (42703/PGRST204) e
-- volta a gravar só ultima_resposta_em. Não toca respostas, ciclos, ultima_resposta_em nem eventos da Meta. Idempotente.
-- Depois de rodar, para o `supabase db push` não reaplicar: `supabase migration repair --status reverted 20261027172239`
-- (ou remover o arquivo da migration do repo), conforme o fluxo da publicação.
set lock_timeout = '5s';
alter table public.crm_anuncio_checkins
  drop column if exists ultima_confirmacao_por,
  drop column if exists ultima_confirmacao_em;
