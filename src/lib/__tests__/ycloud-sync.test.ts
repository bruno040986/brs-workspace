/**
 * Regras puras do sync YCloud (src/lib/ycloud/sync-regras.ts) e contagem de
 * variáveis (leitura.ts). Fixam: primeiro snapshot não gera alerta; piora de
 * qualidade alerta e melhora não; limite alerta nos dois sentidos; template
 * pausado/rejeitado alerta; frescor de 24 h.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alertasDeSaude, alertasDeTemplates, contarVariaveisBody, diffSaude, obsoleto } from '../ycloud/sync-regras.ts'

const base = { quality_rating: 'GREEN', messaging_limit: 'TIER_1K', bm_messaging_limit: 'TIER_2K', status: 'CONNECTED', name_status: 'APPROVED' }

test('primeiro snapshot (sem anterior) não produz mudança nem alerta', () => {
  assert.deepEqual(diffSaude(null, { qualityRating: 'RED' }), [])
})

test('qualidade caiu → alerta; subiu → só mudança, sem alerta', () => {
  const caiu = diffSaude(base, { ...base, qualityRating: 'YELLOW' } as never)
  assert.equal(caiu.length, 1)
  assert.equal(alertasDeSaude('Suporte', caiu).length, 1)
  const subiu = diffSaude({ ...base, quality_rating: 'YELLOW' }, { qualityRating: 'GREEN', messagingLimit: 'TIER_1K', whatsappBusinessManagerMessagingLimit: 'TIER_2K', status: 'CONNECTED', nameStatus: 'APPROVED' })
  assert.equal(subiu.length, 1)
  assert.equal(alertasDeSaude('Suporte', subiu).length, 0)
})

test('limite do portfólio alerta nos dois sentidos; campo ausente no atual não é mudança', () => {
  const up = diffSaude(base, { qualityRating: 'GREEN', messagingLimit: 'TIER_1K', whatsappBusinessManagerMessagingLimit: 'TIER_10K', status: 'CONNECTED', nameStatus: 'APPROVED' })
  assert.equal(alertasDeSaude('X', up).length, 1)
  const down = diffSaude(base, { qualityRating: 'GREEN', messagingLimit: 'TIER_1K', whatsappBusinessManagerMessagingLimit: 'TIER_250', status: 'CONNECTED', nameStatus: 'APPROVED' })
  assert.equal(alertasDeSaude('X', down).length, 1)
  assert.deepEqual(diffSaude(base, { qualityRating: 'GREEN' }), []) // demais campos undefined → ignorados
})

test('status ruim alerta; status neutro não', () => {
  const banido = diffSaude(base, { ...base, qualityRating: 'GREEN', messagingLimit: 'TIER_1K', whatsappBusinessManagerMessagingLimit: 'TIER_2K', status: 'BANNED', nameStatus: 'APPROVED' })
  assert.equal(alertasDeSaude('X', banido).length, 1)
  const pendente = diffSaude(base, { qualityRating: 'GREEN', messagingLimit: 'TIER_1K', whatsappBusinessManagerMessagingLimit: 'TIER_2K', status: 'PENDING', nameStatus: 'APPROVED' })
  assert.equal(alertasDeSaude('X', pendente).length, 0)
})

test('templates: pausado/rejeitado e qualidade RED alertam; novo template não alerta', () => {
  const ant = [
    { nome: 'oferta', idioma: 'pt_BR', status: 'APPROVED', quality_rating: 'GREEN' },
    { nome: 'lembrete', idioma: 'pt_BR', status: 'APPROVED', quality_rating: 'YELLOW' },
  ]
  const alertas = alertasDeTemplates(ant, [
    { name: 'oferta', language: 'pt_BR', status: 'PAUSED', qualityRating: 'GREEN' },
    { name: 'lembrete', language: 'pt_BR', status: 'APPROVED', qualityRating: 'RED' },
    { name: 'novo', language: 'pt_BR', status: 'REJECTED', qualityRating: 'UNKNOWN' },
  ])
  assert.equal(alertas.length, 2)
})

test('obsoleto: > 24 h, ausente ou lixo', () => {
  const agora = Date.parse('2026-09-27T12:00:00Z')
  assert.equal(obsoleto('2026-09-27T11:00:00Z', agora), false)
  assert.equal(obsoleto('2026-09-26T11:59:00Z', agora), true)
  assert.equal(obsoleto(null, agora), true)
  assert.equal(obsoleto('x', agora), true)
})

test('contarVariaveisBody conta posições distintas do BODY', () => {
  assert.equal(contarVariaveisBody([{ type: 'HEADER', text: '{{1}}' }, { type: 'BODY', text: 'Olá {{1}}, sua margem é {{2}}. Até {{ 2 }}.' }]), 2)
  assert.equal(contarVariaveisBody([]), 0)
  assert.equal(contarVariaveisBody(null), 0)
})
