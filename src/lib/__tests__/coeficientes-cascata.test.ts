import test from 'node:test'
import assert from 'node:assert/strict'
import { aplicarSelecao, opcoesConvenio, opcoesInstituicao, opcoesTabela, rotuloCascata, vinculoTabelaValido, type TabelaCascata } from '../coeficientes-cascata.ts'

const I = (id: string, name: string) => ({ id, name })
const C = (id: string, nome: string) => ({ id, nome })
const T = (id: string, i: ReturnType<typeof I>, c: ReturnType<typeof C>): TabelaCascata => ({ id, convenio_id: c.id, financial_institutions: i, convenios: c })
const bv = I('i1', 'BANCO ÁGIL'), ab = I('i2', 'abc'), zz = I('i3', 'Zeta')
const inss = C('c1', 'INSS'), sia = C('c2', 'Siape'), ac = C('c3', 'Água')
const tabs = [T('t1', bv, inss), T('t2', bv, inss), T('t3', bv, sia), T('t4', ab, inss), T('t5', zz, ac)]
const rot = (t: TabelaCascata) => `R-${t.id}`

test('instituições: únicas, ordem pt-BR sem acento, rótulo legível', () => {
  assert.deepEqual(opcoesInstituicao(tabs).map((o) => o.label), ['Abc', 'Banco Ágil', 'Zeta'])
})
test('convênios só da instituição; vazio sem instituição', () => {
  assert.deepEqual(opcoesConvenio(tabs, 'i1').map((o) => o.id), ['c1', 'c2'])
  assert.deepEqual(opcoesConvenio(tabs, ''), [])
  assert.deepEqual(opcoesConvenio(tabs, 'inexistente'), [])
})
test('tabelas só do convênio E da instituição', () => {
  assert.deepEqual(opcoesTabela(tabs, { instituicaoId: 'i1', convenioId: 'c1' }, rot).map((o) => o.id), ['t1', 't2'])
  assert.deepEqual(opcoesTabela(tabs, { instituicaoId: 'i2', convenioId: 'c2' }, rot), [])
  assert.deepEqual(opcoesTabela(tabs, { instituicaoId: 'i1', convenioId: '' }, rot), [])
})
test('grafias distintas do mesmo id não duplicam; sem convenio fica de fora', () => {
  const x = [T('a', bv, inss), T('b', bv, C('c1', 'inss')), { ...T('c', bv, inss), convenio_id: null, convenios: null }]
  assert.equal(opcoesConvenio(x, 'i1').length, 1)
  assert.equal(opcoesTabela(x, { instituicaoId: 'i1', convenioId: 'c1' }, rot).length, 2)
})
test('rotuloCascata', () => {
  assert.equal(rotuloCascata('  GOV   SP '), 'Gov Sp')
  assert.equal(rotuloCascata('Banco BMG'), 'Banco BMG')
  assert.equal(rotuloCascata(null), 'sem nome')
})
test('trocar instituição limpa convênio e tabela; trocar convênio limpa tabela', () => {
  const s0 = { instituicaoId: 'i1', convenioId: 'c1', tabelaId: 't1' }
  assert.deepEqual(aplicarSelecao(tabs, s0, 'instituicaoId', 'i1', rot), { instituicaoId: 'i1', convenioId: '', tabelaId: '' })
  assert.deepEqual(aplicarSelecao(tabs, s0, 'convenioId', 'c2', rot), { instituicaoId: 'i1', convenioId: 'c2', tabelaId: 't3' })
  assert.deepEqual(aplicarSelecao(tabs, s0, 'tabelaId', 't2', rot).tabelaId, 't2')
})
test('uma única opção é pré-selecionada em cascata', () => {
  assert.deepEqual(aplicarSelecao(tabs, { instituicaoId: '', convenioId: '', tabelaId: '' }, 'instituicaoId', 'i3', rot), { instituicaoId: 'i3', convenioId: 'c3', tabelaId: 't5' })
  assert.deepEqual(aplicarSelecao(tabs, { instituicaoId: '', convenioId: '', tabelaId: '' }, 'instituicaoId', '', rot), { instituicaoId: '', convenioId: '', tabelaId: '' })
})
test('validação do servidor', () => {
  const t = { institution_id: 'i1', convenio_id: 'c1' }
  assert.equal(vinculoTabelaValido(null, {}), false)
  assert.equal(vinculoTabelaValido(t, {}), true)
  assert.equal(vinculoTabelaValido(t, { instituicaoId: 'i1', convenioId: 'c1' }), true)
  assert.equal(vinculoTabelaValido(t, { instituicaoId: 'i2' }), false)
  assert.equal(vinculoTabelaValido(t, { convenioId: 'c2' }), false)
})
