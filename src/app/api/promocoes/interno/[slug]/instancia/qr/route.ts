import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    await requirePermission('comercial-promocoes-config', 'can_view')
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const { slug } = await ctx.params
  const admin: any = await createAdminClient()
  const { data: camp } = await admin.from('promocao_campanhas').select('instancia_id').eq('slug', slug).maybeSingle()
  if (!camp?.instancia_id) return NextResponse.json({ status: 'sem_instancia', qr: null })
  const { data: inst } = await admin.from('chat_instancias').select('status, ultimo_qr').eq('id', camp.instancia_id).is('deleted_at', null).maybeSingle()
  return NextResponse.json({ status: inst?.status ?? 'sem_instancia', qr: inst?.ultimo_qr ?? null })
}
