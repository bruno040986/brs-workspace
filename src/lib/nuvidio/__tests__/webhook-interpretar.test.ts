/**
 * Payloads de exemplo da doc oficial (docs.nuvidio.com/reference/<hook>.md)
 * contra o interpretador puro. Rodar: npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interpretarHook } from '../webhook-interpretar.ts'

const callFinished = {
  hookType: 'call_finished',
  hookDescription: 'Chamada finalizada',
  timestamp: '2023-08-28T18:23:43.002Z',
  content: {
    id: '65372643c22a7973c603c653',
    recorded: true,
    recordingDeleted: false,
    queue: { origin: 'https://nuvidio.com/nuvidio-gustavo?token=bd94b60f-210b-4d30-852a-0d769d4aaf81' },
    customer: { name: 'Cliente', cpf: '000.000.000-00' },
    invite: { id: '65372637db09d16ea44b3fa5', token: 'bd94b60f-210b-4d30-852a-0d769d4aaf81', link: 'https://nuvidio.com/nuvidio?token=bd94b60f-210b-4d30-852a-0d769d4aaf81' },
  },
}

test('call_finished: chamada finalizada, ids da chamada e do convite, gravação', () => {
  const h = interpretarHook(callFinished)
  assert.equal(h.acao, 'chamada_finalizada')
  assert.equal(h.callId, '65372643c22a7973c603c653')
  assert.equal(h.inviteId, '65372637db09d16ea44b3fa5')
  assert.equal(h.token, 'bd94b60f-210b-4d30-852a-0d769d4aaf81')
  assert.equal(h.cpf, '00000000000')
  assert.equal(h.gravacao, true)
  assert.equal(h.timestamp, '2023-08-28T18:23:43.002Z')
})

test('attendant_closed_call também finaliza; attendant_closed_issue é só evento (não regride)', () => {
  assert.equal(interpretarHook({ ...callFinished, hookType: 'attendant_closed_call' }).acao, 'chamada_finalizada')
  const issue = interpretarHook({ ...callFinished, hookType: 'attendant_closed_issue' })
  assert.equal(issue.acao, 'so_evento')
  assert.equal(issue.callId, '65372643c22a7973c603c653')
})

test('new_call_started: só o id da chamada (sem invite, sem cpf)', () => {
  const h = interpretarHook({
    hookType: 'new_call_started',
    content: { id: '64ece43e1e0406b3d41b1cfb', recorded: false, customer: { name: 'Cliente', cpf: null }, customerData: {} },
  })
  assert.equal(h.acao, 'chamada_iniciada')
  assert.equal(h.callId, '64ece43e1e0406b3d41b1cfb')
  assert.equal(h.inviteId, '')
  assert.equal(h.cpf, '')
  assert.equal(h.gravacao, false)
})

test('new_client_waiting: fila; content.id NÃO é chamada; token só se o origin tiver', () => {
  const base = { hookType: 'new_client_waiting', content: { id: 'fila123', customer: { cpf: null }, origin: 'https://nuvidio.com/nuvidio', ticket: '23081468509534' } }
  const semToken = interpretarHook(base)
  assert.equal(semToken.acao, 'fila_entrou')
  assert.equal(semToken.callId, '')
  assert.equal(semToken.token, '')
  const comToken = interpretarHook({ ...base, content: { ...base.content, origin: 'https://nuvidio.com/x?token=abc-123&push=true' } })
  assert.equal(comToken.token, 'abc-123')
  assert.equal(interpretarHook({ hookType: 'client_left_queue', content: base.content }).acao, 'fila_saiu')
})

test('customer_scheduled_call: content.id é o CONVITE; datas do agendamento', () => {
  const h = interpretarHook({
    hookType: 'customer_scheduled_call',
    content: { id: '6500589c99a89829c02e1135', token: 'dc6d6931-d996-45a4-a92e-058099dc0732', initialDate: '2023-09-13T03:00:00.000Z', expirationDate: '2023-09-13T03:30:00.000Z' },
  })
  assert.equal(h.acao, 'agendamento')
  assert.equal(h.inviteId, '6500589c99a89829c02e1135')
  assert.equal(h.callId, '')
  assert.equal(h.token, 'dc6d6931-d996-45a4-a92e-058099dc0732')
  assert.equal(h.scheduleAt, '2023-09-13T03:00:00.000Z')
  assert.equal(h.expirationAt, '2023-09-13T03:30:00.000Z')
})

test('vídeo autônomo é ignorado; desconhecido e payload vazio não explodem', () => {
  assert.equal(interpretarHook({ hookType: 'video_autonomous_invite_expired', content: { invite: { id: 'x' } } }).acao, 'ignorar')
  assert.equal(interpretarHook({ hookType: 'foo_bar', content: {} }).acao, 'desconhecido')
  assert.equal(interpretarHook({}).acao, 'desconhecido')
  assert.equal(interpretarHook(null).hookType, '')
})
