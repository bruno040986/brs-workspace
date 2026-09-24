import { NextRequest, NextResponse } from 'next/server'
import { getMensagens } from '@/lib/central-conversas/actions'
import { requirePermission } from '@/lib/auth/server'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('conversas', 'can_view')
    const params = await context.params
    const conversationId = Number(params.id)
    if (!conversationId || isNaN(conversationId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }
    const res = await getMensagens(conversationId)
    return NextResponse.json(res)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
