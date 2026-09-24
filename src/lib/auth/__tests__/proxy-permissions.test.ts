import { describe, it } from 'node:test'
import assert from 'node:assert'
import { canAccessRoute, getRouteAccessDecision } from '../permissions.ts'

function mockUpdateSessionFlow(
  pathname: string,
  hasSessionCookie: boolean,
  permissions: Array<{ resource_name: string; can_view?: boolean }> = [],
) {
  const isPublicAsset = pathname.endsWith('.mp3')
  if (isPublicAsset) return { action: 'next', status: 200 }

  if (!hasSessionCookie) {
    return pathname.startsWith('/api/')
      ? { action: 'unauthorized', status: 401 }
      : { action: 'redirect', location: '/login', status: 307 }
  }

  const openApis = [
    '/api/conversas/bootstrap',
    '/api/conversas/lista',
    '/api/conversas/contadores',
    '/api/conversas/contatos',
    '/api/chat/messages',
    '/api/chat/read',
  ]
  if (openApis.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return { action: 'next', status: 200 }
  }

  const decision = getRouteAccessDecision(pathname)
  if (decision.type === 'deny') return { action: 'forbidden', status: 403 }
  if (decision.type === 'permission') {
    const allowed = canAccessRoute(permissions, decision.rule)
    return allowed ? { action: 'next', status: 200 } : { action: 'forbidden', status: 403 }
  }
  return { action: 'next', status: 200 }
}

describe('Unit Tests: Proxy Route Access Decision Rules & Simulated Flow', () => {
  it('returns open decision for /api/conversas/bootstrap', () => {
    const decision = getRouteAccessDecision('/api/conversas/bootstrap')
    assert.strictEqual(decision.type, 'open')
  })

  it('returns open decision for /api/conversas/lista', () => {
    const decision = getRouteAccessDecision('/api/conversas/lista')
    assert.strictEqual(decision.type, 'open')
  })

  it('returns open decision for /api/conversas/contadores', () => {
    const decision = getRouteAccessDecision('/api/conversas/contadores')
    assert.strictEqual(decision.type, 'open')
  })

  it('returns open decision for /api/conversas/contatos', () => {
    const decision = getRouteAccessDecision('/api/conversas/contatos')
    assert.strictEqual(decision.type, 'open')
  })

  it('returns open decision for /api/chat/messages and /api/chat/read', () => {
    assert.strictEqual(getRouteAccessDecision('/api/chat/messages').type, 'open')
    assert.strictEqual(getRouteAccessDecision('/api/chat/read').type, 'open')
  })

  it('returns permission decision for page /conversas', () => {
    const decision = getRouteAccessDecision('/conversas')
    assert.strictEqual(decision.type, 'permission')
    if (decision.type === 'permission') {
      const allowed = canAccessRoute([{ resource_name: 'conversas', can_view: true }], decision.rule)
      assert.strictEqual(allowed, true)
    }
  })

  it('middleware blocks unauthenticated API request with 401 status', () => {
    const res = mockUpdateSessionFlow('/api/conversas/bootstrap', false)
    assert.strictEqual(res.status, 401)
  })

  it('middleware redirects unauthenticated page request to /login', () => {
    const res = mockUpdateSessionFlow('/conversas', false)
    assert.strictEqual(res.status, 307)
    assert.strictEqual(res.location, '/login')
  })

  it('middleware allows authenticated user to access /api/conversas/bootstrap', () => {
    const res = mockUpdateSessionFlow('/api/conversas/bootstrap', true, [])
    assert.strictEqual(res.action, 'next')
    assert.strictEqual(res.status, 200)
  })

  it('middleware passes public asset requests through cleanly', () => {
    const res = mockUpdateSessionFlow('/notificacao-brs.mp3', false)
    assert.strictEqual(res.status, 200)
  })
})
