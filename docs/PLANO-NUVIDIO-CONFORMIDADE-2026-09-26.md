# PLANO — Nuvidio: conformidade com a doc oficial, correções e implementação

> Data: 26/09/2026. Autor: Fable (revisão página a página de docs.nuvidio.com).
> Público: Bruno (decide) e sessões Sonnet/Fable (executam). Cada fatia diz o modelo.
> Fonte da verdade da API: `https://docs.nuvidio.com/llms.txt` → cada página em `.md`.
> Duas APIs distintas: **v1** (`api.nuvidio.com/v1/api/...`, a nossa) e **V2 / vídeo
> autônomo** (`apigw.nuvidio.com/...`, OAuth2 próprio) — NÃO misturar.

## 0. Situação em 26/09/2026

| Item | Estado |
|---|---|
| Credenciais (API KEY/SECRET) | Salvas no cofre; teste OK: 15 departamentos |
| Endpoints do cliente | Corrigidos (commit `f2fb5e80`, em produção) |
| Dois departamentos (padrão × cadastro de parceiros) | Em produção (`e0c6d1e0`, migration `20260926000502` aplicada) |
| Chave do webhook | Definida no card |
| Departamentos no card | **Vazios — Bruno escolhe os dois** |
| Webhooks no painel da Nuvidio | **A cadastrar (3 eventos, dados completos ligado)** |
| Atendentes na Nuvidio | **A cadastrar com o MESMO e-mail do Workspace** (SSO deu 404 "atendente não encontrado") |
| Dados | 0 convites, 0 eventos — nada a migrar |

## 1. Conferido e conforme (não mexer)

| Função | Endpoint (doc) | Arquivo |
|---|---|---|
| Autenticar | `POST /v1/api/auth` `{apiKey, apiSecret}` → `{token, tokenExpiration}` (10 min) | `src/lib/nuvidio/client.ts` |
| Listar departamentos | `GET /v1/api/departments?take&page&search` → `{count, departments[{id, identifier, name, disabled, attendants, queueLength}]}` | idem |
| Criar convite | `POST /v1/api/invite/department/:id` `{expirationDate, initialDate, push, schedule, customerData[{label, value, type?, private?}]}` → `{id, token, link, shortLink, guestLink}` | idem |
| Desativar convite | `PUT /v1/api/invite/:id/status` `{enabled:false}` | idem |
| Link da gravação | `GET /v1/api/call/recording/:id/link` → URL S3 em texto puro, **expira em 2 h** | idem |
| Baixar gravação | `GET /v1/api/call/recording/:id` → blob (400 = não gravada) | a usar (fatia 3) |
| Buscar chamada | `GET /v1/api/call/:id` → traz `invite{id, token, link, shortLink}`, `recorded`, `recordingDeleted`, `customer`, `attendant`, `logs` | a usar (fatia 1) |
| SSO do atendente | `POST /v1/api/attendant/single-sign-on` `{email}` → `{date, token}` — **a doc NÃO diz onde usar o token** | idem |
| Webhook (envelope) | `POST` com `{hookType, hookDescription, timestamp, content}`; chave em `Authorization` (campo "Autenticação") ou `?key=`; "Enviar dados completos" = `content` inteiro | `src/app/api/nuvidio/webhook/route.ts` |
| Rota pública + permissões | webhook liberado no proxy; 3 chaves (`operacional-nuvidio-links`, `operacional-nuvidio-atendimento`, `sistema-config-nuvidio`) nos 4 pontos da REGRA FIXA | `src/lib/supabase/middleware.ts`, `permissions.ts`, `divisoes.ts`, `usuarios/page.tsx` |

Ponto a validar no 1º convite real: se `:id` de `/invite/department/:id` aceita o `id`
(ObjectId, o que gravamos) ou exige o `identifier` (slug). Se der 404, gravar o
`identifier` no card também.

## 2. Achados (verificados no código, ordem de gravidade)

| # | Achado | Onde | Doc |
|---|---|---|---|
| A1 | Webhook **regride status**: qualquer evento com "closed" cai em "chamada finalizada" e grava `chamada_realizada` sem olhar o status atual. `attendant_closed_issue` (atendente salvou a tabulação) ou um reenvio de `call_finished` desfazem "aprovado/reprovado". | `webhook/route.ts` regex `finaliz|finished|ended|closed` | hooks-2, atendente-fechou-a-solicitação |
| A2 | **`content.id` muda de significado por evento**: id da CHAMADA em `call_*`/`attendant_*`; id da FILA em `new_client_waiting`/`client_left_queue`; id do CONVITE em `customer_scheduled_call`. Extração genérica confunde. | idem | payloads de cada hook |
| A3 | **Casamento frágil**: `new_client_waiting` e `new_call_started` não trazem `invite.id` nos exemplos; `customer.cpf` pode ser `null`. Evento sem convite só vai pro `console.warn` e se perde. | idem | novo-cliente-esperando, nova-chamada-iniciada |
| A4 | **Toque de telefone no evento errado**: toca em `chamada_em_curso` (= `new_call_started`, que a doc diz disparar DEPOIS de conectar). "Cliente esperando" (`new_client_waiting`) é ignorado. | `nuvidio/atendimento/page.tsx` + webhook | novo-cliente-esperando |
| A5 | **Convite vencido nunca vira "Expirado"**: o único hook de expiração é do vídeo autônomo (outra API). | `webhook/route.ts` + listagem | invite-expirou-copy |
| A6 | **Agendamento pode nascer vencido**: `expirationDate = agora + horas`, ignora `agendarPara`. | `convites-actions.ts` `criarNuvidioConvite` | criar-convite |
| A7 | **Gravação**: link de 2 h persistido em `gravacao_url` e copiado pra `corban_onboarding_processos.nuvidio_video_url` (a etapa 3 "conclui" com um link morto); sem `call_id` persistido usa `inviteId`, que a API não aceita; sem retry se a gravação ainda não existe. | webhook + `LinksCriadosClient` | buscar-um-link-de-gravação, buscar-uma-gravação |
| A8 | **Permissão da listagem**: `listarNuvidioConvites` exige `operacional-nuvidio-links`; a tela de Atendimento (perm `...-atendimento`) e Cadastros Recebidos › Nuvidio — Acompanhamento (perm `agente-corban-cadastros-recebidos`) chamam a mesma action → fila vazia/erro pra quem não tem a chave de Links. | `convites-actions.ts` | — |
| A9 | **SSO**: resposta traz só `token`; código procura `url` e nunca acha. Atendente precisa existir na Nuvidio com o e-mail do Workspace (404 hoje). | `client.ts` `ssoAtendente`, `atendimento/page.tsx` | login-transparente |
| A10 | Placeholder do link da sala sugere `atendimento.nuvidio.com` (portal do ATENDENTE); link do cliente é `nuvidio.com/<identifier>?token=...` ou `nuvidio.me/...`. | `EtapasFinaisPanel.tsx` | criar-convite |
| A11 | Comparação da chave do webhook com `!==` (não é tempo constante) e chave na URL vai pros logs da Vercel. | `webhook/route.ts` | — |
| A12 | `listarDepartments` mostra departamentos `disabled`; cache do JWT ignora `tokenExpiration`. | `client.ts` | listar-departamentos |
| A13 | Onboarding manda o CPF/CNPJ com label `documento`; a Nuvidio só preenche `customer.cpf` com label `cpf` → CPF nunca casa no onboarding. | `etapas-actions.ts` | exemplos (labels name/tel/email) |

## 3. Contrato de eventos (fatia 1) — mapa explícito por `hookType`

Transições **só pra frente**; evento repetido não muda nada (idempotente).

| hookType | Onde está o quê | Ação no convite |
|---|---|---|
| `new_client_waiting` | fila: `content.department.id`, `content.customer`, `content.origin` (link c/ `?token=`), `content.ticket` | `fila_entrou_em = now()` se status = `aguardando_chamada` |
| `client_left_queue` | idem + `content.status.detail.code = quit` | `fila_saiu_em = now()` |
| `new_call_started` | `content.id` = **call_id**; sem invite → `GET /v1/api/call/:id` → `invite.id` | `aguardando_chamada → chamada_em_curso`, `chamada_iniciada_em`, `call_id` |
| `call_finished`, `attendant_closed_call` | `content.id` = call_id, `content.invite.id`, `content.recorded`, `content.recordingDeleted` | `aguardando_chamada\|chamada_em_curso → chamada_realizada`, `chamada_finalizada_em`, `call_id`, `gravacao_disponivel = recorded && !recordingDeleted` |
| `attendant_closed_issue` | tabulação do atendente (notes, tags) | só evento (não toca status) |
| `call_rated` | NPS | só evento |
| `customer_scheduled_call`, `customer_rescheduled_call` | `content.id` = **invite id**, `content.initialDate`/`expirationDate` | `schedule_at`, `expiration_at` |
| cancelamento de agendamento (nome a confirmar no 1º evento) | — | só evento |
| `video_autonomous_*` | outra API | ignorar (fica na inbox, `erro='api v2'`) |
| desconhecido | — | inbox, `erro='hook não mapeado'` |

Ordem de casamento com `nuvidio_convites`: (1) `content.invite.id` = `invite_id`;
(2) `content.id` = `call_id` já gravado; (3) evento de chamada sem invite →
`GET /v1/api/call/:id` → `invite.id`; (4) `?token=` em `content.invite.token`,
`content.queue.origin`, `content.origin`, `content.link` → `link ilike '%token=<t>%'`;
(5) `content.customer.cpf` → convite ativo mais recente com esse CPF;
(6) nada → fica na inbox sem `convite_id` e aparece em "Sem correspondência".

## 4. Fatias

### Fatia 1 — Webhook durável, casamento e transições (modelo: **Fable**)
Fronteira de segurança + migration + contrato novo → Fable.

Migration (timestamp real, `date +%Y%m%d%H%M%S`, sai só da pasta principal):
```sql
alter table public.nuvidio_convites
  add column if not exists call_id text not null default '',
  add column if not exists short_link text not null default '',
  add column if not exists fila_entrou_em timestamptz null,
  add column if not exists fila_saiu_em timestamptz null,
  add column if not exists gravacao_disponivel boolean not null default false;
create index if not exists idx_nuvidio_convites_call on public.nuvidio_convites (call_id) where call_id <> '';

-- inbox durável: TODO webhook entra aqui antes de qualquer regra (nada se perde)
create table if not exists public.nuvidio_webhooks_recebidos (
  id uuid primary key default gen_random_uuid(),
  hook_type text not null default '',
  invite_id text not null default '',
  call_id text not null default '',
  convite_id uuid null references public.nuvidio_convites (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  recebido_em timestamptz not null default now(),
  processado_em timestamptz null,
  erro text not null default ''
);
create index if not exists idx_nuvidio_wh_pendentes on public.nuvidio_webhooks_recebidos (recebido_em desc) where processado_em is null;
alter table public.nuvidio_webhooks_recebidos enable row level security; -- só service role
```

Código:
- `webhook/route.ts`: (a) chave via `Authorization` **ou** `?key=`, comparação com
  `timingSafeEqual`; (b) grava na inbox ANTES de processar e responde 200 mesmo
  se a regra falhar (o erro fica em `erro`); (c) `processarWebhook(inboxId)` em
  `src/lib/nuvidio/webhooks.ts` com o mapa da §3 (sem regex) e casamento em 6
  passos; (d) `nuvidio_eventos` continua recebendo `webhook:<hookType>` quando casa;
  (e) lente onboarding: em `chamada_realizada` grava só o evento
  `nuvidio_chamada_realizada` — **NÃO** escreve `nuvidio_video_url` (fatia 3).
- `criarInvite`/`criarNuvidioConvite`/`gerarConviteNuvidioOnboarding`: salvar `short_link`.
- Ação `reprocessarWebhooksNuvidio()` (perm `sistema-config-nuvidio`) + painel
  "Webhooks sem correspondência" no card da Nuvidio (últimos 50, hookType, quando,
  erro, botão Reprocessar). Serve pra ajustar o casamento depois do 1º evento real.

Aceite: (1) mesmo payload 2× → estado igual; (2) convite `aprovado` +
`attendant_closed_issue` → continua `aprovado`; (3) `new_call_started` sem invite
→ casa via `GET /v1/api/call/:id`; (4) payload desconhecido → inbox com erro e 200;
(5) chave errada → 401 e NADA gravado. Check executável: script em `scripts/`
que faz POST dos 4 payloads da doc contra `localhost:3000` e confere o banco.

### Fatia 2 — Ciclo de vida do convite e permissões (modelo: **Sonnet**)
Padrão já existe; sem migration; depende da fatia 1 só pelo `short_link`.
- `listarNuvidioConvites`: `requireAnyPermission([links, atendimento])`; com
  `origem='onboarding'` aceita também `agente-corban-cadastros-recebidos`.
  `tabular` segue `atendimento` can_edit.
- Expiração sem cron: no início de `listarNuvidioConvites`,
  `update ... set status='expirado' where status='aguardando_chamada' and expiration_at < now()`
  (idempotente; evento `expirado` só na 1ª vez, via `returning`).
- Agendamento: se `agendarPara`, `initialDate = agendarPara`, `expirationDate =
  agendarPara + expiracaoHoras`, validar `agendarPara > now`.
- `customerData`: `cpf`/`proposta` com `private: true`; onboarding manda `cpf` do
  sócio (label `cpf`) quando houver, além de `documento` (A13).
- `listarDepartments`: filtrar `disabled`; cache do JWT usa `tokenExpiration - 60s`.
- Placeholder do link (A10); template ganha `{{link_curto}}`.
- Links Criados / Acompanhamento: badge "Na fila" (derivado de `fila_entrou_em`
  sem `fila_saiu_em` e status `aguardando_chamada`) com tempo de espera.

### Fatia 3 — Gravação (modelo: **Sonnet** executa, **Fable** revisa)
Segue o padrão de evidência com hash de `uploadDocAnalise` (actions.ts ~1150).
- `client.ts`: `baixarGravacao(callId)` → `GET /v1/api/call/recording/:id` (blob,
  `{bytes, contentType}`); `buscarLinkGravacao` fica só pra visualização.
- Ação `obterLinkGravacao(conviteId)` (perms links|atendimento|cadastros): gera
  link fresco na hora do clique; botão "Ver gravação" quando `gravacao_disponivel`.
  **Nunca persistir o link** (`gravacao_url` deixa de ser escrita; coluna fica).
- Ação `arquivarGravacaoNoProcesso(conviteId)` (só `origem='onboarding'`, perm
  `agente-corban-cadastros-recebidos` can_edit): baixa o blob → sha256 → upload em
  `partner-analise` `${processoId}/video_nuvidio/...` → insere
  `corban_onboarding_docs_analise` (tipo `video_nuvidio`, hash, tamanho, mime) →
  `nuvidio_video_url = path` → evento. Botão na etapa Nuvidio do processo e em
  Acompanhamento. Guardas: tamanho máximo (300 MB) e `maxDuration = 300` no
  segmento; se a Nuvidio devolver 400 "não gravada", mensagem clara e sem retry
  automático. **Risco:** vídeo grande estoura memória/tempo da função → se
  acontecer, trocar por upload resumível (TUS) direto do blob; decidir na hora.

### Fatia 4 — Atendimento e SSO (modelo: **Sonnet**; SSO depende do suporte)
- Toque: tocar em `fila_entrou_em` novo (cliente esperando) E em `chamada_em_curso`;
  fila mostra "Na fila há Xs".
- SSO: `ssoAtendente` passa a devolver `{token, url|null}`; a URL só é montada
  quando o suporte confirmar o formato (ex.: `https://atendimento.nuvidio.com/?token=`).
  Sem URL: botão "Abrir portal do atendente" → `https://atendimento.nuvidio.com`.
  404 do SSO vira mensagem: "Cadastre na Nuvidio um atendente com o e-mail
  <e-mail do usuário> (Gestão › Atendentes)".
- Opcional (decisão do Bruno): botão "Criar atendente na Nuvidio" na tela de
  Usuários via `POST /v1/api/attendant` (`name, lastName, email, sendPassword`).
  Atendente **não pode ser excluído depois** (só suporte) → por isso é opcional.

### Fatia 5 — Opcionais (modelo: **Codex/Sonnet**, só se pedido)
- `NUVIDIO_API_BASE` por env (sandbox `api.sandbox.nuvidio.com`, acesso pelo suporte).
- Realtime em `nuvidio_convites` no lugar do polling de 10 s do Atendimento.
- Envio pelos canais da Nuvidio (`POST /v1/api/invite/whatsapp|email|sms`,
  `{phone|email, id|token|url, validateIsInviteActive}`) como alternativa aos
  templates próprios (403 se a feature estiver desligada no plano).

## 5. Modelos por etapa

| Etapa | Modelo | Por quê |
|---|---|---|
| Fatia 1 (webhook, migration, inbox, casamento) | Fable | fronteira de segurança, contrato novo, migration |
| Fatia 2 (ciclo de vida, permissões, textos) | Sonnet | execução sobre padrão definido aqui |
| Fatia 3 (gravação) | Sonnet + revisão Fable | padrão existe; storage/hash pedem revisão |
| Fatia 4 (atendimento/SSO) | Sonnet | UI; SSO bloqueado pelo suporte |
| Fatia 5 (opcionais) | Codex/Sonnet | mecânico |
| Revisão final + teste em produção | Fable + Bruno | — |

## 6. Perguntas ao suporte da Nuvidio (Bruno)
1. Login transparente: depois de `POST /v1/api/attendant/single-sign-on`, em qual
   URL e com qual parâmetro usamos o `token` pra abrir `atendimento.nuvidio.com`
   já logado? Funciona dentro de iframe?
2. Webhook: há retry quando nossa URL responde erro/timeout? Quantas vezes?
3. Depois de `call_finished`, quanto tempo até a gravação ficar disponível em
   `GET /v1/api/call/recording/:id`?
4. `POST /v1/api/invite/department/:id`: `:id` é o `id` ou o `identifier`?
   (a gente testa antes; perguntar só se der 404)
5. Acesso ao sandbox (`api.sandbox.nuvidio.com`) pra homologar sem gastar minutos.
Contato citado na doc: gustavo@nuvidio.com.br.

## 7. Roteiro de teste em produção (depois das fatias 1–2)
1. Card: escolher os 2 departamentos; conferir webhooks no painel (3 eventos,
   "dados completos" ligado, Autenticação = chave).
2. Criar Link com o celular do Bruno (CPF real do Bruno, proposta fictícia).
   Confere: `invite_id`, `link`, `short_link` gravados; convite abre no celular.
3. Entrar na fila → `fila_entrou_em` preenche, telefone toca no Atendimento.
4. Atendente (cadastrado com e-mail do Workspace) atende → `chamada_em_curso`.
5. Encerrar → `chamada_realizada`, `call_id`, `gravacao_disponivel`.
6. Tabular "aprovado" → salvar tabulação na Nuvidio (`attendant_closed_issue`)
   → status continua `aprovado`.
7. "Ver gravação" abre o vídeo (link fresco). Card › "Webhooks sem
   correspondência" vazio (ou explica o que não casou).
8. Lente onboarding com processo de teste (Bem Digital): gerar convite na etapa
   Nuvidio, repetir 3–7, "Arquivar gravação" conclui a etapa (fatia 3).

## 8. Ordem e dependências
Bruno (departamentos + webhooks + atendentes) → Fatia 1 (Fable) → Fatias 2 e 4
em paralelo (Sonnet) → teste §7 → Fatia 3 (Sonnet + Fable) → SSO quando o
suporte responder → Fatia 5 se fizer sentido. Uma worktree por fatia; migration
só da fatia 1, aplicada antes do deploy dela.
