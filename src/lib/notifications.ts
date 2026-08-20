import type { createAdminClient } from '@/lib/supabase/server'

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>

export type WorkspaceNotificationInput = {
  user_id: string
  type: string
  title: string
  body?: string
  href?: string
  entity_type?: string | null
  entity_id?: string | null
  actor_user_id?: string | null
}

// Cria notificações do sino para um ou mais usuários. Sempre via
// service role — a RLS de workspace_notifications só permite ao
// usuário ler/marcar as próprias. O INSERT chega em tempo real ao
// navegador do destinatário (Supabase Realtime, como nos Elogios).
export async function createWorkspaceNotifications(
  admin: AdminClient,
  notifications: WorkspaceNotificationInput[],
) {
  const rows = notifications
    .filter((n) => n.user_id && n.title)
    .map((n) => ({
      user_id: n.user_id,
      type: n.type,
      title: n.title,
      body: n.body || '',
      href: n.href || '',
      entity_type: n.entity_type ?? null,
      entity_id: n.entity_id ?? null,
      actor_user_id: n.actor_user_id ?? null,
    }))
  if (!rows.length) return
  const { error } = await admin.from('workspace_notifications').insert(rows)
  if (error) throw error
}
