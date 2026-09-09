'use server'

/**
 * Averbadoras — subsistema isolado (permissão workspace-averbadoras), mesmo
 * padrão de `convenios/actions.ts` + `convenios/cadastros-actions.ts`.
 * Averbadora 1→N convênios (a FK vive em `convenios`, ver
 * `convenios/actions.ts`). Sem delete físico — inativar é o soft delete.
 */

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { normalizarUrl } from '@/lib/url-site'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const RESOURCE = 'workspace-averbadoras'

export type Averbadora = {
  id: string
  cnpj: string
  razao_social: string
  nome: string
  site_institucional: string | null
  is_active: boolean
}

export type TipoAutenticacao = {
  id: string
  tipo: string
  vigencia_horas: number
  is_active: boolean
}

function onlyDigits(value: unknown): string {
  return String(value || '').replace(/\D/g, '')
}

// ---------------- Averbadoras ----------------

export async function getAverbadoras(): Promise<{ success: boolean; items?: Averbadora[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const { data, error } = await admin
      .from('averbadoras')
      .select('id, cnpj, razao_social, nome, site_institucional, is_active')
      .is('deleted_at', null)
      .order('is_active', { ascending: false })
      .order('nome')
    if (error) throw error
    return { success: true, items: (data || []) as Averbadora[] }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/** Só ativas — usado no seletor do modal de Convênio. */
export async function getAverbadorasAtivas(): Promise<Averbadora[]> {
  try {
    await requirePermission(RESOURCE)
    const { data } = await admin
      .from('averbadoras')
      .select('id, cnpj, razao_social, nome, site_institucional, is_active')
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('nome')
    return (data || []) as Averbadora[]
  } catch {
    return []
  }
}

export async function salvarAverbadora(input: {
  id?: string
  cnpj: string
  razao_social: string
  nome: string
  site_institucional?: string | null
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')

    const cnpj = onlyDigits(input.cnpj)
    if (cnpj.length !== 14) throw new Error('Informe um CNPJ válido (14 dígitos).')

    const nome = String(input.nome || '').trim()
    if (!nome) throw new Error('Informe o nome da averbadora.')

    let siteInstitucional: string | null = null
    const siteBruto = String(input.site_institucional || '').trim()
    if (siteBruto) siteInstitucional = normalizarUrl(siteBruto)

    const row = {
      cnpj,
      razao_social: String(input.razao_social || '').trim(),
      nome,
      site_institucional: siteInstitucional,
      updated_at: new Date().toISOString(),
    }

    const { error } = input.id
      ? await admin.from('averbadoras').update(row).eq('id', input.id)
      : await admin.from('averbadoras').insert(row)
    if (error) throw error.code === '23505' ? new Error('Já existe uma averbadora com esse CNPJ ou nome.') : error

    revalidatePath('/averbadoras')
    revalidatePath('/convenios')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function setAverbadoraStatus(id: string, isActive: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_activate_inactivate')
    if (!id) throw new Error('ID inválido.')
    const { error } = await admin.from('averbadoras').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    revalidatePath('/averbadoras')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ---------------- Tipos de Autenticação ----------------

export async function getTiposAutenticacao(): Promise<{ success: boolean; items?: TipoAutenticacao[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const { data, error } = await admin
      .from('averbadora_tipos_autenticacao')
      .select('id, tipo, vigencia_horas, is_active')
      .order('is_active', { ascending: false })
      .order('tipo')
    if (error) throw error
    return { success: true, items: (data || []) as TipoAutenticacao[] }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/** Só ativos — usado no seletor do modal de Convênio. */
export async function getTiposAutenticacaoAtivos(): Promise<TipoAutenticacao[]> {
  try {
    await requirePermission(RESOURCE)
    const { data } = await admin
      .from('averbadora_tipos_autenticacao')
      .select('id, tipo, vigencia_horas, is_active')
      .eq('is_active', true)
      .order('tipo')
    return (data || []) as TipoAutenticacao[]
  } catch {
    return []
  }
}

export async function salvarTipoAutenticacao(input: { id?: string; tipo: string; vigencia_horas: number }): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')

    const tipo = String(input.tipo || '').trim()
    if (!tipo) throw new Error('Informe o tipo de autenticação.')

    const vigencia = Math.round(Number(input.vigencia_horas))
    if (!Number.isFinite(vigencia) || vigencia <= 0) throw new Error('O tempo de vigência deve ser um número inteiro de horas maior que zero.')

    const row = { tipo, vigencia_horas: vigencia, updated_at: new Date().toISOString() }
    const { error } = input.id
      ? await admin.from('averbadora_tipos_autenticacao').update(row).eq('id', input.id)
      : await admin.from('averbadora_tipos_autenticacao').insert(row)
    if (error) throw error.code === '23505' ? new Error('Já existe um tipo de autenticação com esse nome.') : error

    revalidatePath('/averbadoras/tipos-autenticacao')
    revalidatePath('/convenios')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function setTipoAutenticacaoStatus(id: string, isActive: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_activate_inactivate')
    if (!id) throw new Error('ID inválido.')
    const { error } = await admin.from('averbadora_tipos_autenticacao').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    revalidatePath('/averbadoras/tipos-autenticacao')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
