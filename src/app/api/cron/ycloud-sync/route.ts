/**
 * Cron do sync YCloud (F3): saúde dos números, templates e saldo → espelhos +
 * alertas. Horário desalinhado dos demais crons (regra do apagão de 22/09) e
 * intervalo (15 min) > maxDuration. Protegido por CRON_SECRET, fail-closed.
 */
import { NextRequest } from 'next/server'
import { sincronizarTodasConexoes } from '@/lib/ycloud/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isAuthorized(req: NextRequest): boolean {
  const secret = String(process.env.CRON_SECRET || '')
  if (!secret) return false
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  try {
    const resultado = await sincronizarTodasConexoes()
    return Response.json({ ok: resultado.erros.length === 0, ...resultado })
  } catch (err) {
    console.error('[cron ycloud-sync]', err instanceof Error ? err.message : err)
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'falha' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}
export async function POST(req: NextRequest) {
  return handle(req)
}
