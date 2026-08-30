import { timingSafeEqual } from 'node:crypto'

/** Autenticação das rotas de serviço NVTI (Bearer = NVTI_SERVICE_TOKEN), fail-closed e sem vazar tempo de comparação. */
export function isNvtiServiceAuthorized(req: { headers: { get(name: string): string | null } }): boolean {
  const secret = String(process.env.NVTI_SERVICE_TOKEN || '')
  if (!secret) return false
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return false
  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}
