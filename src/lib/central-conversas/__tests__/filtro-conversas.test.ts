/**
 * Aba "Meus" do Atendimento: corpo do POST /conversations/filter por agente.
 * Roda com: npm test (node --test --experimental-strip-types).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { payloadFiltroConversas } from '../chatwoot.ts'

test('agente + status + team: AND entre os itens, último sem operador', () => {
  const p = payloadFiltroConversas({ assigneeId: 6, status: 'open', teamId: 1 })
  assert.deepEqual(
    p.map((i) => [i.attribute_key, i.values, i.query_operator]),
    [
      ['assignee_id', [6], 'AND'],
      ['status', ['open'], 'AND'],
      ['team_id', [1], null],
    ],
  )
  assert.ok(p.every((i) => i.filter_operator === 'equal_to'))
})

test("status 'all' não vira filtro: só o agente, sem operador", () => {
  assert.deepEqual(payloadFiltroConversas({ assigneeId: 6, status: 'all' }), [
    { attribute_key: 'assignee_id', filter_operator: 'equal_to', values: [6], query_operator: null },
  ])
})
