import { NextRequest, NextResponse } from 'next/server'
import { getConversas } from '@/lib/central-conversas/actions'
import { requirePermission } from '@/lib/auth/server'

export async function GET(request: NextRequest) {
  try {
    await requirePermission('conversas', 'can_view')
    const searchParams = request.nextUrl.searchParams
    const rawAba = searchParams.get('aba') || 'meus'
    let aba: 'meus' | 'fila' | 'geral' = 'meus'
    if (rawAba === 'unassigned' || rawAba === 'fila') aba = 'fila'
    else if (rawAba === 'all' || rawAba === 'geral') aba = 'geral'
    else aba = 'meus'

    const q = searchParams.get('q') || undefined
    const inboxId = searchParams.get('inboxId') ? Number(searchParams.get('inboxId')) : undefined
    const teamId = searchParams.get('teamId') ? Number(searchParams.get('teamId')) : undefined
    const page = searchParams.get('page') ? Number(searchParams.get('page')) : undefined

    const res = await getConversas({ aba, q, inboxId, teamId, page })
    return NextResponse.json(res)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
