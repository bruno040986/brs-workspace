# Handoff — Fundação do chat AlvoConsig (05/09/2026)

Revisão Fable 5.1 sobre o trabalho do coordenador anterior (GPT "Astra", cota
esgotada em 05/09 ~00:54). Documento de passagem para a próxima sessão — feita
para rodar em **Sonnet 5**, com Fable só na revisão final de cada etapa.

Contexto completo: [auditoria](AUDITORIA-ALVOCONSIG-2026-09-04.md) (17 achados)
→ [plano](PLANO-IMPLEMENTACAO-ALVOCONSIG-2026-09-05.md) (7 etapas, critérios de
aceite) → este handoff. Branch nos dois repos: `codex/alvoconsig-chat-foundation-20260905`.

## O que está pronto (etapas 1–4 do plano, parcial)

**brs-workspace** — 8 migrations, renumeradas com timestamp real, **APLICADAS em produção 05/09 ~01:50** (flags seguem desligadas):

| Migration | O quê | Consumidor no CRM |
|---|---|---|
| `20260905013748_crm_chat_autorizacao` | `crm_chat_membro_do_canal` passa a exigir tenant habilitado + `chat_interno.usar` (revogação vale no Realtime) | policy existente em `crm_chat_mensagens` |
| `20260905013749_chat_eventos_duraveis` | inbox `chat_engine_jobs` + `chat_engine_claim/finish/renew` (lease, backoff, `uncertain` p/ envios) | `services/engine/src/event-inbox.ts` (flag `ENGINE_DURABLE_EVENTS`) |
| `20260905013750_chat_envios_idempotentes` | `chat_envios_operacoes` (operation_id por instância) | `services/engine/src/send-operation.ts` |
| `20260905013751_chat_historico_proprio` | `crm_pessoas`, `crm_relacionamentos`, `chat_timelines`, `chat_historico_*`, RPCs `crm_assegurar_relacionamento` / `chat_assegurar_timeline` / `chat_gravar_historico`, bucket `crm-historico-midia` | `services/engine/src/history.ts` (flag `ENGINE_OWNED_HISTORY`) |
| `20260905013752_crm_preservar_expurgo` | `crm_historico_registros` + triggers BEFORE DELETE em `crm_contatos`/`crm_tabulacoes` + `crm_relacionamento_visivel` | `apps/web/src/app/api/crm/historico/route.ts` |
| `20260905013753_chat_instance_leases` | posse de socket Baileys por réplica | `services/engine/src/baileys.ts` (flag `CHAT_INSTANCE_LEASES`) |
| `20260905013754_chat_uploads` | `chat_upload_tickets` (upload direto ao bucket `parceiro-midias`) | `apps/web/src/lib/chat/actions.ts` |
| `20260905013755_crm_disparo_duravel` | lease + status `incerto` na `crm_disparo_fila`, `crm_disparo_cadencia`, `crm_disparo_claim/finish` | `apps/web/src/app/api/cron/disparo-whatsapp/route.ts` (migrado 05/09 — ver seção Sonnet abaixo) |

**brs-alvoconsig** — ~25 arquivos modificados + ~20 novos (+580/−170). Correções
dos achados 01, 02, 04 (parcial), 07, 08, 10, 11, 13, 15, 17 da auditoria; tudo
novo atrás de flag desligada. Ambiente de teste: Postgres isolado
(`npm run test:db:start`, porta 55432, container `alvoconsig-test-db`).

**Estado verificado 05/09 01:40:** `npm test` 18/18 · `npm run test:db` PASS ·
`npm run typecheck` limpo.

## O que a revisão Fable mudou (05/09)

1. **Migrations do CRM movidas para o Workspace** (`chat_instance_leases`,
   `chat_uploads`) — regra do grupo: migrations do Supabase compartilhado saem só
   daqui. As duas estavam **sem RLS e sem revoke**; as 3 funções de lease eram
   `security definer` executáveis por qualquer `authenticated` (qualquer usuário
   logado derrubava a posse de um número). Corrigido + asserções em
   `tests/db/assertions.sql`.
2. **Trigger de expurgo não aborta mais o DELETE.** Versão original levantava
   `IDENTITY_REQUIRED`/`CPF_INVALID` e travaria `crm_campanha_encerrar` em
   produção no primeiro contato sem CPF de 11 dígitos (CPF com zero à esquerda
   perdido no Excel é comum). Agora arquiva com `relacionamento_id null` +
   `identidade_erro`; reconciliação vira fluxo explícito. Teste em
   `tests/db/history.sql`.
3. **`crm_disparo_claim`** recicla também linhas `enviando` com `lease_until`
   nulo (legado do worker antigo) → `incerto`.
4. **Renumeração** das 8 com `date` real (`013748`…`013755`), ordem preservada.
   Script `scripts/test-db.mjs` passou a localizar por sufixo.
5. `baileys.ts:56` — `.catch` em builder do Supabase → `try/catch` (typecheck).

## Etapa 4 restante — feito pela sessão Sonnet (05/09)

1. **Cron `disparo-whatsapp` migrado** para `crm_disparo_claim`/`crm_disparo_finish`.
   O claim otimista manual (`update ... where status='pendente'`) saiu; a RPC
   já reconcilia lease vencida, aplica cadência por parceiro e devolve no
   máximo 1 item por parceiro elegível. Distinção nova, central pro plano
   ("timeout após possível envio exige reconciliação"): erro de **validação
   local** (template sumiu, instância desconectada — nunca tentou enviar) vira
   `falhou`/`pendente`; erro na **chamada ao engine em si** (rede, timeout,
   5xx — pode ter chegado no WhatsApp) vira `incerto` e nunca é reenviado
   sozinho. `tests/db/disparo.sql` (novo) cobre dois workers no mesmo tick,
   campanha pausada isolando só o parceiro afetado, retomada, e lease vencida
   → `incerto`. `crm_disparo_duravel` entrou em `scripts/test-db.mjs` — os 3
   testes de banco agora cobrem as 8 migrations (não mais 7).
2. **Bootstrap agregado — parcial.** `atendimento-read-client.ts` já cobria
   mensagens (`lerConversa`, com cursor `before`) e fila (`lerFila`, com
   `page`/`nextSourcePage`). Migrados agora os dois polls de 10s que ainda
   eram Server Action (achado 03): resumo do lead (`PainelLead.tsx`) e
   tabulações/eventos da conversa (`ConversaCentro.tsx`) — novos recursos
   `resource=resumo|pastas|tabulacoes` em `/api/crm/atendimento`, mesma
   autorização de sempre (a rota só delega pras actions existentes). Cadência
   de fetch preservada (não virou uma tela mais lenta nem mais rápida, só
   tirou a fila de Server Actions do caminho). `getLeadResumo` continua como
   Server Action em `LigacaoCentro.tsx`/`ChatInterno.tsx` — são chamadas
   avulsas (on-mount), não polls, fora do escopo do achado.
3. **Paginação por cursor — já em boa parte pronta**, não precisou de mudança:
   mensagens usam `before` (cursor por id do Chatwoot), fila usa
   `page`/`nextSourcePage`/`temMais`. **Ainda falta**: busca por CPF/IDWS que
   não dependa só da 1ª página do Chatwoot (achado 05, mais fundo que UI —
   exige índice próprio) e virtualização de lista (só se o volume medido
   justificar, plano não pede sem medir).

**Estado verificado 05/09 ~04:50:** `npm test` 18/18 · `npm run test:db` PASS
(8/8 migrations) · `npm run typecheck` limpo.

## Etapa 5 — parcial (Sonnet, 05/09)

Achados de leitura de código (a auditoria de 04/09 não cobriu a seção 5 em
detalhe) mapeados 1:1 na seção 5 do plano, corrigidos sem precisar de schema:

1. **Fechar exigia só um motivo opcional — sem tabulação nem decisão de
   funil.** `encerrarConversaAtendimento` agora recebe `{ tabulacao, estagio }`
   em vez de um `motivo` livre. Com lead vinculado, os dois são obrigatórios e
   gravados (via `moverEstagio`+`addTabulacao`, mesmo par que `PainelLead.tsx`
   já usa) ANTES do resolve no Chatwoot — se falhar, a conversa continua
   aberta. Sem lead vinculado (FK de `crm_tabulacoes` exige `contato_id`) só o
   texto é exigido — limitação de schema, documentada, não simulada.
2. **Reabertura de conversa resolvida era silenciosa.**
   `services/engine/src/chatwoot.ts:reabrirSeResolvida` só trocava o status;
   agora deixa uma nota privada identificável ("🔓 Atendimento reaberto..."),
   mesmo idioma que assumir/transferir/encerrar já usavam.
3. **Falsa confirmação ao criar lead receptivo com CPF/Nome/Telefone/Convênio
   ok mas sync do WeSales falhando.** `criarLeadDaConversa` já exige os
   quatro campos (isso já estava certo); o toast em `AtendimentoShell.tsx` é
   que dizia "Lead criado." mesmo com `idws` nulo. Novo tipo de toast
   `aviso` (`ui.tsx`, âmbar) avisa "sincronização pendente" em vez de
   confirmar um vínculo que não existe.

**O resto da seção 5** (tags por conversa, atribuição atômica, agendamento
individual persistente, rascunhos, citação de mensagem, busca, galeria,
ordenação por espera, sidebar recolhível) tem status desigual — alguns
precisam de migration, outros só não foram feitos ainda. Detalhe completo,
com SQL de rascunho pros que precisam de schema, em
[PROPOSTA-SCHEMA-ATENDIMENTO-2026-09-05.md](PROPOSTA-SCHEMA-ATENDIMENTO-2026-09-05.md).

**Estado verificado 05/09 ~06:10:** `npm test` 18/18 · `npm run typecheck`
limpo. (`test:db` não muda com esta entrega — nenhuma migration nova.)

## Etapa 6 — parcial (Sonnet, 05/09)

Rotação e delay (fórmula canônica `(i + N·(volta%3) + ⌊volta/3⌋) % M`, saco de
delays sem reposição) já estavam corretos de uma sessão anterior — conferidos
à mão contra o exemplo do plano (10 números, 30 templates) e agora com teste
próprio (`disparo.test.ts`, caso `rotação canônica 10x30`).

**Feito:**
1. **Worker persistente no engine** (`services/engine/src/disparo-worker.ts`,
   flag `ENGINE_DISPARO_WORKER`, desligada) — resolve "cron de minuto não
   serve pra cadências de 5s" reivindicando `crm_disparo_claim` a cada 1-2s em
   vez de 1x/minuto. Cron do Next.js continua sendo o caminho ativo.
2. **Prévia das rodadas** no wizard de campanha, antes de criar.
3. **Painel de progresso do disparo** em `CampanhaDetalhe.tsx` — e dois bugs
   corrigidos em `getProgressoDisparo` de quebra: função nunca tinha UI que a
   chamasse, contava em memória sem paginação (undercontava campanha grande)
   e não incluía o status `incerto`.
4. **Só uma campanha de disparo ativa por parceiro** (pedido do Bruno,
   05/09/2026, durante a revisão): a cadência é por parceiro, não por
   campanha — duas ativas embaralhariam o rodízio uma da outra.
   `existeDisparoAtivo` trava no servidor (criar e retomar); `CampanhasHub.tsx`
   e `CampanhaDetalhe.tsx` desabilitam os botões correspondentes na tela.
   Campanhas simultâneas com números disjuntos ficou cogitado pro futuro —
   detalhe na proposta.

**Não feito — precisa de decisão do Bruno antes de codar** (detalhe em
[PROPOSTA-SCHEMA-ATENDIMENTO-2026-09-05.md](PROPOSTA-SCHEMA-ATENDIMENTO-2026-09-05.md#etapa-6-disparos-e-métricas-por-instância--0509-sessão-sonnet)):
fluxo técnico entre números controlados (código que inicia conversa sozinho,
categoria nova — quero confirmação do objetivo e dos limites numéricos antes
de desenhar schema), versionar edição de pool em campanha ativa (a própria
edição do pool não existe ainda), limite numérico de envios por instância
(sem um número, não dá pra codificar).

**Estado verificado 05/09 ~07:00:** `npm test` 21/21 (+3 do engine) ·
`npm run test:db` PASS · `npm run typecheck` limpo.

## Decisões do Bruno + 5 migrations novas (Fable, 05/09 tarde)

Bruno decidiu fazer agora: atribuição atômica, solicitação operacional como
registro próprio + painel, mídia no chat interno, limite de envios/dia por
número (campo na aba AlvoConsig), tráfego técnico desenhado mas **desligado**.
Migrations `20260905125418`…`125422` commitadas nesta branch, validadas no
Postgres de teste, **NÃO aplicadas** — push só depois do merge em `main`,
pela pasta principal. Detalhe, revisão e as 5 frentes que o Sonnet implementa
em seguida (a)–(e): fim de
[PROPOSTA-SCHEMA-ATENDIMENTO-2026-09-05.md](PROPOSTA-SCHEMA-ATENDIMENTO-2026-09-05.md).

**Worktrees (regra nova, GRUPO.md):** esta frente vive em
`brs-workspace-chat` e `brs-alvoconsig-chat` (branch codex). As pastas
principais ficam em `main` e são só estação de merge. Nunca `git checkout`
na pasta principal.

## Regras para a sessão Sonnet

**Pode fazer sem perguntar:** código TS/TSX do CRM e do engine, testes,
componentes, Server Actions, rotas GET, docs. Rodar `npm test`, `npm run
test:db`, `npm run typecheck` a cada entrega — **os três precisam passar** antes
de qualquer commit.

**Para e devolve ao Fable:** migration nova ou alteração em SQL existente;
qualquer `security definer`, policy RLS, grant/revoke; mudança em `session.ts`,
`proxy.ts`, `autorizacao.ts`, `sessao-cache.ts`; ligar flag em ambiente
publicado; `supabase db push`; deploy. Se uma etapa precisar de schema novo,
escrever a proposta de SQL em `docs/` e seguir com outra frente.

**Nunca:** número/credencial real em fixture, log, commit ou prompt; tráfego
para lead real; alterar a stack Docker `bem-varejo`.

## Próximos passos, em ordem

1. ~~Bruno aprova e aplica~~ **FEITO 05/09** — 8 migrations aplicadas (`supabase db push`;
   conferir `npx supabase migration list` antes — remoto está sincronizado até
   `20260903220713`). Flags continuam **desligadas** depois do push.
2. ~~Etapa 4 restante~~ **FEITO 05/09 (Sonnet)** — ver seção acima. Sobrou só a
   busca por CPF/IDWS além da 1ª página e virtualização (medir antes).
3. **Etapa 5 — parcial, FEITO 05/09 (Sonnet)** — ver seção acima. Resto na
   proposta de schema + backlog schema-free (drafts, citação, busca, galeria,
   ordenação por espera, sidebar).
4. **Etapa 6 — parcial, FEITO 05/09 (Sonnet)** — ver seção acima. Sobrou fluxo
   técnico entre números controlados, versionamento de pool e limite por
   instância — todos esperando decisão do Bruno, não código.
5. **Etapa 7 (Sonnet):** painéis de simulação/digitação + chat interno.
6. **Ativação gradual (Fable + Bruno):** `ENGINE_DURABLE_EVENTS` → 
   `CHAT_INSTANCE_LEASES` → `ENGINE_OWNED_HISTORY`, um tenant de teste por vez,
   com a homologação real do plano (pareamento, 2 números, destinatário
   autorizado).

## Pendências conhecidas

- Job de limpeza de `chat_upload_tickets` vencidos e de sinais Realtime
  (achado 16) não agendados.
- `chat_historico_canais.conversa_legada_id` sem `on delete` de propósito:
  hard-delete de `chat_conversas` passa a falhar (histórico sobrevive). Só há
  soft-delete hoje.
- Registros com `identidade_erro` preenchido precisam de tela/fluxo de
  reconciliação (não existe).
- Validação real de WhatsApp (Baileys/Z-API), Chatwoot e p50/p95 da tela: só
  com números pareados — ver "Homologação posterior" no plano.
