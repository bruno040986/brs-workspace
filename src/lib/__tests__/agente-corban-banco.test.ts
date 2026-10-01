import { describe, it } from 'node:test'
import assert from 'node:assert'
import { bancoVigente, lerValorChavePix } from '../agente-corban-banco.ts'

describe('lerValorChavePix', () => {
  it('lê texto puro, objeto normal e objeto com string espalhada', () => {
    assert.equal(lerValorChavePix('abc').pix_key, 'abc')
    assert.equal(lerValorChavePix({ pix_type: 'cnpj', pix_key: 'x', respostas: null }).pix_key, 'x')
    const r = lerValorChavePix({ '0': '6', '1': '6', '2': '.', respostas: { existe: true } })
    assert.equal(r.pix_key, '66.')
    assert.deepEqual(r.respostas, { existe: true })
  })
})

describe('bancoVigente', () => {
  it('itens de validação vencem corban_data', () => {
    const itens = [
      { etapa: 'validacao', chave: 'bank.bank_agency', valor: '0001-0' },
      { etapa: 'validacao', chave: 'bank.bank_code', valor: '260' },
      { etapa: 'validacao', chave: 'bank.pix_key', valor: { '0': '6', '1': '6' } },
    ]
    const b = bancoVigente({ bank_agency: '16330', bank_code: '033', bank_account: '1', pix_type: 'bank', pix_key: 'Dados' }, itens)
    assert.equal(b.bank_agency, '0001-0')
    assert.equal(b.bank_code, '260')
    assert.equal(b.bank_account, '1')
    assert.equal(b.pix_key, '66')
    assert.equal(b.pix_type, '')
  })
})
