# Disparo de WhatsApp (Z-API)

Subsistema do setor **Comercial** para campanhas de WhatsApp em massa, sobre a integração real com a Z-API.

## Integração Z-API (`src/lib/zapi/`)

| Módulo | Função |
|---|---|
| `client.ts` | `ZapiClient` — `send-text`, `send-image`, `send-document/{ext}`, `send-audio`, `send-contact`, `send-button-list`, `status`, `me`, `device`, `update-webhook-*`. Sempre envia `Client-Token` + `Content-Type`. |
| `phone.ts` | `normalizeBrPhone` → `55` + DDD + número (12–13 dígitos), `formatBrPhone`. |
| `format.ts` | `renderTemplate({{var}})`, `renderPartnerTags` (tags do parceiro), `composeButtonMessage`. |
| `instances.ts` | Acesso a `zapi_instances` (multi-instância; padrão = `is_default`). |
| `send.ts` | `sendAndLog` — **único ponto de saída**; grava `wa_outbound_messages`. |
| `webhooks.ts` | Classifica webhooks do `/me` (nosso / externo / vazio), planeja e aplica mudanças; modo **relay** repassa ao ARW. |
| `webhook-processor.ts` | Processa `MessageStatusCallback` (entregue/lida), `DeliveryCallback`, `ReceivedCallback` (opt-out), conexão. |

Configuração: **Configurações → API WhatsApp** (`/rh/parceiros/config/provedores/whatsapp`) — lista de instâncias, testar conexão, mensagem de teste, painel de webhooks.

Usos do client fora das campanhas: WhatsApp de boas-vindas do parceiro (`executePartnerAutomation('whatsapp')`) e handler `send_whatsapp` do motor SCP.

## Campanhas

- Rotas: `/disparo-whatsapp` (dashboard), `/disparo-whatsapp/nova` (wizard 3 passos), `/disparo-whatsapp/[id]` (detalhe), `/disparo-whatsapp/optouts`.
- Permissão: `comercial-disparo-whatsapp` (seed para quem tem `comercial-agentes`/`comercial-estrutura`/`workspace-com`).
- Tabelas: `wa_campaigns`, `wa_campaign_templates` (blocos de rotação), `wa_campaign_slots` (lotes), `wa_campaign_recipients` (fila durável), `wa_optouts`, `wa_webhook_events`, `wa_outbound_messages`. Contadores mantidos por trigger; `wa_campaign_recount(id)` para recontar.
- Mídia: bucket privado `wa-campaign-media` (upload via `/api/disparo-whatsapp/upload`, URL assinada 3h gerada na hora do envio).

### Worker

`/api/cron/wa-campaigns` (cron a cada minuto + kick imediato ao iniciar/retomar; `maxDuration 300`; auth `Bearer CRON_SECRET`).

Por execução: promove agendadas → recupera `sending` travados (>3 min → `failed`) → para cada instância com campanha em execução: lock otimista (`zapi_instances.worker_lock_*`), checa `status` da instância, loop: pacing (`next_send_at`), round-robin de campanhas, gate (janela/dias/lotes), claim atômico (`wa_claim_next_recipient`), opt-out, template (rotação por `position`), envio (principal → contato → botão anti-ban), persiste, delay aleatório. Sai antes do budget e solta o lock.

Falhas: 5 consecutivas → campanha pausada; instância offline → campanhas da instância pausadas.

### Verificação

```
npx tsc src/lib/zapi/phone.ts src/lib/zapi/format.ts src/lib/disparo-whatsapp/schedule.ts \
  src/lib/disparo-whatsapp/recipients.ts src/lib/disparo-whatsapp/types.ts \
  --outDir /tmp/wa-build --module commonjs --target ES2020 --moduleResolution node --skipLibCheck --esModuleInterop
BUILD_DIR=/tmp/wa-build node scripts/verify-disparo-whatsapp.js
```

### Env necessárias

`CRON_SECRET`, `NEXT_PUBLIC_APP_URL` (URL pública para webhooks e kick), `SUPABASE_SERVICE_ROLE_KEY`.
