-- =============================================================================
-- BRS Messenger — mapa wa_id ↔ chatwoot_message_id (07/09/2026)
--
-- Achado na revisão da Entrega 1 do contrato de grupos, confirmado agora: o
-- recado de ack/reação/aparelho (RECADO-ENGINE-ACK-REACAO-APARELHO.md) supõe
-- "o engine já tem esse mapeamento pelo espelho/histórico próprio" — não tem.
-- `ChatwootConta.enviarMensagem` sempre devolveu `{ id }` (o id da mensagem no
-- Chatwoot), mas `espelharMensagemNaConversa` (bridge.ts) descartava esse
-- retorno. `history.ts` (chat_gravar_historico) é outra coisa — histórico
-- duro do CRM por conversa, sem relação com o id do Chatwoot.
--
-- Sem este mapa, três coisas do contrato são impossíveis: `in_reply_to`
-- (citação chega do WhatsApp com o wa_id — stanzaId — da mensagem original,
-- o Chatwoot quer o id dele), `quoted` no envio (o CRM só conhece o
-- chatwoot_message_id da mensagem que quer citar, o Baileys precisa do
-- wa_id + remote_jid + from_me pra montar a citação), e ack/reação (chegam do
-- Baileys com wa_id, as tabelas da Fase B são chaveadas por
-- chatwoot_message_id).
--
-- remote_jid e from_me existem só pra reconstruir um WAMessage mínimo na hora
-- de citar (Baileys pede { key: { remoteJid, id, fromMe }, message } — não
-- precisa do conteúdo, só da key pra montar o contextInfo da citação).
--
-- Cresce uma linha por mensagem espelhada, pra sempre — mesma observação já
-- feita em chat_atendimento_sinais (migration 20260903020000): sem expurgo
-- por ora, é hipótese de faxina futura, não bloqueia esta entrega.
-- =============================================================================

create table if not exists public.chat_mensagens_mapa (
  id uuid primary key default gen_random_uuid(),
  instancia_id uuid not null references public.chat_instancias (id) on delete cascade,
  conta_id uuid not null references public.chat_contas (id) on delete cascade,
  wa_id text not null,
  remote_jid text not null,
  from_me boolean not null,
  chatwoot_message_id integer not null,
  chatwoot_conversation_id integer not null,
  created_at timestamptz not null default now()
);

-- Resolver citação recebida (wa_id → chatwoot_message_id) é por instância:
-- o mesmo wa_id pode existir em instâncias diferentes.
create unique index if not exists chat_mensagens_mapa_wa_idx on public.chat_mensagens_mapa (instancia_id, wa_id);
-- Resolver `quoted`/ack/reação (chatwoot_message_id → wa_id) é global: quem
-- chama já sabe qual conversa/instância pelo lado do Chatwoot.
create unique index if not exists chat_mensagens_mapa_cw_idx on public.chat_mensagens_mapa (chatwoot_message_id);

alter table public.chat_mensagens_mapa enable row level security;
revoke all on public.chat_mensagens_mapa from public, anon, authenticated;
grant select, insert, update, delete on public.chat_mensagens_mapa to service_role;

notify pgrst, 'reload schema';
