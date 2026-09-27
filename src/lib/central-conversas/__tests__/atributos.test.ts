/** D3 (lote 2): catálogo e helpers de atributos personalizados. Roda com: npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { atributosDoVinculo, corpoDefinicao, DEFINICOES, mesclarAtributos, normalizarLista } from '../atributos.ts'

test('catálogo: os 5 campos decididos, modelo certo em cada um', () => {
  assert.deepEqual(DEFINICOES.map((d) => [d.chave, d.modelo]), [
    ['parceiro_codigo', 'contato'], ['instituicao_financeira', 'contato'], ['promotora', 'contato'], ['convenio', 'contato'], ['motivo_contato', 'conversa'],
  ])
})

test('corpo da definição: tipo e modelo INTEIROS; lista exige valores e normaliza', () => {
  const texto = corpoDefinicao(DEFINICOES[0], [])
  assert.ok(texto.ok)
  if (texto.ok) assert.deepEqual([texto.corpo.attribute_display_type, texto.corpo.attribute_model, texto.corpo.attribute_values], [0, 1, undefined])
  const motivo = corpoDefinicao(DEFINICOES[4], [' Dúvida ', 'dúvida', '', 'Proposta'])
  assert.ok(motivo.ok)
  if (motivo.ok) assert.deepEqual([motivo.corpo.attribute_display_type, motivo.corpo.attribute_model, motivo.corpo.attribute_values], [6, 0, ['Dúvida', 'Proposta']])
  const vazia = corpoDefinicao(DEFINICOES[3], ['  '])
  assert.equal(vazia.ok, false)
})

test('normalizarLista e mesclarAtributos', () => {
  assert.deepEqual(normalizarLista(['b', 'B', ' a ', '']), ['b', 'a'])
  assert.deepEqual(mesclarAtributos({ x: 1, convenio: 'A' }, { convenio: 'B' }), { x: 1, convenio: 'B' })
  assert.deepEqual(mesclarAtributos(null, { a: 1 }), { a: 1 })
})

test('vínculo: preenche a chave do tipo e limpa as outras', () => {
  assert.deepEqual(atributosDoVinculo('parceiro', 'ARW 123'), { parceiro_codigo: 'ARW 123', instituicao_financeira: '', promotora: '' })
  assert.deepEqual(atributosDoVinculo(null, ''), { parceiro_codigo: '', instituicao_financeira: '', promotora: '' })
})
