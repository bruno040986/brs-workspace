import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HELPDESK_STATUS,
  HELPDESK_TRANSICOES_MCP,
  podeAgirMcp,
  podeTransicionarPessoa,
  validarMotivoAlteracao,
} from '../validacao.ts'

test('em_validacao é status válido e o MCP só leva em_execucao -> em_validacao', () => {
  assert.ok(HELPDESK_STATUS.includes('em_validacao'))
  assert.deepEqual(HELPDESK_TRANSICOES_MCP.registrar_resultado, { de: 'em_execucao', para: 'em_validacao' })
  const t = (status: string) => ({ status, aprovado_por: 'p' })
  assert.equal(podeAgirMcp('registrar_resultado', t('em_execucao')).ok, true)
  assert.equal(podeAgirMcp('registrar_resultado', t('em_validacao')).ok, false)
})

test('o MCP não tem ação de concluir, solicitar alteração nem rejeitar', () => {
  for (const acao of ['concluir', 'solicitar_alteracao', 'rejeitar', 'reabrir']) {
    assert.equal(podeAgirMcp(acao as never, { status: 'em_validacao', aprovado_por: 'p' }).ok, false)
  }
})

test('transições de pessoa', () => {
  assert.equal(podeTransicionarPessoa('solicitar_alteracao', 'em_validacao'), true)
  assert.equal(podeTransicionarPessoa('solicitar_alteracao', 'em_execucao'), false)
  assert.equal(podeTransicionarPessoa('concluir', 'em_validacao'), true)
  assert.equal(podeTransicionarPessoa('concluir', 'em_execucao'), true) // tickets antigos
  for (const s of ['aberto', 'plano_proposto', 'aprovado', 'concluido', 'rejeitado']) assert.equal(podeTransicionarPessoa('concluir', s), false)
  assert.equal(podeTransicionarPessoa('rejeitar', 'em_validacao'), true)
  assert.equal(podeTransicionarPessoa('rejeitar', 'concluido'), false)
})

test('motivo da alteração é obrigatório', () => {
  assert.equal(validarMotivoAlteracao('   ').ok, false)
  assert.equal(validarMotivoAlteracao(undefined).ok, false)
  assert.equal(validarMotivoAlteracao('x'.repeat(2001)).ok, false)
  assert.deepEqual(validarMotivoAlteracao('  trocar a cor '), { ok: true, texto: 'trocar a cor' })
})
