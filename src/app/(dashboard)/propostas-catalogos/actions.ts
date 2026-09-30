'use server'

/**
 * Cadastros › Status e Situações de Proposta (esteira, spec §4.2/§6.5).
 * Tabelas só têm grant p/ service_role → tudo via cliente admin, sempre depois
 * de requirePermission. Sem delete físico: inativar é o soft delete (propostas
 * antigas seguem legíveis). Validação pura em src/lib/propostas-catalogos.ts.
 */
import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import {
  normalizarConfig, normalizarSituacao, normalizarStatus,
  type ConfigInput, type SituacaoInput, type StatusInput, type StatusRow,
} from '@/lib/propostas-catalogos'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const RESOURCE = 'operacional-propostas-catalogos'
const PATH = '/propostas-catalogos'

type Res = { success: boolean; error?: string }
export type PropostaStatus = StatusRow & { id: string; ordem: number; is_active: boolean }
export type PropostaSituacao = { id: string; codigo_arw: string; nome: string; descricao: string; status_sugerido_id: string | null; is_active: boolean }
export type EsteiraConfig = { cancelamento_automatico_dias: number; exigir_contato_ao_pendenciar: boolean }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const dup = (e: { code?: string; message?: string }, what: string) =>
  e.code === '23505' ? new Error(`Já existe ${what} com esse nome${/codigo_arw/.test(e.message || '') ? ' ou código' : ''}.`) : e

export async function getCatalogos(): Promise<{ success: boolean; status?: PropostaStatus[]; situacoes?: PropostaSituacao[]; config?: EsteiraConfig; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const [st, si, cf] = await Promise.all([
      admin.from('propostas_status').select('*').order('ordem').order('nome'),
      admin.from('propostas_situacoes').select('id, codigo_arw, nome, descricao, status_sugerido_id, is_active'),
      admin.from('propostas_esteira_config').select('cancelamento_automatico_dias, exigir_contato_ao_pendenciar').eq('id', true).maybeSingle(),
    ])
    if (st.error) throw st.error
    if (si.error) throw si.error
    if (cf.error) throw cf.error
    const situacoes = ((si.data || []) as PropostaSituacao[]).sort((a, b) => Number(a.codigo_arw) - Number(b.codigo_arw) || a.codigo_arw.localeCompare(b.codigo_arw))
    return { success: true, status: (st.data || []) as PropostaStatus[], situacoes, config: (cf.data || undefined) as EsteiraConfig | undefined }
  } catch (err) {
    return { success: false, error: msg(err) }
  }
}

export async function salvarStatus(input: StatusInput & { id?: string }): Promise<Res> {
  try {
    await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')
    const v = normalizarStatus(input)
    if (!v.ok) throw new Error(v.error)
    // Um só status de cadastro: quem marca assume, os demais perdem a marca (o índice único exige).
    if (v.value.padrao_cadastro) {
      let q = admin.from('propostas_status').update({ padrao_cadastro: false }).eq('padrao_cadastro', true)
      if (input.id) q = q.neq('id', input.id)
      const { error } = await q
      if (error) throw error
    }
    const { error } = input.id
      ? await admin.from('propostas_status').update(v.value).eq('id', input.id)
      : await admin.from('propostas_status').insert({ ...v.value, ordem: 100 })
    if (error) throw dup(error, 'um status')
    revalidatePath(PATH)
    return { success: true }
  } catch (err) {
    return { success: false, error: msg(err) }
  }
}

export async function setStatusAtivo(id: string, isActive: boolean): Promise<Res> {
  try {
    await requirePermission(RESOURCE, 'can_activate_inactivate')
    if (!id) throw new Error('ID inválido.')
    const { error } = await admin.from('propostas_status').update({ is_active: isActive }).eq('id', id)
    if (error) throw error
    revalidatePath(PATH)
    return { success: true }
  } catch (err) {
    return { success: false, error: msg(err) }
  }
}

export async function salvarSituacao(input: SituacaoInput & { id?: string }): Promise<Res> {
  try {
    await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')
    const v = normalizarSituacao(input)
    if (!v.ok) throw new Error(v.error)
    if (v.value.status_sugerido_id) {
      const { data, error } = await admin.from('propostas_status').select('id').eq('id', v.value.status_sugerido_id).eq('is_active', true).maybeSingle()
      if (error) throw error
      if (!data) throw new Error('O status sugerido não existe ou está inativo.')
    }
    const { error } = input.id
      ? await admin.from('propostas_situacoes').update(v.value).eq('id', input.id)
      : await admin.from('propostas_situacoes').insert(v.value)
    if (error) throw dup(error, 'uma situação')
    revalidatePath(PATH)
    return { success: true }
  } catch (err) {
    return { success: false, error: msg(err) }
  }
}

export async function setSituacaoAtiva(id: string, isActive: boolean): Promise<Res> {
  try {
    await requirePermission(RESOURCE, 'can_activate_inactivate')
    if (!id) throw new Error('ID inválido.')
    const { error } = await admin.from('propostas_situacoes').update({ is_active: isActive }).eq('id', id)
    if (error) throw error
    revalidatePath(PATH)
    return { success: true }
  } catch (err) {
    return { success: false, error: msg(err) }
  }
}

export async function salvarConfigEsteira(input: ConfigInput): Promise<Res> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const v = normalizarConfig(input)
    if (!v.ok) throw new Error(v.error)
    const { error } = await admin.from('propostas_esteira_config').update(v.value).eq('id', true)
    if (error) throw error
    revalidatePath(PATH)
    return { success: true }
  } catch (err) {
    return { success: false, error: msg(err) }
  }
}
