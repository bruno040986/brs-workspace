-- =============================================================================
-- BRS Messenger — participant_jid no mapa wa_id ↔ chatwoot_message_id
-- (07/09/2026, revisão Fable da Fase B)
--
-- Limitação apontada pelo engine (recado 07/09, item 4): `quoted` em GRUPO de
-- mensagem de terceiro sai sem `participant` porque o mapa não guarda o jid
-- de quem mandou — o Baileys precisa de key.participant pra montar a citação
-- de mensagem alheia em grupo (o caso mais comum de "responder citando").
--
-- Aditivo e nulo por padrão: o engine passa a gravar quando remote_jid é
-- grupo e from_me=false; linhas antigas ficam null (quoted sai sem
-- participant nelas, como hoje). Nada no Workspace lê esta coluna.
-- =============================================================================

alter table public.chat_mensagens_mapa
  add column if not exists participant_jid text null;

comment on column public.chat_mensagens_mapa.participant_jid is
  'JID do remetente quando a mensagem é de terceiro em grupo (key.participant do Baileys para quoted). Null fora de grupo, em fromMe e em linhas anteriores a 07/09/2026.';

notify pgrst, 'reload schema';
