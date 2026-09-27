import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizarTelefoneDestino } from '../envio-intencao.ts'

test('destino bsuid: passa intacto, sem extrair dígitos', () => {
  assert.equal(normalizarTelefoneDestino('bsuid:US.13491208655302741918'), 'bsuid:US.13491208655302741918')
  assert.equal(normalizarTelefoneDestino('(11) 91234-5678'), '5511912345678')
})
