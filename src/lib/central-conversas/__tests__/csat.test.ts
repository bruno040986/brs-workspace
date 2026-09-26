/** D4 (lote 2): validação da config e resumo das respostas de CSAT. Roda com: npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarConfigCsat, resumirCsat } from '../csat.ts'

test('config: corpo do PATCH da caixa, botão padrão, idioma pt_BR', () => {
  const r = montarConfigCsat({ ativa: true, tipo: 'star', mensagem: ' Como foi? ', botao: '' })
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual(r.corpo, { csat_survey_enabled: true, csat_config: { display_type: 'star', message: 'Como foi?', button_text: 'Avaliar atendimento', language: 'pt_BR' } })
})

test('config: recusas — tipo inválido, ativa sem texto, textos longos; desativada sem texto passa', () => {
  const erro = (e: Parameters<typeof montarConfigCsat>[0]) => { const r = montarConfigCsat(e); return r.ok ? '' : r.error }
  assert.match(erro({ ativa: true, tipo: 'x', mensagem: 'a', botao: '' }), /tipo/i)
  assert.match(erro({ ativa: true, tipo: 'emoji', mensagem: ' ', botao: '' }), /texto da pesquisa/)
  assert.match(erro({ ativa: true, tipo: 'emoji', mensagem: 'a'.repeat(301), botao: '' }), /300/)
  assert.match(erro({ ativa: true, tipo: 'emoji', mensagem: 'a', botao: 'b'.repeat(41) }), /botão/)
  assert.equal(erro({ ativa: false, tipo: 'emoji', mensagem: '', botao: '' }), '')
})

test('resumo: média, distribuição e ranking por atendente; notas fora de 1–5 ignoradas', () => {
  const r = resumirCsat([
    { id: 1, rating: 5, assigned_agent: { name: 'Ana' } },
    { id: 2, rating: 3, assigned_agent: { name: 'Ana' } },
    { id: 3, rating: 4, assigned_agent: { name: 'Beto' } },
    { id: 4, rating: 9 },
    { id: 5, rating: 1 },
  ])
  assert.equal(r.total, 4)
  assert.equal(r.media, 3.25)
  assert.deepEqual(r.distribuicao, { 1: 1, 2: 0, 3: 1, 4: 1, 5: 1 })
  assert.deepEqual(r.porAtendente, [{ nome: 'Ana', total: 2, media: 4 }, { nome: 'Beto', total: 1, media: 4 }, { nome: 'Sem atendente', total: 1, media: 1 }])
  assert.deepEqual(resumirCsat([]).porAtendente, [])
})
