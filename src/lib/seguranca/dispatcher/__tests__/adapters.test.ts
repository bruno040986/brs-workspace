import test from 'node:test'
import assert from 'node:assert/strict'
import { TelegramBotAdapter } from '../adapters/telegram.ts'
import { ResendEmailAdapter } from '../adapters/email.ts'
import { EngineWhatsAppAdapter } from '../adapters/whatsapp.ts'

const resp = (status: number, body: unknown) => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch
const tg = (f: typeof fetch) => new TelegramBotAdapter('SEGREDO-TOKEN', '123', { fetchImpl: f })

test('telegram: 200 com message_id => aceita', async () => {
  assert.deepEqual(await tg(resp(200, { ok: true, result: { message_id: 55 } })).enviar({ texto: 'x' }), { tipo: 'aceita', messageId: '55' })
})
test('telegram: 429 respeita retry_after', async () => {
  assert.deepEqual(await tg(resp(429, { ok: false, parameters: { retry_after: 17 } })).enviar({ texto: 'x' }), { tipo: 'limitada', retryAfterSeg: 17 })
})
test('telegram: 403/400/401 rejeição permanente; 5xx transitória', async () => {
  for (const s of [400, 401, 403, 404]) assert.deepEqual(await tg(resp(s, { ok: false })).enviar({ texto: 'x' }), { tipo: 'rejeitada', categoria: `http_${s}`, http: s })
  assert.equal(((await tg(resp(502, 'bad')).enviar({ texto: 'x' })) as { transitoria?: boolean }).transitoria, true)
})
test('telegram: timeout, queda e corpo ilegível => incerta, sem vazar o token', async () => {
  const timeout = (async () => { throw new DOMException('t', 'TimeoutError') }) as unknown as typeof fetch
  for (const f of [timeout, resp(200, 'nao-json'), resp(200, { ok: true })]) {
    const r = await tg(f).enviar({ texto: 'x' }); assert.equal(r.tipo, 'incerta'); assert.ok(!JSON.stringify(r).includes('SEGREDO'))
  }
})
test('email: idempotency-key = operationId; 4xx rejeita; 5xx e timeout são incertos', async () => {
  let h: Headers | undefined
  const f = (async (_u: string, i: RequestInit) => { h = new Headers(i.headers); return new Response(JSON.stringify({ id: 'e1' }), { status: 200 }) }) as unknown as typeof fetch
  assert.equal((await new ResendEmailAdapter('k', 'a@b.c', 'd@e.f', { fetchImpl: f }).enviar({ assunto: 's', html: 'h', operationId: 'OP' })).tipo, 'aceita')
  assert.equal(h!.get('idempotency-key'), 'OP')
  assert.equal((await new ResendEmailAdapter('k', 'a', 'b', { fetchImpl: resp(422, {}) }).enviar({ assunto: 's', html: 'h', operationId: 'OP' })).tipo, 'rejeitada')
  assert.equal((await new ResendEmailAdapter('k', 'a', 'b', { fetchImpl: resp(503, {}) }).enviar({ assunto: 's', html: 'h', operationId: 'OP' })).tipo, 'incerta')
})
test('whatsapp: mapeia erros do cliente do engine e repassa operationId', async () => {
  const mk = (e: Error) => new EngineWhatsAppAdapter(async () => { throw e }, '5561')
  const nomeado = (nome: string, extra: object) => Object.assign(new Error('x'), { name: nome }, extra)
  assert.equal((await mk(nomeado('EngineErro', { codigo: 'INSTANCIA_INELEGIVEL', status: 409 })).enviar({ instanciaId: 'i', texto: 't', operationId: 'o' })).tipo, 'rejeitada')
  assert.equal((await mk(nomeado('EngineEnvioIncertoError', { motivo: 'uncertain' })).enviar({ instanciaId: 'i', texto: 't', operationId: 'o' })).tipo, 'incerta')
  let visto = ''
  const ok = new EngineWhatsAppAdapter(async (_i, d, _t, o) => { visto = d + o.operationId; return { ok: true, id: 'm' } }, '5561')
  assert.deepEqual(await ok.enviar({ instanciaId: 'i', texto: 't', operationId: 'o' }), { tipo: 'aceita', messageId: 'm' })
  assert.equal(visto, '5561o')
})
