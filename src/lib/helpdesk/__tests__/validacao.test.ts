/** HelpDesk: validação do "abrir ticket" no servidor. Roda com: npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarHelpdeskTicket, type HelpdeskTicketEntrada } from '../validacao.ts'

const EU = '11111111-2222-3333-4444-555555555555'
const OUTRO = '99999999-8888-7777-6666-555555555555'
const base: HelpdeskTicketEntrada = { titulo: ' Tela trava ', descricao: ' ao salvar ', sistema: 'workspace', tipo: 'bug', prioridade: 'impede' }
const img = (path: string, type = 'image/png') => ({ path, name: 'print.png', size: 1000, type })
const erro = (e: Partial<HelpdeskTicketEntrada>) => {
  const r = validarHelpdeskTicket({ ...base, ...e }, EU)
  return r.ok ? '' : r.error
}

test('aceita, faz trim e deriva urgente da prioridade', () => {
  const r = validarHelpdeskTicket({ ...base, anexos: [img(`${EU}/1760000000000-abc123.png`)] }, EU)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.dados.ticket.titulo, 'Tela trava')
  assert.equal(r.dados.ticket.urgente, true)
  assert.equal(r.dados.anexos.length, 1)
  const r2 = validarHelpdeskTicket({ ...base, prioridade: 'sugestao' }, EU)
  assert.ok(r2.ok && r2.dados.ticket.urgente === false)
})

test('anexo com path de outro usuário (ou traversal) é rejeitado', () => {
  assert.match(erro({ anexos: [img(`${OUTRO}/1760000000000-abc123.png`)] }), /Anexo inválido/)
  assert.match(erro({ anexos: [img(`${EU}/../${OUTRO}/1-a.png`)] }), /Anexo inválido/)
  assert.match(erro({ anexos: [img(`${EU}/1-a.png`, 'application/pdf')] }), /imagens/)
  assert.match(erro({ anexos: Array.from({ length: 6 }, (_, i) => img(`${EU}/${i}-a.png`)) }), /No máximo 5/)
})

test('enums inválidos e campos obrigatórios', () => {
  assert.match(erro({ tipo: 'feature' }), /tipo/)
  assert.match(erro({ prioridade: 'altissima' }), /prioridade/)
  assert.match(erro({ sistema: 'crm' }), /sistema/)
  assert.match(erro({ titulo: '   ' }), /título/)
  assert.match(erro({ descricao: '' }), /Descreva/)
  assert.match(erro({ area: 'x'.repeat(101) }), /área/)
})

test('contexto técnico: só chaves conhecidas', () => {
  const r = validarHelpdeskTicket({ ...base, contexto_tecnico: { pathname: '/rh', hack: 'x' } }, EU)
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual(r.dados.ticket.contexto_tecnico, { pathname: '/rh' })
})
