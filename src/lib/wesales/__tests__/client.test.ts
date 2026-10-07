import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { codigoErroWesales, getContact, WesalesHttpError } from '../client.ts'

// WeSales falso: fetch simulado, nenhuma chamada de rede real.
const fetchOriginal = globalThis.fetch
let chamadas: Array<{ url: string; signal?: AbortSignal | null }> = []
function wesalesFalso(resposta: () => Response | Promise<Response>) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), signal: init?.signal })
    return resposta()
  }) as typeof fetch
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

beforeEach(() => {
  process.env.WESALES_API_TOKEN = 'token-de-teste'
  process.env.WESALES_LOCATION_ID = 'loc-teste'
  chamadas = []
})
afterEach(() => {
  globalThis.fetch = fetchOriginal
})

test('getContact devolve o contato e usa timeout', async () => {
  wesalesFalso(() => json(200, { contact: { id: 'c1', name: 'Pessoa Sintética' } }))
  const c = await getContact('c1')
  assert.equal(c?.id, 'c1')
  assert.match(chamadas[0].url, /\/contacts\/c1$/)
  assert.ok(chamadas[0].signal, 'fetch recebe AbortSignal de timeout')
})

test('getContact devolve null só para 404 e 400', async () => {
  wesalesFalso(() => json(404, { message: 'Contact not found' }))
  assert.equal(await getContact('x'), null)
  wesalesFalso(() => json(400, { message: 'Invalid id' }))
  assert.equal(await getContact('x'), null)
})

for (const status of [401, 403, 500, 503]) {
  test(`getContact relança ${status} como WesalesHttpError`, async () => {
    wesalesFalso(() => json(status, { statusCode: status, message: 'Location is not active' }))
    await assert.rejects(getContact('c1'), (err: unknown) => {
      assert.ok(err instanceof WesalesHttpError)
      assert.equal(err.status, status)
      assert.equal(codigoErroWesales(err), `wesales_${status}`)
      return true
    })
  })
}

test('getContact relança timeout como WesalesHttpError status 0', async () => {
  wesalesFalso(() => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  })
  await assert.rejects(getContact('c1'), (err: unknown) => {
    assert.ok(err instanceof WesalesHttpError)
    assert.equal(err.status, 0)
    assert.equal(err.body, 'timeout')
    assert.equal(codigoErroWesales(err), 'wesales_sem_resposta')
    return true
  })
})

test('getContact relança falha de rede como WesalesHttpError status 0', async () => {
  wesalesFalso(() => {
    throw new TypeError('fetch failed')
  })
  await assert.rejects(getContact('c1'), (err: unknown) => err instanceof WesalesHttpError && err.status === 0 && err.body === 'falha de rede')
})

test('codigoErroWesales não vaza mensagem de erro desconhecido', () => {
  assert.equal(codigoErroWesales(new Error('CPF 123 na mensagem')), 'wesales_erro')
})

test('getContact relança erro que não é de transporte sem converter', async () => {
  wesalesFalso(() => new Response('<html>', { status: 200 }))
  await assert.rejects(getContact('c1'), (err: unknown) => err instanceof SyntaxError)
})
