/** Roda com: npm test (node --test --experimental-strip-types) */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { descricaoTabela } from '../comissionamento.ts'

const base = {
  formaNome: 'Empréstimo Novo',
  formaNomeCurto: 'Novo',
  convenioNomeReduzido: 'Pré-F Valparaíso de Goiás/GO',
  oferta: 'Oferta 1',
  taxa_juros_tipo: 'fixa' as const,
  taxa_juros: 1.2,
  com_seguro: true,
}

test('descrição completa', () => {
  assert.equal(descricaoTabela(base), 'Novo · Pré-F Valparaíso de Goiás/GO · Oferta 1 · 1,20% · Com seguro')
})

test('sem oferta não deixa separador sobrando', () => {
  assert.equal(descricaoTabela({ ...base, oferta: null }), 'Novo · Pré-F Valparaíso de Goiás/GO · 1,20% · Com seguro')
  assert.equal(descricaoTabela({ ...base, oferta: '  ' }), 'Novo · Pré-F Valparaíso de Goiás/GO · 1,20% · Com seguro')
})

test('faixa de juros', () => {
  assert.equal(
    descricaoTabela({ ...base, taxa_juros_tipo: 'faixa', taxa_juros_min: 1.55, taxa_juros_max: 2.5 }),
    'Novo · Pré-F Valparaíso de Goiás/GO · Oferta 1 · 1,55% a 2,50% · Com seguro',
  )
})

test('seguro false e nulo', () => {
  assert.ok(descricaoTabela({ ...base, com_seguro: false }).endsWith(' · Sem seguro'))
  assert.equal(descricaoTabela({ ...base, com_seguro: null }), 'Novo · Pré-F Valparaíso de Goiás/GO · Oferta 1 · 1,20%')
})

test('forma sem nome_curto usa nome completo; convênio cai no nome', () => {
  assert.equal(
    descricaoTabela({ ...base, formaNomeCurto: null, formaNome: 'Cartão Benefício RCC', convenioNomeReduzido: null, convenioNome: 'Prefeitura de São José' }),
    'Cartão Benefício RCC · Prefeitura de São José · Oferta 1 · 1,20% · Com seguro',
  )
})

test('sem juros tipo omite juros; acentos preservados', () => {
  assert.equal(
    descricaoTabela({ formaNome: 'Refin', oferta: 'chocolate com pimenta', com_seguro: false }),
    'Refin · chocolate com pimenta · Sem seguro',
  )
})
