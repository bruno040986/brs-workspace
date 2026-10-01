/** Roda com: npm test (node --test --experimental-strip-types) */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularImpostoComissao } from '../comissao-liquida.ts'

const campo = (value: string) => ({ enabled: true, value })
const cfg = (overrides: Record<string, { custom: boolean; value: string }>) =>
  ({
    figure_snapshot: {
      config: {
        section_1: { iss: { enabled: false, value: '' } },
        section_4: { irpj: campo('150'), csll: campo('100'), pis: campo('065'), cofins: campo('300') },
      },
    },
    retention_overrides: overrides,
  }) as any

test('nenhuma retenção marcada => 0 (valor da figura não entra)', () => {
  assert.equal(calcularImpostoComissao(cfg({})).totalPercent, 0)
  assert.equal(calcularImpostoComissao(cfg({ irpj: { custom: false, value: '150' } })).totalPercent, 0)
})

test('só as marcadas somam, com o valor do override', () => {
  const r = calcularImpostoComissao(cfg({ irpj: { custom: true, value: '150' }, cofins: { custom: true, value: '200' } }))
  assert.equal(r.totalPercent, 3.5)
  assert.equal(r.itens.length, 2)
})
