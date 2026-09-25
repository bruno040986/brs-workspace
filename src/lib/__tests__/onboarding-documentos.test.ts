import { describe, it } from 'node:test'
import assert from 'node:assert'
import { coletarDocumentosDoCadastro } from '../onboarding-documentos.ts'

const corban = {
  master: { name: 'Bem Digital Online Ltda' },
  socios: [
    { person_kind: 'PF', is_principal: true, cpf: '123.456.789-09', name: 'Bruno' },
    { person_kind: 'PF', cpf: '98765432100', name: 'Sócia 2' },
    { person_kind: 'PJ', cnpj: '11.222.333/0001-44', name: 'Holding' },
  ],
  administracao: [{ cpf: '123.456.789-09', name: 'Bruno (adm)' }, { cpf: '55566677788', name: 'Diretor' }],
  witness: { cpf: '111.222.333-44', name: 'Testemunha' },
}

describe('coletarDocumentosDoCadastro (fatia 2)', () => {
  it('PJ: CNPJ da empresa + CPFs de sócios PF, administradores e testemunha, só dígitos, sem repetição', () => {
    const docs = coletarDocumentosDoCadastro(corban, 'PJ', '24.278.218/0001-70')
    assert.deepStrictEqual(
      docs.map((d) => [d.documento, d.tipo, d.papel]),
      [
        ['24278218000170', 'cnpj', 'empresa'],
        ['12345678909', 'cpf', 'socio'],
        ['98765432100', 'cpf', 'socio'],
        ['55566677788', 'cpf', 'administrador'],
        ['11122233344', 'cpf', 'testemunha'],
      ],
    )
    assert.strictEqual(docs[0].nome, 'Bem Digital Online Ltda')
    assert.strictEqual(docs.filter((d) => d.documento === '12345678909').length, 1)
  })

  it('PF: o CPF do titular entra como titular', () => {
    assert.deepStrictEqual(coletarDocumentosDoCadastro({ master: { name: 'Fulano' } }, 'PF', '123.456.789-09'), [
      { documento: '12345678909', tipo: 'cpf', papel: 'titular', nome: 'Fulano' },
    ])
  })

  it('cadastro vazio não gera documento', () => {
    assert.deepStrictEqual(coletarDocumentosDoCadastro(null, 'PJ', ''), [])
  })
})
