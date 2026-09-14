'use server'

/**
 * Operadoras de telefonia — cadastro isolado (permissão
 * workspace-operadoras-telefonia), mesmo padrão de `averbadoras/actions.ts`.
 * Consumido pelo CRM AlvoConsig (card da instância de WhatsApp: operadora do
 * chip + logotipo quadrado). Sem delete físico — inativar é o soft delete.
 */

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const RESOURCE = 'workspace-operadoras-telefonia'

export type OperadoraTelefonia = {
  id: string
  nome: string
  logo_url: string | null
  is_active: boolean
}

export async function getOperadoras(): Promise<{ success: boolean; items?: OperadoraTelefonia[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const { data, error } = await admin
      .from('operadoras_telefonia')
      .select('id, nome, logo_url, is_active')
      .is('deleted_at', null)
      .order('is_active', { ascending: false })
      .order('nome')
    if (error) throw error
    return { success: true, items: (data || []) as OperadoraTelefonia[] }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function salvarOperadora(input: { id?: string; nome: string; logo_url?: string | null }): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')
    const nome = String(input.nome || '').trim()
    if (!nome) throw new Error('Informe o nome da operadora.')
    const row = { nome, logo_url: input.logo_url?.trim() || null, updated_at: new Date().toISOString() }
    const { error } = input.id ? await admin.from('operadoras_telefonia').update(row).eq('id', input.id) : await admin.from('operadoras_telefonia').insert(row)
    if (error) throw error.code === '23505' ? new Error('Já existe uma operadora com esse nome.') : error
    revalidatePath('/operadoras-telefonia')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function setOperadoraStatus(id: string, isActive: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_activate_inactivate')
    if (!id) throw new Error('ID inválido.')
    const { error } = await admin.from('operadoras_telefonia').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    revalidatePath('/operadoras-telefonia')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
