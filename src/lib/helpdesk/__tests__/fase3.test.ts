/** HelpDesk fase 3: comentário, motivo de reabertura, permissão de reabrir e abas. Roda com: npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { desfechoEmailFila, filtrarPorAba, podeReabrir, validarComentario, validarMotivoReabertura } from '../validacao.ts'

const EU = '11111111-2222-3333-4444-555555555555'
const OUTRO = '99999999-8888-7777-6666-555555555555'

test('comentário: trim, vazio e limite de 4000', () => {
  const r = validarComentario('  oi  ')
  assert.ok(r.ok && r.texto === 'oi')
  assert.equal(validarComentario('   ').ok, false)
  assert.equal(validarComentario(null).ok, false)
  assert.equal(validarComentario('x'.repeat(4000)).ok, true)
  assert.equal(validarComentario('x'.repeat(4001)).ok, false)
})

test('motivo da reabertura é obrigatório e cabe no comentário', () => {
  assert.equal(validarMotivoReabertura('').ok, false)
  assert.equal(validarMotivoReabertura('x'.repeat(2001)).ok, false)
  const r = validarMotivoReabertura(' voltou a dar erro ')
  assert.ok(r.ok && r.texto === 'voltou a dar erro')
})

test('reabrir: só encerrado, só solicitante ou aprovador', () => {
  const meu = { status: 'concluido', aberto_por: EU }
  assert.equal(podeReabrir(meu, EU, false), true)
  assert.equal(podeReabrir({ ...meu, status: 'rejeitado' }, EU, false), true)
  assert.equal(podeReabrir(meu, OUTRO, false), false)
  assert.equal(podeReabrir(meu, OUTRO, true), true)
  assert.equal(podeReabrir(meu, '', false), false)
  for (const s of ['aberto', 'plano_proposto', 'aprovado', 'em_execucao']) {
    assert.equal(podeReabrir({ ...meu, status: s }, EU, true), false)
  }
})

test('abas: meus e aguardando aprovação só filtram a tela', () => {
  const tickets = [
    { id: 'a', status: 'aberto', aberto_por: EU },
    { id: 'b', status: 'plano_proposto', aberto_por: OUTRO },
    { id: 'c', status: 'plano_proposto', aberto_por: EU },
  ]
  assert.equal(filtrarPorAba(tickets, 'todos', EU, false).length, 3)
  assert.deepEqual(filtrarPorAba(tickets, 'meus', EU, false).map((t) => t.id), ['a', 'c'])
  assert.deepEqual(filtrarPorAba(tickets, 'aprovacao', EU, true).map((t) => t.id), ['b', 'c'])
  assert.equal(filtrarPorAba(tickets, 'aprovacao', EU, false).length, 0)
})

test('fila de e-mail: definitiva sai, passageira volta até a 5ª', () => {
  assert.deepEqual(desfechoEmailFila({ detalhe: 'Usuário sem e-mail.' }, 0), { enviado_em: null, tentativas: 1, erro: 'Usuário sem e-mail.' })
  assert.deepEqual(desfechoEmailFila({ detalhe: 'Resend respondeu 503.', transitorio: true }, 0), { enviado_em: null, tentativas: 1 })
  assert.deepEqual(desfechoEmailFila({ detalhe: 'x', transitorio: true }, 3), { enviado_em: null, tentativas: 4 })
  assert.deepEqual(desfechoEmailFila({ detalhe: 'x', transitorio: true }, 4), { enviado_em: null, tentativas: 5, erro: 'x' })
  assert.equal(desfechoEmailFila({ detalhe: 'y'.repeat(900) }, 0).erro?.length, 500)
})
