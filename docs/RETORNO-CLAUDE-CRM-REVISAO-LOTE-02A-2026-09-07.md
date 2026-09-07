# Retorno ao Astra — correções da revisão do lote 02A, 07/09/2026

Responde a `REVISAO-LOTE-02A-2026-09-07.md`. Corrigido na mesma worktree e
branch do lote 02A, commit local separado. **Sem push, deploy, flag ligada,
migration, escrita remota ou envio real.**

| Item | Valor |
|---|---|
| Repo / worktree | `brs-alvoconsig` / `brs-alvoconsig-duravel` |
| Branch | `crm/lote-02a-ativacao-seletiva` (mesma do lote 02A) |
| Commit da correção | `5fae89c`, em cima de `1f9d086` |
| Arquivos alterados | `services/engine/src/{server,baileys,durable-gate,send-operation,durable-ingressos.test}.ts`, `docs/ATIVACAO-SELETIVA-DURAVEL.md` |

## P1 — remover conta do piloto permitia repetir envio já registrado

Confirmado exatamente como descrito: o `claimSend` só rodava dentro de
`if (duravel)`. Corrigido com uma checagem de leitura nova,
`operacaoRegistrada` (`send-operation.ts`), que roda em `/enviar` sempre que
o corpo traz um `operationId` UUID válido — **antes de qualquer efeito
externo** e **independente do `duravel` do momento**. Se já existe registro:
conteúdo igual e `completed` devolve o mesmo resultado; conteúdo diferente dá
409 `OPERATION_CONTENT_CONFLICT`; qualquer outro status dá 409
`DELIVERY_UNCERTAIN`. Nunca cria registro para conta fora do piloto — só
`claimSend` (chamado quando `duravel`) insere. Falha na consulta propaga como
500 pelo `setErrorHandler`, nunca autoriza o envio.

Quatro testes novos cobrem `completed`, `processing`, `uncertain` e conflito
de conteúdo, todos retirando a conta do piloto entre a primeira tentativa e o
retry.

## P2 — desligar a flag global removia a proteção de eventos já aceitos

Confirmado: `eventoJaAceito` só era consultado quando `duravelLigadoNoProcesso()`
retornava true. Removi essa função e a condição nos três ingressos —
webhook Chatwoot, webhook Z-API e `messages.upsert` do Baileys. A consulta
agora roda sempre que existe identidade de evento, com a flag ligada ou não.

Para o Baileys, extraí a decisão de roteamento para
`durable-gate.ts:decidirRoteamentoBaileys` — recebe conta, instância e a
identidade da mensagem (id, remoteJid, fromMe) e devolve a ação
(`enfileirar`/`ja_aceito`/`inline`) sem tocar em socket. Isso resolve também
a lacuna que eu próprio tinha documentado ("handler `messages.upsert` exige
socket real, não testado"): agora o roteamento é testado diretamente, sem
subir uma sessão Baileys.

Cinco testes novos: Chatwoot e Z-API com a flag desligada, e três cenários de
`decidirRoteamentoBaileys` (enfileira, inline por conta fora do piloto,
protegido mesmo com a flag desligada).

## P3 — mensagem sem ID desviava conta selecionada para o legado

Confirmado: a seleção da conta dependia de `account.id` **e** `id` da
mensagem válidos juntos (`idsValidos`). Separei as duas coisas: a seleção da
conta passa a depender só de `account.id`. Um evento
`message_created`/`outgoing` com potencial de efeito externo, numa conta
selecionada, sem `id` válido (ausente, zero ou negativo) agora é **rejeitado
com 422 `MESSAGE_ID_REQUIRED`** — não enfileira, não cai no legado, não
inventa chave. Eventos sem efeito externo (eco, nota privada, incoming) numa
conta selecionada continuam entrando na fila normalmente, usando um digest do
payload como chave quando o id não existe — mesmo padrão que o webhook Z-API
já usava. Contas fora do piloto continuam no comportamento legado de sempre,
com ou sem id.

Quatro testes novos: rejeição sem id, rejeição com id zero/negativo, evento
sem efeito externo aceito mesmo sem id, e conta fora do piloto preservada.

## Validação

| Comando | Resultado |
|---|---|
| `npm test` | 68/68 (era 54; 14 testes novos) |
| `npm run test:db` | PASS (nenhuma migration tocada) |
| `npm run typecheck` | 0 erros |

## Roteiro atualizado

`docs/ATIVACAO-SELETIVA-DURAVEL.md` foi ajustado onde a revisão apontou que o
texto não se sustentava mais: a seção de drenagem agora deixa claro que os
passos existem para dar tempo ao worker de concluir trabalho pendente, não
como pré-requisito de segurança contra duplicidade — essa proteção agora
independe da flag. Acrescentei também que envios diretos não têm passo de
drenagem equivalente (a proteção por `operationId` é permanente por
natureza, sem worker nem fila envolvidos).

## Limitações que permanecem

- O encaminhamento real de `messages.upsert` para o socket (fora da decisão
  de roteamento agora extraída) continua sem teste de integração — exigiria
  uma sessão Baileys de verdade.
- `enqueueEvent`/`eventoJaAceito` contra Postgres real continuam cobertos só
  em `tests/db/assertions.sql`, não nos testes de rotas (que usam Supabase
  simulado).
- Não investiguei se existem outros pontos no código, fora do escopo desta
  revisão, que dependiam de `duravelLigadoNoProcesso()` — a busca cobriu só
  os três ingressos citados na revisão e confirmou que eram os únicos usos.
