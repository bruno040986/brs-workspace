import test from 'node:test'
import assert from 'node:assert/strict'
import { emailDominioInterno, pausaMinutos, calcularEtapa, classificarErroAuth, mensagemPausa, type EstadoBanco } from '../etapas.ts'
import { gerarCodigo, hashCodigo, formatoCodigoValido, segredoCodigo, chaveSenha } from '../codigo-email.ts'

test('domínio: exatamente brspromotora.com.br', () => {
  assert.equal(emailDominioInterno('Ana@BRSPromotora.com.br'), true)
  for (const e of ['a@parceiro.brspromotora.com.br', 'a@brspromotora.com.br.evil.com', 'a@evilbrspromotora.com.br', 'a@x@brspromotora.com.br',
    '@brspromotora.com.br', 'a@brspromotora.com', '', 'a b@brspromotora.com.br', null, 5]) assert.equal(emailDominioInterno(e), false, String(e))
})

test('pausas: 5, 15, 30, 60, 120 e teto de 240 (sem 24 h)', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 99].map(pausaMinutos), [0, 5, 15, 30, 60, 120, 240, 240])
  assert.match(mensagemPausa(125), /2 min 05 s/)
})

const base: EstadoBanco = { liberada: false, tem_fator: true, fator_id: 'f', prova_ativacao: false, desafio_pendente: false, pausa_email_seg: 0, pausa_totp_seg: 0, bloqueado_admin: false, interno_ativo: true }
const claims = (over: object = {}) => ({ sub: 'u', session_id: 's', aal: 'aal1', email: 'a@brspromotora.com.br', amr: [{ method: 'password' }], app_metadata: {}, ...over })

test('máquina de estados', () => {
  assert.deepEqual(calcularEtapa(null, null), { etapa: 'anonima', proximo: 'login' })
  assert.deepEqual(calcularEtapa(claims(), base), { etapa: 'senha_ok', proximo: 'totp' })
  assert.deepEqual(calcularEtapa(claims(), { ...base, tem_fator: false }), { etapa: 'senha_ok', proximo: 'ativar_email' })
  assert.deepEqual(calcularEtapa(claims(), { ...base, tem_fator: false, prova_ativacao: true }), { etapa: 'senha_ok', proximo: 'ativar_totp' })
  const aal2 = claims({ aal: 'aal2', amr: [{ method: 'totp' }, { method: 'password' }] })
  assert.deepEqual(calcularEtapa(aal2, base), { etapa: 'totp_ok', proximo: 'email' })
  assert.deepEqual(calcularEtapa(aal2, { ...base, liberada: true }), { etapa: 'liberada', proximo: 'nenhum' })
})

test('negada: não interno, bloqueado, externo, domínio, sem senha no amr; liberada sem aal2 não vale', () => {
  assert.equal(calcularEtapa(claims(), { ...base, interno_ativo: false }).etapa, 'negada')
  assert.equal(calcularEtapa(claims(), { ...base, bloqueado_admin: true }).etapa, 'negada')
  assert.equal(calcularEtapa(claims({ app_metadata: { external: true } }), base).etapa, 'negada')
  assert.equal(calcularEtapa(claims({ email: 'a@parceiro.brspromotora.com.br' }), base).etapa, 'negada')
  assert.equal(calcularEtapa(claims({ amr: [{ method: 'otp' }] }), base).etapa, 'negada')
  assert.equal(calcularEtapa(claims(), null).etapa, 'negada')
  assert.notEqual(calcularEtapa(claims(), { ...base, liberada: true }).etapa, 'liberada')
})

test('erro de infraestrutura não conta como credencial', () => {
  assert.equal(classificarErroAuth({ status: 400, code: 'invalid_credentials' }), 'credencial')
  assert.equal(classificarErroAuth({ status: 400, code: 'mfa_verification_failed' }), 'credencial')
  assert.equal(classificarErroAuth({ status: 500 }), 'infra')
  assert.equal(classificarErroAuth({ status: 429, code: 'over_request_rate_limit' }), 'infra')
  assert.equal(classificarErroAuth({ name: 'AuthRetryableFetchError', status: 0 }), 'infra')
  assert.equal(classificarErroAuth(null), 'infra')
})

test('código: 6 dígitos, hash preso a user/sessão/finalidade, segredo obrigatório', () => {
  const c = gerarCodigo()
  assert.equal(formatoCodigoValido(c), true)
  for (const x of ['12345', '1234567', 'abcdef', '12 456', 123456]) assert.equal(formatoCodigoValido(x), false)
  const seg = 'x'.repeat(32)
  const h = hashCodigo(seg, 'u', 's', 'acesso_workspace', '123456')
  assert.match(h, /^[0-9a-f]{64}$/)
  assert.equal(h, hashCodigo(seg, 'u', 's', 'acesso_workspace', ' 123456 '))
  for (const outro of [hashCodigo(seg, 'u2', 's', 'acesso_workspace', '123456'), hashCodigo(seg, 'u', 's2', 'acesso_workspace', '123456'),
    hashCodigo(seg, 'u', 's', 'ativacao_fator', '123456'), hashCodigo(seg, 'u', 's', 'acesso_workspace', '123457'), hashCodigo('y'.repeat(32), 'u', 's', 'acesso_workspace', '123456')]) assert.notEqual(outro, h)
  assert.throws(() => segredoCodigo({}))
  assert.throws(() => segredoCodigo({ AUTH_CODIGO_SEGREDO: 'curto' }))
  assert.equal(segredoCodigo({ AUTH_CODIGO_SEGREDO: seg }), seg)
  assert.notEqual(chaveSenha(seg, 'a@brspromotora.com.br'), chaveSenha(seg, 'b@brspromotora.com.br'))
  assert.equal(new Set(Array.from({ length: 200 }, gerarCodigo)).size > 150, true)
})

import { verificarTurnstile } from '../turnstile.ts'
test('turnstile: desligado sem env; ligado sem segredo/token falha fechado; sucesso só com success:true', async () => {
  assert.deepEqual(await verificarTurnstile(undefined, null, {}), { ok: true, aplicado: false, motivo: 'desligado' })
  assert.equal((await verificarTurnstile('t', null, { TURNSTILE_ENFORCE: 'true' })).ok, false)
  assert.equal((await verificarTurnstile(undefined, null, { TURNSTILE_ENFORCE: 'true', TURNSTILE_SECRET_KEY: 's' })).motivo, 'token_ausente')
  const f = (v: unknown, ok = true) => (async () => ({ ok, json: async () => v })) as unknown as typeof fetch
  const env = { TURNSTILE_ENFORCE: 'true', TURNSTILE_SECRET_KEY: 's' }
  assert.equal((await verificarTurnstile('t', null, env, f({ success: true }))).ok, true)
  assert.equal((await verificarTurnstile('t', null, env, f({ success: false }))).ok, false)
  assert.equal((await verificarTurnstile('t', null, env, f({}, false))).ok, false)
  assert.equal((await verificarTurnstile('t', null, env, (async () => { throw new Error('x') }) as unknown as typeof fetch)).ok, false)
})
