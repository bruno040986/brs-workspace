'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireCurrentUser } from '@/lib/auth/server'

export type WorkspaceNotificationRow = {
  id: string
  type: string
  title: string
  body: string
  href: string
  entity_type: string | null
  entity_id: string | null
  created_at: string
  read_at: string | null
  actor_name?: string | null
}

export async function getWorkspaceUnreadCount() {
  try {
    const user = await requireCurrentUser()
    const admin = await createAdminClient()
    const { count, error } = await admin
      .from('workspace_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('read_at', null)
    if (error) throw error
    return { success: true, count: Number(count || 0) }
  } catch (error: any) {
    return { success: false, error: error.message, count: 0 }
  }
}

export async function getWorkspaceNotifications(params?: { limit?: number }) {
  try {
    const user = await requireCurrentUser()
    const admin = await createAdminClient()
    const limit = Math.max(1, Math.min(50, Number(params?.limit || 10)))

    const { data, error } = await admin
      .from('workspace_notifications')
      .select('id, type, title, body, href, entity_type, entity_id, created_at, read_at, actor:actor_user_id ( name )')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error

    const notifications: WorkspaceNotificationRow[] = (data || []).map((row: any) => ({
      id: String(row.id),
      type: String(row.type || ''),
      title: String(row.title || ''),
      body: String(row.body || ''),
      href: String(row.href || ''),
      entity_type: row.entity_type ? String(row.entity_type) : null,
      entity_id: row.entity_id ? String(row.entity_id) : null,
      created_at: String(row.created_at || ''),
      read_at: row.read_at ? String(row.read_at) : null,
      actor_name: row.actor?.name ? String(row.actor.name) : null,
    }))

    return { success: true, notifications }
  } catch (error: any) {
    return { success: false, error: error.message, notifications: [] as WorkspaceNotificationRow[] }
  }
}

export async function markWorkspaceNotificationsRead(payload?: { id?: string }) {
  try {
    const user = await requireCurrentUser()
    const admin = await createAdminClient()
    const now = new Date().toISOString()

    let q = admin
      .from('workspace_notifications')
      .update({ read_at: now })
      .eq('user_id', user.id)
      .is('read_at', null)
    if (payload?.id) q = q.eq('id', String(payload.id).trim())

    const { error } = await q
    if (error) throw error
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
