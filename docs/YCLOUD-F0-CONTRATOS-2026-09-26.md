# YCloud — F0: inventário, ADRs e contratos executáveis

Data: 26/09/2026. Autor: Fable (sessão F0). Base: PLANO-YCLOUD-CLAUDE-CODE-
REVISADO-2026-09-26.md (autoridade técnica) + PLANO-YCLOUD-WHATSAPP-OFICIAL-
2026-09-26.md (decisões comerciais). Fatos da API em
`docs/ycloud/FATOS-VERIFICADOS-2026-09-26.md` (URLs + data).

Este documento é o contrato para F1–F6 e S0–S3. Divergência descoberta na
implementação volta aqui como ADR revisado, não é resolvida em silêncio.

---

## 1. Inventário do código atual (evidências, 26/09)

### Engine (`brs-alvoconsig/services/engine/src/`)
- **Não existe interface de adapter.** Provedor é `if` sobre `inst.provedor`
  em pontos enumerados (§4.1). Tipo em `db.ts:16` (`'baileys'|'zapi'`);
  CHECK no banco em `20260829180000_chat_integrado.sql:42`.
- Envio: só `POST /instancias/:id/enviar` (`server.ts:130-360`), Bearer
  `ENGINE_API_TOKEN`. Fluxo: instância → gate durável → ledger (leitura) →
  destino → conversa Chatwoot ANTES do envio → `claimSend` → provedor →
  `confirmarTroca` → espelho → `finishSend`.
- Ledger: `chat_envios_operacoes` (PK `instancia_id, operation_id`;
  `fingerprint` sha256 canônico; estados processing|completed|uncertain;
  **sem lease/TTL** — `processing` preso responde 409 `DELIVERY_UNCERTAIN`
  até reconciliar). Código em `send-operation.ts`.
- Inbox durável: `chat_engine_jobs` (UNIQUE `source,scope,event_key`; RPCs
  `chat_engine_claim/renew/finish`; worker 1 job por vez, lease 120 s,
  backoff `2^attempts` teto 300 s; `sends_external` falho vira `uncertain`).
  Gate: `ENGINE_DURABLE_EVENTS` **e** conta em `ENGINE_DURABLE_ACCOUNT_IDS`
  (`durable-policy.ts`/`durable-gate.ts`). **Hoje tudo desligado em produção**
  (`docs/ATIVACAO-SELETIVA-DURAVEL.md`).
- Guarda de eco: `ORIGENS_PROPRIAS_ENGINE = ['engine','aparelho']`
  (`bridge.ts:104`), checada por inclusão, nunca `!== 'engine'`.
- Cofre: `cofre.ts` AES-256-GCM, `base64(iv12||ct||tag16)`, chave
  `CRM_CREDENTIALS_KEY` (mesma do CRM e do Workspace). Z-API guarda
  `{instanceId, token, clientToken}` em `chat_instancias.credencial_cifrada`.
- Webhook Z-API: segredo estático na URL (`ENGINE_WEBHOOK_SECRET`,
  comparação em tempo constante). Sem assinatura do provedor. Chatwoot idem.
- Mídia: sem storage intermediário próprio (bytes → Chatwoot multipart,
  teto 20 MB); com `ENGINE_OWNED_HISTORY` sobe ao bucket
  `crm-historico-midia` (`history.ts`).
- Erros de domínio: `{erro, codigo}` via `setErrorHandler`
  (`server.ts:362-366`); `ErroGrupo(codigo, msg, status)` é o padrão.
- Envs obrigatórias: `ENGINE_API_TOKEN`, `ENGINE_WEBHOOK_SECRET`,
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRM_CREDENTIALS_KEY`.

### Workspace (`brs-workspace`)
- Cliente do engine: `src/lib/central-conversas/engine.ts` — `operationId`
  obrigatório por intenção (`envio-intencao.ts`, fases
  editando|enviando|incerto|concluido), classificação
  confirmado|rejeitado|incerto (`classificarFalha`), `REJEICOES_PRE_ENVIO`.
  Respostas normais vão pelo Chatwoot (`responderConversa`), NÃO pelo engine
  — só conversa nova/grupo novo passa pelo engine.
- Padrão de card de Provedores (Nuvidio/QuarkRH/Kaizom/Giphy): tabela
  singleton `*_config` (CHECK id=1) com colunas `*_enc` (`cifrarTexto`),
  RLS sem policy, lib `lerXConfigRow/Publica` + `salvarXConfig` +
  `testXConnection`, action `'use server'` com `requirePermission`.
- Permissão nova = 4 pontos (padrão `sistema-config-figurinhas-gifs`):
  `usuarios/page.tsx` SYSTEM_MODULES; `permissions.ts`
  (systemConfigNavEntries + exactRouteRules + prefixRouteRules);
  `divisoes.ts`; seed em migration copiando de `sistema-usuarios-root`.
- Notificações: `createWorkspaceNotifications(admin, [{user_id, type,
  title, body?, href?, entity_type?, entity_id?}])`.
- Mercado Pago: só config (`gateway_pagamentos`, credenciais em jsonb puro,
  permissão `sistema-config-gateways`). Chamadas Pix + webhook `x-signature`
  vivem no **brs-portal-parceiro** (`src/lib/pix/*`,
  `src/app/api/webhooks/mercadopago/route.ts`). **Zero preapproval no grupo.**
- Migration mais recente: `20260926020346_limite_operacional.sql`.

### CRM (`brs-alvoconsig/apps/web`)
- Aba atual: `app/crm/configuracoes/whatsapp-oficial/page.tsx` — estática,
  3 cards demo (Meta direto/360dialog/Gupshup) `disponivel={false}` +
  seções "Em breve". Sem permissão própria (só `config.ver` do menu);
  editar canal/credencial = `config.editar_canais`.
- Cofre do tenant: `lib/crm/cofre.ts` (mesma cifra), tabela
  `crm_parceiro_credenciais` (UNIQUE `agente_parceiro_id, provedor`, RLS
  service-role-only), gravação via `salvarCredencial` (merge de segredo),
  leitura server-only via `lib/crm/credenciais.ts#obterCredencial` —
  **deliberadamente fora de arquivo `'use server'`**.
- Tenancy: `agente_parceiro_id` via `getSessaoCrm()`; service role +
  `.eq('agente_parceiro_id', …)` na aplicação; RLS ligado sem policy nas
  `crm_*`; sem bypass de master (tudo por chave de permissão).
- Campanha não oficial: tipos em `campanhas-tipos.ts` (**`'whatsapp_oficial'`
  e `'ia_voz_whatsapp_oficial'` já existem com `disponivel:false`**), wizard
  `NovaCampanhaWizard.tsx` (passos filtros|atendentes|disparo|visaoOferta|
  revisar), fila `crm_disparo_fila` + RPCs claim/finish, worker no cron
  `/api/cron/disparo-whatsapp` (25/min, 1 por parceiro, lease 5 min,
  incerto nunca reenviado), primitivas puras em `lib/crm/disparo.ts` (com
  testes) e `disparo-shared.ts`.
- `crm_templates_mensagem.canal` já aceita `'whatsapp_oficial'`.

### Achado de segurança FORA do escopo (relatar ao Bruno)
`apps/web/src/lib/crm/email-actions.ts` é `'use server'` e exporta
`enviarEmailResend({agenteParceiroId, …})` **sem checar sessão/permissão**,
decifrando a credencial Resend do tenant que o chamador indicar. Qualquer
cliente autenticável pode enviar e-mail com a chave de qualquer parceiro.
Corrigir em entrega própria (exigir sessão + derivar tenant da sessão).

---

## 2. ADRs

### ADR-1 — Conexão e credencial: `ycloud_conexoes` + FK na instância
A API Key da YCloud é da CONTA (N números/WABAs), não do número. Guardar por
instância duplicaria segredo e quebraria rotação. Decisão:

- Tabela `ycloud_conexoes` (Workspace, service-role-only): dona do segredo
  (`api_key_cifrada` no cofre AES existente, `CRM_CREDENTIALS_KEY`), do
  webhook (`webhook_endpoint_id`, `webhook_secret_cifrado`) e do vínculo de
  proprietário (`owner_tipo 'brs'|'parceiro'` + `agente_parceiro_id`,
  espelhando `chat_contas`).
- `chat_instancias` ganha `ycloud_conexao_id` FK; credencial da instância
  YCloud NÃO usa `credencial_cifrada` (fica null) — o engine resolve pelo
  join instância→conexão. Jobs carregam só IDs.
- O card do Workspace (BRS) e a aba do CRM (parceiro) gravam na MESMA tabela
  `ycloud_conexoes` via actions próprias; `crm_parceiro_credenciais` NÃO é
  usada (é 1 segredo por provedor por tenant, mas precisamos de
  endpoint/estado/rotação acoplados ao segredo — tabela própria é o desenho
  do plano revisado §4.2). Registrado como decisão frente ao cofre singleton
  dos cards do Workspace: conexão YCloud não é singleton (N parceiros).
- Isolamento: toda action e o engine validam que conexão, instância, WABA,
  número e inbox pertencem ao mesmo proprietário. Unicidade v1: índice único
  parcial por número E.164 ativo em `provedor='ycloud'` (impede o mesmo
  número em dois tenants e ativação concorrente).
- Troca de chave: action valida com `GET /balance` + `GET
  /whatsapp/phoneNumbers` e confere que os números ativos continuam
  presentes antes de gravar; grava e invalida qualquer cache. Remoção da
  chave só quando nenhuma instância ativa referencia a conexão.

### ADR-2 — Webhook: rota no ENGINE, um endpoint YCloud por conexão
- Rota `POST /webhooks/ycloud/:conexaoId` no engine (Railway), fora do
  Bearer, como os webhooks atuais. O limite de 20 endpoints é por conta
  YCloud (= por conexão de parceiro), então 1 endpoint por conexão sobra.
- Validação fail-closed, nesta ordem: bytes brutos capturados antes do
  parser JSON (Fastify: content-type parser que preserva o raw body só
  nessa rota); header `YCloud-Signature` com formato `t=<unix>,s=<hex>`
  validado (tamanho/formato); tolerância de `t` = 5 min; HMAC-SHA256 do
  `"{t}.{corpo bruto}"` com o secret da conexão, comparação em tempo
  constante; assinatura inválida → 401 + log de segurança, sem gravação.
- `X-Webhook-Endpoint-ID` vai para o log (correlação), nunca decide tenant.
  Tenant vem SÓ do `:conexaoId` da URL + assinatura com o secret daquela
  conexão. Campo do corpo nunca escolhe tenant.
- **2xx só depois de persistir na inbox durável.** Banco indisponível →
  503 (a YCloud retenta 7×). Violação do UNIQUE (duplicado já aceito) →
  2xx. Processamento pesado é do worker.
- Roteamento (no worker, não na ingestão): inbound → instância por
  (`conexao_id`, `to` normalizado); status → correlação por `id`
  YCloud/`externalId`/`wamid` (nunca exige `to`); eventos de
  template/WABA/número → conexão + `wabaId`/número. Evento válido de
  recurso não gerenciado (ex.: número da conta que não foi ativado no CRM)
  → auditado e concluído sem efeito, com 2xx.
- `enabledEvents` na criação do endpoint (v1):
  `whatsapp.inbound_message.received`, `whatsapp.message.updated`,
  `whatsapp.phone_number.quality_updated`,
  `whatsapp.phone_number.name_updated`, `whatsapp.phone_number.deleted`,
  `whatsapp.template.reviewed`, `whatsapp.template.quality_updated`,
  `whatsapp.template.category_updated`, `whatsapp.business_account.updated`,
  `whatsapp.business_account.deleted`.
- O secret vem na resposta da criação do endpoint (verificado); rotação via
  `rotateSecret` com janela de aceitação dupla (validar contra secret novo
  e, por 10 min, contra o anterior) — testar comportamento em redelivery na
  homologação (F2).

### ADR-3 — Durabilidade OBRIGATÓRIA para YCloud (independente das flags)
Baileys/Z-API têm o gate `ENGINE_DURABLE_EVENTS` + lista de contas porque
existe caminho legado inline. YCloud NÃO tem sessão para reprocessar e o
único replay externo são as 7 retentativas da YCloud. Decisão:

- Eventos `source='ycloud'` SEMPRE entram em `chat_engine_jobs`
  (`enqueueEvent` incondicional). `scope = conexao_id`,
  `event_key = id do evento YCloud` (globalmente único).
- Envios YCloud SEMPRE passam pelo ledger `chat_envios_operacoes`
  (claim/finish), independente do gate durável da conta.
- O event-worker passa a subir sempre que houver instância YCloud ativa OU
  a flag durável ligada (implementação simples: subir sempre; o loop ocioso
  é barato). Nada muda para Baileys/Z-API — a flag global continua fechada.
- CHECKs de banco: `chat_instancias.provedor` e `chat_engine_jobs.source`
  ganham `'ycloud'` por migration (aditivo).

### ADR-4 — IDs, ledger e redutor de status
Quatro identificadores, nunca fundidos:
1. `operationId` (nosso, UUID, 1 por intenção) — idempotência local; vai à
   YCloud como `externalId` (**correlação apenas**: a doc não documenta
   dedupe de POST — verificado 26/09).
2. `id` YCloud (resposta do POST e dos webhooks) — chave de correlação
   primária dos status.
3. `wamid` — pode chegar depois; correlação secundária (citações/replies).
4. `id` do evento de webhook — dedupe da inbox.

- Tabela satélite `ycloud_mensagens` (não mexe na tabela central de mensagens
  compartilhada com outros provedores): `instancia_id`, `ycloud_id` (unique),
  `operation_id?`, `wamid?`, `direcao`, status + carimbo POR status
  (`accepted_em`, `sent_em`, `delivered_em`, `read_em`, `failed_em`),
  `erro jsonb`, custo (`total_price numeric(12,6)`, `currency`,
  `pricing_category`, `pricing_type`, `preco_final bool`), `payload jsonb`.
- **Status órfão** (webhook antes do retorno HTTP do POST, ou correlação
  ainda ausente): grava a linha por `ycloud_id` mesmo sem `operation_id`;
  reconciliação posterior liga ao ledger/mensagem local.
- **Redutor forward-only por campo**: cada carimbo só é preenchido uma vez
  (timestamp do evento, não do processamento); `read` não regride por
  `sent` atrasado; `failed` coexiste com carimbos anteriores (a doc admite
  `delivered` após `failed` — guardar ambos e expor o mais avançado +
  falha); preço pode ser ATUALIZADO até `preco_final=true`
  (delivered/read), depois é imutável.
- Timeout/erro incerto depois do POST: NUNCA repostar. Reconciliar por
  webhook; sem webhook em N horas → fila de análise (job `uncertain`).
  Provedor aceitou + falha de DB/Chatwoot → repete só persistência/espelho.

### ADR-5 — Identidade e BSUID
- Conversa YCloud usa a chave existente `chat_conversas.jid` = dígitos
  E.164 quando o telefone existe (compatível com `normalizarTelefone` e o
  vínculo por telefone do Atendimento).
- Inbound com BSUID e SEM telefone: `jid = 'bsuid:' + fromUserId`
  (sentinela nunca parseável como telefone); resposta usa `recipient` no
  POST em vez de `to`. Proibido derivar E.164/JID de BSUID e proibido
  fundir contatos por nome.
- Colunas novas em `chat_conversas` (nullable, só YCloud preenche):
  `ycloud_user_id`, `ycloud_parent_user_id`. Se mais tarde o mesmo cliente
  aparecer com telefone, a fusão é decisão manual/futura — v1 não funde.

### ADR-6 — Janela de 24 h no servidor
- `chat_conversas` ganha `ultima_mensagem_cliente_em` (engine atualiza em
  todo inbound; agnóstico de provedor, custo zero para os demais).
- Regra no ENGINE (não na UI): envio `type != 'template'` para instância
  YCloud com `now() - ultima_mensagem_cliente_em > 24h` (ou null) → 422
  `JANELA_24H_FECHADA`. Timestamp da mensagem do cliente = `sendTime` do
  evento (relógio da YCloud/UTC), não o horário de processamento.
- Agendamentos/automações revalidam TODAS as condições (janela, template
  aprovado, cobrança, saúde, opt-out) imediatamente antes do POST.
- Exceções de gratuidade (72 h entry point etc.) NÃO ampliam composição na
  v1 — informativas no custo, nada mais.

### ADR-7 — Capacidades por provedor (mapa central, enfim)
Hoje a capacidade é espalhada (`ListaConversas.tsx:731`,
`PainelContato.tsx:850`, comentários no engine). Com um 3º provedor isso
vira bug. Contrato novo (F2/F3 implementam, S1/S2 consomem):

```ts
// compartilhado Workspace/CRM (duplicado como os cofres, 1 arquivo por repo)
export type ProvedorChat = 'baileys' | 'zapi' | 'ycloud'
export interface CapacidadesProvedor {
  enviaTexto: boolean; enviaMidia: boolean
  reacoes: boolean; respostaCitada: boolean; mencoes: boolean
  marcaLido: boolean; digitando: boolean
  grupos: boolean            // ycloud v1: false (501 PROVEDOR_NAO_SUPORTADO)
  novaConversa: boolean      // inicia conversa fora de resposta
  templates: boolean         // só ycloud
  janela24h: boolean         // só ycloud
  custoPorMensagem: boolean  // só ycloud
}
export const CAPACIDADES: Record<ProvedorChat, CapacidadesProvedor>
```
YCloud v1: `{enviaTexto: true, enviaMidia: true, reacoes: false,
respostaCitada: true (context.message_id), mencoes: false, marcaLido: true,
digitando: true, grupos: false, novaConversa: true (só template),
templates: true, janela24h: true, custoPorMensagem: true}`.
Reação/lido/digitando só viram `true` depois de homologados na conta real.
UI esconde ação não suportada (não desabilita com tooltip genérico).

### ADR-8 — Cobrança: entitlement derivado, gateway abstraído
- Tabelas no schema compartilhado (migrations no Workspace), prefixo
  `crm_wa_oficial_*` (curto e não colide): `crm_wa_oficial_assinaturas`,
  `crm_wa_oficial_trials`, `crm_wa_oficial_cobrancas`,
  `crm_wa_oficial_gateway_eventos` (§3).
- **Direito de envio é FUNÇÃO, não status**: `direitoDeEnvio(assinatura,
  trial, now)` implementa a matriz do plano revisado §6. O status do
  preapproval do MP nunca desbloqueia sozinho; callback de navegador
  (back_url) nunca desbloqueia. Trial vigente OU período pago vigente OU
  inadimplência dentro da carência → envia. Recebimento NUNCA depende de
  cobrança.
- Enforcement no ENGINE: antes do POST YCloud de instância com
  `agente_parceiro_id`, consulta o entitlement (query direta, service role;
  cache em memória ≤ 60 s, **fail-closed para envio novo** se a consulta
  falhar). BRS (`owner_tipo='brs'`) não tem assinatura — sempre envia.
  Código: 403 `INSTANCIA_BLOQUEADA_COBRANCA`.
- Trial: 1 por (`tenant`, `numero_e164`), em tabela própria que sobrevive a
  soft-delete/desconexão; ativação concorrente deduplicada pelo unique.
  Cartão cadastrado durante o trial NÃO encurta os 30 dias (1ª cobrança no
  fim do trial) — validar a modelagem exata no MP na F4 (lacuna R6).
- Webhook MP: rota no CRM (`apps/web/src/app/api/webhooks/mercadopago/
  route.ts`), validação `x-signature` no padrão já em produção no
  brs-portal-parceiro, idempotente por id de evento
  (`crm_wa_oficial_gateway_eventos` unique), e **consulta o recurso pela
  API** antes de qualquer transição (autenticidade + moeda/valor/owner).
  Inadimplência: `inicio_inadimplencia` gravado UMA vez por ciclo;
  notificações repetidas não prorrogam carência. Reconciliador em cron
  diário corrige webhook perdido.
- Cancelamento: agenda fim no término do período pago; até lá envia.
  Desconexão, suspensão financeira e pausa de envio são operações
  DISTINTAS; remover webhook/credencial só quando nenhuma instância da
  conexão depender deles.

### ADR-9 — Limite externo por PORTFÓLIO
Verificado: desde 07/10/2025 a Meta calcula o limite por portfólio
(`whatsappBusinessManagerMessagingLimit`), compartilhado por todos os
números. Decisão:
- Snapshot de saúde guarda os DOIS campos; o controle de campanha usa o do
  portfólio como teto externo e o teto local por número (min com o teto do
  master) como distribuição.
- Contador local de conversas iniciadas por empresa em janela móvel de
  24 h por destinatário único, por número E por portfólio (view/consulta
  sobre `ycloud_mensagens` + campanhas). Ele é INFORMATIVO/conservador:
  outros sistemas na mesma conta podem consumir cota que não vemos.
- Informação de saúde/limite desconhecida ou mais velha que o limiar (24 h)
  → campanha PAUSA (fail-closed), nunca inventa capacidade. Atendimento
  individual não pausa por limite desconhecido (volume irrisório) — só
  campanha.

### ADR-10 — Mídia
- Inbound: worker baixa com `X-API-Key` (janela de 30 dias, mas baixa
  imediata), teto 20 MB (igual aos demais), timeout, validação de
  MIME/extensão, e proteção SSRF (só https, resolver e recusar IP privado,
  sem seguir redirect para host diferente). Falha de mídia NÃO perde o
  evento: mensagem espelhada com marcador de mídia pendente + retry do job.
- Destino: Chatwoot multipart (padrão atual). Com `ENGINE_OWNED_HISTORY`
  ligado, também bucket privado (`history.ts`), como hoje.
- Outbound com mídia: v1 usa URL assinada temporária (padrão do disparo,
  600 s) como link no payload; upload por media id
  (`/whatsapp/media/{phoneNumber}/upload`, 30 dias) entra na F5 para
  campanhas (mídia reutilizada em massa).

---

## 3. Modelo de dados e plano de migrations

Tudo aditivo, timestamp real (`date +%Y%m%d%H%M%S`), RLS ligado sem policy
(service-role-only) salvo indicação. Rollback lógico = flags/UI fora, nunca
drop de histórico.

### Migration F1-a — provedor e conexões
```
alter chat_instancias: drop/re-add CHECK provedor in ('baileys','zapi','ycloud');
  add ycloud_conexao_id uuid null references ycloud_conexoes,
      ycloud_waba_id text null, ycloud_phone_number_id text null;
  índice único parcial: (numero) where provedor='ycloud' and deleted_at is null;
alter chat_engine_jobs: CHECK source in ('chatwoot','zapi','baileys','ycloud');
create ycloud_conexoes (
  id uuid pk, owner_tipo text check in ('brs','parceiro'),
  agente_parceiro_id uuid null fk,          -- null p/ brs
  nome text, api_key_cifrada text,
  webhook_endpoint_id text null, webhook_secret_cifrado text null,
  webhook_criado_em timestamptz null,
  status text check in ('ativa','invalida','removida') default 'ativa',
  ultimo_teste_em timestamptz, criado_por uuid, created_at, updated_at,
  constraint parceiro_exige_agente check
    (owner_tipo <> 'parceiro' or agente_parceiro_id is not null)
);
unique parcial: (agente_parceiro_id) where status='ativa' and owner_tipo='parceiro';
unique parcial: (owner_tipo) where owner_tipo='brs' and status='ativa';  -- 1 conexão BRS v1
alter chat_conversas: add ultima_mensagem_cliente_em timestamptz null,
  ycloud_user_id text null, ycloud_parent_user_id text null;
```

### Migration F1-b — espelhos YCloud
```
ycloud_numeros_saude (snapshot, 1 viva por instância):
  instancia_id pk fk, quality_rating, messaging_limit,
  bm_messaging_limit, status, name_status, verified_name,
  update_event, quality_update_event, is_oba bool,
  observado_em timestamptz not null, payload jsonb;
  -- 'desconhecido/obsoleto' = observado_em velho ou linha ausente; explícito na leitura
ycloud_numeros_saude_eventos (append-only): id, instancia_id, tipo,
  de jsonb, para jsonb, evento_id text unique, ocorrido_em, payload jsonb;
ycloud_templates: id, conexao_id fk, waba_id, nome, idioma, categoria,
  status, quality_rating, componentes jsonb, sincronizado_em,
  status_update_evento_id, unique (conexao_id, waba_id, nome, idioma);
ycloud_saldos: conexao_id, moeda, saldo numeric(14,4), observado_em,
  pk (conexao_id, moeda);
ycloud_mensagens: id uuid, instancia_id fk, ycloud_id text unique,
  operation_id uuid null, wamid text null, direcao text in ('in','out'),
  status text, accepted_em, sent_em, delivered_em, read_em, failed_em,
  erro jsonb, total_price numeric(12,6), currency text,
  pricing_category text, pricing_type text, preco_final bool default false,
  payload jsonb, created_at, updated_at;
  índices: (instancia_id, created_at desc), (operation_id), (wamid);
```

### Migration F1-c — permissões (regra dos 4 pontos + seed)
- `sistema-config-whatsapp-oficial` → card Provedores › WhatsApp Oficial
  (YCloud), rota `/rh/parceiros/config/provedores/whatsapp-oficial`.
- `conversas-whatsapp-oficial-saude` → painel de saúde na Central de
  Atendimento.
- Seed copiando de quem tem `sistema-usuarios-root` (padrão Giphy).
- CRM: **sem chave nova** — aba continua sob `config.ver` (menu) e
  `config.editar_canais` (conectar/ativar/desativar); campanha oficial usa
  as chaves `campanhas.*` existentes com ativação restrita a
  `campanhas.criar_editar` + confirmação de perfil master no servidor.

### Migration F4 — cobrança
```
crm_wa_oficial_trials: id, agente_parceiro_id, numero_e164,
  instancia_id_atual fk null, inicio_em, fim_em,
  unique (agente_parceiro_id, numero_e164);   -- sobrevive a soft delete
crm_wa_oficial_assinaturas: id, agente_parceiro_id, instancia_id fk,
  numero_e164, valor_centavos int default 4900, gateway text,
  gateway_customer_id, gateway_subscription_id,
  status text in ('trial','sem_pagamento','ativa','inadimplente',
                  'bloqueada','cancelamento_agendado','cancelada'),
  periodo_pago_ate timestamptz null, inicio_inadimplencia timestamptz null,
  carencia_ate timestamptz null, cancelada_em, cancelamento_em_fim_ciclo bool,
  aceite_termos jsonb (versao, user, data, ip), created_at, updated_at,
  unique (instancia_id);
crm_wa_oficial_cobrancas: id, assinatura_id fk, competencia date,
  valor_centavos, status, gateway_payment_id unique, moeda, payload jsonb,
  criado_em, confirmado_em;
crm_wa_oficial_gateway_eventos: id, gateway, evento_id text, topico,
  recurso_id, payload jsonb, processado_em, resultado,
  unique (gateway, evento_id);
```

### Migration F5 — campanhas oficiais (nomes do plano-base, revisados)
`crm_campanhas_oficial`, `crm_campanhas_oficial_numeros`,
`crm_campanhas_oficial_templates`, `crm_campanhas_oficial_envios`,
`crm_campanhas_oficial_pausas`, `crm_campanhas_oficial_optout` (se o
catálogo existente não servir). Correções obrigatórias do plano revisado:
dedupe em `envios` por **(campanha_id, destinatario_norm)** unique — não só
(campanha, lead) — onde `destinatario_norm` = E.164 ou `bsuid:…`; sorteio
(número, template, mídia) persistido ANTES do envio com seed; reserva
atômica de capacidade/orçamento por RPC. Detalhar na F5.

Ordem de dependência: F1-a → F1-b/F1-c (mesma sessão), F4 independente após
F1-a, F5 por último.

---

## 4. Mapa de arquivos por fatia

### F2 — engine (repo brs-alvoconsig, `services/engine/src/`)
| Arquivo | Mudança |
|---|---|
| `db.ts` | tipo `provedor` + 'ycloud'; `ycloud_conexao_id` etc. em COLS_INSTANCIA; helper `conexaoYcloud(inst)` (join + decifra) |
| `ycloud.ts` (novo) | client HTTP (X-API-Key, timeout, map de erro YCloud→domínio), `enviarYcloud`, `baixarMidiaYcloud`, `marcarLidoYcloud`, `digitandoYcloud`, `normalizarInboundYcloud`, `normalizarStatusYcloud`, util `validarAssinaturaYcloud(raw, header, secret, tolerancia)` |
| `server.ts` | rota `POST /webhooks/ycloud/:conexaoId` (raw body + assinatura + enqueue + 2xx); ramos ycloud em `/conectar` (valida credencial/número), `/status`, `/enviar` (janela/template/cobrança/ledger sempre) |
| `event-worker.ts` / `event-dispatch.ts` | `source: 'ycloud'` → `inboundYcloud` / `statusYcloud` |
| `bridge.ts` | `inboundYcloud` (normaliza → `entregarNoChatwoot`), rótulo de inbox, guarda de eco: origem `'ycloud-status'` nunca vira mensagem |
| `index.ts` | event-worker sobe sempre (ADR-3) |
| `config.ts` | (nada novo obrigatório; tolerância de assinatura com default) |
| testes | `ycloud.test.ts` (assinatura, normalização, redutor), `send-ycloud.test.ts` (ledger/duplicação/incerto), fixtures sanitizadas em `test/fixtures/ycloud/` |

### F3 — sync e domínio (Workspace `src/lib/ycloud/` novo)
`client.ts` (Management API paginada, respeitando 10k/h), `sync.ts`
(números/WABAs/templates/saldo → espelhos, frescor explícito),
`config-actions.ts` (card BRS), cron `src/app/api/cron/ycloud-sync/route.ts`
(intervalo ≥ maxDuration, horário desalinhado — regra dos crons), alertas
via `createWorkspaceNotifications`.

### S0/S1/S2 — UI (contratos no §5)
- S0: `apps/web/src/app/crm/configuracoes/whatsapp-oficial/page.tsx` — card
  único YCloud com texto do §11 do plano revisado, estados indisponíveis,
  sem botão que simule conexão. `configuracoes-grupos.ts` mantém `emBreve`
  até S2.
- S1: card Provedores Workspace (padrão Nuvidio) + Messenger: seletor de
  templates, indicador de janela, capacidades (ADR-7).
- S2: aba CRM níveis 1 e 2, assinatura, avisos.

### F4 — cobrança
CRM: `apps/web/src/lib/crm/wa-oficial-billing-actions.ts` (+ lib pura
`wa-oficial-billing.ts` com `direitoDeEnvio` TESTADA), rota webhook MP,
cron reconciliador. Engine: checagem de entitlement no `/enviar`.

### F5/S3 — campanhas
Motor no engine + fila própria (primitivas de `crm_disparo_*` como
referência, tabelas novas); wizard/monitor no CRM.

---

## 5. Contratos para o Sonnet

### 5.1 Envio (engine `/instancias/:id/enviar`, extensão YCloud)
Corpo ganha campos opcionais (só válidos p/ ycloud):
```ts
{ destino?: string,            // E.164 dígitos; OU
  recipientBsuid?: string,     // BSUID (conversa sem telefone)
  operationId: string,         // UUID, OBRIGATÓRIO (sempre, ycloud)
  texto?: string, midia?: {...},              // como hoje
  template?: {                 // exigido fora da janela
    nome: string, idioma: string,
    variaveis?: Record<string,string>,       // posição -> valor
    headerMidiaUrl?: string, botoesUrl?: Record<string,string>
  } }
```
Respostas: sucesso como hoje (`{ok, id, messageId, conversationId}` — `id`
= id YCloud). Erros novos, formato `{erro, codigo}`:

| codigo | HTTP | Quando | UI |
|---|---|---|---|
| `JANELA_24H_FECHADA` | 422 | texto/mídia livre fora da janela | abrir seletor de template |
| `TEMPLATE_NAO_APROVADO` | 422 | template inexistente/não APPROVED/pausado | recarregar lista |
| `SALDO_INSUFICIENTE` | 422 | erro YCloud BALANCE_INSUFFICIENT | CTA recarregar carteira |
| `NUMERO_RESTRITO` | 422 | status do número impede envio | mostrar saúde |
| `CREDENCIAL_INVALIDA` | 422 | 401 da YCloud | CTA reconectar chave |
| `INSTANCIA_BLOQUEADA_COBRANCA` | 403 | entitlement negado | CTA pagamento |
| `DESTINATARIO_OPT_OUT` | 422 | RECIPIENT_UNSUBSCRIBED | informar opt-out |
| `PROVEDOR_NAO_SUPORTADO` | 501 | grupos etc. | esconder ação (ADR-7) |

Estados de intenção seguem `envio-intencao.ts` (confirmado|rejeitado|
incerto). **Incerto NUNCA reenvia sozinho e a UI preserva a intenção após
refresh** (contrato existente, vale igual).

### 5.2 DTOs de leitura (actions Fable entregam na F3; UI não calcula)
```ts
type SaudeNumero = {
  instanciaId: string
  qualidade: 'GREEN'|'YELLOW'|'RED'|'UNKNOWN'
  limiteNumero: string          // TIER_*
  limitePortfolio: string       // TIER_* (o que vale — ADR-9)
  status: string; nomeVerificado?: string; nameStatus: string
  observadoEm: string           // ISO
  obsoleto: boolean             // observadoEm > limiar → UI marca "desatualizado"
}
type TemplateYcloud = {
  nome: string; idioma: string
  categoria: 'AUTHENTICATION'|'MARKETING'|'UTILITY'
  status: 'APPROVED'|'PENDING'|'REJECTED'|'PAUSED'|'DISABLED'|'ARCHIVED'|'IN_APPEAL'|'DELETED'
  qualidade: 'GREEN'|'YELLOW'|'RED'|'UNKNOWN'
  componentes: unknown[]        // render de prévia
  variaveis: number             // contagem {{n}} do body
  sincronizadoEm: string
}
type SaldoCarteira = { moeda: string; saldo: string; observadoEm: string; obsoleto: boolean }
type JanelaConversa = { aberta: boolean; expiraEm?: string }  // servidor calcula
type AssinaturaResumo = {
  status: 'trial'|'sem_pagamento'|'ativa'|'inadimplente'|'bloqueada'|'cancelamento_agendado'|'cancelada'
  podeEnviar: boolean           // direitoDeEnvio() — UI NUNCA deriva
  trialFimEm?: string; periodoPagoAte?: string; carenciaAte?: string
  proximaCobrancaEm?: string
}
type CustoMensagem = { estimado: boolean; valor: string; moeda: string; categoria: string }
```
Regras para a UI: estados loading/erro/vazio/indisponível/obsoleto/incerto
sempre; nenhum segredo chega ao browser (máscara `mascarar()`); moeda da
carteira YCloud ≠ R$ 49 da mensalidade (nunca somar); timestamps no fuso do
usuário com data absoluta no hover; valores estimados sempre rotulados.

### 5.3 Texto da tela do parceiro
Usar o §11 do plano revisado (não o §6 do plano-base — remove "ganha selo"
e "não sofre desconexões"). Nome da aba: "WhatsApp Oficial" (pendência de
rótulo não bloqueia).

---

## 6. Critérios de aceite por fatia (mapeados aos testes §9 do plano)

| Fatia | Aceite mínimo (testes automatizados onde couber) |
|---|---|
| F1 | migrations aplicam local; constraints impedem: número ycloud duplicado entre tenants, conexão parceiro sem agente, 2ª conexão ativa do mesmo dono; RLS nega anon/authenticated em todas |
| F2 | (1) mesmo webhook 2× + 2 workers → 1 mensagem; (2) assinatura inválida/corpo alterado/replay fora da tolerância/conexão de outro tenant → 401/sem gravação; (3) banco fora → sem 2xx; redelivery recupera; (4) provedor aceitou + falha DB/Chatwoot + retry mesma operação → 1 POST só; (5) timeout pós-POST → incerto, webhook posterior resolve; (6) status antes do retorno HTTP e read antes de sent → correlação e final corretos; eco: status nunca vira inbound; regressão total Baileys/Z-API (suíte existente verde) |
| F3 | 2 números na mesma WABA → template/saldo únicos, evento no número certo, desconectar 1 preserva o outro; snapshot vs histórico; obsoleto explícito; sync respeita 10k req/h |
| F4 | matriz §6 do plano revisado coberta por testes de `direitoDeEnvio`; webhook MP duplicado/atrasado/fora de ordem idempotente; trial não reinicia em reconexão; corrida de ativação → 1 trial; inbound continua durante bloqueio |
| F5 | 2 leads mesmo telefone → 1 envio; opt-out pós-enfileiramento respeitado (+ `filterUnsubscribed=true`); sorteio persistido sobrevive a restart; pausas por escopo certo; limite portfólio desconhecido → pausa |
| S* | fluxos com backend real de teste, sem segredo no cliente, estados §5.2; permissões nos 4 pontos quando aplicável |
| F6/H1 | homologação só com conta real (mocks não homologam); IDs externos sanitizados registrados; piloto = destinatários e teto de gasto definidos antes |

---

## 7. Lacunas e pendências externas (não escondidas)

1. **Conta YCloud real da BRS**: plano/contrato, webhook/analytics/saldo
   habilitados, e se há múltiplas API Keys (rotação). Sem isso F2 termina em
   sandbox/fixtures — homologação fica aberta.
2. **Mercado Pago assinaturas**: páginas de referência do preapproval e de
   webhooks retornaram 404 no fetch desta sessão (registrado em
   FATOS-VERIFICADOS). Reverificar na F4: campos exatos do preapproval,
   free trial com cartão cadastrado sem encurtar os 30 dias,
   `X-Idempotency-Key`, manifest do x-signature para os tópicos de
   assinatura. Referência interna: webhook Pix do brs-portal-parceiro.
3. **Elegibilidade de ofertas de crédito** na política do WhatsApp antes de
   qualquer campanha (F5/H1): confirmar por escrito com o provedor.
4. **Comportamento de redelivery** (timestamp/assinatura) e da rotação de
   secret: só verificável com endpoint real (F2).
5. **Texto final** do Bloco A/termos de aceite e nome da aba — Bruno.
6. Fora do escopo, mas urgente: falha de autorização em
   `lib/crm/email-actions.ts` (§1).
