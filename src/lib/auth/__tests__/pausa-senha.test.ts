import test from 'node:test'
import assert from 'node:assert/strict'
import { decidirPausaSenha } from '../pausa-senha.ts'
import { ipConfiavel } from '../ip-confiavel.ts'

const base = { origemSeg: 0, duroSeg: 0, leveSeg: 0, turnstileAplicadoEValido: false }

test('I2: pausa leve por identificador cede a Turnstile valido; sem ele aplica', () => {
  assert.equal(decidirPausaSenha({ ...base, leveSeg: 300 }).bloqueia, true)
  assert.equal(decidirPausaSenha({ ...base, leveSeg: 300, turnstileAplicadoEValido: true }).bloqueia, false)
  assert.equal(decidirPausaSenha(base).bloqueia, false)
})

test('I2: captcha valido acima do teto por identificador (tier duro) AINDA e pausado; origem tambem', () => {
  const d = decidirPausaSenha({ ...base, duroSeg: 600, leveSeg: 300, turnstileAplicadoEValido: true })
  assert.deepEqual(d, { bloqueia: true, pausaSeg: 600, motivo: 'pausa_ativa_teto_identificador' })
  assert.equal(decidirPausaSenha({ ...base, origemSeg: 120, turnstileAplicadoEValido: true }).bloqueia, true)
})

test('IP so de cabecalho da plataforma (Vercel); fora dela ou invalido => null', () => {
  const h = (m: Record<string, string>) => (n: string) => m[n] ?? null
  assert.equal(ipConfiavel(h({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }), { VERCEL: '1' }), '203.0.113.9')
  assert.equal(ipConfiavel(h({ 'x-real-ip': '203.0.113.9' }), { VERCEL: '1' }), '203.0.113.9')
  assert.equal(ipConfiavel(h({ 'x-forwarded-for': 'lixo<script>' }), { VERCEL: '1' }), null)
  assert.equal(ipConfiavel(h({ 'x-forwarded-for': '203.0.113.9' }), {}), null) // fora da plataforma: forjavel
})
