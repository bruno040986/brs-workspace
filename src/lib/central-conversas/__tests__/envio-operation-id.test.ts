/**
 * Lote 02B — contrato de envio com operationId (engine simulado) + máquina de
 * estados da modal "Nova conversa".
 * Roda com: npm test  (node --test --experimental-strip-types)
 * Não fala com engine real: `fetch` é substituído por um stub que captura o
 * corpo/headers e devolve o que cada caso pede.
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { engine, EngineEnvioIncertoError, EngineErro } from '../engine.ts'
import { ehOperationId, estadoInicialEnvio, normalizarTelefoneDestino, novoOperationId, reduzirEnvio, resolverIntencao, type EstadoEnvio } from '../envio-intencao.ts'

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
const envio = (chave = novoOperationId()) => engine.enviar('inst-1', '5511999990000', 'oi', { operationId: chave })
const ehIncerto = (motivo: string, chave?: string) => (err: unknown) =>
  err instanceof EngineEnvioIncertoError && err.motivo === motivo && (chave === undefined || err.operationId === chave)
const ehRejeicao = (codigo: string) => (err: unknown) => err instanceof EngineErro && err.codigo === codigo && !(err instanceof EngineEnvioIncertoError)

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
    await envio(chave)
    await envio(chave)
    assert.equal(chamadas.length, 2)
    assert.equal(chamadas[0].body.operationId, chave)
    assert.equal(chamadas[1].body.operationId, chave)
  })

  test('dois envios deliberados iguais recebem chaves distintas (chave vem de fora, não do conteúdo)', async () => {
    simularEngine(() => ok())
    const a = novoOperationId()
    const b = novoOperationId()
    assert.notEqual(a, b)
    await envio(a)
    await envio(b)
    assert.notEqual(chamadas[0].body.operationId, chamadas[1].body.operationId)
  })

  test('recusa chave ausente/inválida antes de chamar o engine (rejeição, não incerteza)', async () => {
    simularEngine(() => ok())
    await assert.rejects(() => engine.enviar('inst-1', '5511999990000', 'oi', { operationId: 'nao-e-uuid' }), /operationId inválido/)
    await assert.rejects(() => engine.enviar('inst-1', '5511999990000', 'oi', {} as never), /operationId inválido/)
    assert.equal(chamadas.length, 0)
  })

  test('409 DELIVERY_UNCERTAIN → incerto(uncertain), uma chamada, chave preservada, sem retry', async () => {
    simularEngine(() => new Response(JSON.stringify({ error: 'Envio em processamento ou resultado incerto; aguarde reconciliação.', code: 'DELIVERY_UNCERTAIN' }), { status: 409 }))
    const chave = novoOperationId()
    await assert.rejects(() => envio(chave), ehIncerto('uncertain', chave))
    assert.equal(chamadas.length, 1)
  })

  test('timeout (abort) → incerto(timeout), uma chamada', async () => {
    simularEngine(() => {
      const e = new Error('aborted')
      e.name = 'AbortError'
      throw e
    })
    const chave = novoOperationId()
    await assert.rejects(() => envio(chave), ehIncerto('timeout', chave))
    assert.equal(chamadas.length, 1)
  })

  test('queda de conexão (TypeError fetch failed / ECONNRESET) → incerto(transporte), uma chamada', async () => {
    simularEngine(() => {
      throw new TypeError('fetch failed')
    })
    const chave = novoOperationId()
    await assert.rejects(() => envio(chave), ehIncerto('transporte', chave))
    assert.equal(chamadas.length, 1)
  })

  test('502/503/504 do gateway → incerto(gateway), uma chamada cada', async () => {
    for (const status of [502, 503, 504]) {
      chamadas = []
      simularEngine(() => new Response('Bad Gateway', { status }))
      const chave = novoOperationId()
      await assert.rejects(() => envio(chave), ehIncerto('gateway', chave))
      assert.equal(chamadas.length, 1)
    }
  })

  test('500 genérico do engine (falha no meio do envio) → incerto(gateway)', async () => {
    simularEngine(() => new Response(JSON.stringify({ statusCode: 500, error: 'Internal Server Error', message: 'SEND_RESULT_PERSISTENCE_FAILED' }), { status: 500 }))
    await assert.rejects(() => envio(), ehIncerto('gateway'))
    assert.equal(chamadas.length, 1)
  })

  test('corpo interrompido (falha ao ler a resposta) → incerto(resposta)', async () => {
    simularEngine(() => {
      const res = new Response('x', { status: 200 })
      Object.defineProperty(res, 'text', { value: () => Promise.reject(new TypeError('terminated')) })
      return res
    })
    await assert.rejects(() => envio(), ehIncerto('resposta'))
    assert.equal(chamadas.length, 1)
  })

  test('2xx sem confirmação válida (objeto vazio, JSON quebrado, ok:false, sem id) → incerto(resposta)', async () => {
    for (const corpo of ['{}', '', 'not json', JSON.stringify({ ok: false }), JSON.stringify({ ok: true })]) {
      chamadas = []
      simularEngine(() => new Response(corpo, { status: 200 }))
      await assert.rejects(() => envio(), ehIncerto('resposta'))
      assert.equal(chamadas.length, 1)
    }
  })

  test('rejeições comprovadas NÃO viram incerto: 4xx do contrato, erro de domínio com código, conflito de chave', async () => {
    simularEngine(() => new Response(JSON.stringify({ error: 'Mensagem vazia.' }), { status: 400 }))
    await assert.rejects(() => envio(), ehRejeicao('HTTP_400'))

    chamadas = []
    simularEngine(() => new Response(JSON.stringify({ erro: 'Instância não está conectada.', codigo: 'INSTANCIA_DESCONECTADA' }), { status: 409 }))
    await assert.rejects(() => envio(), ehRejeicao('INSTANCIA_DESCONECTADA'))

    chamadas = []
    simularEngine(() => new Response(JSON.stringify({ statusCode: 500, error: 'Internal Server Error', message: 'OPERATION_CONTENT_CONFLICT' }), { status: 500 }))
    await assert.rejects(() => envio(), ehRejeicao('OPERATION_CONTENT_CONFLICT'))

    chamadas = []
    simularEngine(() => new Response(JSON.stringify({ error: 'Instância não encontrada.' }), { status: 404 }))
    await assert.rejects(() => envio(), ehRejeicao('HTTP_404'))
    assert.equal(chamadas.length, 1)
  })

  test('código existir NÃO prova rejeição: erro pós-envio estruturado e código desconhecido em 500 ficam incertos', async () => {
    for (const corpo of [
      { code: 'SEND_RESULT_PERSISTENCE_FAILED', message: 'falha apos envio' },
      { codigo: 'SEND_RESULT_PERSISTENCE_FAILED', erro: 'falha apos envio' },
      { code: 'INTERNAL_ERROR', message: 'falha apos envio' },
      { error: 'enviar pelo WhatsApp: SEND_RESULT_PERSISTENCE_FAILED' },
      { error: 'espelhar mensagem no Chatwoot: timeout' },
      { erro: 'Falha ao comunicar com o WhatsApp', codigo: 'FALHA_WHATSAPP' },
    ]) {
      chamadas = []
      simularEngine(() => new Response(JSON.stringify(corpo), { status: 500 }))
      const chave = novoOperationId()
      await assert.rejects(() => envio(chave), ehIncerto('gateway', chave))
      assert.equal(chamadas.length, 1)
    }
    chamadas = []
    simularEngine(() => new Response(JSON.stringify({ erro: 'Falha ao comunicar com o WhatsApp', codigo: 'FALHA_WHATSAPP' }), { status: 502 }))
    await assert.rejects(() => envio(), ehIncerto('gateway'))
    assert.equal(chamadas.length, 1)
  })

  test('rejeições conhecidas estruturadas, nos formatos reais do engine, continuam rejeição', async () => {
    const casos: Array<[number, Record<string, unknown>, string]> = [
      [422, { error: 'numero_sem_whatsapp', erro: 'numero_sem_whatsapp' }, 'numero_sem_whatsapp'],
      [500, { error: 'enviar pelo WhatsApp: OPERATION_CONTENT_CONFLICT' }, 'OPERATION_CONTENT_CONFLICT'],
      [500, { error: 'enviar pelo WhatsApp: SEND_PERSISTENCE_FAILED' }, 'SEND_PERSISTENCE_FAILED'],
      [500, { statusCode: 500, error: 'Internal Server Error', message: 'OPERATION_CONTENT_CONFLICT' }, 'OPERATION_CONTENT_CONFLICT'],
      [409, { erro: 'Instância não está conectada.', codigo: 'INSTANCIA_DESCONECTADA' }, 'INSTANCIA_DESCONECTADA'],
      [501, { erro: 'Só Baileys.', codigo: 'PROVEDOR_NAO_SUPORTADO' }, 'PROVEDOR_NAO_SUPORTADO'],
      [400, { code: 'PAYLOAD_INVALIDO', message: 'operationId inválido' }, 'PAYLOAD_INVALIDO'],
    ]
    for (const [status, corpo, codigo] of casos) {
      chamadas = []
      simularEngine(() => new Response(JSON.stringify(corpo), { status }))
      await assert.rejects(() => envio(), ehRejeicao(codigo))
      assert.equal(chamadas.length, 1)
    }
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

describe('máquina de estados da modal "Nova conversa" (a mesma que a UI usa via useReducer)', () => {
  let n = 0
  const gerar = () => `00000000-0000-4000-8000-00000000000${++n}`
  const reduzir = (s: EstadoEnvio, a: Parameters<typeof reduzirEnvio>[1]) => reduzirEnvio(s, a, gerar)
  const campos = { instanciaId: 'i', telefone: '(11) 99999-0000', texto: ' oi ' }

  test('enviar normaliza campos, gera a chave uma vez; enquanto envia, editar e fechar-por-edição são ignorados', () => {
    let s = reduzir(estadoInicialEnvio(campos), { tipo: 'enviar' })
    assert.equal(s.fase, 'enviando')
    assert.deepEqual(s.intencao, { instanciaId: 'i', telefone: '11999990000', texto: 'oi', chave: s.intencao!.chave })
    const chave = s.intencao!.chave
    s = reduzir(s, { tipo: 'editar', campos: { texto: 'outro' } })
    assert.equal(s.fase, 'enviando')
    assert.equal(s.intencao!.texto, 'oi')
    assert.equal(s.intencao!.chave, chave)
  })

  test('incerto → tentar editar é ignorado → repetir usa a MESMA chave e o MESMO payload', () => {
    let s = reduzir(estadoInicialEnvio(campos), { tipo: 'enviar' })
    const chave = s.intencao!.chave
    s = reduzir(s, { tipo: 'resultado', resultado: { resultado: 'incerto', mensagem: 'timeout' } })
    assert.equal(s.fase, 'incerto')
    assert.equal(s.mensagem, 'timeout')
    // campos congelados: a edição não pega
    s = reduzir(s, { tipo: 'editar', campos: { texto: 'editado', telefone: '11888880000', instanciaId: 'j' } })
    assert.equal(s.fase, 'incerto')
    assert.equal(s.campos.texto, ' oi ')
    s = reduzir(s, { tipo: 'repetir' })
    assert.equal(s.fase, 'enviando')
    assert.equal(s.intencao!.chave, chave)
    assert.deepEqual(s.campos, { instanciaId: 'i', telefone: '11999990000', texto: 'oi' })
    // e "enviar" cru também não gera outra chave a partir de 'incerto'
    const s2 = reduzir(reduzir(s, { tipo: 'resultado', resultado: { resultado: 'incerto', mensagem: 'de novo' } }), { tipo: 'enviar' })
    assert.equal(s2.fase, 'incerto')
    assert.equal(s2.intencao!.chave, chave)
  })

  test('incerto → novo envio explícito: intenção anterior registrada como incerta, campos liberados, chave NOVA', () => {
    let s = reduzir(estadoInicialEnvio(campos), { tipo: 'enviar' })
    const chaveAnterior = s.intencao!.chave
    s = reduzir(s, { tipo: 'resultado', resultado: { resultado: 'incerto', mensagem: 'gateway' } })
    s = reduzir(s, { tipo: 'novoEnvio' })
    assert.equal(s.fase, 'editando')
    assert.equal(s.intencao, null)
    assert.equal(s.incertoAnterior!.chave, chaveAnterior)
    assert.match(s.mensagem!, /PODE ter sido entregue/)
    s = reduzir(s, { tipo: 'editar', campos: { texto: 'segunda tentativa' } })
    assert.equal(s.campos.texto, 'segunda tentativa')
    s = reduzir(s, { tipo: 'enviar' })
    assert.equal(s.fase, 'enviando')
    assert.notEqual(s.intencao!.chave, chaveAnterior)
    assert.equal(s.incertoAnterior!.chave, chaveAnterior)
  })

  test('rejeitado: nada saiu → volta a editar; repetir igual conserva a chave; mudar campo troca', () => {
    let s = reduzir(estadoInicialEnvio(campos), { tipo: 'enviar' })
    const chave = s.intencao!.chave
    s = reduzir(s, { tipo: 'resultado', resultado: { resultado: 'rejeitado', mensagem: 'Instância não encontrada.' } })
    assert.equal(s.fase, 'editando')
    assert.equal(s.mensagem, 'Instância não encontrada.')
    s = reduzir(s, { tipo: 'enviar' })
    assert.equal(s.intencao!.chave, chave)
    s = reduzir(s, { tipo: 'resultado', resultado: { resultado: 'rejeitado', mensagem: 'x' } })
    s = reduzir(s, { tipo: 'editar', campos: { telefone: '11777770000' } })
    s = reduzir(s, { tipo: 'enviar' })
    assert.notEqual(s.intencao!.chave, chave)
  })

  test('confirmado → concluido, intenção zerada, conversationId guardado', () => {
    let s = reduzir(estadoInicialEnvio(campos), { tipo: 'enviar' })
    s = reduzir(s, { tipo: 'resultado', resultado: { resultado: 'confirmado', conversationId: 9 } })
    assert.equal(s.fase, 'concluido')
    assert.equal(s.intencao, null)
    assert.equal(s.conversationId, 9)
  })
})
