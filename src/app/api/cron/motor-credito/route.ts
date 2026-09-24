/**
 * Cron da API Kaizom (D5): a cada 5 min lê até 500 linhas novas de
 * `consultas` pro staging. Protegido por CRON_SECRET, fail-closed, mesmo
 * padrão de `api/cron/convenio-pesquisas`.
 */
import { NextRequest } from 'next/server'
import { lerConsultasKaizom } from '@/lib/motor-credito/leitor'

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
    const resultado = await lerConsultasKaizom()
    return Response.json({ ok: true, ...resultado })
  } catch (err) {
    console.error('[cron motor-credito]', err instanceof Error ? err.message : err)
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'falha' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}
export async function POST(req: NextRequest) {
  return handle(req)
}
