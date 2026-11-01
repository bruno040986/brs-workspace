/**
 * M05: monitor de configuração (policies, grants, buckets, contas Auth sem cadastro) via seg_monitor_snapshot().
 * Protegido por CRON_SECRET (fail-closed). Roda na mesma Vercel/Supabase: NÃO é monitor independente (PT02 §5.7).
 */
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isCronAuthorized } from '@/lib/security/safe-compare'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get('authorization'))) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const admin = await createAdminClient()
  const { data, error } = await admin.rpc('seg_monitor_snapshot')
  if (error) {
    console.error('[seguranca-monitor] falha', error.code)
    return Response.json({ ok: false, error: 'snapshot_falhou' }, { status: 500 })
  }
  return Response.json({ ok: true, ...data })
}
