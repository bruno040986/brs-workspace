import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { deriveChatStatus } from '@/lib/chat/presence'

export async function GET() {
  try {
    const supabase = await createClient()
    const admin = await createAdminClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data, error } = await admin
      .from('users')
      .select('id, email, name, avatar_url')
      .eq('active', true)
      .neq('id', user.id)
      .order('name', { ascending: true })

    if (error) throw error

    const userIds = (data || []).map((u) => u.id)
    const { data: profiles } = await admin
      .from('workspace_chat_user_profiles')
      .select('user_id, nickname, status, status_message, last_seen_at, last_interaction_at, is_visible, has_focus')
      .in('user_id', userIds)

    const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]))
    const now = Date.now()

    return NextResponse.json(
      (data || []).map((u) => ({
        id: u.id,
        email: u.email,
        full_name: u.name || undefined,
        short_name: String(u.name || '')
          .split(' ')
          .filter(Boolean)
          .slice(0, 2)
          .join(' '),
        avatar_url: u.avatar_url || null,
        nickname: profileMap.get(u.id)?.nickname || null,
        status: deriveChatStatus(profileMap.get(u.id), now),
        status_message: profileMap.get(u.id)?.status_message || null,
      })),
    )
  } catch (error) {
    console.error('Error fetching chat contacts:', error)
    return NextResponse.json([], { status: 500 })
  }
}
