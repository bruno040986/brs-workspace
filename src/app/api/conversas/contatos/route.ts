import { NextRequest, NextResponse } from 'next/server'
import { listarContatos } from '@/lib/central-conversas/actions'
import { requirePermission } from '@/lib/auth/server'

export async function GET(request: NextRequest) {
  try {
    await requirePermission('conversas', 'can_view')
    const q = request.nextUrl.searchParams.get('q') || undefined
    const contatos = await listarContatos({ q })
    return NextResponse.json(contatos)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
