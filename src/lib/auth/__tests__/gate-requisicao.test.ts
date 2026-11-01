import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isServerActionRequest } from '../gate-requisicao.ts'

test('B1: header next-action em /api NAO isenta o gate (sessao nao liberada => negada)', () => {
  assert.equal(isServerActionRequest('/api/chat/conversations', true), false)
  assert.equal(isServerActionRequest('/api/nvti/lotes/1/export', true), false)
  assert.equal(isServerActionRequest('/chat', true), true) // Server Action real, em rota de pagina
  assert.equal(isServerActionRequest('/chat', false), false)
})

test('B1: o proxy usa o helper e o gate nao tem isencao por /api/auth', () => {
  const m = readFileSync(join(import.meta.dirname, '..', '..', 'supabase', 'middleware.ts'), 'utf8')
  assert.match(m, /isServerActionPath\(request\.nextUrl\.pathname, request\.headers\.has\('next-action'\)\)/)
  assert.doesNotMatch(m, /startsWith\('\/api\/auth'\)/)
})

test('B1: hasPermissionForUser exige sessao liberada da sessao corrente', () => {
  const s = readFileSync(join(import.meta.dirname, '..', 'server.ts'), 'utf8')
  assert.match(s, /export async function hasPermissionForUser[\s\S]*sessaoCorrenteLiberada/)
  assert.match(s, /export async function requireApiUser[\s\S]*sessaoCorrenteLiberada/)
})

test('I3: troca de senha no servidor com sessao liberada e senha atual; nada de updateUser({ password }) no navegador', () => {
  const raiz = join(import.meta.dirname, '..', '..', '..')
  const a = readFileSync(join(raiz, 'app', 'trocar-senha', 'actions.ts'), 'utf8')
  assert.match(a, /requireCurrentUser\(\)/)
  assert.match(a, /signInWithPassword/)
  const p = readFileSync(join(raiz, 'app', 'trocar-senha', 'page.tsx'), 'utf8')
  assert.doesNotMatch(p, /updateUser\(/)
})
