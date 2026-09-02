'use server'

import { createAdminClient, createClient } from '@/lib/supabase/server'

type PraiseStatus = 'pending' | 'accepted' | 'denied'

type PraiseUser = {
  id: string
  name: string
  avatar_url: string | null
}

export type PraiseReactionSummary = {
  emoji: string
  count: number
  reacted: boolean
}

export type PraiseFeedItem = {
  id: string
  message: string
  bg_color: string
  text_color: string
  created_at: string
  from_user: PraiseUser
  to_user: PraiseUser | null
  to_all: boolean
  status: PraiseStatus
  reactions: PraiseReactionSummary[]
}

function sanitizeColor(input: unknown, fallback: string) {
  const value = String(input || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value
  return fallback
}

async function requireUserId() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  const userId = data?.user?.id
  if (!userId) throw new Error('Usuário não autenticado.')
  return userId
}

export async function getPraiseFeed(params?: { limit?: number }) {
  try {
    const userId = await requireUserId()
    const supabase = await createAdminClient()
    const limit = Math.max(1, Math.min(100, Number(params?.limit || 40)))

    const { data: messages, error } = await supabase
      .from('praise_messages')
      .select(
        `
          id,
          message,
          bg_color,
          text_color,
          created_at,
          to_all,
          status,
          from_user:from_user_id ( id, name, avatar_url, active ),
          to_user:to_user_id ( id, name, avatar_url, active )
        `,
      )
      .eq('status', 'accepted')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw error

    // Usuário inativo some do mural: elogios enviados por ele ou dirigidos a
    // ele não aparecem; os "para todos" ficam, desde que o remetente esteja
    // ativo (decisão 02/09/2026).
    const items = ((messages || []) as any[]).filter((m) => {
      if (m.from_user && m.from_user.active === false) return false
      if (!m.to_all && m.to_user && m.to_user.active === false) return false
      return true
    })
    const praiseIds = items.map((m) => String(m.id)).filter(Boolean)

    const reactionsByPraise = new Map<string, Array<{ emoji: string; user_id: string }>>()
    if (praiseIds.length > 0) {
      const { data: reactions, error: rErr } = await supabase
        .from('praise_reactions')
        .select('praise_id, emoji, user_id')
        .in('praise_id', praiseIds)

      if (rErr) throw rErr
      for (const row of (reactions || []) as any[]) {
        const pid = String(row.praise_id || '')
        if (!pid) continue
        const list = reactionsByPraise.get(pid) || []
        list.push({ emoji: String(row.emoji || ''), user_id: String(row.user_id || '') })
        reactionsByPraise.set(pid, list)
      }
    }

    const feed: PraiseFeedItem[] = items.map((m) => {
      const fromUser = m.from_user || {}
      const toUser = m.to_user || null
      const reactions = reactionsByPraise.get(String(m.id)) || []

      const counts = new Map<string, { count: number; reacted: boolean }>()
      for (const r of reactions) {
        const emoji = String(r.emoji || '').trim()
        if (!emoji) continue
        const current = counts.get(emoji) || { count: 0, reacted: false }
        current.count += 1
        if (String(r.user_id) === userId) current.reacted = true
        counts.set(emoji, current)
      }

      return {
        id: String(m.id),
        message: String(m.message || ''),
        bg_color: String(m.bg_color || '#FFF8C5'),
        text_color: String(m.text_color || '#111827'),
        created_at: String(m.created_at || ''),
        from_user: {
          id: String(fromUser.id || ''),
          name: String(fromUser.name || ''),
          avatar_url: fromUser.avatar_url ? String(fromUser.avatar_url) : null,
        },
        to_user: toUser
          ? {
              id: String(toUser.id || ''),
              name: String(toUser.name || ''),
              avatar_url: toUser.avatar_url ? String(toUser.avatar_url) : null,
            }
          : null,
        to_all: !!m.to_all,
        status: String(m.status || 'accepted') as PraiseStatus,
        reactions: Array.from(counts.entries()).map(([emoji, meta]) => ({ emoji, ...meta })),
      }
    })

    return { success: true, feed }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function sendPraise(payload: {
  to_user_id?: string | null
  to_all?: boolean
  message: string
  bg_color?: string
  text_color?: string
}) {
  try {
    const userId = await requireUserId()
    const supabase = await createAdminClient()

    const message = String(payload.message || '').trim()
    if (!message) return { success: false, error: 'Mensagem é obrigatória.' }
    if (message.length > 150) return { success: false, error: 'Mensagem excede 150 caracteres.' }

    const bgColor = sanitizeColor(payload.bg_color, '#FFF8C5')
    const textColor = sanitizeColor(payload.text_color, '#111827')

    const toAll = !!payload.to_all || !payload.to_user_id
    const toUserId = toAll ? null : String(payload.to_user_id || '').trim()
    if (!toAll && !toUserId) return { success: false, error: 'Selecione um destinatário ou escolha Todos.' }
    if (!toAll && toUserId === userId) return { success: false, error: 'Não é possível enviar elogio para si mesmo.' }

    const now = new Date().toISOString()
    const status: PraiseStatus = toAll ? 'accepted' : 'pending'

    const { data: inserted, error } = await supabase
      .from('praise_messages')
      .insert({
        from_user_id: userId,
        to_user_id: toUserId,
        to_all: toAll,
        message,
        bg_color: bgColor,
        text_color: textColor,
        status,
        decided_at: toAll ? now : null,
        decided_by: toAll ? userId : null,
      })
      .select('id, to_user_id, to_all, status')
      .single()

    if (error) throw error

    if (!inserted.to_all && inserted.to_user_id) {
      const baseRow: any = { user_id: inserted.to_user_id, praise_id: inserted.id, type: 'praise_received' }
      let { error: nErr } = await supabase.from('praise_notifications').insert(baseRow)
      if (nErr && String(nErr.message || '').includes("Could not find the 'type' column")) {
        const retry = await supabase.from('praise_notifications').insert({ user_id: inserted.to_user_id, praise_id: inserted.id })
        nErr = retry.error as any
      }
      if (nErr) throw nErr
    }

    return { success: true, id: String(inserted.id), status: String(inserted.status) as PraiseStatus }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function getReceivedPraiseRequests() {
  try {
    const userId = await requireUserId()
    const supabase = await createAdminClient()

    const { data, error } = await supabase
      .from('praise_messages')
      .select(
        `
          id,
          message,
          bg_color,
          text_color,
          created_at,
          status,
          from_user:from_user_id ( id, name, avatar_url )
        `,
      )
      .eq('to_user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error

    return { success: true, requests: (data || []) as any[] }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function decidePraise(payload: { praise_id: string; decision: 'accept' | 'deny' }) {
  try {
    const userId = await requireUserId()
    const supabase = await createAdminClient()
    const praiseId = String(payload.praise_id || '').trim()
    if (!praiseId) return { success: false, error: 'ID inválido.' }

    const { data: praise, error: findErr } = await supabase
      .from('praise_messages')
      .select('id, to_user_id, status')
      .eq('id', praiseId)
      .maybeSingle()

    if (findErr) throw findErr
    if (!praise) return { success: false, error: 'Elogio não encontrado.' }
    if (String(praise.to_user_id || '') !== userId) return { success: false, error: 'Sem permissão.' }
    if (String(praise.status) !== 'pending') return { success: false, error: 'Elogio já foi processado.' }

    const nextStatus: PraiseStatus = payload.decision === 'accept' ? 'accepted' : 'denied'
    const now = new Date().toISOString()

    const { error: updErr } = await supabase
      .from('praise_messages')
      .update({ status: nextStatus, decided_at: now, decided_by: userId })
      .eq('id', praiseId)

    if (updErr) throw updErr

    const { error: readErr } = await supabase
      .from('praise_notifications')
      .update({ read_at: now })
      .eq('praise_id', praiseId)
      .eq('user_id', userId)
      .is('read_at', null)

    if (readErr) throw readErr

    return { success: true, status: nextStatus }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function togglePraiseReaction(payload: { praise_id: string; emoji: string }) {
  try {
    const userId = await requireUserId()
    const supabase = await createAdminClient()
    const praiseId = String(payload.praise_id || '').trim()
    const emoji = String(payload.emoji || '').trim()
    if (!praiseId || !emoji) return { success: false, error: 'Dados inválidos.' }
    if (emoji.length > 10) return { success: false, error: 'Emoji inválido.' }

    const { data: praise, error: pErr } = await supabase
      .from('praise_messages')
      .select('id, from_user_id, to_user_id, to_all, status')
      .eq('id', praiseId)
      .maybeSingle()
    if (pErr) throw pErr
    if (!praise || String(praise.status) !== 'accepted') return { success: false, error: 'Elogio não disponível para reação.' }

    const { data: existing, error: findErr } = await supabase
      .from('praise_reactions')
      .select('id')
      .eq('praise_id', praiseId)
      .eq('user_id', userId)
      .eq('emoji', emoji)
      .maybeSingle()

    if (findErr) throw findErr

    if (existing?.id) {
      const { error: delErr } = await supabase.from('praise_reactions').delete().eq('id', existing.id)
      if (delErr) throw delErr
      return { success: true, reacted: false }
    }

    const { error: insErr } = await supabase.from('praise_reactions').insert({
      praise_id: praiseId,
      user_id: userId,
      emoji,
    })
    if (insErr) throw insErr

    const notifyUserIds = new Set<string>()
    const fromUserId = String(praise.from_user_id || '')
    const toUserId = praise.to_all ? '' : String(praise.to_user_id || '')

    if (fromUserId && fromUserId !== userId) notifyUserIds.add(fromUserId)
    if (toUserId && toUserId !== userId) notifyUserIds.add(toUserId)

    for (const targetUserId of notifyUserIds) {
      let { error: nErr } = await supabase.from('praise_notifications').insert({
        user_id: targetUserId,
        praise_id: praiseId,
        type: 'praise_reaction',
        from_user_id: userId,
        emoji,
      })
      if (nErr && String(nErr.message || '').includes("Could not find the 'type' column")) {
        const retry = await supabase.from('praise_notifications').insert({
          user_id: targetUserId,
          praise_id: praiseId,
        })
        nErr = retry.error as any
      }
      if (nErr) throw nErr
    }

    return { success: true, reacted: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function getPraiseUnreadCount() {
  try {
    const userId = await requireUserId()
    const supabase = await createAdminClient()
    const { count, error } = await supabase
      .from('praise_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null)
    if (error) throw error
    return { success: true, count: Number(count || 0) }
  } catch (error: any) {
    return { success: false, error: error.message, count: 0 }
  }
}

export async function getPraiseNotifications(params?: { limit?: number }) {
  try {
    const userId = await requireUserId()
    const supabase = await createAdminClient()
    const limit = Math.max(1, Math.min(50, Number(params?.limit || 10)))

    let { data, error } = await supabase
      .from('praise_notifications')
      .select(
        `
          id,
          praise_id,
          created_at,
          read_at,
          type,
          emoji,
          from_user:from_user_id ( id, name, avatar_url ),
          praise:praise_id ( id, from_user_id, to_user_id, to_all, message, created_at )
        `,
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error && String(error.message || '').includes("Could not find the 'type' column")) {
      const fallback = await supabase
        .from('praise_notifications')
        .select('id, praise_id, created_at, read_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit)
      data = fallback.data as any
      error = fallback.error as any
    }
    if (error) throw error

    return { success: true, notifications: (data || []) as any[] }
  } catch (error: any) {
    return { success: false, error: error.message, notifications: [] }
  }
}

export async function markPraiseNotificationsRead(payload?: { praise_id?: string }) {
  try {
    const userId = await requireUserId()
    const supabase = await createAdminClient()
    const now = new Date().toISOString()
    const praiseId = payload?.praise_id ? String(payload.praise_id).trim() : ''

    let q = supabase
      .from('praise_notifications')
      .update({ read_at: now })
      .eq('user_id', userId)
      .is('read_at', null)

    if (praiseId) q = q.eq('praise_id', praiseId)

    const { error } = await q
    if (error) throw error

    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
