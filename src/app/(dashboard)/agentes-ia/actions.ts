/* eslint-disable @typescript-eslint/no-explicit-any -- mesmo padrão das actions vizinhas (linhas do Supabase sem tipo gerado) */
'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'
import { validarPerfil, type PerfilQualificacao } from '@/lib/ia/perfis'

const RESOURCE = 'comercial-agentes-ia'
type Resultado<T = object> = ({ success: true } & T) | { success: false; error: string }

export type VersaoPerfil = { versao: number; perfil: PerfilQualificacao; autor: string | null; created_at: string }
export type SecaoConhecimento = { chave: string; titulo: string; conteudo_md: string; ordem: number; ativo: boolean; versao: number }

async function nomesDe(admin: Awaited<ReturnType<typeof createAdminClient>>, ids: (string | null)[]) {
  const unicos = Array.from(new Set(ids.filter(Boolean))) as string[]
  const { data } = unicos.length ? await admin.from('users').select('id,name').in('id', unicos) : { data: [] as any[] }
  return new Map((data || []).map((u: any) => [u.id, u.name as string]))
}

export async function listarVersoesPerfil(tipo: string): Promise<Resultado<{ versoes: VersaoPerfil[] }>> {
  try {
    await requirePermission(RESOURCE, 'can_view')
    const admin = await createAdminClient()
    const { data, error } = await admin.from('ia_agente_perfis_padrao_versoes').select('*').eq('tipo', tipo).order('versao', { ascending: false }).limit(30)
    if (error) throw error
    const nome = await nomesDe(admin, (data || []).map((v: any) => v.updated_by))
    return { success: true, versoes: (data || []).map((v: any) => ({ versao: v.versao, perfil: v.perfil, autor: nome.get(v.updated_by) || null, created_at: v.created_at })) }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

/** Publica o perfil como nova versão (versão atual + 1); falha se alguém publicou antes de você. */
export async function publicarPerfilPadrao(tipo: string, perfil: PerfilQualificacao, versaoBase: number): Promise<Resultado<{ versao: number }>> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const erros = validarPerfil(perfil)
    if (erros.length) throw new Error(erros.join('\n'))
    const admin = await createAdminClient()
    const { data: atual, error: eAtual } = await admin.from('ia_agente_perfis_padrao').select('versao').eq('tipo', tipo).maybeSingle()
    if (eAtual) throw eAtual
    if (!atual) throw new Error('Tipo de agente desconhecido.')
    if (atual.versao !== versaoBase) throw new Error(`Outra pessoa publicou a versão ${atual.versao} enquanto você editava. Recarregue a página.`)
    const versao = atual.versao + 1
    const { data: ok, error } = await admin.from('ia_agente_perfis_padrao').update({ perfil, versao, updated_by: user.id }).eq('tipo', tipo).eq('versao', atual.versao).select('versao')
    if (error) throw error
    if (!ok?.length) throw new Error('Outra pessoa publicou ao mesmo tempo. Recarregue a página.')
    const { error: vErr } = await admin.from('ia_agente_perfis_padrao_versoes').insert({ tipo, versao, perfil, updated_by: user.id })
    if (vErr) throw vErr
    revalidatePath(`/agentes-ia/perfis/${tipo}`)
    return { success: true, versao }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

/** Restaurar = publicar de novo o conteúdo de uma versão antiga (vira versão nova; histórico imutável). */
export async function restaurarVersaoPerfil(tipo: string, versaoAntiga: number, versaoBase: number): Promise<Resultado<{ versao: number }>> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()
    const { data, error } = await admin.from('ia_agente_perfis_padrao_versoes').select('perfil').eq('tipo', tipo).eq('versao', versaoAntiga).maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Versão não encontrada.')
    return await publicarPerfilPadrao(tipo, data.perfil, versaoBase)
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function salvarSecaoConhecimento(input: { chave: string; titulo: string; conteudo_md: string; ordem: number; ativo: boolean }, nova: boolean): Promise<Resultado> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const chave = input.chave.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(chave)) throw new Error('Chave inválida: use letras minúsculas, números e hífen.')
    if (!input.titulo.trim()) throw new Error('Título é obrigatório.')
    const admin = await createAdminClient()
    const { data: atual } = await admin.from('ia_conhecimento_geral').select('versao').eq('chave', chave).maybeSingle()
    if (nova && atual) throw new Error('Já existe uma seção com essa chave.')
    const { error } = await admin.from('ia_conhecimento_geral').upsert(
      { chave, titulo: input.titulo.trim(), conteudo_md: input.conteudo_md, ordem: Math.trunc(Number(input.ordem) || 0), ativo: !!input.ativo, versao: (atual?.versao || 0) + 1, updated_by: user.id },
      { onConflict: 'chave' },
    )
    if (error) throw error
    revalidatePath('/agentes-ia/conhecimento')
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function excluirSecaoConhecimento(chave: string): Promise<Resultado> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()
    const { error } = await admin.from('ia_conhecimento_geral').delete().eq('chave', chave)
    if (error) throw error
    revalidatePath('/agentes-ia/conhecimento')
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// Leituras para as páginas (server components) — mesma checagem das actions.
export async function carregarTipos() {
  await requirePermission(RESOURCE, 'can_view')
  const admin = await createAdminClient()
  const [{ data: tipos, error }, { data: padroes }] = await Promise.all([
    admin.from('ia_agente_tipos').select('tipo,nome,descricao,ativo').order('tipo'),
    admin.from('ia_agente_perfis_padrao').select('tipo,versao,updated_at'),
  ])
  if (error) throw error
  const v = new Map((padroes || []).map((p: any) => [p.tipo, p]))
  return (tipos || []).map((t: any) => ({ ...t, versao: v.get(t.tipo)?.versao ?? null, updated_at: v.get(t.tipo)?.updated_at ?? null }))
}

export async function carregarPerfilPadrao(tipo: string) {
  await requirePermission(RESOURCE, 'can_view')
  const admin = await createAdminClient()
  const [{ data: padrao, error }, { data: tipoRow }, { data: bc }] = await Promise.all([
    admin.from('ia_agente_perfis_padrao').select('perfil,versao').eq('tipo', tipo).maybeSingle(),
    admin.from('ia_agente_tipos').select('nome').eq('tipo', tipo).maybeSingle(),
    admin.from('ia_conhecimento_geral').select('titulo,conteudo_md').eq('ativo', true).order('ordem'),
  ])
  if (error) throw error
  if (!padrao || !tipoRow) return null
  return { nome: tipoRow.nome as string, perfil: padrao.perfil as PerfilQualificacao, versao: padrao.versao as number, bc: (bc || []) as { titulo: string; conteudo_md: string }[] }
}

export async function carregarConhecimento(): Promise<SecaoConhecimento[]> {
  await requirePermission(RESOURCE, 'can_view')
  const admin = await createAdminClient()
  const { data, error } = await admin.from('ia_conhecimento_geral').select('chave,titulo,conteudo_md,ordem,ativo,versao').order('ordem')
  if (error) throw error
  return (data || []) as SecaoConhecimento[]
}
