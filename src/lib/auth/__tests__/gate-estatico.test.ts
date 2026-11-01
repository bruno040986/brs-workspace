import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// M04: teste estatico do gate da etapa 5. Todo arquivo 'use server' e todo route handler de /api deve
// chamar um helper que passa por requireCurrentUser (que chama requireSessaoInternaCompleta), OU estar
// na lista de lacunas conhecidas abaixo (autenticam por segredo/webhook, sao publicos, ou ainda faltam).
// A lista so pode ENCOLHER: arquivo novo sem gate falha o teste.
const RAIZ = join(import.meta.dirname, '..', '..', '..')
// exige CHAMADA (nome seguido de parenteses) fora de comentarios; mencionar o nome num comentario/import nao conta
// processarHookMfa: Auth Hook autenticado por assinatura HMAC (falha fechado), sem sessao de usuario.
const GATE = /\b(requireCurrentUser|requirePermission|requireAnyPermission|requireSessaoInternaCompleta|requireApiUser|requireServerPermission|processarHookMfa|getCurrentUserEffectivePermissions|getVisibleEffectivePermissions|getMyEffectivePermissions)\s*\(/
const semComentarios = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const ISENTOS = new Set<string>(readFileSync(join(RAIZ, 'lib/auth/__tests__/gate-lacunas.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))

function arquivos(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) { if (n !== 'node_modules' && n !== '__tests__') arquivos(p, out) } else if (/\.(ts|tsx)$/.test(n)) out.push(p)
  }
  return out
}

test('gate da etapa 5: arquivos use server e handlers /api sem gate estao na lista de lacunas', () => {
  const sem: string[] = []
  for (const f of arquivos(RAIZ)) {
    const rel = relative(RAIZ, f).replaceAll('\\', '/')
    const src = readFileSync(f, 'utf8')
    const useServer = /^\s*(['"])use server\1/m.test(src.slice(0, 400))
    const handler = /^app\/api\/.*\/route\.ts$/.test(rel)
    if (!useServer && !handler) continue
    if (rel.startsWith('app/acesso/')) continue // etapas: guardas proprias por estado
    if (!GATE.test(semComentarios(src))) sem.push(rel)
  }
  const novos = sem.filter((r) => !ISENTOS.has(r))
  assert.deepEqual(novos, [], 'arquivos novos sem gate da sessao interna (use requireCurrentUser/requirePermission)')
  const obsoletos = [...ISENTOS].filter((r) => !sem.includes(r))
  assert.deepEqual(obsoletos, [], 'lacunas ja corrigidas: remova de gate-lacunas.txt')
})

test('requireCurrentUser chama o gate da sessao interna', () => {
  const s = readFileSync(join(RAIZ, 'lib/auth/server.ts'), 'utf8')
  assert.match(s, /export async function requireCurrentUser[\s\S]*requireSessaoInternaCompleta/)
})

test('B1: handlers /api que autenticam por getUser nao existem mais (usam requireApiUser/requireCurrentUser)', () => {
  const ruins = arquivos(join(RAIZ, 'app/api')).filter((f) => /route\.ts$/.test(f) && /\.auth\.getUser\(/.test(semComentarios(readFileSync(f, 'utf8'))))
  assert.deepEqual(ruins.map((f) => relative(RAIZ, f)), [])
})
