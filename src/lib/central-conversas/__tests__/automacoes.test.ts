/** D6 (lote 2): montagem/validação do corpo de regra de automação do Chatwoot. Roda com: npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarCorpoRegra, regraParaEntrada, type RegraEntrada } from '../automacoes.ts'

const base: RegraEntrada = {
  nome: ' Suporte ', evento: 'conversation_created', ativa: true, combinador: 'AND',
  condicoes: [{ chave: 'inbox_id', operador: 'equal_to', valor: '5' }],
  acoes: [{ nome: 'assign_team', valor: '2' }, { nome: 'add_label', valor: 'suporte' }, { nome: 'resolve_conversation', valor: '' }],
}

test('monta o corpo: ids viram número, ação sem parâmetro vai com lista vazia', () => {
  const r = montarCorpoRegra(base)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.corpo.name, 'Suporte')
  assert.deepEqual(r.corpo.conditions, [{ attribute_key: 'inbox_id', filter_operator: 'equal_to', query_operator: 'AND', values: [5] }])
  assert.deepEqual(r.corpo.actions, [
    { action_name: 'assign_team', action_params: [2] },
    { action_name: 'add_label', action_params: ['suporte'] },
    { action_name: 'resolve_conversation', action_params: [] },
  ])
})

test('operador sem valor (is_present) e combinador OR', () => {
  const r = montarCorpoRegra({ ...base, combinador: 'OR', condicoes: [{ chave: 'content', operador: 'is_present', valor: '' }, { chave: 'content', operador: 'contains', valor: 'ajuda, suporte' }] })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.deepEqual(r.corpo.conditions.map((c) => [c.query_operator, c.values]), [['OR', []], ['OR', ['ajuda', 'suporte']]])
})

test('recusas claras', () => {
  const erro = (mudanca: Partial<RegraEntrada>) => { const r = montarCorpoRegra({ ...base, ...mudanca }); return r.ok ? '' : r.error }
  assert.match(erro({ nome: ' ' }), /nome/)
  assert.match(erro({ evento: 'x' }), /Evento/)
  assert.match(erro({ condicoes: [] }), /condição/)
  assert.match(erro({ acoes: [] }), /ação/)
  assert.match(erro({ condicoes: [{ chave: 'inbox_id', operador: 'equal_to', valor: 'abc' }] }), /inteiros positivos/)
  assert.match(erro({ condicoes: [{ chave: 'content', operador: 'contains', valor: '' }] }), /valor da condição/)
  assert.match(erro({ acoes: [{ nome: 'assign_team', valor: '0' }] }), /inteiro positivo/)
  assert.match(erro({ acoes: [{ nome: 'send_message', valor: '' }] }), /valor da ação/)
  assert.match(erro({ acoes: [{ nome: 'apagar_tudo', valor: '' }] }), /desconhecida/)
})

test('ida e volta: regra da API vira formulário', () => {
  const e = regraParaEntrada({ name: 'R', event_name: 'message_created', active: false, conditions: [{ attribute_key: 'content', filter_operator: 'contains', query_operator: 'or', values: ['a', 'b'] }], actions: [{ action_name: 'add_label', action_params: ['x'] }] })
  assert.deepEqual(e, { nome: 'R', descricao: '', evento: 'message_created', ativa: false, combinador: 'OR', condicoes: [{ chave: 'content', operador: 'contains', valor: 'a, b' }], acoes: [{ nome: 'add_label', valor: 'x' }] })
})
