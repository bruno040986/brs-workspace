import { describe, it } from 'node:test'
import assert from 'node:assert'
import { nomeComercial, opcoesComerciais } from '../comerciais-hierarquia.ts'

const eduardo = { id: 'e', name: 'Eduardo', role: 'superintendente', status: 'ativo' }
const sandra = { id: 's', name: 'Sandra', role: 'supervisor', status: 'ativo' }
const gil = { id: 'g', name: 'Gil', role: 'gerente', status: 'ativo', cadastral_data: { commercial_name: 'Gil Vendas' } }
const antigo = { id: 'a', name: 'Antigo', role: 'gerente', status: 'inativo' }
const todos = [gil, antigo, sandra, eduardo]

const ids = (lista: Array<{ id: string }>) => lista.map((c) => c.id)

describe('hierarquia comercial (regra 25/09/2026)', () => {
  it('Superintendente aceita só superintendentes', () => {
    assert.deepStrictEqual(ids(opcoesComerciais(todos, 'superintendente')), ['e'])
  })

  it('Supervisor aceita supervisores e o superintendente', () => {
    assert.deepStrictEqual(ids(opcoesComerciais(todos, 'supervisor')), ['e', 's'])
  })

  it('Gerente aceita os três cargos, do mais alto para o mais baixo', () => {
    assert.deepStrictEqual(ids(opcoesComerciais(todos, 'gerente')), ['e', 's', 'g'])
  })

  it('inativo só aparece quando já é o valor gravado', () => {
    assert.deepStrictEqual(ids(opcoesComerciais(todos, 'gerente', 'a')), ['e', 's', 'a', 'g'])
  })

  it('com um único superintendente ativo, ele é opção nos três campos', () => {
    const so = [eduardo, antigo]
    assert.deepStrictEqual(ids(opcoesComerciais(so, 'superintendente')), ['e'])
    assert.deepStrictEqual(ids(opcoesComerciais(so, 'supervisor')), ['e'])
    assert.deepStrictEqual(ids(opcoesComerciais(so, 'gerente')), ['e'])
  })

  it('cargo desconhecido fica de fora', () => {
    assert.deepStrictEqual(ids(opcoesComerciais([{ id: 'x', name: 'X', role: 'diretor', status: 'ativo' }], 'gerente')), [])
  })

  it('nomeComercial prefere o nome comercial e marca inativo', () => {
    assert.strictEqual(nomeComercial(gil), 'Gil Vendas')
    assert.strictEqual(nomeComercial(antigo), 'Antigo (Inativo)')
    assert.strictEqual(nomeComercial(null), '')
  })
})
