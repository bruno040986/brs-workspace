import { NextRequest, NextResponse } from 'next/server'
import { getContatoMetaReadOnly, getTagsContato } from '@/lib/central-conversas/actions'
import { requirePermission } from '@/lib/auth/server'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('conversas', 'can_view')
    const params = await context.params
    const contactId = Number(params.id)
    if (!contactId || isNaN(contactId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const [contatoMeta, tagsContato] = await Promise.all([
      getContatoMetaReadOnly(contactId),
      getTagsContato(contactId).catch(() => []),
    ])

    return NextResponse.json({ contatoMeta, tagsContato })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
