/**
 * Decisão 17 (01/11): retenção de 180 dias para eventos, pausas, códigos de e-mail e entregas de notificação
 * (seg_expurgar). Preserva incidentes abertos e a tabela de auditoria. Protegido por CRON_SECRET (fail-closed).
 */
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isCronAuthorized } from '@/lib/security/safe-compare'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get('authorization'))) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const admin = await createAdminClient()
  const { data, error } = await admin.rpc('seg_expurgar', { dias: 180 })
  if (error) {
    console.error('[seguranca-expurgo] falha', error.code)
    return Response.json({ ok: false, error: 'expurgo_falhou' }, { status: 500 })
  }
  return Response.json({ ok: true, apagados: data })
}
