import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

const TOKEN = 'tok_'.padEnd(43, 'a')
const HASH = createHash('sha256').update(TOKEN).digest('hex')
const SUB = '11111111-1111-4111-8111-111111111111'

let estado: { geracao: any; rpc: any; limiteOk: boolean }

function builder(tabela: string) {
  const q: any = {
    _upd: null,
    select: () => q,
    update: (v: any) => ((q._upd = v), q),
    insert: () => Promise.resolve({ error: null }),
    eq: () => q,
    in: () => q,
    or: () => q,
    order: () => q,
    maybeSingle: () => Promise.resolve({ data: tabela === 'promocao_geracoes' ? estado.geracao : tabela === 'promocao_campanhas' ? { id: 'c1', slug: 'valparaiso-go', status: 'ativa', prazo_geracao_ate: '2999-01-01T00:00:00Z' } : null }),
    then: (res: any) => {
      if (q._upd && tabela === 'promocao_geracoes' && q._upd.submission_id) estado.geracao.submission_id = q._upd.submission_id
      return Promise.resolve({ data: tabela === 'promocao_numeros' ? [{ numero: 12 }, { numero: 34567 }] : [{ id: 'g1' }], count: 2, error: null }).then(res)
    },
  }
  return q
}

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: async () => ({
    from: builder,
    rpc: async (fn: string) => (fn === 'promocao_limite_tentar' ? { data: estado.limiteOk, error: null } : estado.rpc()),
  }),
}))

import { POST } from '@/app/api/promocoes/publico/geracao/confirmar/route'

function req(extra: Record<string, unknown> = {}) {
  return new Request('http://x/api', {
    method: 'POST',
    headers: { 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify({ campanha: 'valparaiso-go', t: TOKEN, submissionId: SUB, telefoneConfirmacao: '0000', dados: { nome: 'Maria Silva', telefone: '61999990000' }, aceiteRegulamento: true, regulamentoVersao: 'v1', site: '', ...extra }),
  }) as any
}

beforeEach(() => {
  estado = {
    geracao: { id: 'g1', campanha_id: 'c1', status: 'enviado', token_hash: HASH, telefone: '5561999990000', expira_em: '2999-01-01T00:00:00Z', titular_tipo: 'inscricao', titular_id: 't1', submission_id: null, qtd: 2, snapshot: {} },
    rpc: () => ({ data: [12, 34567], error: null }),
    limiteOk: true,
  }
})

describe('POST geracao/confirmar', () => {
  it('gera e devolve números formatados', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ numeros: ['00012', '34567'], totalNumeros: 2, comprovanteToken: TOKEN })
  })

  it('honeypot responde 200 sem gerar', async () => {
    const rpc = vi.fn()
    estado.rpc = rpc
    const res = await POST(req({ site: 'bot' }))
    expect(await res.json()).toEqual({ ok: true })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('4 dígitos errados -> 422 e não gera', async () => {
    const rpc = vi.fn()
    estado.rpc = rpc
    const res = await POST(req({ telefoneConfirmacao: '1111' }))
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('TELEFONE_NAO_CONFERE')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sem aceite -> 409', async () => {
    const res = await POST(req({ aceiteRegulamento: false }))
    expect(res.status).toBe(409)
  })

  it('link já usado com o mesmo submissionId devolve o mesmo resultado (idempotente)', async () => {
    estado.geracao.status = 'usado'
    estado.geracao.submission_id = SUB
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect((await res.json()).numeros).toHaveLength(2)
  })

  it('link usado com outro submissionId -> 404', async () => {
    estado.geracao.status = 'usado'
    estado.geracao.submission_id = '22222222-2222-4222-8222-222222222222'
    expect((await POST(req())).status).toBe(404)
  })

  it('limite estourado -> 429', async () => {
    estado.limiteOk = false
    expect((await POST(req())).status).toBe(429)
  })

  it('RPC com LINK_INVALIDO (corrida) -> 404', async () => {
    estado.rpc = () => ({ data: null, error: { message: 'LINK_INVALIDO' } })
    expect((await POST(req())).status).toBe(404)
  })
})
