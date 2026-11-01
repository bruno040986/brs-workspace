import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return fallback
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await createAdminClient()
    const user = await requireApiUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const { error } = await admin
      .from('comunicado_reads')
      .upsert(
        {
          comunicado_id: id,
          user_id: user.id,
          read_at: new Date().toISOString(),
        },
        { onConflict: 'comunicado_id,user_id' },
      )
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error marking comunicado as read:', error)
    return NextResponse.json({ error: getErrorMessage(error, 'Falha ao registrar leitura.') }, { status: 500 })
  }
}
