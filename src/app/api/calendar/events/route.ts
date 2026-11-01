import { NextRequest, NextResponse } from 'next/server'
import { getMyCalendarEvents, getUserCalendarEvents } from '@/lib/google/calendar'
import { requireAnyPermission, requireApiUser } from '@/lib/auth/server'

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userEmail = request.nextUrl.searchParams.get('user')

    if (userEmail) {
      await requireAnyPermission([
        { resource: 'sistema-usuarios-root', action: 'can_view' },
        { resource: 'sistema-usuarios-cadastro', action: 'can_view' },
        { resource: 'sistema-usuarios-perfis', action: 'can_view' },
      ])
      const events = await getUserCalendarEvents(user.id, userEmail)
      return NextResponse.json(events)
    }

    const events = await getMyCalendarEvents(user.id)
    return NextResponse.json(events)
  } catch (error) {
    console.error('Error fetching calendar events:', error)
    const status = error instanceof Error && error.message.includes('Sem permissao') ? 403 : 500
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch events' },
      { status },
    )
  }
}
