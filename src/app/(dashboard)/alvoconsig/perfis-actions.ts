'use server'

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { PERMISSOES_CRM } from '@/lib/alvoconsig/permissoes-crm'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const PERMISSION_RESOURCE = 'alvoconsig-gestao'

export type PerfilCrmItem = {
  id: string
  chave: string
  nome: string
  descricao: string | null
  ordem: number
  sistema: boolean
  permissoes: string[]
  usuarios: number
  parceiros: number
}

export type PerfilCrmInput = {
  id: string
  nome: string
  descricao: string | null
  permissoes: string[]
}

export async function getPerfisCrm(): Promise<{ success: boolean; error?: string; perfis?: PerfilCrmItem[] }> {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const { data: perfis, error } = await supabaseAdmin
      .from('crm_perfis')
      .select('id, chave, nome, descricao, ordem, sistema')
      .is('agente_parceiro_id', null)
      .order('ordem', { ascending: true })
    if (error) throw error

    const ids = (perfis || []).map((p) => p.id as string)
    if (ids.length === 0) return { success: true, perfis: [] }

    const [{ data: perms, error: permsError }, { data: usuarios, error: usuariosError }] = await Promise.all([
      supabaseAdmin.from('crm_perfis_permissoes').select('perfil_id, permissao').in('perfil_id', ids),
      supabaseAdmin.from('crm_usuarios').select('perfil_id, agente_parceiro_id').in('perfil_id', ids),
    ])
    if (permsError) throw permsError
    if (usuariosError) throw usuariosError

    const permsPorPerfil = new Map<string, string[]>()
    for (const row of perms || []) {
      const list = permsPorPerfil.get(row.perfil_id as string) || []
      list.push(row.permissao as string)
      permsPorPerfil.set(row.perfil_id as string, list)
    }
    const usuariosPorPerfil = new Map<string, number>()
    const parceirosPorPerfil = new Map<string, Set<string>>()
    for (const row of usuarios || []) {
      const pid = row.perfil_id as string
      usuariosPorPerfil.set(pid, (usuariosPorPerfil.get(pid) || 0) + 1)
      if (row.agente_parceiro_id) {
        const set = parceirosPorPerfil.get(pid) || new Set<string>()
        set.add(row.agente_parceiro_id as string)
        parceirosPorPerfil.set(pid, set)
      }
    }

    return {
      success: true,
      perfis: (perfis || []).map((p) => ({
        id: p.id as string,
        chave: p.chave as string,
        nome: p.nome as string,
        descricao: (p.descricao as string | null) ?? null,
        ordem: Number(p.ordem ?? 0),
        sistema: p.sistema === true,
        permissoes: permsPorPerfil.get(p.id as string) || [],
        usuarios: usuariosPorPerfil.get(p.id as string) || 0,
        parceiros: parceirosPorPerfil.get(p.id as string)?.size || 0,
      })),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erro ao carregar os perfis.' }
  }
}

export async function salvarPerfisCrm(input: PerfilCrmInput[]): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_edit')

    const chavesValidas = new Set<string>(PERMISSOES_CRM.map((p) => p.chave))
    const ids = input.map((p) => p.id)
    if (ids.length === 0) return { success: true }

    const { data: existentes, error: existentesError } = await supabaseAdmin
      .from('crm_perfis')
      .select('id, sistema')
      .is('agente_parceiro_id', null)
      .in('id', ids)
    if (existentesError) throw existentesError
    const existentesMap = new Map((existentes || []).map((p) => [p.id as string, p.sistema === true]))

    for (const perfil of input) {
      const sistema = existentesMap.get(perfil.id)
      if (sistema === undefined) throw new Error('Perfil não encontrado.')

      const nome = perfil.nome.trim()
      if (!sistema && !nome) throw new Error('O nome do perfil é obrigatório.')
      const descricao = perfil.descricao?.trim() || null
      const permissoes = Array.from(new Set(perfil.permissoes.filter((c) => chavesValidas.has(c))))

      const patch: Record<string, unknown> = { descricao }
      if (!sistema) patch.nome = nome
      const { error: updError } = await supabaseAdmin.from('crm_perfis').update(patch).eq('id', perfil.id)
      if (updError) throw updError

      const { error: delError } = await supabaseAdmin.from('crm_perfis_permissoes').delete().eq('perfil_id', perfil.id)
      if (delError) throw delError
      if (permissoes.length > 0) {
        const { error: insError } = await supabaseAdmin
          .from('crm_perfis_permissoes')
          .insert(permissoes.map((permissao) => ({ perfil_id: perfil.id, permissao })))
        if (insError) throw insError
      }
    }

    revalidatePath('/alvoconsig/perfis')
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erro ao salvar os perfis.' }
  }
}
