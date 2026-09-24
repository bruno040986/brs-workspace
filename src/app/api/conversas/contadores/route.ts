import { NextRequest, NextResponse } from 'next/server'
import { getContadores } from '@/lib/central-conversas/actions'
import { requirePermission } from '@/lib/auth/server'

export async function GET(request: NextRequest) {
  try {
    await requirePermission('conversas', 'can_view')
    const teamIdStr = request.nextUrl.searchParams.get('teamId')
    const teamId = teamIdStr ? Number(teamIdStr) : undefined

    const contadores = await getContadores(teamId)
    return NextResponse.json(contadores)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
