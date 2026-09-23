'use server'

/**
 * Cadastros Recebidos › Funções — catálogo das funções de quem preenche o
 * cadastro no Portal Parceiro (etapa 0 "Identificação"). Mesmo padrão de
 * `operadoras-telefonia/actions.ts`. Permissão: a da própria lista de
 * Cadastros Recebidos (como a subpágina Nuvidio) — sem chave nova.
 *
 * A chave (slug) é gerada do nome na criação e NUNCA muda: é o que fica
 * gravado em corban_data.preenchedor.funcao_chave. Renomear a função só
 * muda o nome exibido. Sem delete físico — inativar é o soft delete.
 * O portal só lê (service role), filtrando is_active.
 */

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const RESOURCE = 'agente-corban-cadastros-recebidos'
const ROTA = '/agente-corban/cadastros-recebidos/funcoes'

export type CadastroFuncao = {
  id: string
  chave: string
  nome: string
  exige_descricao: boolean
  ordem: number
  is_active: boolean
}

function slugify(nome: string): string {
  return (
    nome
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'funcao'
  )
}

export async function getFuncoes(): Promise<{ success: boolean; items?: CadastroFuncao[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const { data, error } = await admin
      .from('corban_cadastro_funcoes')
      .select('id, chave, nome, exige_descricao, ordem, is_active')
      .order('ordem')
      .order('nome')
    if (error) throw error
    return { success: true, items: (data || []) as CadastroFuncao[] }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function salvarFuncao(input: {
  id?: string
  nome: string
  exige_descricao: boolean
  ordem: number
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')
    const nome = String(input.nome || '').trim()
    if (!nome) throw new Error('Informe o nome da função.')
    const ordem = Number.isFinite(Number(input.ordem)) ? Math.trunc(Number(input.ordem)) : 0
    const row = { nome, exige_descricao: !!input.exige_descricao, ordem, updated_at: new Date().toISOString() }
    const { error } = input.id
      ? await admin.from('corban_cadastro_funcoes').update(row).eq('id', input.id)
      : await admin.from('corban_cadastro_funcoes').insert({ ...row, chave: slugify(nome) })
    if (error) throw error.code === '23505' ? new Error('Já existe uma função com essa chave — escolha outro nome.') : error
    revalidatePath(ROTA)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function setFuncaoStatus(id: string, isActive: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_activate_inactivate')
    if (!id) throw new Error('ID inválido.')
    const { error } = await admin
      .from('corban_cadastro_funcoes')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    revalidatePath(ROTA)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
