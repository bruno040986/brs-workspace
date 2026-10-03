import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estadoAtendimento, mascararNumeroInstancia, validarConfigAtendimento, type PatchAtendimento } from '../atendimento-config-regras.ts'

const base: PatchAtendimento = {
  parceiro_atendimento_id: 'p1', instancia_atendimento_id: 'a', instancia_atendimento_reserva_id: 'b',
  atendimento_liberado_em: null, atendimento_pausado: false,
  limite_atendimento_indicador_hora: 30, limite_atendimento_instancia_hora: 40, limite_atendimento_instancia_dia: 200,
}
const ctx = (over: object = {}) => ({
  instanciaOtpId: 'otp',
  instancias: [{ id: 'a', status: 'conectada' }, { id: 'b', status: 'conectada' }, { id: 'c', status: 'desconectada' }],
  anterior: { principalId: null, reservaId: null },
  ...over,
})

test('máscara: só os 4 últimos', () => {
  assert.equal(mascararNumeroInstancia('5561999990000'), '•••••••••0000')
  assert.equal(mascararNumeroInstancia(null), '—')
})

test('validação: caminho feliz e limites', () => {
  assert.equal(validarConfigAtendimento(base, ctx()), null)
  assert.match(validarConfigAtendimento({ ...base, limite_atendimento_indicador_hora: 0 }, ctx())!, /indicador/)
  assert.match(validarConfigAtendimento({ ...base, limite_atendimento_instancia_dia: 5001 }, ctx())!, /24 h/)
  assert.match(validarConfigAtendimento({ ...base, limite_atendimento_instancia_hora: 1.5 }, ctx())!, /instância\/hora/)
  assert.match(validarConfigAtendimento({ ...base, atendimento_liberado_em: 'x' }, ctx())!, /liberação/)
})

test('validação: principal ≠ reserva, ≠ OTP, do parceiro, conectada', () => {
  assert.match(validarConfigAtendimento({ ...base, instancia_atendimento_reserva_id: 'a' }, ctx())!, /diferentes/)
  assert.match(validarConfigAtendimento({ ...base, instancia_atendimento_id: 'otp' }, ctx())!, /OTP/)
  assert.match(validarConfigAtendimento({ ...base, instancia_atendimento_reserva_id: 'zzz' }, ctx())!, /não pertence/)
  assert.match(validarConfigAtendimento({ ...base, instancia_atendimento_reserva_id: 'c' }, ctx())!, /conectada/)
  // já gravada e caída: não bloqueia salvar (ex.: pausar)
  assert.equal(validarConfigAtendimento({ ...base, instancia_atendimento_reserva_id: 'c' }, ctx({ anterior: { principalId: 'a', reservaId: 'c' } })), null)
  assert.match(validarConfigAtendimento({ ...base, parceiro_atendimento_id: null }, ctx())!, /parceiro/)
  assert.match(validarConfigAtendimento({ ...base, instancia_atendimento_id: null }, ctx())!, /principal/)
})

test('estado: pausado > sem instância > aguardando > pronto', () => {
  const agora = new Date('2026-10-05T12:00:00Z')
  const c = { atendimento_pausado: false, atendimento_liberado_em: '2026-10-05T11:00:00Z', principalStatus: 'conectada', reservaStatus: null }
  assert.equal(estadoAtendimento(c, agora), 'pronto')
  assert.equal(estadoAtendimento({ ...c, atendimento_pausado: true }, agora), 'pausado')
  assert.equal(estadoAtendimento({ ...c, principalStatus: 'desconectada' }, agora), 'sem_instancia')
  assert.equal(estadoAtendimento({ ...c, principalStatus: 'desconectada', reservaStatus: 'conectada' }, agora), 'pronto')
  assert.equal(estadoAtendimento({ ...c, atendimento_liberado_em: null }, agora), 'aguardando_liberacao')
  assert.equal(estadoAtendimento({ ...c, atendimento_liberado_em: '2026-10-05T13:00:00Z' }, agora), 'aguardando_liberacao')
})
