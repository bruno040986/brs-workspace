# Retorno ao Astra — CRM AlvoConsig, lote 01 de retomada (07/09/2026)

Responde a `RECADO-CLAUDE-CRM-RETOMADA-2026-09-07.md`. Só leitura e testes
locais: nenhum código funcional, migration, flag, deploy ou envio real.
Evidência bruta em `EVIDENCIAS-CRM-RETOMADA-LOTE-01-2026-09-07.md`.

## Referência analisada

| Repo | Branch/SHA lido | Observação |
|---|---|---|
| `brs-alvoconsig` | `main` = `f1d6bb9` (testes rodados na worktree `brs-alvoconsig-grupos`, mesmo SHA) | Sem delta desde a conferência do Astra |
| `brs-workspace` | `main` = `7d73daa`; este retorno na worktree `brs-workspace-crm-retomada`, branch `crm/retomada-lote-01` | Sem delta. Migration `20260907113143_chat_mensagens_mapa_participant` (outra sessão) já aplicada no remoto |
| `codex/alvoconsig-chat-foundation-20260905` | 0 commits exclusivos nos dois repos (9 e 21 atrás) | Confere com o recado |

Deltas do engine após `b3a4e57` (commits `7275e41`, `5b77273`, `45fdb54`,
`f1d6bb9`): +509/−19 em `baileys.ts`, `bridge.ts`, `db.ts`, `server.ts` e
`grupos.ts` (novo). Nada em `event-*`, `send-operation`, `history`,
`lifecycle`. Únicas linhas da fundação alteradas: guarda de eco em
`bridge.ts:448` e flag `external` em `server.ts:306-308`, de `=== 'engine'`
para `ORIGENS_PROPRIAS_ENGINE.includes(...)` (`['engine','aparelho']`).

## 1. Inventário da fundação

| Linha | Implementação atual | Config necessária | Evidência de teste | Lacuna |
|---|---|---|---|---|
| Recepção durável | `server.ts`: webhooks Chatwoot/Z-API e `messages.upsert` do Baileys fazem `enqueueEvent` (upsert, `ignoreDuplicates`) quando `config.durableEvents`; senão processam inline. `index.ts:27` sobe `startEventWorker` → `processNextJob(jobStore, dispatchEvent)` | `ENGINE_DURABLE_EVENTS=true` (global, processo inteiro) | `assertions.sql:35-50` (dedupe, 2º worker vazio, token obsoleto, lease vencida recuperada, externo → `uncertain`, concluído não reenvia); `event-worker.test.ts` (3 classificações + `STALE_COMPLETION`) | Sem teste de `dispatchEvent` (payload Baileys via `BufferJSON`); `SESSION_UNAVAILABLE` conta tentativa e cai em `failed` após 8 mesmo sendo falta transitória de socket |
| Replay / resultado incerto | `chat_engine_claim` recicla lease vencida; `sends_external` → `uncertain`, nunca volta a `pending` (RPC nega). `chat_engine_finish` backoff `2^attempts` ≤ 300 s | idem | idem | **Não existe consulta nem ação de conciliação** para `uncertain`/`failed` em `chat_engine_jobs` (plano §4 pede "fila de erros consultável") |
| Envio idempotente | `server.ts:134-136` exige `operationId` UUID **só com durável ligado**; `claimSend` por fingerprint canônico; conflito de conteúdo → erro; repetido → resultado gravado ou 409 `DELIVERY_UNCERTAIN`; falha → `finishSend(null)` = `uncertain`. CRM: `engine.ts:11` injeta `operationId` aleatório em todo POST; cron de disparo usa `crm_disparo_fila.id` | `ENGINE_DURABLE_EVENTS` | `assertions.sql:23` (privilégio). **Nenhum teste de `claimSend`/`finishSend`** | (1) **Workspace (`src/lib/central-conversas/engine.ts:42`) chama `/enviar` sem `operationId`**: ligar a flag quebra o BRS Messenger com 400. (2) `operationId` do Atendimento nasce no helper HTTP, não na intenção: retry da action gera chave nova (idempotência só contra retry de rede, não contra duplo clique) |
| Origem/eco | `ORIGENS_PROPRIAS_ENGINE` em `bridge.ts:65`; dois pontos de uso (`bridge.ts:448`, `server.ts:308`). `origemEnvio:'aparelho'` derivado em `inboundBaileys` (fromMe que passou por `type!=='notify'` + `enviadasPorApi`) | — | Nenhum teste automatizado da guarda | Sem teste; Z-API fromMe não rotulado (0 instâncias) |
| Mapa de mensagens e citação | `chat_mensagens_mapa` gravado em `espelharMensagemNaConversa` (único call site de `enviarMensagem`); `in_reply_to` inbound via `mapaPorWaId`; `quoted.messageId` (id Chatwoot) → `mapaPorChatwootId`; `participant_jid` já existe no schema (`20260907113143`), **engine ainda não grava** | — | Nenhum | Engine gravar `participant_jid`; citação sem linha no mapa envia sem aviso |
| Histórico próprio por tenant/pessoa | `history.ts:preserveMessage` (só `agente_parceiro_id` não nulo) → storage `crm-historico-midia` + RPC `chat_gravar_historico`; leitura `GET /api/crm/historico` (`crm_relacionamento_visivel` + `chat_timelines`); botão em `PainelLead.tsx:191` | Engine `ENGINE_OWNED_HISTORY`; CRM `CRM_OWNED_HISTORY_READS` (server) + `NEXT_PUBLIC_CRM_OWNED_HISTORY` (UI). Três flags que precisam andar juntas | `history.sql`: idempotência por `provider_id`, 2 instâncias → 1 timeline, checkpoints, outro tenant negado, desalocação oculta/realocação restaura, carteira sobrevive, sem identidade não aborta | Com `ownedHistory` ligado, falha de download de mídia **lança** (`bridge.ts:344/393`) e derruba o inbound inteiro (plano pede "pendência recuperável"); sem importador; sem tela de reconciliação de `identidade_erro` |
| Desalocação/carteira/expurgo | Triggers BEFORE DELETE (`crm_preservar_expurgo`), `crm_historico_registros`, `crm_clientes_parceiro` | Ativo desde a migration (não depende de flag) | `history.sql:16-40` | — |
| Upload de arquivo | >1 MB: `criarTicketUploadChat` (10 min, 15 MB, allowlist MIME) → `uploadToSignedUrl` → `finalizarUploadChat` (só `pending` e não vencido → `finalizing` → confere tamanho/MIME → Chatwoot → `sent`). ≤1 MB: action multipart legada | — | `assertions.sql:21` (privilégio) | Ticket que falha **depois** de `finalizing` fica preso (não volta a `pending`, sem retry); limpeza de vencidos não agendada; **sem teste do fluxo** |
| Áudio gravado | `ConversaCentro.tsx:321`: `MediaRecorder` → sempre action multipart (nunca ticket) | — | Nenhum | Áudio >1 MB não usa o caminho direto (limite 15 MB ainda vale) |
| Disparo — despacho | Cron Next `disparo-whatsapp` (`maxDuration 300`, `CRON_SECRET` obrigatório) **é o caminho ativo**; `disparo-worker.ts` no engine (loopback `/enviar`, `LIMITE_POR_TICK 25`, tick 0,5–2 s) atrás de flag | Cron: `CRON_SECRET` (Vercel, não verificado). Worker: `ENGINE_DISPARO_WORKER` (ausente) | `disparo.sql` (2 workers, pausa isola parceiro, retomada, lease vencida → `incerto`, `incerto` não reclamado); `integrity.test.ts` (cron exige segredo) | Os dois caminhos duplicam a montagem do template (`disparo.ts` do engine ≠ `lib/crm/disparo.ts`) |
| Disparo — claim/finish, pool, intervalos, teto | RPC `crm_disparo_claim` (1 item por parceiro, cadência por parceiro, teto diário por instância dentro do claim, dia SP) / `crm_disparo_finish` por token. Pool: `montarRotacao` fórmula `(i + N·(volta%3) + ⌊volta/3⌋) % M`. Delays: saco sem reposição (`criarSacoDelaysMs`), fronteira sem repetição, **materializados na criação** (`agendado_para` cumulativo) | Teto: coluna `disparo_max_envios_dia_por_instancia` (**sem campo no Workspace** — `AlvoconsigTab` só tem os 4 limites de 03/09) | `disparo.test.ts` (rotação 10×30, pool não divisível, saco 60–300 = 241) + `decisoes-0509.sql:21-28` (teto bloqueia/libera) | Delay pré-calculado ≠ "a partir do envio efetivo" (plano §6); após pausa longa, itens vencidos dependem só da cadência; **status `incerto` sem ação de conciliação** (só contagem em `CampanhaDetalhe`) |
| Atribuição atômica | `atribuirConversa` (`atendimento-actions.ts:489`) **não usa** `atribuicao_lock_*` | — | `decisoes-0509.sql:15-17` só no SQL | Frente (a) não implementada |
| Tabulação/funil | `encerrarConversaAtendimento` exige `{tabulacao, estagio}` com lead | — | Nenhum | — |
| Citação, busca, galeria, tags, agendamento individual | **Nenhum** no CRM (`in_reply_to`, `search`, `waiting_since`, `crm_tags`, agendamento: 0 ocorrências) | — | — | Proposta §2–3 não iniciada; o Workspace já fez o equivalente no Messenger (não reaproveitável direto: outro tenant model) |
| Solicitações operacionais | Tabelas aplicadas; **0 consumidores** (`solicitarSimulacao` segue gravando mensagem de chat) | — | `decisoes-0509.sql` | Frente (b) não implementada |
| Mídia do chat interno | CHECK aberto; **0 consumidores** (`chat-interno*.ts` não emite `imagem/audio/documento`) | — | `decisoes-0509.sql:30` | Frente (c) não implementada |
| Tráfego técnico | Colunas + tabela, flag por parceiro `false`; **nenhum código** lê `trafego_tecnico_*`; filtro `origem <> 'tecnico'` no Atendimento e regra "não marca `respondida`" no engine **não existem** | Por parceiro (única flag realmente por tenant) | `decisoes-0509.sql:35` | Inerte enquanto desligado; frente (e) não iniciada |

## 2. Configuração (estado observado)

- **Railway/engine production** (nomes, valores redigidos): definidas
  `ENGINE_API_TOKEN`, `ENGINE_WEBHOOK_SECRET`, `ENGINE_PUBLIC_URL`,
  `CHATWOOT_URL`, `CRM_CREDENTIALS_KEY`, `SUPABASE_*`. **Ausentes** (logo
  desligadas): `ENGINE_DURABLE_EVENTS`, `ENGINE_OWNED_HISTORY`,
  `ENGINE_DISPARO_WORKER`, `CHAT_INSTANCE_LEASES` (+ owner/seconds).
- **Vercel/CRM**: não verificado (CLI não vinculada; MCP não lista envs).
- **Supabase**: 13/13 migrations da fundação constam aplicadas no remoto.
- **Flags globais impedem ativação por tenant**: as 4 do engine são do
  processo (um só engine serve CRM e BRS Messenger); `CRM_OWNED_HISTORY_READS`
  é global do app. Só `trafego_tecnico_habilitado` é por parceiro. "Um tenant
  de teste por vez" (handoff §6) **não é possível hoje** sem gate por
  `conta`/`agente_parceiro_id` no engine.

## 3. Validação local (worktree `brs-alvoconsig-grupos`, `f1d6bb9`)

| Comando | Resultado |
|---|---|
| `npm test` | 21/21 (15 web + 6 engine), 4,9 s |
| `npm run test:db` | PASS — bootstrap + 13 migrations + 4 arquivos de cenário, rollback, container `alvoconsig-test-db` |
| `npm run typecheck` | 0 erros (web + engine) |

Cobertura real dos cenários pedidos: **repetição de webhook** — só no
banco (`assertions.sql:37`), não no `enqueueEvent`; **timeout após possível
envio** — `chat_engine_*` e `crm_disparo_*` no SQL, `event-worker` unitário;
`claimSend`/`finishSend` **sem teste**; **recuperação de lease** — jobs,
disparo e `chat_instance_lease_*` no SQL; **isolamento entre tenants** —
canal interno e visibilidade de histórico; **preservação após expurgo** —
`history.sql`; **ciclo completo de delays** — só o tamanho/unicidade do saco
(`disparo.test.ts:21`), **não** a fronteira nem a persistência do cursor.

## 4. Cinco lacunas prioritárias (propostas, não executadas)

1. **`ENGINE_DURABLE_EVENTS` quebra o BRS Messenger.** Workspace não manda
   `operationId`. Proposta: engine gera `operationId` quando ausente e o
   registra como não-idempotente (ou exige só de chamadores com header
   `x-idempotency`), e/ou Workspace passa a mandar. Sem isso, nenhuma
   ativação do durável é possível.
2. **Sem gate por tenant nas flags.** Proposta: `durableEvents`/`ownedHistory`
   resolvidos por `inst.conta_id`/`agente_parceiro_id` (lista em env ou
   coluna em `crm_parceiro_config`/`chat_contas`), mantendo o global como
   fallback.
3. **`incerto`/`uncertain` sem conciliação.** Proposta: consulta + ação
   "marcar como enviado / voltar à fila / descartar" para `crm_disparo_fila`
   e `chat_engine_jobs`, com autoria; sem isso o caminho durável acumula
   itens que ninguém vê.
4. **Cinco migrations de 05/09 sem consumidor** (frentes a–e do handoff).
   Ordem sugerida: (a) trava em `atribuirConversa` (menor, sem UI nova) →
   (d) campo do teto na aba AlvoConsig → (b)/(c) → (e) por último.
5. **Mídia no histórico próprio derruba o inbound.** Proposta: com
   `ownedHistory`, falha de download vira pendência
   (`chat_historico_anexos.status='falhou'`) e a mensagem segue; plus job de
   retry. Junto: ticket de upload preso em `finalizing` volta a `pending`
   quando a etapa falhar antes do Chatwoot.

## 5. Menor fluxo homologável primeiro e o que impede

**Fluxo:** Atendimento receptivo em texto num único tenant de teste com
Baileys — inbound → Chatwoot → fila do CRM → resposta pelo composer → eco
filtrado — **com todas as flags como estão (desligadas)**. Já é o que roda
em produção; a homologação seria confirmar em ambiente controlado o que a
fundação não mudou. Impede hoje: números pareados e destinatário
autorizado (dependem do Bruno), nada de código.

**Primeiro passo da fundação nova:** `ENGINE_DURABLE_EVENTS` com o worker.
Impede: lacuna 1 (Workspace sem `operationId`) e lacuna 2 (flag global).
Depois de resolvidas, `CHAT_INSTANCE_LEASES` é o próximo com menor
superfície (só engine, testado no SQL), e `ENGINE_OWNED_HISTORY` por último
(três flags + lacuna 5).
