# 📋 Recado aditivo para a sessão do CRM/engine — ack, reação e "aparelho" (Fase B do Messenger)

Complementa `RECADO-ENGINE-GRUPOS-BRS-MESSENGER.md` (§ espelho no Chatwoot).
Migration do Workspace `20260907022722_brs_messenger_fase_b.sql` criou as
tabelas que o engine grava (service role, mesmo Supabase). Tudo aditivo.

## Tabelas (gravar direto, service role)

```
public.chat_mensagem_status   (chatwoot_message_id int PK, conta_id uuid, status text, atualizado_em timestamptz)
  status ∈ 'enviado' | 'entregue' | 'lido' | 'falhou'   — UPSERT por chatwoot_message_id; só avança
  (enviado→entregue→lido; 'falhou' sobrescreve qualquer um). Fonte: Baileys `messages.update` (status 2/3/4 / erro).

public.chat_mensagem_reacoes  (id uuid, chatwoot_message_id int, conta_id uuid, jid text, emoji text, created_at)
  unique (chatwoot_message_id, jid) — UPSERT ao reagir/trocar; DELETE quando a reação é removida
  (Baileys `messages.reaction` com emoji vazio). Fonte: reaction do WhatsApp.
```

`conta_id` = `chat_contas.id` da instância. `chatwoot_message_id` = id da
mensagem espelhada no Chatwoot (o engine já tem o mapeamento wa_id ↔ chatwoot
id pelo espelho/histórico próprio).

## `content_attributes` no espelho (aditivo)

- `origem: 'aparelho'` em mensagem **fromMe sem operation_id nosso** (enviada
  pelo celular). **Guarda de eco = lista de origens** (`['engine','aparelho']`),
  como vocês já prepararam — o Workspace NUNCA usa `!== 'engine'` como critério
  (regra fixada no roteiro da Fase B).
- `in_reply_to: <chatwoot_message_id da citada>` quando a mensagem recebida
  cita outra (o Chatwoot já entende o campo); `mentions: [jid]` quando
  menciona.
- `sender` em grupo já está na Entrega 1 — obrigado.

## O que o Workspace faz com isso
Render de ✓/✓✓/lido/falhou, reações sob a bolha, "Dispositivo externo" em
itálico, preview da citada. Nada de polling extra: entra na leitura de
mensagens que já existe. Avisem commit + deploy quando publicarem.

## Adendo — `in_reply_to` também na SAÍDA (frente g, "responder citando")

O Workspace agora manda `content_attributes: { in_reply_to: <chatwoot_message_id
da citada> }` no `POST /conversations/:id/messages` quando o atendente responde
citando uma bolha (contrato privado Workspace↔engine — não é campo documentado
do Chatwoot, mas ele grava o objeto verbatim). Pra citação aparecer de fato no
WhatsApp do cliente (não só na nossa thread), o engine precisa, no caminho de
ENVIO (mensagem outgoing vinda do Chatwoot pro Baileys):

1. Ler `content_attributes.in_reply_to` do payload do Chatwoot.
2. Resolver o `wa_id`/`key` da mensagem citada (mesmo mapeamento wa_id ↔
   chatwoot_message_id que vocês já mantêm pro espelho/histórico).
3. Passar como `quoted` (`{ key, message }` da mensagem original) no `sendMessage`
   do Baileys.

Se o `chatwoot_message_id` citado não for encontrado no mapeamento (ex.: mensagem
fora da janela de histórico do engine), enviar normal sem `quoted` — a citação
visual já fica preservada do lado do Workspace independente disso.
