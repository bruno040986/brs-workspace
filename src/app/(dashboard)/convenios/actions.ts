'use server'

/**
 * Convênios — subsistema isolado (permissão workspace-convenios).
 * Cadastro básico hoje; evolui para a Base de Conhecimento de Convênios
 * (estrutura em construção pela equipe) sem carregar o comissionamento junto.
 */

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { CONVENIO_ESFERAS } from '@/lib/cadastros-credito'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
)

const PERMISSION_RESOURCE = 'workspace-convenios'

export type ConvenioRecord = {
  id?: string
  nome: string
  nome_reduzido: string
  codigo?: string | null // Código ARW — opcional, só usado pelo importador de comissionamento
  codigo_sistema?: string // gerado pelo banco, não editável
  esfera: string
  cnpj?: string | null
  razao_social?: string | null
  cidade?: string | null
  uf?: string | null
  cep?: string | null
  is_active?: boolean
}

export async function getConvenios() {
  try {
    await requirePermission(PERMISSION_RESOURCE)
    const { data, error } = await supabaseAdmin
      .from('convenios')
      .select('id, nome, nome_reduzido, codigo, codigo_sistema, esfera, cnpj, razao_social, cidade, uf, cep, is_active, created_at')
      .is('deleted_at', null)
      .order('is_active', { ascending: false })
      .order('nome', { ascending: true })
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar convênios:', error)
    return { success: false, error: error.message }
  }
}

function onlyDigitsOrNull(value: unknown): string | null {
  const digits = String(value || '').replace(/\D/g, '')
  return digits || null
}

export async function saveConvenio(payload: ConvenioRecord) {
  try {
    await requirePermission(PERMISSION_RESOURCE, payload.id ? 'can_edit' : 'can_include')

    const nome = String(payload.nome || '').trim()
    if (!nome) return { success: false, error: 'O nome do convênio é obrigatório.' }

    const nomeReduzido = String(payload.nome_reduzido || '').trim()
    if (!nomeReduzido) return { success: false, error: 'O nome reduzido é obrigatório.' }

    const esfera = CONVENIO_ESFERAS.some((item) => item.value === payload.esfera)
      ? payload.esfera
      : 'outro'

    const row = {
      nome,
      nome_reduzido: nomeReduzido,
      codigo: String(payload.codigo || '').trim() || null,
      esfera,
      cnpj: onlyDigitsOrNull(payload.cnpj),
      razao_social: String(payload.razao_social || '').trim() || null,
      cidade: String(payload.cidade || '').trim() || null,
      uf: String(payload.uf || '').trim().toUpperCase().slice(0, 2) || null,
      cep: onlyDigitsOrNull(payload.cep),
      updated_at: new Date().toISOString(),
    }

    if (payload.id) {
      const { error } = await supabaseAdmin.from('convenios').update(row).eq('id', payload.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin.from('convenios').insert(row)
      if (error) throw error
    }

    revalidatePath('/convenios')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar convênio:', error)
    if ((error as any)?.code === '23505') {
      return { success: false, error: 'Já existe um convênio com esse nome ou código.' }
    }
    return { success: false, error: error.message }
  }
}

export async function setConvenioStatus(id: string, isActive: boolean) {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_activate_inactivate')
    if (!id) return { success: false, error: 'ID inválido.' }

    const { error } = await supabaseAdmin
      .from('convenios')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error

    revalidatePath('/convenios')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alterar status do convênio:', error)
    return { success: false, error: error.message }
  }
}
