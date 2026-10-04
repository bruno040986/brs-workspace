import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarMetaCapi } from '../config-regras.ts'

test('validarMetaCapi aceita entrada válida e rejeita inválidas', () => {
  assert.equal(validarMetaCapi({ token: 'EAAB123', testEventCode: 'TEST12345', datasetId: '1234567890123', datasetNome: 'X' }).ok, true)
  assert.equal(validarMetaCapi({ datasetId: '1234567890' }).ok, true) // token vazio = manter
  assert.equal(validarMetaCapi({ datasetId: '123' }).ok, false)
  assert.equal(validarMetaCapi({ datasetId: '12345678901a' }).ok, false)
  assert.equal(validarMetaCapi({ token: 'a b', datasetId: '1234567890' }).ok, false)
  assert.equal(validarMetaCapi({ token: 'x'.repeat(601), datasetId: '1234567890' }).ok, false)
  assert.equal(validarMetaCapi({ testEventCode: 'TE ST', datasetId: '1234567890' }).ok, false)
  assert.equal(validarMetaCapi({ datasetNome: 'x'.repeat(121), datasetId: '1234567890' }).ok, false)
})

import { executarTesteMeta } from '../config-regras.ts'

const TOK = 'EAAsecretTOKEN123'
const base = { token: TOK, testEventCode: 'TEST1', datasetId: '1403565855285551' }
const resp = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

test('executarTesteMeta não chama fetch sem código de teste ou com ID inválido', async () => {
  let n = 0
  const f = (async () => { n++; return new Response('{}') }) as unknown as typeof fetch
  assert.equal((await executarTesteMeta({ ...base, testEventCode: null }, f)).ok, false)
  assert.equal((await executarTesteMeta({ ...base, datasetId: 'abc' }, f)).ok, false)
  assert.equal(n, 0)
})

test('executarTesteMeta: erro da Meta sem vazar o token; sucesso com events_received 1', async () => {
  const e = await executarTesteMeta(base, resp(400, { error: { message: `Invalid token ${TOK}`, code: 190, fbtrace_id: 'AbC' } }))
  assert.equal(e.ok, false)
  assert.ok(e.detalhe.includes('400, código 190'))
  assert.ok(!e.detalhe.includes(TOK))
  assert.equal((await executarTesteMeta(base, resp(200, { events_received: 1 }))).ok, true)
})
