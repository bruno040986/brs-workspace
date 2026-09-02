'use server'

/**
 * Grupos Internos do BRS Messenger — gerenciados na Central de Atendimento
 * (Configurações › Central de Atendimento › Grupos Internos), permissão
 * `central-conversas`. Um grupo é uma conversa `kind='grupo'` com nome
 * próprio em `workspace_chat_conversations.name` e membros em
 * `workspace_chat_participants` — o mesmo modelo do canal fixo "Equipe BRS",
 * então o chat, os anexos e os não-lidos já funcionam sem código novo.
 */
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'

export type GrupoInternoRow = {
  id: string
  nome: string
  criado_em: string
  membros: Array<{ user_id: string; name: string; email: string; avatar_url: string | null }>
}

export type UsuarioParaGrupo = { id: string; name: string; email: string; avatar_url: string | null }

export async function listarGruposInternos(): Promise<{ success: boolean; data?: GrupoInternoRow[]; usuarios?: UsuarioParaGrupo[]; error?: string }> {
  try {
    await requirePermission('central-conversas')
    const admin = await createAdminClient()

    const [{ data: grupos, error: errG }, { data: usuarios, error: errU }] = await Promise.all([
      admin
        .from('workspace_chat_conversations')
        .select('id, name, created_at')
        .eq('kind', 'grupo')
        .is('deleted_at', null)
        .order('name'),
      admin.from('users').select('id, name, email, avatar_url').eq('active', true).order('name'),
    ])
    if (errG) throw errG
    if (errU) throw errU

    const ids = (grupos || []).map((g) => String(g.id))
    let participantes: Array<{ conversation_id: string; user_id: string }> = []
    if (ids.length) {
      const { data } = await admin.from('workspace_chat_participants').select('conversation_id, user_id').in('conversation_id', ids)
      participantes = (data || []) as typeof participantes
    }
    const usuarioPorId = new Map((usuarios || []).map((u) => [String(u.id), u]))

    const data: GrupoInternoRow[] = (grupos || []).map((g) => ({
      id: String(g.id),
      nome: String(g.name || 'Grupo'),
      criado_em: String(g.created_at),
      membros: participantes
        .filter((p) => String(p.conversation_id) === String(g.id))
        .map((p) => {
          const u = usuarioPorId.get(String(p.user_id))
          return u
            ? { user_id: String(u.id), name: String(u.name || ''), email: String(u.email || ''), avatar_url: (u.avatar_url as string | null) || null }
            : null
        })
        .filter((m): m is NonNullable<typeof m> => Boolean(m)),
    }))

    return {
      success: true,
      data,
      usuarios: (usuarios || []).map((u) => ({
        id: String(u.id),
        name: String(u.name || ''),
        email: String(u.email || ''),
        avatar_url: (u.avatar_url as string | null) || null,
      })),
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao listar grupos.' }
  }
}

export async function salvarGrupoInterno(input: {
  id?: string
  nome: string
  membros: string[]
}): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const { user } = await requirePermission('central-conversas', 'can_edit')
    const nome = String(input.nome || '').trim()
    if (!nome) throw new Error('Dê um nome ao grupo.')
    const membros = [...new Set((input.membros || []).map(String).filter(Boolean))]
    if (membros.length < 2) throw new Error('Um grupo precisa de pelo menos 2 membros.')

    const admin = await createAdminClient()
    let grupoId = String(input.id || '')

    if (grupoId) {
      const { data: existente } = await admin
        .from('workspace_chat_conversations')
        .select('id, kind')
        .eq('id', grupoId)
        .eq('kind', 'grupo')
        .maybeSingle()
      if (!existente) throw new Error('Grupo não encontrado.')
      const { error } = await admin.from('workspace_chat_conversations').update({ name: nome, deleted_at: null }).eq('id', grupoId)
      if (error) throw error
    } else {
      const { data: criado, error } = await admin
        .from('workspace_chat_conversations')
        .insert({ kind: 'grupo', name: nome, created_by: user.id })
        .select('id')
        .single()
      if (error) throw error
      grupoId = String(criado.id)
    }

    // Sincroniza membros: adiciona os novos, remove quem saiu.
    const { data: atuais } = await admin.from('workspace_chat_participants').select('user_id').eq('conversation_id', grupoId)
    const atuaisIds = new Set((atuais || []).map((p) => String(p.user_id)))
    const desejados = new Set(membros)

    const adicionar = membros.filter((id) => !atuaisIds.has(id))
    const remover = [...atuaisIds].filter((id) => !desejados.has(id))

    if (adicionar.length) {
      const { error } = await admin
        .from('workspace_chat_participants')
        .insert(adicionar.map((userId) => ({ conversation_id: grupoId, user_id: userId })))
      if (error) throw error
    }
    if (remover.length) {
      const { error } = await admin
        .from('workspace_chat_participants')
        .delete()
        .eq('conversation_id', grupoId)
        .in('user_id', remover)
      if (error) throw error
    }

    revalidatePath('/central-conversas/grupos')
    return { success: true, id: grupoId }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao salvar grupo.' }
  }
}

export async function excluirGrupoInterno(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission('central-conversas', 'can_edit')
    const admin = await createAdminClient()
    // Soft delete: o histórico fica no banco; o grupo some do Messenger de todos.
    const { error } = await admin
      .from('workspace_chat_conversations')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('kind', 'grupo')
    if (error) throw error
    revalidatePath('/central-conversas/grupos')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao excluir grupo.' }
  }
}
