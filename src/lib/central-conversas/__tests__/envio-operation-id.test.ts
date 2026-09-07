/**
 * Lote 02B — contrato de envio com operationId (engine simulado).
 * Roda com: npm test  (node --test --experimental-strip-types)
 * Não fala com engine real: `fetch` é substituído por um stub que captura o
 * corpo/headers e devolve o que cada caso pede.
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { engine, EngineEnvioIncertoError, EngineErro } from '../engine.ts'
import { ehOperationId, normalizarTelefoneDestino, novoOperationId, resolverIntencao } from '../envio-intencao.ts'

type Chamada = { url: string; init: RequestInit; body: Record<string, unknown> }

const fetchOriginal = globalThis.fetch
let chamadas: Chamada[] = []

function simularEngine(responder: (c: Chamada) => Response | Promise<Response>) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const c: Chamada = { url: String(url), init: init || {}, body: init?.body ? JSON.parse(String(init.body)) : {} }
    chamadas.push(c)
    return responder(c)
  }) as typeof fetch
}

const ok = (extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ ok: true, id: 'wa-1', messageId: 'wa-1', conversationId: 77, ...extra }), { status: 200 })

describe('engine.enviar — operationId no corpo', () => {
  beforeEach(() => {
    chamadas = []
    process.env.ENGINE_API_TOKEN = 'token-teste'
    process.env.ENGINE_URL = 'http://engine.simulado'
  })
  afterEach(() => {
    globalThis.fetch = fetchOriginal
  })

  test('transmite destino, texto e operationId, com Bearer da instância', async () => {
    simularEngine(() => ok())
    const chave = novoOperationId()
    const r = await engine.enviar('inst-1', '5511999990000', '*Ana:*\nolá', { operationId: chave })
    assert.equal(r.conversationId, 77)
    assert.equal(chamadas.length, 1)
    assert.equal(chamadas[0].url, 'http://engine.simulado/instancias/inst-1/enviar')
    assert.equal(chamadas[0].init.method, 'POST')
    assert.equal((chamadas[0].init.headers as Record<string, string>).Authorization, 'Bearer token-teste')
    assert.deepEqual(chamadas[0].body, { destino: '5511999990000', texto: '*Ana:*\nolá', operationId: chave })
  })

  test('retry da mesma intenção conserva a chave (helper não gera nem troca)', async () => {
    simularEngine(() => ok())
    const chave = novoOperationId()
    await engine.enviar('inst-1', '5511999990000', 'oi', { operationId: chave })
    await engine.enviar('inst-1', '5511999990000', 'oi', { operationId: chave })
    assert.equal(chamadas.length, 2)
    assert.equal(chamadas[0].body.operationId, chave)
    assert.equal(chamadas[1].body.operationId, chave)
  })

  test('dois envios deliberados iguais recebem chaves distintas (chave vem de fora, não do conteúdo)', async () => {
    simularEngine(() => ok())
    const a = novoOperationId()
    const b = novoOperationId()
    assert.notEqual(a, b)
    await engine.enviar('inst-1', '5511999990000', 'oi', { operationId: a })
    await engine.enviar('inst-1', '5511999990000', 'oi', { operationId: b })
    assert.notEqual(chamadas[0].body.operationId, chamadas[1].body.operationId)
  })

  test('recusa chave ausente/inválida antes de chamar o engine', async () => {
    simularEngine(() => ok())
    await assert.rejects(() => engine.enviar('inst-1', '5511999990000', 'oi', { operationId: 'nao-e-uuid' }), /operationId inválido/)
    await assert.rejects(() => engine.enviar('inst-1', '5511999990000', 'oi', {} as never), /operationId inválido/)
    assert.equal(chamadas.length, 0)
  })

  test('409 DELIVERY_UNCERTAIN → EngineEnvioIncertoError, uma única chamada, sem retry', async () => {
    simularEngine(() => new Response(JSON.stringify({ error: 'Envio em processamento ou resultado incerto; aguarde reconciliação.', code: 'DELIVERY_UNCERTAIN' }), { status: 409 }))
    const chave = novoOperationId()
    await assert.rejects(
      () => engine.enviar('inst-1', '5511999990000', 'oi', { operationId: chave }),
      (err: unknown) => err instanceof EngineEnvioIncertoError && err.motivo === 'uncertain' && err.operationId === chave,
    )
    assert.equal(chamadas.length, 1)
  })

  test('timeout (abort) → EngineEnvioIncertoError, uma única chamada, sem retry', async () => {
    simularEngine(() => {
      const e = new Error('aborted')
      e.name = 'AbortError'
      throw e
    })
    const chave = novoOperationId()
    await assert.rejects(
      () => engine.enviar('inst-1', '5511999990000', 'oi', { operationId: chave }),
      (err: unknown) => err instanceof EngineEnvioIncertoError && err.motivo === 'timeout',
    )
    assert.equal(chamadas.length, 1)
  })

  test('erro de domínio { erro, codigo } vira EngineErro com código (não é incerto)', async () => {
    simularEngine(() => new Response(JSON.stringify({ erro: 'Instância não está conectada.', codigo: 'INSTANCIA_DESCONECTADA' }), { status: 409 }))
    await assert.rejects(
      () => engine.enviar('inst-1', '5511999990000', 'oi', { operationId: novoOperationId() }),
      (err: unknown) => err instanceof EngineErro && err.codigo === 'INSTANCIA_DESCONECTADA' && !(err instanceof EngineEnvioIncertoError),
    )
    assert.equal(chamadas.length, 1)
  })

  test('mentions/quoted só entram no corpo quando informados', async () => {
    simularEngine(() => ok())
    await engine.enviar('inst-1', '5511999990000', 'oi', { operationId: novoOperationId(), mentions: ['5511@s.whatsapp.net'], quoted: { messageId: 42 } })
    assert.deepEqual(chamadas[0].body.mentions, ['5511@s.whatsapp.net'])
    assert.deepEqual(chamadas[0].body.quoted, { messageId: 42 })
  })
})

describe('envio-intencao — chave por intenção', () => {
  test('mesmos campos → mesma chave; campo alterado → chave nova; sem intenção → chave nova', () => {
    let n = 0
    const gerar = () => `00000000-0000-4000-8000-00000000000${++n}`
    const campos = { instanciaId: 'i', telefone: '5511999990000', texto: 'oi' }
    const a = resolverIntencao(null, campos, gerar)
    const b = resolverIntencao(a, campos, gerar)
    assert.equal(a.chave, b.chave)
    const c = resolverIntencao(b, { ...campos, texto: 'oi!' }, gerar)
    assert.notEqual(c.chave, a.chave)
    const d = resolverIntencao(null, campos, gerar)
    assert.notEqual(d.chave, a.chave)
  })

  test('novoOperationId é uuid e não se repete', () => {
    const a = novoOperationId()
    const b = novoOperationId()
    assert.ok(ehOperationId(a) && ehOperationId(b))
    assert.notEqual(a, b)
    assert.equal(ehOperationId('abc'), false)
    assert.equal(ehOperationId(undefined), false)
  })

  test('normalizarTelefoneDestino: 10/11 dígitos ganham 55; E.164 fica; curto rejeita', () => {
    assert.equal(normalizarTelefoneDestino('(11) 91234-5678'), '5511912345678')
    assert.equal(normalizarTelefoneDestino('1133334444'), '551133334444')
    assert.equal(normalizarTelefoneDestino('5511912345678'), '5511912345678')
    assert.throws(() => normalizarTelefoneDestino('123'), /DDD/)
  })
})
