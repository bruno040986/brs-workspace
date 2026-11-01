import test from 'node:test'
import assert from 'node:assert/strict'
import { decidirPausaSenha } from '../pausa-senha.ts'
import { dispositivoValido, emitirDispositivo, DISPOSITIVO_TTL_SEG } from '../dispositivo-confiavel.ts'

const S = 'x'.repeat(40), ID = 'id-a', agora = 1_800_000_000_000
const base = { origemSeg: 0, duroSeg: 600, leveSeg: 300, turnstileAplicadoEValido: false }

test('C1: cookie valido dispensa leve e duro; origem (par/ip) continua valendo', () => {
  const dc = dispositivoValido(S, ID, emitirDispositivo(S, ID, agora), agora)
  assert.equal(dc, true)
  assert.equal(decidirPausaSenha({ ...base, dispositivoConfiavel: dc }).bloqueia, false)
  assert.equal(decidirPausaSenha({ ...base, origemSeg: 60, dispositivoConfiavel: dc }).motivo, 'pausa_ativa')
  assert.equal(decidirPausaSenha(base).bloqueia, true)
})

test('C1: invalido, de outro identificador, adulterado ou expirado nao vale', () => {
  const v = emitirDispositivo(S, ID, agora)
  assert.equal(dispositivoValido(S, 'id-b', v, agora), false)
  assert.equal(dispositivoValido('y'.repeat(40), ID, v, agora), false)
  assert.equal(dispositivoValido(S, ID, v.replace(/^\d+/, m => String(Number(m) + 1)), agora), false)
  assert.equal(dispositivoValido(S, ID, undefined, agora), false)
  assert.equal(dispositivoValido(S, ID, 'lixo', agora), false)
  assert.equal(dispositivoValido(S, ID, v, agora + (DISPOSITIVO_TTL_SEG + 1) * 1000), false)
})
