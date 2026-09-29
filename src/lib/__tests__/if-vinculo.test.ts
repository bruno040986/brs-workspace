/** Roda com: npm test (node --test --experimental-strip-types) */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveFiscalVinculo,
  escolherFonteImposto,
  fiscalConfigOptionLabel,
  isFiscalConfigVigente,
  pagadorExplicitoPromotora,
  validarFiscalCru,
  validateFiscalVinculos,
} from '../if-vinculo.ts'

const base = { remuneration_type_id: 'r1', remuneration_type_name: 'Comissão à Vista' }
const noLegacy = new Map()

test('config antiga sem vínculo vira direto/pagador if', () => {
  const d = deriveFiscalVinculo({ ...base }, noLegacy)
  assert.equal(d.vinculo_tipo, 'direto')
  assert.equal(d.pagador, 'if')
  assert.equal(d.promotora_id, '')
})

test('config antiga herda vínculo e promotora da financeira de mesmo tipo', () => {
  const legacy = new Map([['r1', { vinculo_tipo: 'sub_grade' as const, promotora_id: 'p1', promotora_name: 'TN', promotora_logo_url: '' }]])
  const d = deriveFiscalVinculo({ ...base }, legacy)
  assert.deepEqual([d.vinculo_tipo, d.promotora_id, d.pagador], ['sub_grade', 'p1', 'if'])
})

test('sub_zero => pagador promotora', () => {
  const d = deriveFiscalVinculo({ ...base, vinculo_tipo: 'sub_zero', promotora_id: 'p1' }, noLegacy)
  assert.equal(d.pagador, 'promotora')
})

test('grade com bônus pago pela promotora; sem escolha explícita fica indefinido e a validação exige', () => {
  const pago = deriveFiscalVinculo({ ...base, vinculo_tipo: 'sub_grade', promotora_id: 'p1', pagador: 'promotora' }, noLegacy)
  assert.equal(pago.pagador, 'promotora')
  const indefinido = deriveFiscalVinculo({ ...base, vinculo_tipo: 'sub_grade', promotora_id: 'p1' }, noLegacy)
  assert.equal(indefinido.pagador, undefined)
  const erros = validateFiscalVinculos([
    { ...base, id: 'a', effective_from: '2026-01-01', effective_to: null, vinculo_tipo: 'sub_grade', promotora_id: 'p1' } as any,
  ])
  assert.match(erros[0], /quem paga/)
})

const cfg = (id: string, from: string, to: string | null, promotora = '') =>
  ({ ...base, id, effective_from: from, effective_to: to, vinculo_tipo: 'direto', promotora_id: promotora }) as any

test('sobreposição: aberta x fechada conflita, promotoras diferentes não', () => {
  assert.equal(validateFiscalVinculos([cfg('a', '2026-01-01', null), cfg('b', '2026-06-01', '2026-12-31')]).length, 1)
  assert.equal(validateFiscalVinculos([cfg('a', '2026-01-01', '2026-05-31'), cfg('b', '2026-06-01', null)]).length, 0)
  assert.equal(validateFiscalVinculos([cfg('a', '2026-01-01', null, 'p1'), cfg('b', '2026-01-01', null, 'p2')]).filter((e) => /sobrepostas/.test(e)).length, 0)
})

test('vigência considera início futuro e fim passado', () => {
  assert.equal(isFiscalConfigVigente({ effective_from: '2026-10-01', effective_to: null }, '2026-09-29'), false)
  assert.equal(isFiscalConfigVigente({ effective_from: '2026-01-01', effective_to: '2026-09-01' }, '2026-09-29'), false)
  assert.equal(isFiscalConfigVigente({ effective_from: '2026-01-01', effective_to: null }, '2026-09-29'), true)
})

test('fonte do imposto: if, promotora e promotora sem config marcada => null', () => {
  const daIf = { ...cfg('a', '2026-01-01', null), usar_para_comissao: true, pagador: 'if' }
  assert.equal(escolherFonteImposto([daIf], () => [], '2026-09-29').tipo, 'if')
  const paga = { ...cfg('b', '2026-01-01', null, 'p1'), usar_para_comissao: true, pagador: 'promotora' }
  const promo = { ...cfg('c', '2026-01-01', null), usar_para_comissao: true }
  const f = escolherFonteImposto([paga], (id) => (id === 'p1' ? [promo] : []), '2026-09-29')
  assert.equal(f.tipo, 'promotora')
  assert.equal(f.config?.id, 'c')
  assert.equal(escolherFonteImposto([paga], () => [{ ...promo, usar_para_comissao: false }], '2026-09-29').config, null)
  assert.equal(escolherFonteImposto([], () => [], '2026-09-29').tipo, 'nenhuma')
})

test('rótulo da config fiscal no financeiro', () => {
  assert.equal(fiscalConfigOptionLabel({ ...base, vinculo_tipo: 'direto' } as any), 'Comissão à Vista — Direto')
  assert.equal(
    fiscalConfigOptionLabel({ remuneration_type_name: 'Bônus Fixo Negociado', vinculo_tipo: 'sub_grade', promotora_name: 'TN Promotora', pagador: 'promotora' }),
    'Bônus Fixo Negociado — TN Promotora (paga a promotora)',
  )
})

test('item 1: payload cru sem vínculo ou remuneração é rejeitado (sem herança)', () => {
  assert.equal(validarFiscalCru([{ vinculo_tipo: '', remuneration_type_id: 'r1' }]).length, 1)
  assert.equal(validarFiscalCru([{ vinculo_tipo: 'direto', remuneration_type_id: '' }]).length, 1)
  assert.equal(validarFiscalCru([{ vinculo_tipo: 'direto', remuneration_type_id: 'r1' }]).length, 0)
})

test('item 2: só limpa o fiscal quando o pagador promotora é explícito', () => {
  assert.equal(pagadorExplicitoPromotora({}), false)
  assert.equal(pagadorExplicitoPromotora({ pagador: 'if' }), false)
  assert.equal(pagadorExplicitoPromotora({ pagador: 'promotora' }), true)
})

test('item 3: prefere a config marcada vigente', () => {
  const velha = { ...cfg('velha', '2025-01-01', '2025-12-31'), usar_para_comissao: true, pagador: 'if' }
  const atual = { ...cfg('atual', '2026-01-01', null), usar_para_comissao: true, pagador: 'if' }
  assert.equal(escolherFonteImposto([velha, atual], () => [], '2026-09-29').config?.id, 'atual')
  const paga = { ...cfg('p', '2026-01-01', null, 'p1'), usar_para_comissao: true, pagador: 'promotora' }
  const pVelha = { ...cfg('pv', '2025-01-01', '2025-12-31'), usar_para_comissao: true }
  const pAtual = { ...cfg('pa', '2026-01-01', null), usar_para_comissao: true }
  assert.equal(escolherFonteImposto([paga], () => [pVelha, pAtual], '2026-09-29').config?.id, 'pa')
})
