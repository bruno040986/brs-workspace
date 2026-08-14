import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { deriveChatStatus, normalizeManualStatus } from '@/lib/chat/presence'

export async function GET() {
  try {
    const supabase = await createClient()
    const admin = await createAdminClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: me } = await admin.from('users').select('id, name, email, avatar_url').eq('id', user.id).single()
    const { data: profile } = await admin
      .from('workspace_chat_user_profiles')
      .select('nickname, status, status_message, last_seen_at, last_interaction_at, is_visible, has_focus')
      .eq('user_id', user.id)
      .maybeSingle()

    return NextResponse.json({
      user: me,
      profile: profile
        ? {
            ...profile,
            manual_status: normalizeManualStatus(profile.status),
            status: deriveChatStatus(profile),
          }
        : null,
    })
  } catch (error) {
    console.error('Error fetching chat profile:', error)
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const admin = await createAdminClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const nickname = body.nickname ? String(body.nickname).slice(0, 40) : null
    const status = String(body.status) === 'busy' ? 'busy' : 'online'
    const statusMessage = body.status_message ? String(body.status_message).slice(0, 50) : null

    const { error } = await admin.from('workspace_chat_user_profiles').upsert(
      {
        user_id: user.id,
        nickname,
        status,
        status_message: statusMessage,
        last_seen_at: new Date().toISOString(),
        last_interaction_at: new Date().toISOString(),
        is_visible: true,
        has_focus: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating chat profile:', error)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}
