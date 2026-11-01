import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { processarHookMfa, type DepsHook } from '../hook-mfa.ts'

const SEGREDO_RAW = Buffer.from('0123456789abcdef0123456789abcdef')
const SEGREDO = 'v1,whsec_' + SEGREDO_RAW.toString('base64')
const U = '00000004-0000-4000-8000-000000000001'
const AGORA = 1_800_000_000_000

function assinar(corpo: string, id = 'msg_1', ts = String(AGORA / 1000), chave = SEGREDO_RAW) {
  return { id, timestamp: ts, assinatura: 'v1,' + createHmac('sha256', chave).update(`${id}.${ts}.${corpo}`).digest('base64') }
}
function deps(over: Partial<DepsHook> = {}): DepsHook & { chamadas: string[] } {
  const chamadas: string[] = []
  return {
    chamadas, segredo: SEGREDO, agora: () => AGORA,
    pausaAtual: async () => 0,
    registrarFalha: async () => { chamadas.push('falha'); return { pausaSeg: 0, alerta: false } },
    registrarSucesso: async () => { chamadas.push('sucesso') },
    ...over,
  }
}
const corpo = (valid: boolean) => JSON.stringify({ user_id: U, factor_id: 'f', factor_type: 'totp', valid })

test('hook MFA: falha fechada sem segredo, assinatura errada, antiga ou payload invalido', async () => {
  const c = corpo(false)
  assert.equal((await processarHookMfa(assinar(c), c, deps({ segredo: undefined }))).status, 503)
  assert.equal((await processarHookMfa(assinar(c), c, deps({ segredo: '' }))).status, 503)
  assert.equal((await processarHookMfa(assinar(c, 'm', String(AGORA / 1000), Buffer.from('outro-segredo-outro-segredo-xx')), c, deps())).status, 401)
  assert.equal((await processarHookMfa({ id: null, timestamp: null, assinatura: null }, c, deps())).status, 401)
  assert.equal((await processarHookMfa(assinar(c, 'm', String(AGORA / 1000 - 3600)), c, deps())).status, 401) // replay antigo
  assert.equal((await processarHookMfa(assinar(c + ' '), c, deps())).status, 401) // corpo adulterado
  const ruim = JSON.stringify({ user_id: 'x', valid: false })
  assert.equal((await processarHookMfa(assinar(ruim), ruim, deps())).status, 400)
})

test('hook MFA: codigo errado conta no banco; na pausa nega (mesmo com codigo certo); sucesso zera', async () => {
  const d = deps()
  let c = corpo(false)
  let r = await processarHookMfa(assinar(c), c, d)
  assert.deepEqual(r, { status: 200, corpo: { decision: 'continue' } }); assert.deepEqual(d.chamadas, ['falha'])

  const dp = deps({ registrarFalha: async () => ({ pausaSeg: 300, alerta: false }) })
  r = await processarHookMfa(assinar(c), c, dp)
  assert.equal(r.corpo.decision, 'reject')

  const emPausa = deps({ pausaAtual: async () => 120 })
  c = corpo(true)
  r = await processarHookMfa(assinar(c), c, emPausa)
  assert.equal(r.corpo.decision, 'reject'); assert.deepEqual(emPausa.chamadas, [])

  r = await processarHookMfa(assinar(c), c, d)
  assert.equal(r.corpo.decision, 'continue'); assert.deepEqual(d.chamadas, ['falha', 'sucesso'])
})

test('hook MFA: erro de infraestrutura nao libera (503)', async () => {
  const c = corpo(true)
  assert.equal((await processarHookMfa(assinar(c), c, deps({ pausaAtual: async () => null }))).status, 503)
  const f = corpo(false)
  assert.equal((await processarHookMfa(assinar(f), f, deps({ registrarFalha: async () => null }))).status, 503)
})
