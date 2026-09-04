'use server'

/**
 * Biblioteca de Artes — taxonomia relacional (Grupo, Categoria, Formato) +
 * Associação (Grupo+Categoria → Formato). Substitui os campos-texto da arte.
 * Permissão: `marketing-biblioteca-artes`. Tudo passa por service role nas
 * actions (RLS é defensiva). A leitura de opções ativas alimenta a cascata da
 * tela "Nova Arte" e o catálogo do Portal Parceiro.
 */
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'

const RESOURCE = 'marketing-biblioteca-artes'

export type Grupo = { id: string; nome: string; is_active: boolean }
export type Categoria = { id: string; nome: string; is_active: boolean }
export type Formato = { id: string; rotulo: string; largura_px: number; altura_px: number; is_active: boolean }
export type Associacao = {
  id: string
  grupo_id: string
  categoria_id: string
  formato_id: string
  is_active: boolean
  grupo_nome?: string
  categoria_nome?: string
  formato_rotulo?: string
  largura_px?: number
  altura_px?: number
}

// --------------------------------------------------------------------------
// Grupos
// --------------------------------------------------------------------------
export async function listarGrupos(): Promise<{ success: boolean; data?: Grupo[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const admin = await createAdminClient()
    const { data, error } = await admin.from('marketing_grupos').select('id, nome, is_active').order('is_active', { ascending: false }).order('nome')
    if (error) throw error
    return { success: true, data: (data || []) as Grupo[] }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function salvarGrupo(input: { id?: string; nome: string }): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')
    const nome = String(input.nome || '').trim()
    if (!nome) throw new Error('Informe o nome do grupo.')
    const admin = await createAdminClient()
    const row = { nome, updated_at: new Date().toISOString() }
    const { error } = input.id
      ? await admin.from('marketing_grupos').update(row).eq('id', input.id)
      : await admin.from('marketing_grupos').insert(row)
    if (error) throw error.code === '23505' ? new Error('Já existe um grupo com esse nome.') : error
    revalidatePath('/marketing/grupos')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function setGrupoStatus(id: string, isActive: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_activate_inactivate')
    const admin = await createAdminClient()
    const { error } = await admin.from('marketing_grupos').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    revalidatePath('/marketing/grupos')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// --------------------------------------------------------------------------
// Categorias
// --------------------------------------------------------------------------
export async function listarCategorias(): Promise<{ success: boolean; data?: Categoria[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const admin = await createAdminClient()
    const { data, error } = await admin.from('marketing_categorias').select('id, nome, is_active').order('is_active', { ascending: false }).order('nome')
    if (error) throw error
    return { success: true, data: (data || []) as Categoria[] }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function salvarCategoria(input: { id?: string; nome: string }): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')
    const nome = String(input.nome || '').trim()
    if (!nome) throw new Error('Informe o nome da categoria.')
    const admin = await createAdminClient()
    const row = { nome, updated_at: new Date().toISOString() }
    const { error } = input.id
      ? await admin.from('marketing_categorias').update(row).eq('id', input.id)
      : await admin.from('marketing_categorias').insert(row)
    if (error) throw error.code === '23505' ? new Error('Já existe uma categoria com esse nome.') : error
    revalidatePath('/marketing/categorias')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function setCategoriaStatus(id: string, isActive: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_activate_inactivate')
    const admin = await createAdminClient()
    const { error } = await admin.from('marketing_categorias').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    revalidatePath('/marketing/categorias')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// --------------------------------------------------------------------------
// Formatos
// --------------------------------------------------------------------------
export async function listarFormatos(): Promise<{ success: boolean; data?: Formato[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const admin = await createAdminClient()
    const { data, error } = await admin.from('marketing_formatos').select('id, rotulo, largura_px, altura_px, is_active').order('is_active', { ascending: false }).order('rotulo')
    if (error) throw error
    return { success: true, data: (data || []).map((r: any) => ({ ...r, largura_px: Number(r.largura_px), altura_px: Number(r.altura_px) })) as Formato[] }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function salvarFormato(input: { id?: string; rotulo?: string; largura_px: number; altura_px: number }): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')
    const largura = Math.round(Number(input.largura_px))
    const altura = Math.round(Number(input.altura_px))
    if (!largura || !altura || largura < 1 || altura < 1) throw new Error('Informe largura e altura em pixels.')
    const rotulo = String(input.rotulo || '').trim() || `${largura}x${altura}px`
    const admin = await createAdminClient()
    const row = { rotulo, largura_px: largura, altura_px: altura, updated_at: new Date().toISOString() }
    const { error } = input.id
      ? await admin.from('marketing_formatos').update(row).eq('id', input.id)
      : await admin.from('marketing_formatos').insert(row)
    if (error) throw error.code === '23505' ? new Error('Já existe um formato com esse rótulo.') : error
    revalidatePath('/marketing/formatos')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function setFormatoStatus(id: string, isActive: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_activate_inactivate')
    const admin = await createAdminClient()
    const { error } = await admin.from('marketing_formatos').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    revalidatePath('/marketing/formatos')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// --------------------------------------------------------------------------
// Associações (Grupo + Categoria → Formato)
// --------------------------------------------------------------------------
export async function listarAssociacoes(): Promise<{ success: boolean; data?: Associacao[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('marketing_associacoes')
      .select('id, grupo_id, categoria_id, formato_id, is_active, grupo:grupo_id(nome), categoria:categoria_id(nome), formato:formato_id(rotulo, largura_px, altura_px)')
      .order('is_active', { ascending: false })
    if (error) throw error
    const rows = (data || []).map((r: any) => ({
      id: r.id,
      grupo_id: r.grupo_id,
      categoria_id: r.categoria_id,
      formato_id: r.formato_id,
      is_active: r.is_active,
      grupo_nome: r.grupo?.nome || '',
      categoria_nome: r.categoria?.nome || '',
      formato_rotulo: r.formato?.rotulo || '',
      largura_px: Number(r.formato?.largura_px) || 0,
      altura_px: Number(r.formato?.altura_px) || 0,
    })) as Associacao[]
    rows.sort((a, b) => (a.grupo_nome || '').localeCompare(b.grupo_nome || '') || (a.categoria_nome || '').localeCompare(b.categoria_nome || '') || (a.formato_rotulo || '').localeCompare(b.formato_rotulo || ''))
    return { success: true, data: rows }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function salvarAssociacao(input: { grupo_id: string; categoria_id: string; formato_id: string }): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_include')
    if (!input.grupo_id || !input.categoria_id || !input.formato_id) throw new Error('Selecione grupo, categoria e formato.')
    const admin = await createAdminClient()
    const { error } = await admin.from('marketing_associacoes').insert({ grupo_id: input.grupo_id, categoria_id: input.categoria_id, formato_id: input.formato_id })
    if (error) throw error.code === '23505' ? new Error('Essa combinação já existe.') : error
    revalidatePath('/marketing/associacoes')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function setAssociacaoStatus(id: string, isActive: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_activate_inactivate')
    const admin = await createAdminClient()
    const { error } = await admin.from('marketing_associacoes').update({ is_active: isActive }).eq('id', id)
    if (error) throw error
    revalidatePath('/marketing/associacoes')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function excluirAssociacao(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_delete')
    const admin = await createAdminClient()
    const { error } = await admin.from('marketing_associacoes').delete().eq('id', id)
    if (error) throw error
    revalidatePath('/marketing/associacoes')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// --------------------------------------------------------------------------
// Lookups para telas (formulário de associação + cascata da Nova Arte)
// --------------------------------------------------------------------------
export async function getTaxonomiaLookups(): Promise<{
  grupos: Grupo[]
  categorias: Categoria[]
  formatos: Formato[]
}> {
  try {
    await requirePermission(RESOURCE)
    const admin = await createAdminClient()
    const [{ data: g }, { data: c }, { data: f }] = await Promise.all([
      admin.from('marketing_grupos').select('id, nome, is_active').eq('is_active', true).order('nome'),
      admin.from('marketing_categorias').select('id, nome, is_active').eq('is_active', true).order('nome'),
      admin.from('marketing_formatos').select('id, rotulo, largura_px, altura_px, is_active').eq('is_active', true).order('rotulo'),
    ])
    return {
      grupos: (g || []) as Grupo[],
      categorias: (c || []) as Categoria[],
      formatos: (f || []).map((r: any) => ({ ...r, largura_px: Number(r.largura_px), altura_px: Number(r.altura_px) })) as Formato[],
    }
  } catch {
    return { grupos: [], categorias: [], formatos: [] }
  }
}
