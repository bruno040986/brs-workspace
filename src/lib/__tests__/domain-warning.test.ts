import { describe, it } from 'node:test'
import assert from 'node:assert'
import { domainWarning } from '../vercel/domain-warning.ts'

describe('domainWarning', () => {
  it('sem slug: nenhum aviso', () => assert.equal(domainWarning('', true), null))
  it('cartão desabilitado: avisa', () => assert.match(domainWarning('joao', false)!, /Cartão desabilitado.*joao\.brspromotora\.com\.br/))
  it('sucesso ou já existe: sem aviso', () => {
    assert.equal(domainWarning('joao', true, { success: true }), null)
    assert.equal(domainWarning('joao', true, { success: true, alreadyExists: true, status: 409 }), null)
  })
  it('falha: motivo curto, sem corpo cru', () => {
    assert.match(domainWarning('joao', true, { success: false, status: 403, error: 'token abc' })!, /erro 403/)
    assert.doesNotMatch(domainWarning('joao', true, { success: false, status: 403, error: 'token abc' })!, /token abc/)
    assert.match(domainWarning('joao', true, { success: false, error: 'Variaveis de ambiente da Vercel ausentes.' })!, /ausentes/)
  })
})
