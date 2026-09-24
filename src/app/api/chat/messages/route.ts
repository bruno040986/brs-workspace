import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { CHAT_ATTACHMENT_BUCKET, CHAT_SIGNED_URL_TTL, chatAttachmentPath, type ChatAttachment } from '@/lib/chat/attachments'

import { PerformanceTimer } from '@/lib/performance/timing'

export async function GET(request: NextRequest) {
  const timer = new PerformanceTimer()
  try {
    const supabase = await createClient()
    const admin = await createAdminClient()

    timer.start('auth')
    const {
      data: { user },
    } = await supabase.auth.getUser()
    timer.end('auth')

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const conversationId = request.nextUrl.searchParams.get('conversationId')
    if (!conversationId) return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 })

    const before = request.nextUrl.searchParams.get('before')
    const beforeId = request.nextUrl.searchParams.get('beforeId')
    const limit = Math.min(Math.max(1, Number(request.nextUrl.searchParams.get('limit')) || 50), 100)

    timer.start('check_membership')
    const { data: membership } = await admin
      .from('workspace_chat_participants')
      .select('conversation_id')
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id)
      .maybeSingle()
    timer.end('check_membership')

    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    timer.start('fetch_messages')
    const [{ data: otherParticipant }, rawMessagesResult] = await Promise.all([
      admin
        .from('workspace_chat_participants')
        .select('last_read_at')
        .eq('conversation_id', conversationId)
        .neq('user_id', user.id)
        .maybeSingle(),
      (() => {
        let q = admin
          .from('workspace_chat_messages')
          .select('id, sender_id, body, created_at, text_style, attachments')
          .eq('conversation_id', conversationId)
        if (before && beforeId) {
          q = q.or(`created_at.lt.${before},and(created_at.eq.${before},id.lt.${beforeId})`)
        } else if (before) {
          q = q.lt('created_at', before)
        }
        return q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit)
      })(),
    ])
    timer.end('fetch_messages')

    if (rawMessagesResult.error) throw rawMessagesResult.error

    const messages = (rawMessagesResult.data || []).reverse()

    timer.start('fetch_users')
    const senderIds = [...new Set(messages.map((m) => m.sender_id))]
    const { data: users } = senderIds.length
      ? await admin.from('users').select('id, name, email').in('id', senderIds)
      : { data: [] as Array<{ id: string; name: string | null; email: string | null }> }
    const userMap = new Map((users || []).map((u) => [u.id, u]))
    timer.end('fetch_users')

    // Bucket privado: gera URLs assinadas em lote (1 única chamada ao Storage)
    timer.start('sign_attachments')
    const allPaths: string[] = []
    for (const m of messages) {
      const list = Array.isArray(m.attachments) ? (m.attachments as ChatAttachment[]) : []
      for (const att of list) {
        const path = chatAttachmentPath(att)
        if (path) allPaths.push(path)
      }
    }

    const signedUrlMap = new Map<string, string>()
    if (allPaths.length) {
      const uniquePaths = [...new Set(allPaths)]
      try {
        const { data: signedResults } = await admin.storage
          .from(CHAT_ATTACHMENT_BUCKET)
          .createSignedUrls(uniquePaths, CHAT_SIGNED_URL_TTL)
        for (const res of signedResults || []) {
          if (res.path && res.signedUrl) signedUrlMap.set(res.path, res.signedUrl)
        }
      } catch {
        // Fallback gracioso
      }
    }
    timer.end('sign_attachments')

    const normalized = messages.map((m) => {
      const sender = userMap.get(m.sender_id)
      const sentByMe = m.sender_id === user.id
      const isReadByOther =
        sentByMe &&
        Boolean(otherParticipant?.last_read_at) &&
        new Date(m.created_at).getTime() <= new Date(otherParticipant?.last_read_at || 0).getTime()

      const rawAtts = Array.isArray(m.attachments) ? (m.attachments as ChatAttachment[]) : []
      const signedAtts = rawAtts.map((att) => {
        const path = chatAttachmentPath(att)
        if (!path) return att
        return { ...att, url: signedUrlMap.get(path) || att.url }
      })

      return {
        id: m.id,
        text: m.body,
        timestamp: m.created_at,
        sender: {
          id: sender?.id || m.sender_id,
          email: sender?.email || '',
          full_name: sender?.name || undefined,
        },
        text_style: m.text_style || null,
        attachments: signedAtts,
        delivery_status: sentByMe ? (isReadByOther ? 'read' : 'sent') : null,
      }
    })

    // Atualização de leitura não-bloqueante
    void (async () => {
      try {
        await admin
          .from('workspace_chat_participants')
          .update({ last_read_at: new Date().toISOString() })
          .eq('conversation_id', conversationId)
          .eq('user_id', user.id)
      } catch {
        // Silencioso
      }
    })()

    return NextResponse.json(normalized, {
      headers: {
        'Server-Timing': timer.getServerTimingHeader(),
      },
    })
  } catch (error) {
    console.error('Error fetching messages:', error)
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

    const body = await request.json()
    const { conversationId, text, textStyle, attachments } = body as {
      conversationId?: string
      text?: string
      textStyle?: Record<string, unknown> | null
      attachments?: Array<Record<string, unknown>>
    }
    if (!conversationId || !text?.trim()) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const { data: membership } = await admin
      .from('workspace_chat_participants')
      .select('conversation_id')
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { data: inserted, error } = await admin
      .from('workspace_chat_messages')
      .insert({
        conversation_id: conversationId,
        sender_id: user.id,
        body: text.trim(),
        text_style: textStyle || null,
        attachments: Array.isArray(attachments) ? attachments : [],
      })
      .select('id, body, created_at, text_style, attachments')
      .single()
    if (error) throw error

    const { data: sender } = await admin
      .from('users')
      .select('id, name, email')
      .eq('id', user.id)
      .single()

    return NextResponse.json({
      id: inserted.id,
      text: inserted.body,
      timestamp: inserted.created_at,
      sender: {
        id: sender?.id || user.id,
        email: sender?.email || '',
        full_name: sender?.name || undefined,
      },
      text_style: inserted.text_style || null,
      attachments: Array.isArray(inserted.attachments) ? inserted.attachments : [],
      delivery_status: 'sent',
    })
  } catch (error) {
    console.error('Error sending message:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
