'use server'

/**
 * Convênios — cadastros de apoio: Esfera e Tipo de Convênio.
 * Cadeia: Esfera → Tipo de Convênio (tem esfera obrigatória) → Convênio (tem
 * tipo; a esfera do convênio deriva do tipo). Permissão: `workspace-convenios`.
 */
import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const RESOURCE = 'workspace-convenios'

export type Esfera = { id: string; nome: string; is_active: boolean }
export type TipoConvenio = { id: string; nome: string; esfera_id: string; is_active: boolean; esfera_nome?: string }

// ---------------- Esferas ----------------
export async function getEsferas(): Promise<{ success: boolean; items?: Esfera[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const { data, error } = await admin.from('convenio_esferas').select('id, nome, is_active').order('is_active', { ascending: false }).order('nome')
    if (error) throw error
    return { success: true, items: (data || []) as Esfera[] }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function salvarEsfera(input: { id?: string; nome: string }): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')
    const nome = String(input.nome || '').trim()
    if (!nome) throw new Error('Informe o nome da esfera.')
    const row = { nome, updated_at: new Date().toISOString() }
    const { error } = input.id
      ? await admin.from('convenio_esferas').update(row).eq('id', input.id)
      : await admin.from('convenio_esferas').insert(row)
    if (error) throw error.code === '23505' ? new Error('Já existe uma esfera com esse nome.') : error
    revalidatePath('/convenios/esferas')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function setEsferaStatus(id: string, isActive: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_activate_inactivate')
    const { error } = await admin.from('convenio_esferas').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    revalidatePath('/convenios/esferas')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ---------------- Tipos de Convênio ----------------
export async function getTiposConvenio(): Promise<{ success: boolean; items?: TipoConvenio[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const { data, error } = await admin
      .from('convenio_tipos')
      .select('id, nome, esfera_id, is_active, esfera:esfera_id(nome)')
      .order('is_active', { ascending: false })
      .order('nome')
    if (error) throw error
    return { success: true, items: (data || []).map((r: any) => ({ id: r.id, nome: r.nome, esfera_id: r.esfera_id, is_active: r.is_active, esfera_nome: r.esfera?.nome || '' })) as TipoConvenio[] }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function salvarTipoConvenio(input: { id?: string; nome: string; esfera_id: string }): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')
    const nome = String(input.nome || '').trim()
    if (!nome) throw new Error('Informe o nome do tipo de convênio.')
    if (!input.esfera_id) throw new Error('A esfera é obrigatória no tipo de convênio.')
    const row = { nome, esfera_id: input.esfera_id, updated_at: new Date().toISOString() }
    const { error } = input.id
      ? await admin.from('convenio_tipos').update(row).eq('id', input.id)
      : await admin.from('convenio_tipos').insert(row)
    if (error) throw error.code === '23505' ? new Error('Já existe um tipo com esse nome.') : error
    revalidatePath('/convenios/tipos')
    revalidatePath('/convenios')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function setTipoConvenioStatus(id: string, isActive: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_activate_inactivate')
    const { error } = await admin.from('convenio_tipos').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    revalidatePath('/convenios/tipos')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ---------------- Lookups ativos (dropdowns) ----------------
export async function getEsferasAtivas(): Promise<Esfera[]> {
  try {
    await requirePermission(RESOURCE)
    const { data } = await admin.from('convenio_esferas').select('id, nome, is_active').eq('is_active', true).order('nome')
    return (data || []) as Esfera[]
  } catch {
    return []
  }
}

export async function getTiposAtivos(): Promise<TipoConvenio[]> {
  try {
    await requirePermission(RESOURCE)
    const { data } = await admin
      .from('convenio_tipos')
      .select('id, nome, esfera_id, is_active, esfera:esfera_id(nome)')
      .eq('is_active', true)
      .order('nome')
    return (data || []).map((r: any) => ({ id: r.id, nome: r.nome, esfera_id: r.esfera_id, is_active: r.is_active, esfera_nome: r.esfera?.nome || '' })) as TipoConvenio[]
  } catch {
    return []
  }
}
