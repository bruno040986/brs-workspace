/**
 * Worker do Disparo de WhatsApp.
 *
 * Agendado pelo Vercel Cron a cada minuto (ver vercel.json) e também
 * disparado imediatamente ("kick") ao iniciar/retomar uma campanha. Protegido
 * por CRON_SECRET (`Authorization: Bearer <CRON_SECRET>`), fail-closed.
 *
 * Roda até ~265s por execução (maxDuration 300); o estado é persistido após
 * cada envio, então um timeout no meio não perde nem duplica mensagens.
 */

import { NextRequest, after } from 'next/server'
import { kickWorker, runWaWorker } from '@/lib/disparo-whatsapp/worker'

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
  const result = await runWaWorker({ budgetMs: budget })
  // Ainda há trabalho elegível: encadeia outra execução (o cron é a rede de segurança).
  if (result.workRemains) {
    after(async () => {
      await kickWorker()
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
