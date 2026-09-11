# Proposta de migration — permitir múltiplos wa_id por chatwoot_message_id (revisão 2)

**Não aplicada.** Migrations do Supabase compartilhado saem exclusivamente
da pasta principal do `brs-workspace` (REGRA FIXA) — isto é só a proposta,
pra quem for aplicar decidir e rodar com timestamp real. Revisão 2: ajusta
a proposta original (`revisão 1`, rejeitada) segundo os três pontos da
revisão Astra de 09/09/2026 — índice não único, sequência de publicação,
semântica da âncora não presumida.

## Achado (mantido da revisão 1)

Conferido o schema real de `chat_mensagens_mapa` via `pg_indexes` (não
aparece em `pg_constraint` por não ser uma constraint nomeada — por isso
passou batido até agora):

```
chat_mensagens_mapa_pkey  — UNIQUE (id)                        [ok, é a PK]
chat_mensagens_mapa_wa_idx — UNIQUE (instancia_id, wa_id)       [ok, é o dedupe real]
chat_mensagens_mapa_cw_idx — UNIQUE (chatwoot_message_id)       [problema]
```

Uma mensagem do Chatwoot com múltiplos anexos gera múltiplas chamadas de
envio (uma por anexo), cada uma com seu próprio `wa_id` — mas todas
compartilham o MESMO `chatwoot_message_id`. O índice único em
`chatwoot_message_id` SOZINHO impede gravar mais de uma linha para essa
mensagem.

## Proposta (corrigida — revisão 1 rejeitada por só dropar o índice)

```sql
drop index if exists public.chat_mensagens_mapa_cw_idx;
create index if not exists chat_mensagens_mapa_cw_idx
  on public.chat_mensagens_mapa (chatwoot_message_id);
```

Troca o índice único por um índice comum (não único) sobre a mesma coluna
— preserva o caminho de busca por `chatwoot_message_id` (usado por
`mapaPorChatwootId`), sem a restrição de cardinalidade 1:1 que hoje
inviabiliza múltiplos anexos. `chat_mensagens_mapa_wa_idx` (único em
`instancia_id, wa_id`) não muda — continua sendo o dedupe real.

## Sequência de publicação (ponto 2 da revisão — não estava nesta proposta antes)

Inventário de leitores de `chat_mensagens_mapa` nos dois produtos que
compartilham este Supabase (`brs-alvoconsig` e `brs-workspace`):

```
grep -rl chat_mensagens_mapa apps/web/src            → nenhum resultado
grep -rl chat_mensagens_mapa brs-workspace/src        → nenhum resultado
grep -rl chat_mensagens_mapa services/engine/src      → baileys.ts, bridge.ts, db.ts
```

O ENGINE é o único leitor/escritor direto da tabela — nem o CRM
(`apps/web`) nem o BRS Messenger (`brs-workspace`) consultam
`chat_mensagens_mapa` diretamente; consomem ack/reação/citação através dos
endpoints do próprio engine. Isso simplifica a sequência, mas não elimina
o risco: **o código do engine com a leitura compatível
(`mapaPorChatwootId` com `.order('id').limit(1)` antes do `.maybeSingle()`,
já no commit `071b3c3` + correções desta rodada) precisa estar
DEPLOYADO no Railway antes (ou junto, no mesmo release) de a migration
permitir de fato 1:N** — não porque outro leitor quebraria imediatamente
(nada além do próprio novo código de `registrarVinculoEnvio` cria uma 2ª
linha hoje), mas porque a migration sozinha já reduz a garantia que o
código ANTIGO presumia, e não há necessidade de correr esse risco por uma
janela de deploy.

**Risco de rollback**, registrado como pedido: uma vez que existam
mensagens reais com 2+ linhas por `chatwoot_message_id` (depois que
migration + código novo estiverem os dois no ar e uma mensagem
multi-anexo de verdade passar), reverter o CÓDIGO para uma versão sem o
`.limit(1)` volta a quebrar com PGRST116 especificamente para essas
mensagens — não é mais um rollback limpo depois desse ponto. Reverter a
MIGRATION (recriar o índice único) sem antes migrar/apagar as linhas
excedentes também falharia (violação do índice ao recriar).

## Semântica da âncora — aberta, não resolvida aqui (ponto 3 da revisão)

`mapaPorChatwootId` usa `.order('id', {ascending:true}).limit(1)` só para
NUNCA quebrar com PGRST116 se/quando existir mais de uma linha — isso é
tudo que a mudança garante. `order by id` é a ordem de INSERÇÃO da linha,
não uma prova de ordem de ENVIO (reentrega/retentativa podem gravar fora
de ordem). Não presumir, sem decisão explícita, que:

- a linha de menor `id` é "o primeiro anexo" para fins de citação — pode
  ser uma convenção aceitável, mas precisa ser decidida e documentada como
  tal, não inferida da implementação;
- a mesma seleção (uma linha) resolve o caso de ack/reação de uma mensagem
  multi-anexo — ack/reação hoje são por `chatwoot_message_id` inteiro
  (tabelas `chat_mensagem_status`/`chat_mensagem_reacoes`, não afetadas por
  esta migration), então não há, por enquanto, uma pergunta de agregação
  aí — mas se algum consumidor futuro precisar saber o status de CADA
  anexo individualmente, vai precisar de outro campo (ex.: uma coluna de
  sequência/posição do anexo), não da ordem de `id`.

Se citação precisar de uma âncora com semântica garantida (ex.: sempre o
PRIMEIRO anexo de verdade, mesmo com reentrega fora de ordem), a proposta
correta é uma coluna dedicada (`posicao`/`enviado_em`) preenchida no
momento do envio — não coberta nesta migration, registrada aqui como
possível próximo passo, não decidida.

## Quando aplicar

Junto ou logo após o deploy do código do engine que já lê com `.limit(1)`
(commit `071b3c3` + correções desta rodada) — não antes, pelo motivo do
item de sequência acima. Nenhuma migration remota nesta rodada.
