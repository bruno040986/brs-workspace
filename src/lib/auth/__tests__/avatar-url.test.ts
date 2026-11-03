import test from 'node:test'
import assert from 'node:assert/strict'
import { avatarPathParaUrl, normalizarAvatarUrl, avatarPathDoValor } from '../avatar-url.ts'

test('normalizarAvatarUrl', () => {
  const pub = 'https://x.supabase.co/storage/v1/object/public/avatars/comerciais/a-1.png?v=3'
  assert.equal(normalizarAvatarUrl(pub), '/api/avatar/comerciais/a-1.png')
  assert.equal(normalizarAvatarUrl('/api/avatar/a.png'), '/api/avatar/a.png')
  assert.equal(normalizarAvatarUrl('  '), null)
  assert.equal(normalizarAvatarUrl(null), null)
  assert.equal(normalizarAvatarUrl('data:image/png;base64,AAA'), 'data:image/png;base64,AAA')
  assert.equal(avatarPathParaUrl('u-1.png'), '/api/avatar/u-1.png')
})

test('avatarPathDoValor rejeita traversal e não-avatar', () => {
  assert.equal(avatarPathDoValor('/api/avatar/comerciais/a-1.png'), 'comerciais/a-1.png')
  assert.equal(avatarPathDoValor('/api/avatar/../x.png'), null)
  assert.equal(avatarPathDoValor('/api/avatar/a%2e.png'), null)
  assert.equal(avatarPathDoValor('https://externa.com/a.png'), null)
})
