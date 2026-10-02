-- Republica crm_chat_mensagens no Realtime (02/10/2026).
--
-- A migration 20260922205308 tirou a tabela da publicação `supabase_realtime`
-- por "nenhum código assina" — engano: o Chat Interno do CRM AlvoConsig
-- (apps/web/src/components/crm/chat-interno/ChatInterno.tsx) assina INSERT em
-- crm_chat_mensagens (lista de canais e canal aberto). Sem publicação o evento
-- nunca chega, sem erro visível; o chat só atualizava no poll. Medido em
-- 02/10/2026: pg_publication_tables sem nenhuma tabela crm_chat_*.
-- A policy de SELECT para membros (crm_chat_mensagens_select_membro, migration
-- 20260903010000) continua existindo; não precisa recriar. Idempotente.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crm_chat_mensagens'
  ) then
    alter publication supabase_realtime add table public.crm_chat_mensagens;
  end if;
end $$;
