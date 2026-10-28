import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Regressão PGRST201: embed de helpdesk_comentarios a partir de helpdesk_tickets precisa nomear a FK.
test('nenhum select embute helpdesk_comentarios sem desambiguar a FK', () => {
  for (const f of ['mcp.ts', 'actions.ts', '../../app/(dashboard)/helpdesk/page.tsx', '../../components/helpdesk/AtividadeTicket.tsx']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /helpdesk_comentarios\(/, f)
  }
  const mcp = readFileSync(new URL('../mcp.ts', import.meta.url), 'utf8')
  assert.match(mcp, /helpdesk_comentarios!helpdesk_comentarios_ticket_id_fkey\(count\)/)
})
