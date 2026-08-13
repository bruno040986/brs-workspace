import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAnyPermission } from '@/lib/auth/server'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json([], { status: 401 })
    }

    await requireAnyPermission([
      { resource: 'sistema-usuarios-root', action: 'can_view' },
      { resource: 'sistema-usuarios-cadastro', action: 'can_view' },
      { resource: 'sistema-usuarios-perfis', action: 'can_view' },
    ])

    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, name')
      .neq('id', user.id)
      .order('name', { ascending: true })

    if (error) throw error

    const normalized = (users || []).map((u) => ({
      id: u.id,
      email: u.email,
      full_name: u.name || undefined,
    }))

    return NextResponse.json(normalized)
  } catch (error) {
    console.error('Error fetching users:', error)
    if (error instanceof Error && error.message.includes('Sem permissao')) {
      return NextResponse.json([], { status: 403 })
    }
    return NextResponse.json([], { status: 500 })
  }
}
