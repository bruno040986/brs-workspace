'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'

// Registro de entidades que aceitam comentários e o recurso de
// permissão que libera cada uma. Para plugar comentários em uma nova
// tela (ex.: Agente Corban), basta adicionar a entrada aqui.
const COMMENT_ENTITY_PERMISSIONS: Record<string, string> = {
  agenda_item: 'workspace-agenda',
}

export type RecordComment = {
  id: string
  body: string
  created_at: string
  user_id: string
  user_name: string
  user_avatar_url: string | null
}

function requireEntityResource(entityType: string): string {
  const resource = COMMENT_ENTITY_PERMISSIONS[entityType]
  if (!resource) throw new Error('Tipo de registro não aceita comentários.')
  return resource
}

export async function listRecordComments(entityType: string, entityId: string) {
  try {
    const resource = requireEntityResource(entityType)
    await requirePermission(resource, 'can_view')
    const admin = await createAdminClient()

    const { data, error } = await admin
      .from('record_comments')
      .select('id, body, created_at, user_id, user:user_id ( name, avatar_url )')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(200)
    if (error) throw error

    const comments: RecordComment[] = (data || []).map((row: any) => ({
      id: String(row.id),
      body: String(row.body || ''),
      created_at: String(row.created_at || ''),
      user_id: String(row.user_id),
      user_name: String(row.user?.name || '—'),
      user_avatar_url: row.user?.avatar_url ? String(row.user.avatar_url) : null,
    }))

    return { success: true, comments }
  } catch (error: any) {
    return { success: false, error: error.message, comments: [] as RecordComment[] }
  }
}

export async function addRecordComment(entityType: string, entityId: string, body: string) {
  try {
    const resource = requireEntityResource(entityType)
    const { user } = await requirePermission(resource, 'can_include')
    const admin = await createAdminClient()

    const text = String(body || '').trim()
    if (!text) return { success: false, error: 'Escreva um comentário.' }
    if (text.length > 4000) return { success: false, error: 'Comentário excede 4000 caracteres.' }

    const { error } = await admin.from('record_comments').insert({
      entity_type: entityType,
      entity_id: entityId,
      user_id: user.id,
      body: text,
    })
    if (error) throw error

    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function removeRecordComment(commentId: string) {
  try {
    const admin = await createAdminClient()
    const { data: comment, error: findErr } = await admin
      .from('record_comments')
      .select('id, entity_type, user_id')
      .eq('id', commentId)
      .is('deleted_at', null)
      .maybeSingle()
    if (findErr) throw findErr
    if (!comment) return { success: false, error: 'Comentário não encontrado.' }

    const resource = requireEntityResource(String(comment.entity_type))
    const { user } = await requirePermission(resource, 'can_view')
    if (String(comment.user_id) !== user.id) {
      return { success: false, error: 'Só é possível excluir o próprio comentário.' }
    }

    const { error } = await admin
      .from('record_comments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', commentId)
    if (error) throw error

    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
