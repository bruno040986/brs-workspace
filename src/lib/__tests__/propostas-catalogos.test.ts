import { describe, it } from 'node:test'
import assert from 'node:assert'
import { normalizarConfig, normalizarSituacao, normalizarStatus } from '../propostas-catalogos.ts'

describe('normalizarStatus', () => {
  it('aceita mínimo válido, apara nome e deixa cor vazia como null', () => {
    const r = normalizarStatus({ nome: '  PAGO ', grupo: 'pago', cor: '' })
    assert.ok(r.ok)
    if (r.ok) { assert.equal(r.value.nome, 'PAGO'); assert.equal(r.value.cor, null); assert.equal(r.value.atualiza_data_atualizacao, true) }
  })
  it('rejeita nome vazio, grupo fora do enum e cor malformada', () => {
    assert.equal(normalizarStatus({ nome: ' ', grupo: 'pago' }).ok, false)
    assert.equal(normalizarStatus({ nome: 'X', grupo: 'outro' }).ok, false)
    assert.equal(normalizarStatus({ nome: 'X', grupo: 'pago', cor: '#FFF' }).ok, false)
    assert.equal(normalizarStatus({ nome: 'X', grupo: 'pago', cor: 'red' }).ok, false)
  })
  it('normaliza cor para maiúsculas', () => {
    const r = normalizarStatus({ nome: 'X', grupo: 'pago', cor: '#aabbcc' })
    assert.ok(r.ok && r.value.cor === '#AABBCC')
  })
})

describe('normalizarSituacao', () => {
  it('exige código e nome; valida uuid do status sugerido', () => {
    assert.equal(normalizarSituacao({ codigo_arw: '', nome: 'A' }).ok, false)
    assert.equal(normalizarSituacao({ codigo_arw: '1', nome: '' }).ok, false)
    assert.equal(normalizarSituacao({ codigo_arw: '1', nome: 'A', status_sugerido_id: 'abc' }).ok, false)
    const r = normalizarSituacao({ codigo_arw: '1', nome: 'A', status_sugerido_id: '' })
    assert.ok(r.ok && r.value.status_sugerido_id === null)
  })
})

describe('normalizarConfig', () => {
  it('dias inteiro > 0', () => {
    assert.equal(normalizarConfig({ cancelamento_automatico_dias: 0 }).ok, false)
    assert.equal(normalizarConfig({ cancelamento_automatico_dias: 1.5 }).ok, false)
    assert.equal(normalizarConfig({ cancelamento_automatico_dias: '90' }).ok, true)
  })
})
