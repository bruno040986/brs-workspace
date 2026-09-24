import { NextRequest, NextResponse } from 'next/server'
import { getMetaReadOnly, getTags } from '@/lib/central-conversas/actions'
import { requirePermission } from '@/lib/auth/server'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('conversas', 'can_view')
    const params = await context.params
    const conversationId = Number(params.id)
    const contactIdStr = request.nextUrl.searchParams.get('contactId')
    const contactId = contactIdStr ? Number(contactIdStr) : undefined

    if (!conversationId || isNaN(conversationId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const [meta, tags] = await Promise.all([
      getMetaReadOnly(conversationId, contactId),
      getTags(conversationId).catch(() => []),
    ])

    return NextResponse.json({ meta, tags })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
