/** D1 (lote 2): montagem/validação do corpo de macro do Chatwoot. Roda com: npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { macroParaEntrada, montarCorpoMacro } from '../macros.ts'

test('monta o corpo: visibilidade global, ids numéricos, ação sem parâmetro com lista vazia, nota privada', () => {
  const r = montarCorpoMacro({ nome: ' Encerrar ', acoes: [{ nome: 'add_label', valor: 'ok' }, { nome: 'add_private_note', valor: 'feito' }, { nome: 'assign_team', valor: '3' }, { nome: 'resolve_conversation', valor: '' }] })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.deepEqual(r.corpo, { name: 'Encerrar', visibility: 'global', actions: [
    { action_name: 'add_label', action_params: ['ok'] },
    { action_name: 'add_private_note', action_params: ['feito'] },
    { action_name: 'assign_team', action_params: [3] },
    { action_name: 'resolve_conversation', action_params: [] },
  ] })
})

test('recusas claras', () => {
  const erro = (e: Parameters<typeof montarCorpoMacro>[0]) => { const r = montarCorpoMacro(e); return r.ok ? '' : r.error }
  assert.match(erro({ nome: ' ', acoes: [{ nome: 'add_label', valor: 'x' }] }), /nome/)
  assert.match(erro({ nome: 'x', acoes: [] }), /ação/)
  assert.match(erro({ nome: 'x', acoes: [{ nome: 'assign_team', valor: 'a' }] }), /inteiro positivo/)
  assert.match(erro({ nome: 'x', acoes: [{ nome: 'apagar', valor: '' }] }), /desconhecida/)
})

test('ida e volta', () => {
  assert.deepEqual(macroParaEntrada({ name: 'M', actions: [{ action_name: 'add_label', action_params: ['a'] }] }), { nome: 'M', acoes: [{ nome: 'add_label', valor: 'a' }] })
})
