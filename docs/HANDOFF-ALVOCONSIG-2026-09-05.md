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
| `20260905013755_crm_disparo_duravel` | lease + status `incerto` na `crm_disparo_fila`, `crm_disparo_cadencia`, `crm_disparo_claim/finish` | **ninguém ainda** — cron `disparo-whatsapp` continua no claim antigo |

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
2. **Etapa 4 restante (Sonnet):** trocar cron `disparo-whatsapp` para
   `crm_disparo_claim/finish` (contrato já no SQL; testar 2 workers, pausa,
   lease vencido); bootstrap agregado + GETs autenticados no atendimento
   (`atendimento-read-client.ts` já existe — falta ligar nos componentes);
   paginação por cursor na fila e no histórico (achado 05).
3. **Etapa 5 (Sonnet):** ferramentas de atendimento — spec no plano, seção 5.
4. **Etapa 6 (Sonnet):** disparos — `montarRotacao` já implementa a fórmula
   `(i + N·(volta%3) + ⌊volta/3⌋) % M`; falta pool versionado, prévia das
   rodadas, worker com agenda persistente (cron de minuto não serve para
   cadência de 5 s) e o fluxo técnico entre números controlados (desligado).
5. **Etapa 7 (Sonnet):** painéis de simulação/digitação + chat interno.
6. **Ativação gradual (Fable + Bruno):** `ENGINE_DURABLE_EVENTS` → 
   `CHAT_INSTANCE_LEASES` → `ENGINE_OWNED_HISTORY`, um tenant de teste por vez,
   com a homologação real do plano (pareamento, 2 números, destinatário
   autorizado).

## Pendências conhecidas

- `test:db` cobre 7 das 8 migrations; `crm_disparo_duravel` fica de fora porque
  o fixture não tem `crm_disparo_fila`/`crm_campanhas_parceiro` — adicionar ao
  `bootstrap.sql` quando o cron migrar.
- Job de limpeza de `chat_upload_tickets` vencidos e de sinais Realtime
  (achado 16) não agendados.
- `chat_historico_canais.conversa_legada_id` sem `on delete` de propósito:
  hard-delete de `chat_conversas` passa a falhar (histórico sobrevive). Só há
  soft-delete hoje.
- Registros com `identidade_erro` preenchido precisam de tela/fluxo de
  reconciliação (não existe).
- Validação real de WhatsApp (Baileys/Z-API), Chatwoot e p50/p95 da tela: só
  com números pareados — ver "Homologação posterior" no plano.
