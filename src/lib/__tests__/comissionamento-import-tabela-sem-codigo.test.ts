/**
 * Importador de comissionamento — tabela SEM código no banco.
 * O banco nem sempre informa código (`codigo_tabela_banco` nulo). Antes, o
 * passo 2 (Prazos) exigia o código e travava a importação com "cód. ?".
 * Roda com: npm test  (node --test --experimental-strip-types)
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { discriminadorTabela, localizarTabelaComissao, type TabelaLocalizavel } from '../comissionamento-import.ts'

const base = { institution_id: 'inst-1', promotora_id: null, forma_contrato_id: 'forma-1', convenio_id: 'conv-1', id_arw: null }
const linhaBase = { institutionId: 'inst-1', promotoraId: null, formaId: 'forma-1', convenioId: 'conv-1', codigoBanco: null, nome: '', idArw: null }

const comCodigo: TabelaLocalizavel = { ...base, id: 't-cod', nome: 'REFIN 1', codigo_tabela_banco: '827004875' }
const semCodigoA: TabelaLocalizavel = { ...base, id: 't-sem-a', nome: 'Refin Oferta A', codigo_tabela_banco: null }
const semCodigoB: TabelaLocalizavel = { ...base, id: 't-sem-b', nome: 'Refin Oferta B', codigo_tabela_banco: null }

describe('discriminadorTabela', () => {
  test('usa o código quando existe e ignora o nome', () => {
    assert.equal(discriminadorTabela(' 827004875 ', 'qualquer nome'), 'cod:827004875')
  })
  test('sem código usa o nome normalizado (acento/caixa/espaços)', () => {
    assert.equal(discriminadorTabela(null, '  Refin  Oferta Ç '), 'nome:refin oferta c')
    assert.equal(discriminadorTabela('', 'Refin Oferta'), discriminadorTabela(null, 'REFIN   oferta'))
  })
  test('código e nome nunca colidem entre si', () => {
    assert.notEqual(discriminadorTabela('abc', 'x'), discriminadorTabela(null, 'abc'))
  })
})

describe('localizarTabelaComissao', () => {
  const tabelas = [comCodigo, semCodigoA, semCodigoB]

  test('com código: comportamento anterior preservado', () => {
    const r = localizarTabelaComissao(tabelas, { ...linhaBase, codigoBanco: '827004875', nome: 'nome diferente' })
    assert.deepEqual(r, { tabela: comCodigo })
  })

  test('sem código: localiza pelo nome (bug original: ficava "não encontrada")', () => {
    const r = localizarTabelaComissao(tabelas, { ...linhaBase, nome: 'REFIN OFERTA B' })
    assert.deepEqual(r, { tabela: semCodigoB })
  })

  test('sem código: nome igual ao de uma tabela COM código não casa', () => {
    const r = localizarTabelaComissao(tabelas, { ...linhaBase, nome: 'REFIN 1' })
    assert.ok('erro' in r)
    assert.match(r.erro, /sem código no banco não encontrada/)
  })

  test('sem código e sem nome: erro pede nome ou id_arw', () => {
    const r = localizarTabelaComissao(tabelas, linhaBase)
    assert.ok('erro' in r)
    assert.match(r.erro, /"nome" \(ou "id_arw"\)/)
  })

  test('id_arw tem prioridade e dispensa código e nome', () => {
    const arw = { ...semCodigoA, id: 't-arw', id_arw: 'ARW-99' }
    const r = localizarTabelaComissao([...tabelas, arw], { ...linhaBase, idArw: ' arw-99 ' })
    assert.deepEqual(r, { tabela: arw })
  })

  test('id_arw que não existe cai para a identidade natural', () => {
    const r = localizarTabelaComissao(tabelas, { ...linhaBase, idArw: 'nao-existe', nome: 'Refin Oferta A' })
    assert.deepEqual(r, { tabela: semCodigoA })
  })

  test('respeita a combinação: outro convênio/promotora/financeira não casa', () => {
    assert.ok('erro' in localizarTabelaComissao(tabelas, { ...linhaBase, nome: 'Refin Oferta A', convenioId: 'conv-2' }))
    assert.ok('erro' in localizarTabelaComissao(tabelas, { ...linhaBase, nome: 'Refin Oferta A', promotoraId: 'prom-1' }))
    assert.ok('erro' in localizarTabelaComissao(tabelas, { ...linhaBase, nome: 'Refin Oferta A', institutionId: 'inst-2' }))
  })

  test('duas tabelas sem código com o mesmo nome: recusa em vez de escolher uma', () => {
    const duplicada = { ...semCodigoA, id: 't-sem-a2' }
    const r = localizarTabelaComissao([semCodigoA, duplicada], { ...linhaBase, nome: 'Refin Oferta A' })
    assert.ok('erro' in r)
    assert.match(r.erro, /mais de uma Tabela de Comissão sem código/)
  })
})
