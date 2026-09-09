# Proposta de migration — permitir múltiplos wa_id por chatwoot_message_id

**Não aplicada.** Migrations do Supabase compartilhado saem exclusivamente
da pasta principal do `brs-workspace` (REGRA FIXA) — isto é só a proposta,
pra quem for aplicar decidir e rodar com timestamp real.

## Achado

Investigando o complemento pedido antes de publicar o engine (vínculo
wa_id↔chatwoot para envio via webhook, commit `071b3c3` da branch
`crm/identidade-lid-entrega`), conferi o schema real de
`chat_mensagens_mapa` via `pg_indexes` (não aparece em `pg_constraint` por
não ser uma constraint nomeada — por isso passou batido até agora):

```
chat_mensagens_mapa_pkey  — UNIQUE (id)                        [ok, é a PK]
chat_mensagens_mapa_wa_idx — UNIQUE (instancia_id, wa_id)       [ok, é o dedupe real]
chat_mensagens_mapa_cw_idx — UNIQUE (chatwoot_message_id)       [problema]
```

Uma mensagem do Chatwoot com múltiplos anexos gera múltiplas chamadas de
envio (uma por anexo), cada uma com seu próprio `wa_id` — mas todas
compartilham o MESMO `chatwoot_message_id` (é uma mensagem só, do ponto de
vista do Chatwoot). O índice único em `chatwoot_message_id` SOZINHO
impede gravar mais de uma linha para essa mensagem: só o primeiro anexo
consegue ser vinculado; os demais esbarram no índice.

## Proposta

```sql
drop index if exists public.chat_mensagens_mapa_cw_idx;
```

Só isso. `chat_mensagens_mapa_wa_idx` (único em `instancia_id, wa_id`)
continua sendo o índice de dedupe de verdade e não muda — é ele que
protege contra gravar o mesmo wa_id duas vezes; o índice removido nunca
serviu pra dedupe, só limitava (sem necessidade) a cardinalidade errada.

## Código já preparado para os dois estados

O código da branch `crm/identidade-lid-entrega` (commit `071b3c3`) já
funciona nos dois lados dessa migration, sem exigir coordenação de deploy:

- **Antes da migration** (schema atual): o 2º+ anexo de uma mensagem
  esbarra no índice, a gravação retorna "incerto" (testado explicitamente
  em `bridge-vinculo-webhook.test.ts`), mas o envio ao WhatsApp já
  aconteceu e não é afetado — sem reenvio, sem nota de erro pro operador.
  É uma melhoria sobre o estado anterior (nenhum anexo vinculado) mesmo
  sem a migration: pelo menos o primeiro anexo (ou o texto único) já fica
  rastreável.
- **Depois da migration**: todos os wa_id de uma mensagem multi-anexo
  ficam vinculados ao mesmo chatwoot_message_id.

Também corrigido nesse mesmo commit, necessário para QUALQUER um dos dois
estados após a migration: `mapaPorChatwootId` (db.ts, usado por
quoted/ack/reação) fazia `.maybeSingle()` sem `.limit(1)` — com 2+ linhas
por chatwoot_message_id (só possível depois da migration), isso viraria
PGRST116. Corrigido para pegar a primeira mensagem (âncora) do grupo via
`.order('id').limit(1)` antes do `.maybeSingle()` — coerente com o
WhatsApp só suportar citar um stanza id por vez.

## Quando aplicar

Sem urgência de sequência com o deploy do engine — o código já é seguro
nos dois estados. Pode ser aplicada antes, junto ou depois da publicação
do commit `071b3c3`, quando a sessão do Workspace tiver disponibilidade.
