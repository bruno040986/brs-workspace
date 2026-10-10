import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deveInterromperLote } from '../conferencia-lote.ts'

test('401 interrompe o lote na hora', () => assert.equal(deveInterromperLote(401, 1), true))
test('falha isolada (5xx/403/timeout) segue', () => {
  for (const s of [500, 403, 0]) assert.equal(deveInterromperLote(s, 1), false)
})
test('3 falhas seguidas interrompem', () => assert.equal(deveInterromperLote(500, 3), true))
