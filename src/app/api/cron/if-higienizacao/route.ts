/**
 * Worker dos lotes de Higienização Amigoz (margem de crédito).
 *
 * Agendado pelo Vercel Cron (ver vercel.json) e também disparado imediatamente
 * ("kick") ao criar/retomar um lote. Protegido por CRON_SECRET, fail-closed.
 * Sai cedo (sem custo) quando não há lote pendente/rodando — mesmo padrão do
 * cron de higienização NVTI (src/app/api/cron/nvti-batches/route.ts).
 */
import { NextRequest, after } from 'next/server'
import { kickHigienizacaoWorker, runHigienizacaoAmigozWorker } from '@/lib/if-credito/amigoz/lote'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = String(process.env.CRON_SECRET || '')
  if (!secret) return false
  const auth = req.headers.get('authorization') || ''
  return auth === `Bearer ${secret}`
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const budget = Math.min(Number(req.nextUrl.searchParams.get('budget') || 265_000), 265_000)
  const result = await runHigienizacaoAmigozWorker({ budgetMs: budget })
  if (result.workRemains) {
    after(async () => {
      await kickHigienizacaoWorker()
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
