/**
 * Worker dos lotes de higienização NVTI.
 *
 * Agendado pelo Vercel Cron (ver vercel.json) e também disparado imediatamente
 * ("kick") ao criar um lote. Protegido por CRON_SECRET, fail-closed.
 */

import { NextRequest, after } from 'next/server'
import { kickNvtiWorker, runNvtiWorker } from '@/lib/nvti/worker'
import { isCronAuthorized } from '@/lib/security/safe-compare'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  return isCronAuthorized(req.headers.get('authorization'))
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const budget = Math.min(Number(req.nextUrl.searchParams.get('budget') || 265_000), 265_000)
  const result = await runNvtiWorker({ budgetMs: budget })
  if (result.workRemains) {
    after(async () => {
      await kickNvtiWorker()
    })
  }
  return Response.json({ ok: true, ...result })
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
