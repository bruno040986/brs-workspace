'use server'

/**
 * Convênio — Base de Conhecimento, Fase 2 (FAQ em duas visões).
 * Spec: docs/SPEC-CONVENIO-BASE-CONHECIMENTO.md §2.10–2.11.
 *
 * Escopo `geral`: FAQ dona de uma entidade (Instituição Financeira, Forma de
 * Contrato ou Averbadora) — vale para qualquer convênio que a importar.
 * Escopo `convenio`: FAQ própria do convênio, com contexto opcional (a
 * exceção — "essa regra vale só aqui, mesmo sendo sobre essa IF").
 * Importação é sempre por seleção manual (convenio_faq_vinculos), nunca
 * automática ao vincular uma entidade.
 */

import { revalidatePath } from 'next/cache'
import { requireCurrentUser, requirePermission } from '@/lib/auth/server'
import { admin } from './supabase-admin'

export type FaqEscopo = 'geral' | 'convenio'
export type FaqEntidadeTipo = 'instituicao_financeira' | 'forma_contrato' | 'averbadora'
export type FaqStatus = 'rascunho' | 'ativo' | 'arquivado'

export type FaqItem = {
  id: string
  escopo: FaqEscopo
  convenio_id: string | null
  entidade_tipo: FaqEntidadeTipo | null
  entidade_id: string | null
  contexto_nome?: string | null
  categoria: string | null
  pergunta: string
  resposta: string
  ordem: number
  origem: 'manual' | 'ia'
  documento_id: string | null
  status: FaqStatus
  usos?: number
}

export type FaqGrupoGeral = {
  entidade_tipo: FaqEntidadeTipo
  entidade_id: string
  nome: string
  itens: (FaqItem & { vinculada: boolean })[]
}

const FAQ_SELECT = 'id, escopo, convenio_id, entidade_tipo, entidade_id, categoria, pergunta, resposta, ordem, origem, documento_id, status'

// Cada visão de FAQ é protegida pela permissão de quem "é dona" dela: FAQ do
// convênio → workspace-convenios; FAQ geral → a permissão do cadastro da
// entidade dona (IF/Forma/Averbadora).
function permissaoFaq(escopo: FaqEscopo, entidadeTipo?: FaqEntidadeTipo | null): string {
  if (escopo === 'convenio') return 'workspace-convenios'
  switch (entidadeTipo) {
    case 'instituicao_financeira':
      return 'sistema-config-instituicoes'
    case 'forma_contrato':
      return 'sistema-config-credito'
    case 'averbadora':
      return 'workspace-averbadoras'
    default:
      return 'workspace-convenios'
  }
}

async function resolverNomesEntidades(ids: { tipo: FaqEntidadeTipo; id: string }[]): Promise<Map<string, string>> {
  const porTipo: Record<FaqEntidadeTipo, Set<string>> = {
    instituicao_financeira: new Set(),
    forma_contrato: new Set(),
    averbadora: new Set(),
  }
  for (const item of ids) porTipo[item.tipo].add(item.id)

  const nomeMap = new Map<string, string>()
  const [ifRes, formaRes, averbRes] = await Promise.all([
    porTipo.instituicao_financeira.size
      ? admin.from('financial_institutions').select('id, name').in('id', [...porTipo.instituicao_financeira])
      : Promise.resolve({ data: [] as any[] }),
    porTipo.forma_contrato.size
      ? admin.from('formas_contrato').select('id, nome').in('id', [...porTipo.forma_contrato])
      : Promise.resolve({ data: [] as any[] }),
    porTipo.averbadora.size
      ? admin.from('averbadoras').select('id, nome').in('id', [...porTipo.averbadora])
      : Promise.resolve({ data: [] as any[] }),
  ])
  for (const r of ifRes.data || []) nomeMap.set(r.id, r.name)
  for (const r of formaRes.data || []) nomeMap.set(r.id, r.nome)
  for (const r of averbRes.data || []) nomeMap.set(r.id, r.nome)
  return nomeMap
}

async function contarUsos(faqIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (faqIds.length === 0) return map
  const { data } = await admin.from('convenio_faq_vinculos').select('faq_item_id').in('faq_item_id', faqIds)
  for (const row of data || []) map.set(row.faq_item_id, (map.get(row.faq_item_id) || 0) + 1)
  return map
}

// ---------------------------------------------------------------------------
// FAQ geral (na entidade)
// ---------------------------------------------------------------------------
export async function getFaqGeral(
  entidadeTipo: FaqEntidadeTipo,
  entidadeId: string,
): Promise<{ success: boolean; items?: FaqItem[]; error?: string }> {
  try {
    await requirePermission(permissaoFaq('geral', entidadeTipo))
    if (!entidadeId) return { success: false, error: 'ID inválido.' }

    const { data, error } = await admin
      .from('faq_itens')
      .select(FAQ_SELECT)
      .eq('escopo', 'geral')
      .eq('entidade_tipo', entidadeTipo)
      .eq('entidade_id', entidadeId)
      .order('status', { ascending: true })
      .order('ordem', { ascending: true })
    if (error) throw error

    const ids = (data || []).map((r: any) => r.id)
    const usosPorId = await contarUsos(ids)
    const items: FaqItem[] = (data || []).map((r: any) => ({ ...r, usos: usosPorId.get(r.id) || 0 }))
    return { success: true, items }
  } catch (error: any) {
    console.error('Erro ao buscar FAQ geral:', error)
    return { success: false, error: error.message }
  }
}

// ---------------------------------------------------------------------------
// FAQ do convênio — próprias + vinculadas (gerais importadas)
// ---------------------------------------------------------------------------
export async function getFaqConvenio(
  convenioId: string,
): Promise<{ success: boolean; proprias?: FaqItem[]; vinculadas?: FaqItem[]; error?: string }> {
  try {
    await requirePermission('workspace-convenios')
    if (!convenioId) return { success: false, error: 'ID de convênio inválido.' }

    const [{ data: propriasRaw, error: e1 }, { data: vinculosRaw, error: e2 }] = await Promise.all([
      admin
        .from('faq_itens')
        .select(FAQ_SELECT)
        .eq('escopo', 'convenio')
        .eq('convenio_id', convenioId)
        .order('status', { ascending: true })
        .order('ordem', { ascending: true }),
      admin.from('convenio_faq_vinculos').select(`faq_item_id, faq:faq_item_id(${FAQ_SELECT})`).eq('convenio_id', convenioId),
    ])
    if (e1) throw e1
    if (e2) throw e2

    const proprias = (propriasRaw || []) as any[]
    const vinculadas = (vinculosRaw || []).map((v: any) => v.faq).filter(Boolean)

    const entidades = [...proprias, ...vinculadas]
      .filter((r: any) => r.entidade_tipo && r.entidade_id)
      .map((r: any) => ({ tipo: r.entidade_tipo as FaqEntidadeTipo, id: r.entidade_id as string }))
    const nomeMap = await resolverNomesEntidades(entidades)

    const comContexto = (rows: any[]): FaqItem[] =>
      rows.map((r) => ({ ...r, contexto_nome: r.entidade_id ? nomeMap.get(r.entidade_id) || null : null }))

    return { success: true, proprias: comContexto(proprias), vinculadas: comContexto(vinculadas) }
  } catch (error: any) {
    console.error('Erro ao buscar FAQ do convênio:', error)
    return { success: false, error: error.message }
  }
}

// FAQs gerais ATIVAS das entidades ligadas ao convênio (averbadora, IFs
// vinculadas, formas permitidas) — usadas pelo painel "Importar FAQ geral".
export async function getFaqGeraisDisponiveis(convenioId: string): Promise<{ success: boolean; grupos?: FaqGrupoGeral[]; error?: string }> {
  try {
    await requirePermission('workspace-convenios')
    if (!convenioId) return { success: false, error: 'ID de convênio inválido.' }

    const [{ data: convenioRow }, { data: instRows }, { data: formaRows }, { data: vinculosRow }] = await Promise.all([
      admin.from('convenios').select('averbadora_id').eq('id', convenioId).maybeSingle(),
      admin.from('convenio_instituicoes').select('financial_institution_id').eq('convenio_id', convenioId),
      admin.from('convenio_formas_contrato').select('forma_contrato_id').eq('convenio_id', convenioId),
      admin.from('convenio_faq_vinculos').select('faq_item_id').eq('convenio_id', convenioId),
    ])

    const vinculadas = new Set((vinculosRow || []).map((v: any) => v.faq_item_id))

    const entidades: { tipo: FaqEntidadeTipo; id: string }[] = []
    if (convenioRow?.averbadora_id) entidades.push({ tipo: 'averbadora', id: convenioRow.averbadora_id })
    for (const r of instRows || []) entidades.push({ tipo: 'instituicao_financeira', id: r.financial_institution_id })
    for (const r of formaRows || []) entidades.push({ tipo: 'forma_contrato', id: r.forma_contrato_id })

    if (entidades.length === 0) return { success: true, grupos: [] }

    const idsUnicos = [...new Set(entidades.map((e) => e.id))]
    const [faqRes, nomeMap] = await Promise.all([
      admin.from('faq_itens').select(FAQ_SELECT).eq('escopo', 'geral').eq('status', 'ativo').in('entidade_id', idsUnicos),
      resolverNomesEntidades(entidades),
    ])
    if (faqRes.error) throw faqRes.error

    const grupos: FaqGrupoGeral[] = entidades
      .map((e) => ({
        entidade_tipo: e.tipo,
        entidade_id: e.id,
        nome: nomeMap.get(e.id) || '(sem nome)',
        itens: (faqRes.data || [])
          .filter((f: any) => f.entidade_tipo === e.tipo && f.entidade_id === e.id)
          .map((f: any) => ({ ...f, vinculada: vinculadas.has(f.id) })),
      }))
      .filter((g) => g.itens.length > 0)

    return { success: true, grupos }
  } catch (error: any) {
    console.error('Erro ao buscar FAQ gerais disponíveis:', error)
    return { success: false, error: error.message }
  }
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------
export type SalvarFaqInput = {
  id?: string
  escopo: FaqEscopo
  convenio_id?: string | null
  entidade_tipo?: FaqEntidadeTipo | null
  entidade_id?: string | null
  categoria?: string | null
  pergunta: string
  resposta: string
  ordem?: number
}

export async function salvarFaq(input: SalvarFaqInput): Promise<{ success: boolean; error?: string; id?: string }> {
  try {
    // Na edição, escopo e entidade dona vêm do REGISTRO GRAVADO — nunca do
    // cliente (senão daria pra editar FAQ de IF alegando permissão de averbadora).
    let escopo = input.escopo
    let entidadeDona: FaqEntidadeTipo | null = input.entidade_tipo || null
    if (input.id) {
      await requireCurrentUser()
      const { data: atual } = await admin.from('faq_itens').select('escopo, entidade_tipo, convenio_id').eq('id', input.id).maybeSingle()
      if (!atual) return { success: false, error: 'FAQ não encontrada.' }
      escopo = atual.escopo
      entidadeDona = atual.escopo === 'geral' ? atual.entidade_tipo : null
      if (escopo === 'convenio' && input.convenio_id && input.convenio_id !== atual.convenio_id) {
        return { success: false, error: 'FAQ não pertence a este convênio.' }
      }
      if (escopo === 'convenio') input.convenio_id = atual.convenio_id
    }
    const { user } = await requirePermission(permissaoFaq(escopo, entidadeDona), input.id ? 'can_edit' : 'can_include')
    input = { ...input, escopo }

    const pergunta = String(input.pergunta || '').trim()
    const resposta = String(input.resposta || '').trim()
    if (!pergunta) return { success: false, error: 'Informe a pergunta.' }
    if (!resposta) return { success: false, error: 'Informe a resposta.' }

    if (input.escopo === 'geral') {
      if (!input.entidade_tipo || !input.entidade_id) return { success: false, error: 'Selecione a entidade dona desta FAQ.' }
    } else if (!input.convenio_id) {
      return { success: false, error: 'ID de convênio inválido.' }
    }

    const row: Record<string, any> = {
      categoria: String(input.categoria || '').trim() || null,
      pergunta,
      resposta,
      ordem: input.ordem ?? 0,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }
    // entidade_tipo/entidade_id e convenio_id não mudam em edição — o escopo é
    // imutável (trigger no banco) e é a entidade/convênio que "é dona" da FAQ.
    if (!input.id) {
      row.escopo = input.escopo
      row.convenio_id = input.escopo === 'convenio' ? input.convenio_id : null
      row.entidade_tipo = input.entidade_tipo || null
      row.entidade_id = input.entidade_id || null
      row.origem = 'manual'
      row.created_by = user.id
    } else if (input.escopo === 'convenio') {
      // no escopo convênio o contexto (entidade) PODE ser alterado a cada edição
      row.entidade_tipo = input.entidade_tipo || null
      row.entidade_id = input.entidade_id || null
    }

    if (input.id) {
      const { error } = await admin.from('faq_itens').update(row).eq('id', input.id)
      if (error) throw error
      if (input.escopo === 'convenio' && input.convenio_id) revalidatePath(`/convenios/${input.convenio_id}`)
      revalidatePath('/convenios')
      return { success: true, id: input.id }
    }

    const { data, error } = await admin.from('faq_itens').insert(row).select('id').single()
    if (error) throw error
    if (input.escopo === 'convenio' && input.convenio_id) revalidatePath(`/convenios/${input.convenio_id}`)
    revalidatePath('/convenios')
    return { success: true, id: data?.id }
  } catch (error: any) {
    console.error('Erro ao salvar FAQ:', error)
    return { success: false, error: error.message }
  }
}

export async function setFaqStatus(id: string, status: 'ativo' | 'arquivado'): Promise<{ success: boolean; error?: string }> {
  try {
    await requireCurrentUser()
    const { data: current, error: fetchErr } = await admin.from('faq_itens').select('escopo, entidade_tipo, convenio_id').eq('id', id).maybeSingle()
    if (fetchErr) throw fetchErr
    if (!current) return { success: false, error: 'FAQ não encontrada.' }

    await requirePermission(permissaoFaq(current.escopo, current.entidade_tipo), 'can_activate_inactivate')

    const { error } = await admin.from('faq_itens').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    if (current.convenio_id) revalidatePath(`/convenios/${current.convenio_id}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alterar status da FAQ:', error)
    return { success: false, error: error.message }
  }
}

export async function excluirFaq(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requireCurrentUser()
    const { data: current } = await admin.from('faq_itens').select('escopo, entidade_tipo, convenio_id').eq('id', id).maybeSingle()
    if (!current) return { success: false, error: 'FAQ não encontrada.' }

    await requirePermission(permissaoFaq(current.escopo, current.entidade_tipo), 'can_delete')

    const { error } = await admin.from('faq_itens').delete().eq('id', id)
    if (error) throw error
    if (current.convenio_id) revalidatePath(`/convenios/${current.convenio_id}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao excluir FAQ:', error)
    return { success: false, error: error.message }
  }
}

// ---------------------------------------------------------------------------
// Importação (vínculo) de FAQ geral no convênio
// ---------------------------------------------------------------------------
export async function vincularFaq(convenioId: string, faqItemIds: string[]): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermission('workspace-convenios', 'can_edit')
    if (!convenioId) return { success: false, error: 'ID de convênio inválido.' }
    if (!Array.isArray(faqItemIds) || faqItemIds.length === 0) return { success: true }

    const rows = faqItemIds.map((faq_item_id) => ({ convenio_id: convenioId, faq_item_id, created_by: user.id }))
    const { error } = await admin.from('convenio_faq_vinculos').upsert(rows, { onConflict: 'convenio_id,faq_item_id', ignoreDuplicates: true })
    if (error) throw error

    revalidatePath(`/convenios/${convenioId}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao importar FAQ geral:', error)
    return { success: false, error: error.message }
  }
}

export async function desvincularFaq(convenioId: string, faqItemId: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission('workspace-convenios', 'can_edit')
    const { error } = await admin.from('convenio_faq_vinculos').delete().eq('convenio_id', convenioId).eq('faq_item_id', faqItemId)
    if (error) throw error
    revalidatePath(`/convenios/${convenioId}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao remover FAQ importada:', error)
    return { success: false, error: error.message }
  }
}

// Só leitura de texto livre já usado (datalist) — sem dado sensível, exige
// apenas usuário autenticado (não amarra a um recurso específico).
export async function getFaqCategoriasSugestoes(): Promise<string[]> {
  try {
    await requireCurrentUser()
    const { data } = await admin.from('faq_itens').select('categoria').not('categoria', 'is', null)
    return [...new Set((data || []).map((r: any) => String(r.categoria || '').trim()).filter(Boolean))].sort()
  } catch {
    return []
  }
}
