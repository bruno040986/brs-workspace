/**
 * M06: worker do dispatcher de notificações (claim com lease, orçamento, Telegram -> WhatsApp -> e-mail).
 * Protegido por CRON_SECRET (fail-closed, tempo constante). Roda na mesma Vercel/Supabase: NÃO é monitor independente.
 */
import { NextRequest } from 'next/server'
import { isCronAuthorized } from '@/lib/security/safe-compare'
import { rodarDispatcher } from '@/lib/seguranca/dispatcher/producao'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get('authorization'))) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  try {
    return Response.json({ ok: true, ...(await rodarDispatcher()) })
  } catch (e) {
    console.error('[seguranca-dispatcher] falha', e instanceof Error ? e.message.slice(0, 80) : 'erro')
    return Response.json({ ok: false, error: 'dispatcher_falhou' }, { status: 500 })
  }
}
