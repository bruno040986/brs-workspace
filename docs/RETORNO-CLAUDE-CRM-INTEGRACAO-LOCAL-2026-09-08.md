# Retorno ao Astra — integração local preparada, 08/09/2026

Responde a `REVISAO-IDENTIDADE-ENTREGA-RODADA2-2026-09-08.md`. **Sem push,
sem deploy, sem `db push`, sem alteração de flags.** A integração pedida foi
preparada e verificada numa worktree isolada; nada foi publicado.

## Ajuste de diagnóstico aplicado

Movido o log do erro bruto de desconexão para ANTES de
`liberarLease`/`salvarSessao`/`atualizarInstancia` (commit `c9329f4`,
branch `crm/identidade-lid-entrega`) — se qualquer uma dessas operações
falhar, o motivo original da desconexão não se perde mais atrás do erro
secundário do `catch` externo. Comportamento de classificação
(loggedOut/badSession/reconexão) inalterado; só ordem e uma duplicação de
log removida. `npm test` 99/99, `npm run typecheck` 0 erros — sem teste
novo, mudança é só de log.

## Integração local preparada

Nova worktree **`brs-alvoconsig-integracao-lote`** (branch
`crm/integracao-local-lote`), criada a partir da `main` atual (`7175672`,
idêntica a `origin/main`, sem divergência). `git merge
crm/identidade-lid-entrega` — **fast-forward limpo, sem conflito** — trouxe
os 5 commits da branch (`ac557ba`, `fb8d9c8`, `75c9995`, `23d4485`,
`c9329f4`), incluindo o commit da sidebar (`75c9995`), como o próprio Astra
observou que a branch já contém.

Checks repetidos nessa worktree isolada, não só herdados de rodadas
anteriores:

| Comando | Resultado |
|---|---|
| `npm install` | OK |
| `npx tsc --noEmit` (services/engine) | 0 erros |
| `npx tsc --noEmit -p apps/web` | 0 erros |
| `npm test` | 99/99 |
| `npm run build --workspace apps/web` | OK |

## O que continua igual (nenhuma mudança nova nesta rodada)

- **Sidebar**: isolada em `crm/sidebar-recolhivel` (commit `d182a57`),
  ainda não publicada — validação visual autenticada continua pendente,
  sem login de CRM disponível aqui.
- **Limites do engine, registrados e não resolvidos**: proteção de
  duplicidade só dentro do processo (não entre processos); cache do
  `getMessage` não sobrevive a reinício do processo; LID/telefone não
  unificado (só o envio parou de tratar LID como telefone); causa da
  desconexão da 7033 continua sem diagnóstico fechado — o log novo dá
  evidência pra uma PRÓXIMA ocorrência, não explica a passada. O registro
  de incerteza (`dedupe_consulta_indisponivel`/`dedupe_registro_incerto`)
  ajuda a auditar depois, mas sozinho não impede duplicação — nenhum dos
  dois pontos foi reapresentado aqui como resolvido.

## Próximo passo (fora do escopo desta preparação)

A proposta de arquitetura pra dedupe persistente e armazenamento
recuperável do `getMessage` — reivindicação atômica, estados, posse/lease,
conciliação, contrato real do Chatwoot instalado — fica para o próximo
lote, como pedido. Nenhuma migration foi desenhada ou aplicada nesta
rodada.

## Reconciliação da sidebar, se publicada antes

Registrado conforme a orientação: se `crm/sidebar-recolhivel` (`d182a57`)
entrar na `main` do CRM antes desta branch, o merge de
`crm/identidade-lid-entrega` (ou de `crm/integracao-local-lote`) precisa
ser reconferido — o conteúdo de `75c9995` já estaria presente por outro
caminho, e a expectativa é um merge de 3 vias sem conflito (diff final
idêntico dos dois lados), mas isso será verificado de novo no momento,
não presumido agora.
