'use server'

/**
 * Server actions do Jarvis (IA do Workspace).
 * - Usar o chat: permissão `workspace-ia`.
 * - Configurar credencial/personalidade: permissão `sistema-config-ia`.
 * O streaming da resposta em si vive em /api/ia/chat (route handler).
 */

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'
import {
  IA_MODELOS_SUGERIDOS,
  IA_PERSONALIDADE_PADRAO,
  lerIaConfigPublica,
  salvarIaConfig,
  type IaConfigPublica,
  type IaPersonalidade,
  type IaProvider,
} from './config'

export type IaMensagemRow = {
  id: string
  role: 'user' | 'assistant'
  content: string
  modelo: string | null
  created_at: string
}

export type IaConversaRow = {
  id: string
  titulo: string
  created_at: string
}

// ---------- Configuração (card "IA do Workspace") ----------

export async function getIaConfig(): Promise<{ success: boolean; data?: IaConfigPublica; sugeridos?: string[]; error?: string }> {
  try {
    await requirePermission('sistema-config-ia')
    const data = await lerIaConfigPublica()
    return { success: true, data, sugeridos: IA_MODELOS_SUGERIDOS }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao carregar configuração.' }
  }
}

export async function saveIaConfig(input: {
  provider: IaProvider
  apiKey?: string
  modelos: string[]
  personalidade: IaPersonalidade
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermission('sistema-config-ia', 'can_edit')
    await salvarIaConfig({ ...input, updatedBy: user.id })
    revalidatePath('/ia-workspace')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao salvar configuração.' }
  }
}

// ---------- Identidade pública do agente (nome/saudação/frase p/ UI) ----------

export async function getIaIdentidade(): Promise<{
  habilitado: boolean
  nome: string
  saudacao: string
  statusFrase: string
}> {
  try {
    const { user, permissions } = await requirePermission('workspace-ia')
    void user
    void permissions
    const cfg = await lerIaConfigPublica()
    const p = cfg.personalidade
    return {
      habilitado: cfg.temChave && cfg.modelos.length > 0,
      nome: p.nome,
      saudacao: p.saudacao,
      statusFrase: p.status_frase,
    }
  } catch {
    return { habilitado: false, nome: IA_PERSONALIDADE_PADRAO.nome, saudacao: '', statusFrase: '' }
  }
}

// ---------- Conversas do usuário ----------

export async function listarIaConversas(): Promise<{ success: boolean; data?: IaConversaRow[]; error?: string }> {
  try {
    const { user } = await requirePermission('workspace-ia')
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('ia_conversas')
      .select('id, titulo, created_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(20)
    if (error) throw error
    return { success: true, data: (data || []) as IaConversaRow[] }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao listar conversas.' }
  }
}

export async function getIaMensagens(conversaId: string): Promise<{ success: boolean; data?: IaMensagemRow[]; error?: string }> {
  try {
    const { user } = await requirePermission('workspace-ia')
    const admin = await createAdminClient()
    const { data: conversa } = await admin.from('ia_conversas').select('id').eq('id', conversaId).eq('user_id', user.id).maybeSingle()
    if (!conversa) throw new Error('Conversa não encontrada.')
    const { data, error } = await admin
      .from('ia_mensagens')
      .select('id, role, content, modelo, created_at')
      .eq('conversa_id', conversaId)
      .order('created_at', { ascending: true })
      .limit(200)
    if (error) throw error
    return { success: true, data: (data || []) as IaMensagemRow[] }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao carregar mensagens.' }
  }
}

export async function excluirIaConversa(conversaId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermission('workspace-ia')
    const admin = await createAdminClient()
    const { error } = await admin.from('ia_conversas').delete().eq('id', conversaId).eq('user_id', user.id)
    if (error) throw error
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao excluir conversa.' }
  }
}
