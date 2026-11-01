/**
 * Cron do motor: drena a fila process_jobs.
 *
 * Agendado pelo Vercel Cron (ver vercel.json). Protegido por CRON_SECRET —
 * o Vercel envia `Authorization: Bearer <CRON_SECRET>`. Também aceita
 * `?secret=` para disparo manual em teste.
 */

import { NextRequest } from 'next/server'
import { runDueJobs } from '@/lib/scp-engine'
import { isCronAuthorized } from '@/lib/security/safe-compare'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isAuthorized(req: NextRequest): boolean {
  return isCronAuthorized(req.headers.get('authorization'))
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const workerId = `cron-${Math.random().toString(36).slice(2, 8)}`
  const result = await runDueJobs(workerId, 20)
  return Response.json({ ok: true, ...result })
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
