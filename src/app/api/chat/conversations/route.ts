import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { deriveChatStatus } from '@/lib/chat/presence'

export async function GET() {
  try {
    const supabase = await createClient()
    const admin = await createAdminClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: myParticipants, error: partErr } = await admin
      .from('workspace_chat_participants')
      .select('conversation_id, last_read_at')
      .eq('user_id', user.id)

    if (partErr) throw partErr

    const conversationIds = (myParticipants || []).map((p) => p.conversation_id)
    if (conversationIds.length === 0) return NextResponse.json([])

    const { data: allParticipants, error: othersErr } = await admin
      .from('workspace_chat_participants')
      .select('conversation_id, user_id')
      .in('conversation_id', conversationIds)
      .neq('user_id', user.id)
    if (othersErr) throw othersErr

    const otherUserIds = [...new Set((allParticipants || []).map((p) => p.user_id))]
    const { data: users, error: usersErr } = await admin
      .from('users')
      .select('id, name, email, avatar_url')
      .in('id', otherUserIds)
    if (usersErr) throw usersErr

    const { data: profiles } = await admin
      .from('workspace_chat_user_profiles')
      .select('user_id, nickname, status, status_message, last_seen_at, last_interaction_at, is_visible, has_focus')
      .in('user_id', otherUserIds)

    // Sem corte, essa query lia o histórico inteiro de mensagens a cada
    // poll (3s) — crescendo pra sempre e estourando o Disk IO do Supabase.
    // Corte por data + limite prático: suficiente pra última mensagem e
    // contagem de não lidas de conversas ativas.
    const messagesSinceIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const { data: messages, error: msgErr } = await admin
      .from('workspace_chat_messages')
      .select('id, conversation_id, sender_id, body, created_at')
      .in('conversation_id', conversationIds)
      .gte('created_at', messagesSinceIso)
      .order('created_at', { ascending: false })
      .limit(2000)
    if (msgErr) throw msgErr

    const userMap = new Map((users || []).map((u) => [u.id, u]))
    const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]))
    const now = Date.now()
    const partMap = new Map((myParticipants || []).map((p) => [p.conversation_id, p.last_read_at]))
    const grouped = new Map<string, Array<{ id: string; sender_id: string; body: string; created_at: string }>>()
    for (const message of messages || []) {
      const arr = grouped.get(message.conversation_id) || []
      arr.push(message)
      grouped.set(message.conversation_id, arr)
    }

    const conversations = (allParticipants || [])
      .map((p) => {
        const participant = userMap.get(p.user_id)
        if (!participant) return null
        const convMessages = grouped.get(p.conversation_id) || []
        const lastMessage = convMessages[0]
        const lastReadAt = partMap.get(p.conversation_id)
        const unreadCount = convMessages.filter((m) => {
          if (m.sender_id === user.id) return false
          if (!lastReadAt) return true
          return new Date(m.created_at).getTime() > new Date(lastReadAt).getTime()
        }).length

        return {
          id: p.conversation_id,
          participant: {
            id: participant.id,
            email: participant.email,
            full_name: participant.name,
            short_name: String(participant.name || '')
              .split(' ')
              .filter(Boolean)
              .slice(0, 2)
              .join(' '),
            avatar_url: participant.avatar_url || null,
            nickname: profileMap.get(participant.id)?.nickname || null,
            status: deriveChatStatus(profileMap.get(participant.id), now),
            status_message: profileMap.get(participant.id)?.status_message || null,
          },
          lastMessage: lastMessage
            ? {
                id: lastMessage.id,
                text: lastMessage.body,
                timestamp: lastMessage.created_at,
              }
            : undefined,
          unreadCount,
        }
      })
      .filter(Boolean)

    return NextResponse.json(conversations)
  } catch (error) {
    console.error('Error fetching conversations:', error)
    return NextResponse.json([], { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const admin = await createAdminClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { participantId } = (await request.json()) as { participantId?: string }
    if (!participantId || participantId === user.id) {
      return NextResponse.json({ error: 'Invalid participant' }, { status: 400 })
    }

    const { data: existingMine, error: mineErr } = await admin
      .from('workspace_chat_participants')
      .select('conversation_id')
      .eq('user_id', user.id)
    if (mineErr) throw mineErr

    const mineConversationIds = (existingMine || []).map((p) => p.conversation_id)
    if (mineConversationIds.length > 0) {
      const { data: existingTarget, error: targetErr } = await admin
        .from('workspace_chat_participants')
        .select('conversation_id')
        .eq('user_id', participantId)
        .in('conversation_id', mineConversationIds)
      if (targetErr) throw targetErr

      const existingId = existingTarget?.[0]?.conversation_id
      if (existingId) {
        return NextResponse.json({ id: existingId })
      }
    }

    const { data: conversation, error: convErr } = await admin
      .from('workspace_chat_conversations')
      .insert({ created_by: user.id, kind: 'direct' })
      .select('id')
      .single()
    if (convErr) throw convErr

    const { error: participantsErr } = await admin.from('workspace_chat_participants').insert([
      { conversation_id: conversation.id, user_id: user.id, last_read_at: new Date().toISOString() },
      { conversation_id: conversation.id, user_id: participantId },
    ])
    if (participantsErr) throw participantsErr

    return NextResponse.json({ id: conversation.id })
  } catch (error) {
    console.error('Error creating conversation:', error)
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
  }
}
