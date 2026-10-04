import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarMetaCapi } from '../config-regras.ts'

test('validarMetaCapi aceita entrada válida e rejeita inválidas', () => {
  assert.equal(validarMetaCapi({ token: 'EAAB123', testEventCode: 'TEST12345', datasetId: '1234567890123', datasetNome: 'X' }).ok, true)
  assert.equal(validarMetaCapi({ datasetId: '1234567890' }).ok, true) // token vazio = manter
  assert.equal(validarMetaCapi({ datasetId: '123' }).ok, false)
  assert.equal(validarMetaCapi({ datasetId: '12345678901a' }).ok, false)
  assert.equal(validarMetaCapi({ token: 'a b', datasetId: '1234567890' }).ok, false)
  assert.equal(validarMetaCapi({ token: 'x'.repeat(601), datasetId: '1234567890' }).ok, false)
  assert.equal(validarMetaCapi({ testEventCode: 'TE ST', datasetId: '1234567890' }).ok, false)
  assert.equal(validarMetaCapi({ datasetNome: 'x'.repeat(121), datasetId: '1234567890' }).ok, false)
})
