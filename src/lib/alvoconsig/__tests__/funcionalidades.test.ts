import { test } from 'node:test'
import assert from 'node:assert/strict'
import { funcionalidadeAtiva } from '../funcionalidades.ts'

const agora = new Date('2026-10-05T12:00:00Z')

test('teste vencido fica inativo, vigente fica ativo', () => {
  assert.equal(funcionalidadeAtiva('teste', '2026-10-04T23:59:59Z', agora), false)
  assert.equal(funcionalidadeAtiva('teste', '2026-12-31T23:59:59-03:00', agora), true)
})
test('pago sem data fica ativo', () => {
  assert.equal(funcionalidadeAtiva('pago', null, agora), true)
})
test('desligado nunca fica ativo', () => {
  assert.equal(funcionalidadeAtiva('desligado', '2099-01-01T00:00:00Z', agora), false)
  assert.equal(funcionalidadeAtiva(null, null, agora), false)
})
