# YCloud + Mercado Pago — fatos verificados na documentação oficial

Verificação em 26/09/2026 via fetch das páginas `.md` de docs.ycloud.com e da doc
do Mercado Pago. Reler antes de codificar cada fatia (APIs mudam). O download
bruto das páginas foi bloqueado pelas permissões da sessão; este arquivo
consolida o que foi extraído, com a URL de origem de cada bloco. Não substituem
a página viva — em divergência, a doc vence.

## Autenticação e base
Fonte: https://docs.ycloud.com/reference/authentication.md
- Base `https://api.ycloud.com/v2`, header `X-API-Key`.
- Chave única gerada em Dashboard › Developers; a doc não descreve escopos nem
  múltiplas chaves por conta. **Lacuna: confirmar na conta real se dá para ter
  mais de uma chave (afeta rotação).**

## Rate limits
Fonte: https://docs.ycloud.com/reference/rate-limits.md
- `POST /v2/whatsapp/messages`: **200 rps por remetente (número)**.
- `sendDirectly`: 80 rps por remetente (fora da v1).
- Management API (balance, webhookEndpoints, businessAccounts, phoneNumbers,
  templates): **200 rps e 10.000 req/hora por conta** — o sync de
  saúde/templates precisa respeitar o teto horário.
- 429 com headers `Retry-After`, `RateLimit-Limit/Remaining/Reset/Policy`.

## Formato de erro
Fonte: https://docs.ycloud.com/reference/errors.md
- `{ "error": { status, code, message, target?, docUrl?, requestId } }`.
- Códigos relevantes: `UNAUTHORIZED` (401), `BALANCE_INSUFFICIENT` (403),
  `RECIPIENT_UNSUBSCRIBED` (403), `TOO_MANY_REQUESTS` (429), `PARAM_INVALID`,
  `PARAM_MISSING`, `NOT_FOUND`, `FORBIDDEN`.
- Header `YCloud-Request-ID` em toda resposta (guardar em log de falha).

## Envio (enqueue)
Fonte: https://docs.ycloud.com/reference/whatsapp_message-send.md
- `POST /v2/whatsapp/messages`. Campos: `from` (E.164), exatamente um de
  `to` (E.164) ou `recipient` (BSUID/parent BSUID), `type`
  (template|text|image|audio|video|document|sticker|location|interactive|
  contacts|reaction), objeto do tipo, `context.message_id` (reply),
  `externalId`, `filterUnsubscribed` (default false), `filterBlocked`
  (default false), `customerProfile`.
- Resposta 200: objeto WhatsappMessage com `id`, `status: 'accepted'`
  ("aceito pelo nosso sistema" — NÃO é entregue), `wamid` (pode vir depois),
  `wabaId`, `createTime` (RFC 3339).
- **`externalId` é literalmente "A unique (recommended) string to reference
  the object … used to reconcile the object with your internal systems". A doc
  NÃO documenta deduplicação nem idempotência para este endpoint.** Portanto:
  externalId = correlação; idempotência é 100% nossa (ledger).
- `useDirectSend`/`category`/`ttlSeconds` existem (Direct Send) — fora da v1.

## Status de envio (webhook whatsapp.message.updated)
Fonte: https://docs.ycloud.com/reference/whatsapp-message-updated-webhook-examples.md
- Envelope comum: `id` (do evento), `type`, `apiVersion: 'v2'`, `createTime`.
- `whatsappMessage`: `id`, `wamid`, `externalId`, `recipientUserId`,
  `parentRecipientUserId`, `customerProfile`, `status`
  (accepted|sent|delivered|read|failed), `bizType`, `type`, timestamps
  (`sendTime`, `deliverTime`, `readTime`), `totalPrice`, `currency`,
  `pricingCategory`, `pricingModel` ("PMP"), `pricingType`, e em falha
  `errorCode`, `errorMessage`, `whatsappApiError`.
- A doc diz explicitamente que **a ordem das notificações NÃO é garantida** e
  eventos podem se sobrepor (ex.: `delivered` depois de `failed`).
- Preço: estimado até `delivered`; final em `delivered/read`; `failed` sem
  cobrança.

## Recebimento (webhook whatsapp.inbound_message.received)
Fonte: https://docs.ycloud.com/reference/whatsapp-inbound-message-webhook-examples.md
- `whatsappInboundMessage`: `id`, `wamid`, `from` (telefone SEM '+'), `to`
  (número empresarial), `fromUserId` (BSUID, formato `US.…`),
  `fromParentUserId`, `customerProfile {name, username}`, `type`, campo do
  tipo, `sendTime` (ISO 8601), `context` (reply).
- **Mídia inbound**: URL acessível sem auth por poucos minutos; com header
  `X-API-Key` o download vale **30 dias**. Baixar sempre com a chave, nunca
  confiar na janela sem auth.

## BSUID
Fonte: https://docs.ycloud.com/reference/webhook-updates-bsuid.md
- Vigente desde 31/03/2026. Campos novos opcionais: `fromUserId`,
  `fromParentUserId`, `recipientUserId`, `parentRecipientUserId`,
  `customerProfile.username`; em troca de número, `system.user_id`.
- Recomendações da doc: tratar campos como opcionais, armazenar BSUID quando
  presente, **não assumir que o telefone é o único identificador estável**.
- `recipient` no envio aceita BSUID no lugar de `to` — pode haver contato sem
  telefone exposto. Nunca derivar E.164 de um BSUID.

## Webhook: assinatura, retries, endpoints
Fonte: https://docs.ycloud.com/reference/webhook-integration-guide.md
- Header `YCloud-Signature: t={unix_seconds},s={hex}`;
  `s = HMAC-SHA256(secret, "{t}.{corpo bruto}")`.
- Responder 2xx; recomendação < 6 s ("lentas >10 s podem ser despriorizadas").
- Retentativas em não-2xx: 10s → 30s → 5m → 30m → 1h → 2h → 2h (7 tentativas).
- **Máximo 20 endpoints por conta**; URL ≤ 500 chars.
- Header `X-Webhook-Endpoint-ID` presente (correlação, não substitui assinatura).

Fonte: https://docs.ycloud.com/reference/webhook_endpoint-create.md
- `POST /v2/webhookEndpoints` `{url, enabledEvents[], description?, status?}`.
- **A resposta da criação já traz o `secret`** ("used to generate webhook
  signatures"), além de `id`, `status` (active|disabled|pending).
- Eventos relevantes para a v1: `whatsapp.inbound_message.received`,
  `whatsapp.message.updated`, `whatsapp.phone_number.quality_updated`,
  `whatsapp.phone_number.name_updated`, `whatsapp.phone_number.deleted`,
  `whatsapp.template.reviewed`, `whatsapp.template.quality_updated`,
  `whatsapp.template.category_updated`, `whatsapp.business_account.updated`,
  `whatsapp.business_account.deleted`. (Existem 35+ tipos, inclusive grupos,
  chamadas, `whatsapp.smb.history`/`whatsapp.smb.message.echoes` para
  coexistência — fora da v1.)
- Rotação: `POST /v2/webhookEndpoints/{id}/rotateSecret`.

## Número: saúde e limites
Fonte: https://docs.ycloud.com/reference/whatsapp_phone_number-retrieve.md
- `qualityRating`: GREEN | YELLOW | RED | UNKNOWN.
- `messagingLimit` (por número): TIER_NOT_SET | TIER_50 | TIER_250 | TIER_1K |
  TIER_10K | TIER_100K | TIER_UNLIMITED — máx. de conversas iniciadas pela
  empresa em janela móvel de 24 h.
- `whatsappBusinessManagerMessagingLimit`: TIER_NOT_SET | TIER_50 | TIER_250 |
  **TIER_2K** | TIER_10K | TIER_100K | TIER_UNLIMITED. **Desde 07/10/2025 o
  limite é calculado por PORTFÓLIO empresarial e compartilhado por todos os
  números do portfólio.** É este o campo do controle externo; o por-número é
  informativo/legado.
- `status` (13 estados, ex. PENDING, CONNECTED, FLAGGED, BANNED), `nameStatus`
  (APPROVED, DECLINED, EXPIRED, PENDING_REVIEW, NONE,
  AVAILABLE_WITHOUT_REVIEW), `verifiedName`, `isOfficialBusinessAccount`,
  `updateEvent` (ACCOUNT_RECONNECTED|ACCOUNT_OFFBOARDED), `qualityUpdateEvent`
  (ONBOARDING|UPGRADE|DOWNGRADE|FLAGGED|UNFLAGGED), `wabaId`.

## Templates
Fonte: https://docs.ycloud.com/reference/whatsapp_template-list.md
- `GET /v2/whatsapp/templates` com `filter.wabaId`, `filter.name`,
  `filter.language`, `filter.status`; paginação por página (`page` ≤ 100,
  `limit` 1–100, `includeTotal`).
- Template: `name`, `language`, `category` (AUTHENTICATION|MARKETING|UTILITY),
  `status` (PENDING|APPROVED|REJECTED|PAUSED|DISABLED|ARCHIVED|IN_APPEAL|
  DELETED), `qualityRating` (GREEN|YELLOW|RED|UNKNOWN), `components[]`
  (HEADER|BODY|FOOTER|BUTTONS). **Escopo: por WABA.**

## Preços
Fonte: https://docs.ycloud.com/reference/whatsapp-message-pricing-integration-guide.md
- `pricingCategory`: marketing | utility | authentication | service |
  referral_conversion. `pricingModel`: sempre "PMP" (per-message). 
- `pricingType`: `regular` (cobrada), `free_customer_service` (janela de
  atendimento, 0), `free_entry_point` (janela 72 h de entry point, categoria
  `referral_conversion`, 0).
- Final somente em delivered/read; accepted/sent = estimado; failed = sem
  cobrança.
- **Regra a partir de out/2026: 1.000 mensagens de serviço entregues grátis
  por número/mês; utility na janela deixa de ser automaticamente grátis.**
  Impacto direto na estimativa de custo de campanha — tabela de preço precisa
  de vigência.

## Mídia (upload para envio)
Fonte: https://docs.ycloud.com/reference/whatsapp_media-upload.md
- `POST /v2/whatsapp/media/{phoneNumber}/upload` (E.164 na rota — escopo por
  número), multipart campo `file`, um arquivo por chamada.
- Resposta: `{id}` (media id, sem URL). Arquivo persiste **30 dias**.
- Limites de tamanho: delegados à doc da Meta (Supported Media Types).
- Media id não vale para header de mensagem interativa (usar link).

## Mercado Pago (assinaturas)
Fonte: https://www.mercadopago.com.br/developers/pt/docs/subscriptions/overview
- Assinatura com ou sem plano; sem plano tem dois modos: **pending** (gera
  link de pagamento/init_point) e **authorized** (cartão tokenizado →
  `card_token` via SDK JS, cobrança automática).
- Estados do preapproval: pending | authorized | paused | cancelled.
- Trial: parâmetro de `trial_days`/free trial na configuração da recorrência.
- Webhooks: tópicos `subscription_preapproval`,
  `subscription_authorized_payment`, `payment`.
- **LACUNA F0 → F4:** as páginas de referência detalhada
  (`/reference/subscriptions/_preapproval/post` e a página de webhooks)
  retornaram 404 no fetch desta sessão. Antes da F4: reverificar na doc viva
  os campos exatos do preapproval (`auto_recurring.free_trial`,
  `card_token_id`, `external_reference`, `back_url`), o suporte a
  `X-Idempotency-Key` e o manifest do `x-signature` para assinaturas. O padrão
  de validação `x-signature` (`ts`,`v1`, manifest id+x-request-id+ts) já está
  implementado e em produção no grupo em
  `brs-portal-parceiro/src/app/api/webhooks/mercadopago/route.ts` — usar como
  referência de partida.
