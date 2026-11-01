/**
 * Worker de agendamento do BRS Messenger (Fase B §5). A cada minuto (ver
 * vercel.json), reivindica ações vencidas via `chat_acoes_agendadas_claim`
 * (lease atômico, FOR UPDATE SKIP LOCKED — vários workers não duplicam) e
 * executa. Protegido por CRON_SECRET, fail-closed, mesmo padrão dos outros
 * crons (`wa-campaigns`, `agenda-sync`).
 */
import { NextRequest } from 'next/server'
import { rodarWorkerAgendamentos } from '@/lib/central-conversas/agendamento-worker'
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
  const resultado = await rodarWorkerAgendamentos()
  return Response.json({ ok: true, ...resultado })
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
