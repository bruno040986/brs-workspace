import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('senha/e-mail vazio é rejeitado antes de contar falha e antes do signIn', () => {
  const src = readFileSync(new URL('../../../app/acesso/actions.ts', import.meta.url), 'utf8')
  const i = src.indexOf('if (!email || !password) {')
  assert.ok(i > 0)
  const bloco = src.slice(i, src.indexOf('\n  }\n', i))
  assert.match(bloco, /senha_vazia/)
  assert.doesNotMatch(bloco, /falhaCredencial/)
  assert.ok(i < src.indexOf('signInWithPassword'))
  assert.ok(!src.includes("|| !password) return falhaCredencial"))
})
