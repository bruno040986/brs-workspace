# Evidências — lote 01 de retomada (07/09/2026)

Worktree de execução: `brs-alvoconsig-grupos` em `f1d6bb9` (= main). Migrations lidas de `brs-workspace-crm-retomada` em `7d73daa` (= main) via `BRS_WORKSPACE_DIR`. Banco: container `alvoconsig-test-db` (label `alvoconsig-synthetic-tests`, 127.0.0.1:55432), transação com ROLLBACK. Stack `bem-varejo` não tocada.

## npm test
```
# tests 21
# pass 21
# fail 0
# skipped 0
# duration_ms 4947.953669
```
Subtests:
```
- um ID de conversa atribuído a outro atendente não passa pela guarda direta
- não envia o token para origem parecida com a do Chatwoot
- redirect externo recebe download sem token
- merge de histórico conserva mensagens antigas durante atualização recente
- cursor preserva desempate por id em timestamp igual
- cursor invalido nunca vira filtro SQL
- rotação canônica 10x30 produz as quatro rodadas especificadas
- pool não divisível por N usa todos os templates
- saco de delays percorre todos os segundos inclusivos
- cron exige segredo configurado e bearer exato
- reprovação calcula origem antes da escrita atômica
- telefone duplicado só confirma CPF igual pelo id do campo
- aplicarVariaveis troca chaves conhecidas e some com as sem valor
- aplicarVariaveis apara linhas em branco e espaços duplicados sobrando da substituição
- moedaBr formata em real e trata valor inválido/zero como vazio
- processing failure external=true attempts=1 => uncertain
- processing failure external=false attempts=1 => pending
- processing failure external=false attempts=8 => failed
- successful dispatch is confirmed only once and stale completion is reported
- generation fences old callbacks and keeps reconnect attempts across a new socket
- flush persists a pending auth change immediately without clearing it
```

## npm run typecheck
```
exit 0 — 0 ocorrências de 'error TS' (apps/web + services/engine)
```

## npm run test:db
```
> brs-alvoconsig@0.1.0 test:db:start
> node scripts/test-db-start.mjs
alvoconsig-test-db
PostgreSQL sintético disponível em 127.0.0.1:55432.
> brs-alvoconsig@0.1.0 test:db
> node scripts/test-db.mjs
PASS: migrations, isolamento de canal, revogação e fila durável (PostgreSQL local; rollback).
```

## Configuração remota consultada (só nomes)

Railway, serviço engine, ambiente production, `valuesRedacted: true` (leitura OAuth, nomes apenas), consultado 07/09 ~12:05:
```
CHATWOOT_URL CRM_CREDENTIALS_KEY ENGINE_API_TOKEN ENGINE_PUBLIC_URL ENGINE_WEBHOOK_SECRET LOG_LEVEL PORT SUPABASE_SERVICE_ROLE_KEY SUPABASE_URL (+ RAILWAY_* injetadas)
AUSENTES: ENGINE_DURABLE_EVENTS ENGINE_OWNED_HISTORY ENGINE_DISPARO_WORKER CHAT_INSTANCE_LEASES CHAT_INSTANCE_LEASE_OWNER CHAT_INSTANCE_LEASE_SECONDS
```

Supabase remoto: `npx supabase migration list --linked` 07/09 ~11:50 — as 13 migrations da fundação (`20260905013748`…`013755`, `20260905125418`…`125422`) constam local = remoto; também `20260907030221` e `20260907113143` (mapa de mensagens).

Vercel (projeto brs-alvoconsig): CLI não vinculada nesta worktree e o MCP não expõe variáveis — envs **não verificadas** (CRON_SECRET, CRM_OWNED_HISTORY_READS, NEXT_PUBLIC_CRM_OWNED_HISTORY, KV_REST_API_*, ENGINE_API_TOKEN). Último deploy production READY: `dpl_GDiPHpwjZD1YDHp1HQW43wHUmL75`.
