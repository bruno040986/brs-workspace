import test from 'node:test'
import assert from 'node:assert/strict'
import { decidirPausaSenha } from '../pausa-senha.ts'
import { dispositivoValido, emitirDispositivo, userIdDoDispositivo, DISPOSITIVO_TTL_SEG } from '../dispositivo-confiavel.ts'

const S = 'x'.repeat(40), ID = 'id-a', U = '00000004-0000-4000-8000-0000000000e1', agora = 1_800_000_000_000
const base = { origemSeg: 0, duroSeg: 600, leveSeg: 300, turnstileAplicadoEValido: false }
const dia = 86400

test('C1: cookie valido (30 dias) dispensa leve e duro; origem continua valendo', () => {
  const idade = dispositivoValido(S, ID, 3, emitirDispositivo(S, ID, U, 3, agora), agora)
  assert.equal(idade, 0)
  assert.equal(decidirPausaSenha({ ...base, dispositivoConfiavel: true }).bloqueia, false) // leve e duro dispensadas
  assert.equal(decidirPausaSenha({ ...base, turnstileAplicadoEValido: true }).motivo, 'pausa_ativa_teto_identificador') // Turnstile sem cookie nao dispensa o duro
  assert.equal(decidirPausaSenha({ ...base, origemSeg: 60, dispositivoConfiavel: true }).motivo, 'pausa_ativa')
  assert.equal(decidirPausaSenha(base).bloqueia, true)
})

test('C1: epoch divergente (troca de senha/bloqueio/logout-todas), usuario inexistente, outro identificador, adulterado ou expirado nao valem', () => {
  const v = emitirDispositivo(S, ID, U, 3, agora)
  assert.equal(userIdDoDispositivo(v), U)
  assert.equal(dispositivoValido(S, ID, 4, v, agora), null) // epoch subiu
  assert.equal(dispositivoValido(S, ID, null, v, agora), null) // usuario inexistente
  assert.equal(dispositivoValido(S, 'id-b', 3, v, agora), null)
  assert.equal(dispositivoValido('y'.repeat(40), ID, 3, v, agora), null)
  assert.equal(dispositivoValido(S, ID, 3, v.replace(U, U.replace(/1$/, '2')), agora), null) // user_id trocado
  assert.equal(dispositivoValido(S, ID, 3, v.replace(/^\d+/, m => String(Number(m) + 1)), agora), null)
  assert.equal(dispositivoValido(S, ID, 3, undefined, agora), null)
  assert.equal(dispositivoValido(S, ID, 3, 'lixo', agora), null)
  assert.equal(userIdDoDispositivo('lixo'), null)
  assert.equal(dispositivoValido(S, ID, 3, v, agora + (DISPOSITIVO_TTL_SEG + 1) * 1000), null)
  assert.equal(dispositivoValido(S, ID, 3, v, agora + 29 * dia * 1000), 29 * dia)
  assert.equal(dispositivoValido(S, ID, 3, v, agora + 30 * dia * 1000), null) // 30 dias exatos: expirado
})
