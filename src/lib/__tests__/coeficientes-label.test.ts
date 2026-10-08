import test from 'node:test'
import assert from 'node:assert/strict'
import { rotuloTabelaCoeficiente } from '../coeficientes-label.ts'

test('código vem antes da descrição', () => {
  assert.equal(rotuloTabelaCoeficiente('ABC123', 'Banco - Tab (CC, s/ seguro)'), 'ABC123 · Banco - Tab (CC, s/ seguro)')
})
test('sem código', () => {
  assert.equal(rotuloTabelaCoeficiente(null, 'X'), 'sem código · X')
  assert.equal(rotuloTabelaCoeficiente('  ', 'X'), 'sem código · X')
})
