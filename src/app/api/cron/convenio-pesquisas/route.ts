/**
 * Cron da pesquisa de convênios (BC Fase 3, §6.5). A cada 2 min (ver
 * vercel.json), retoma pesquisas paradas por lease vencido — ex.: a função
 * anterior foi derrubada no meio de uma etapa. Protegido por CRON_SECRET,
 * fail-closed, mesmo padrão de `api/cron/messenger-agendamentos`.
 */
import { NextRequest } from 'next/server'
import { rodarWorkerPesquisas } from '@/lib/convenios/pesquisa/motor'

export const dynamic = 'force-dynamic'
// Mesma folga da rota /avancar — cada avancarPesquisa() pode levar até ~55s
// (timeout da chamada de IA) dentro do laço de rodarWorkerPesquisas().
export const maxDuration = 90

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
  const resultado = await rodarWorkerPesquisas()
  return Response.json({ ok: true, ...resultado })
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
