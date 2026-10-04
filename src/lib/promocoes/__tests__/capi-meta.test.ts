import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { enviarEventoCapi, hashTelefone, montarEventoLead, validarFbc, validarFbp } from '../capi-meta.ts'

const EID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b'
const base = { telefone: '(61) 98765-4321', ip: '1.2.3.4', userAgent: 'UA' }
const trk = { eventId: EID, consentimento_cookies: true, fbp: 'fb.1.1700000000.123456', fbc: 'fb.1.1700000000.AbCd' }

test('sem consentimento (false ou ausente) não monta', () => {
  assert.equal(montarEventoLead({ ...base, tracking: { ...trk, consentimento_cookies: false } }), null)
  assert.equal(montarEventoLead({ ...base, tracking: { eventId: EID } }), null)
  assert.equal(montarEventoLead({ ...base, tracking: null }), null)
})

test('eventId inválido não monta', () => {
  assert.equal(montarEventoLead({ ...base, tracking: { ...trk, eventId: 'abc' } }), null)
})

test('hash do telefone: DDI 55, sha256 hex, sem +', () => {
  const esperado = createHash('sha256').update('5561987654321').digest('hex')
  assert.equal(hashTelefone('(61) 98765-4321'), esperado)
  assert.equal(hashTelefone('+55 61 98765-4321'), esperado)
  assert.equal(hashTelefone('123'), null)
})

test('corpo: só domínio, ph, fbp/fbc, sem PII nem custom_data', () => {
  const c = montarEventoLead({ ...base, tracking: { ...trk, cpf: '12345678901', nome: 'Fulano' }, agoraMs: 1_700_000_000_999 })!
  const ev = (c.data as any[])[0]
  assert.equal(ev.event_name, 'Lead')
  assert.equal(ev.event_time, 1_700_000_000)
  assert.equal(ev.event_id, EID)
  assert.equal(ev.event_source_url, 'https://nuazul.com.br')
  assert.deepEqual(ev.user_data.ph, [hashTelefone(base.telefone)])
  assert.equal(ev.user_data.fbp, trk.fbp)
  assert.equal(ev.custom_data, undefined)
  const s = JSON.stringify(c)
  assert.ok(!s.includes('12345678901') && !s.includes('Fulano') && !s.includes('98765'))
  assert.equal('test_event_code' in c, false)
})

test('fbp/fbc inválidos descartados; telefone inválido omite ph', () => {
  assert.equal(validarFbp('fb.1.abc.1'), false)
  assert.equal(validarFbc('xx'), false)
  const c = montarEventoLead({ ...base, telefone: '1', tracking: { eventId: EID, consentimento_cookies: true, fbp: 'x', fbc: 'y' } })!
  const ud = (c.data as any[])[0].user_data
  assert.deepEqual(Object.keys(ud).sort(), ['client_ip_address', 'client_user_agent'])
})

test('test_event_code só quando configurado', () => {
  const c = montarEventoLead({ ...base, tracking: trk, testEventCode: 'TEST123' })!
  assert.equal(c.test_event_code, 'TEST123')
})

test('envio: token no header, não na URL; retry em 5xx; sem retry em 4xx', async () => {
  const chamadas: any[] = []
  const f = (async (url: string, init: any) => {
    chamadas.push({ url, init })
    return { ok: chamadas.length > 1, status: chamadas.length > 1 ? 200 : 503 }
  }) as any
  const r = await enviarEventoCapi({ data: [] }, { token: 'SEGREDO', datasetId: '99' }, f)
  assert.deepEqual(r, { ok: true, status: 200 })
  assert.equal(chamadas.length, 2)
  assert.ok(!chamadas[0].url.includes('SEGREDO'))
  assert.equal(chamadas[0].url, 'https://graph.facebook.com/v21.0/99/events')
  assert.equal(chamadas[0].init.headers.Authorization, 'Bearer SEGREDO')
  let n = 0
  const r2 = await enviarEventoCapi({}, { token: 't', datasetId: '1' }, (async () => { n++; return { ok: false, status: 400 } }) as any)
  assert.deepEqual(r2, { ok: false, status: 400 })
  assert.equal(n, 1)
})
