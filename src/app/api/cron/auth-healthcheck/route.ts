/**
 * Cron de monitoramento do Supabase Auth (ver src/lib/system-health/auth-healthcheck.ts).
 * Agendado pelo Vercel Cron (ver vercel.json). Protegido por CRON_SECRET,
 * fail-closed, no mesmo padrão dos demais workers.
 */

import { NextRequest } from 'next/server'
import { runAuthHealthcheck } from '@/lib/system-health/auth-healthcheck'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function isAuthorized(req: NextRequest): boolean {
  const secret = String(process.env.CRON_SECRET || '')
  if (!secret) return false
  const auth = req.headers.get('authorization') || ''
  return auth === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const result = await runAuthHealthcheck()
  return Response.json({ ok: true, ...result })
}
