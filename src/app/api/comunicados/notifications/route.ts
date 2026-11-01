import { NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { loadComunicadosNotifications } from '@/lib/comunicados-service'

export async function GET() {
  try {
    const admin = await createAdminClient()
    const user = await requireApiUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const result = await loadComunicadosNotifications(admin, user.id)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching comunicados notifications:', error)
    return NextResponse.json({ count: 0, items: [] }, { status: 500 })
  }
}

