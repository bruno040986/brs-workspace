/**
 * Cron da sincronização inbound Google → Workspace (Agenda & Tarefas).
 *
 * Agendado pelo Vercel Cron (ver vercel.json). Protegido por
 * CRON_SECRET, fail-closed, no mesmo padrão dos demais workers.
 */

import { NextRequest } from 'next/server'
import { runAgendaInboundSync } from '@/lib/agenda/googleInboundSync'

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
  const budget = Math.min(Number(req.nextUrl.searchParams.get('budget') || 240_000), 240_000)
  const result = await runAgendaInboundSync({ budgetMs: budget })
  return Response.json({ ok: true, ...result })
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
