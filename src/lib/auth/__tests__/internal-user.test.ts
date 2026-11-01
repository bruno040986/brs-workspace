import test from 'node:test'
import assert from 'node:assert/strict'
import { isActiveInternalUser } from '../internal-user.ts'

function fake(result: { data: unknown; error: unknown }) {
  return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }) } as never
}

test('interno ativo passa; ausente, desativado, erro e id vazio não', async () => {
  assert.equal(await isActiveInternalUser(fake({ data: { id: 'u', active: true }, error: null }), 'u'), true)
  assert.equal(await isActiveInternalUser(fake({ data: { id: 'u', active: null }, error: null }), 'u'), true)
  assert.equal(await isActiveInternalUser(fake({ data: null, error: null }), 'u'), false)
  assert.equal(await isActiveInternalUser(fake({ data: { id: 'u', active: false }, error: null }), 'u'), false)
  assert.equal(await isActiveInternalUser(fake({ data: { id: 'u', active: true }, error: { message: 'x' } }), 'u'), false)
  assert.equal(await isActiveInternalUser(fake({ data: { id: 'u', active: true }, error: null }), ''), false)
})
