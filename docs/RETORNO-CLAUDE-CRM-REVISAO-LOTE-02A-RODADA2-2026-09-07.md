# Retorno ao Astra — rodada 2 da revisão do lote 02A, 07/09/2026

Responde a `REVISAO-LOTE-02A-2026-09-07.md`, seção "Rodada 2 — commit
5fae89c". Correção localizada, mesma worktree e branch. **Sem push, deploy,
flag ligada, migration, escrita remota ou envio real.** Não mexi nas três
correções já aprovadas (P1 da 1ª rodada, P2, P3) nem no Workspace/02B.

| Item | Valor |
|---|---|
| Repo / worktree | `brs-alvoconsig` / `brs-alvoconsig-duravel` |
| Branch | `crm/lote-02a-ativacao-seletiva` |
| Commit da correção | `99e82b0`, em cima de `5fae89c` |
| Arquivos alterados | `services/engine/src/{server,durable-ingressos.test}.ts`, `docs/ATIVACAO-SELETIVA-DURAVEL.md` |

## P1 (2ª rodada) — account.id ausente ainda contornava o durável

Confirmado exatamente como descrito: sem `account.id`, `accountIdValido`
ficava falso, a resolução de conta era pulada por inteiro e o payload caía
direto em `outboundDoChatwoot`. O bridge real resolve a conversa por
`conversaPorChatwoot(conversationId, null)`, que ignora o filtro de conta
quando recebe `null` e devolve a linha se houver exatamente uma no banco
inteiro — inclusive de uma conta selecionada.

Correção: a mesma checagem de efeito externo (`external`) que já protegia o
id de mensagem ausente (P3) agora também governa a ausência de conta. Um
evento `message_created`/`outgoing`, não privado, que não é nosso eco, sem
`account.id` válido (ausente, zero ou negativo), é rejeitado com 422
`ACCOUNT_ID_REQUIRED` antes de qualquer chamada ao bridge. Evento sem efeito
externo (incoming, nota privada) continua seguindo o legado mesmo sem
`account.id`, porque o próprio `outboundDoChatwoot` já retorna antes de
qualquer envio nesses casos, com ou sem conta identificada.

## Testes

Seis casos novos ou substituídos em `durable-ingressos.test.ts`, com
`conversation` e `content` no payload como a revisão pediu (sem os dois o
cenário real nem chegaria perto do bridge):

- outgoing sem `account.id` → rejeitado, nunca cai no legado;
- `account.id` zero ou negativo → também rejeitado;
- incoming sem `account.id` → segue o legado, sem risco;
- nota privada sem `account.id` → segue o legado, sem risco;
- reentrega do mesmo evento sem `account.id` → rejeitada de novo, nunca
  reprocessada;
- conta fora do piloto com `account.id` **válido** → comportamento legado
  preservado, sem regressão.

Removi o teste antigo que esperava "ids inválidos seguem o legado" sem
diferenciar efeito externo — essa expectativa era exatamente o bug apontado.

## Validação

| Comando | Resultado |
|---|---|
| `npm test` | 73/73 (era 68) |
| `npm run test:db` | PASS (nenhuma migration tocada) |
| `npm run typecheck` | 0 erros |

## Roteiro

Corrigida em `docs/ATIVACAO-SELETIVA-DURAVEL.md` a frase que ainda afirmava
que ausência de conta segue o legado sem ressalva. Documentado o código
`ACCOUNT_ID_REQUIRED` ao lado do `MESSAGE_ID_REQUIRED` já existente.

## Limitações que permanecem

As mesmas do retorno anterior: encaminhamento real de `messages.upsert` para
o socket sem teste de integração; `enqueueEvent`/`eventoJaAceito` contra
Postgres real cobertos só em `tests/db/assertions.sql`. Nenhuma nova
limitação surgiu desta correção.
