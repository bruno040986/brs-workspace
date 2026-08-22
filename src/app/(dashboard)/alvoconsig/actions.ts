'use server'

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'

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

const PERMISSION_RESOURCE = 'alvoconsig-gestao'

export type FiltrosAlocacao = {
  convenioId?: string
  apenasSemDono?: boolean
  comMargem?: boolean
  comTroco?: boolean
}

function aplicarFiltrosContatos(query: any, filtros: FiltrosAlocacao) {
  let q = query.is('deleted_at', null)
  if (filtros.convenioId) q = q.eq('convenio_id', filtros.convenioId)
  if (filtros.apenasSemDono) q = q.is('agente_parceiro_id', null)
  if (filtros.comMargem) q = q.or('margem_novo.gt.0,margem_cartao_rmc.gt.0,margem_cartao_rcc.gt.0')
  if (filtros.comTroco) q = q.gt('refin_troco', 0)
  return q
}

// ----------------------------------------------------------------------------
// Visão geral
// ----------------------------------------------------------------------------
export async function getAlvoconsigResumo() {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const [total, semDono, comDono, habilitados, imports] = await Promise.all([
      supabaseAdmin.from('crm_contatos').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      supabaseAdmin.from('crm_contatos').select('id', { count: 'exact', head: true }).is('deleted_at', null).is('agente_parceiro_id', null),
      supabaseAdmin.from('crm_contatos').select('id', { count: 'exact', head: true }).is('deleted_at', null).not('agente_parceiro_id', 'is', null),
      supabaseAdmin.from('crm_parceiro_config').select('agente_parceiro_id', { count: 'exact', head: true }).eq('habilitado', true),
      supabaseAdmin
        .from('crm_imports')
        .select('id, tipo, arquivo_nome, total_linhas, importadas, descartadas, status, created_at')
        .order('created_at', { ascending: false })
        .limit(5),
    ])

    return {
      success: true,
      resumo: {
        totalContatos: total.count || 0,
        semDono: semDono.count || 0,
        comDono: comDono.count || 0,
        parceirosHabilitados: habilitados.count || 0,
        importsRecentes: imports.data || [],
      },
    }
  } catch (error: any) {
    console.error('Erro ao carregar resumo AlvoConsig:', error)
    return { success: false, error: error.message }
  }
}

// ----------------------------------------------------------------------------
// Importações
// ----------------------------------------------------------------------------
export async function getImports() {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const { data, error } = await supabaseAdmin
      .from('crm_imports')
      .select('id, tipo, arquivo_nome, total_linhas, importadas, descartadas, status, erro, created_at, concluido_em, convenios ( id, nome )')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    console.error('Erro ao listar importações:', error)
    return { success: false, error: error.message }
  }
}

export async function getConveniosAtivos() {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const { data, error } = await supabaseAdmin
      .from('convenios')
      .select('id, nome, codigo')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('nome', { ascending: true })
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

// ----------------------------------------------------------------------------
// Parceiros habilitados (para alocação)
// ----------------------------------------------------------------------------
export async function getParceirosHabilitados() {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const { data, error } = await supabaseAdmin
      .from('crm_parceiro_config')
      .select('agente_parceiro_id, habilitado, max_atendentes, agentes_parceiros ( id, name, fantasy_name, cpf_cnpj )')
      .eq('habilitado', true)
    if (error) throw error

    const items = (data || []).map((row: any) => ({
      agenteParceiroId: String(row.agente_parceiro_id),
      nome: String(row.agentes_parceiros?.fantasy_name || row.agentes_parceiros?.name || 'Parceiro'),
      cpfCnpj: String(row.agentes_parceiros?.cpf_cnpj || ''),
    }))
    return { success: true, items }
  } catch (error: any) {
    console.error('Erro ao listar parceiros habilitados:', error)
    return { success: false, error: error.message }
  }
}

// ----------------------------------------------------------------------------
// Alocação de lotes
// ----------------------------------------------------------------------------
export async function contarContatosParaAlocacao(filtros: FiltrosAlocacao) {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const { count, error } = await aplicarFiltrosContatos(
      supabaseAdmin.from('crm_contatos').select('id', { count: 'exact', head: true }),
      { ...filtros, apenasSemDono: true },
    )
    if (error) throw error
    return { success: true, disponiveis: count || 0 }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function criarLote(payload: {
  agenteParceiroId: string
  quantidade: number
  descricao?: string
  filtros: FiltrosAlocacao
}) {
  try {
    const { user } = await requirePermission(PERMISSION_RESOURCE, 'can_include')

    if (!payload.agenteParceiroId) return { success: false, error: 'Selecione o parceiro.' }
    const quantidade = Number.parseInt(String(payload.quantidade), 10)
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      return { success: false, error: 'Informe a quantidade de contatos a liberar.' }
    }
    if (quantidade > 50_000) {
      return { success: false, error: 'Máximo de 50.000 contatos por lote.' }
    }

    // Seleciona os contatos disponíveis (sem dono) mais antigos primeiro.
    const { data: contatos, error: selectError } = await aplicarFiltrosContatos(
      supabaseAdmin.from('crm_contatos').select('id'),
      { ...payload.filtros, apenasSemDono: true },
    )
      .order('created_at', { ascending: true })
      .limit(quantidade)
    if (selectError) throw selectError

    const ids = (contatos || []).map((row: any) => String(row.id))
    if (!ids.length) {
      return { success: false, error: 'Nenhum contato disponível com esses filtros.' }
    }

    const { data: lote, error: loteError } = await supabaseAdmin
      .from('crm_lotes_alocacao')
      .insert({
        agente_parceiro_id: payload.agenteParceiroId,
        descricao: String(payload.descricao || '').trim(),
        filtros: payload.filtros,
        qtd_contatos: ids.length,
        liberado_por: user.id,
      })
      .select('id')
      .single()
    if (loteError || !lote) throw loteError || new Error('Falha ao criar o lote.')

    // Marca o dono nos contatos, em chunks (limite de tamanho do IN).
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500)
      const { error: updateError } = await supabaseAdmin
        .from('crm_contatos')
        .update({
          agente_parceiro_id: payload.agenteParceiroId,
          lote_id: lote.id,
          atendente_id: null,
          updated_at: new Date().toISOString(),
        })
        .in('id', chunk)
        .is('agente_parceiro_id', null)
      if (updateError) throw updateError
    }

    revalidatePath('/alvoconsig/alocacao')
    return { success: true, loteId: lote.id, alocados: ids.length }
  } catch (error: any) {
    console.error('Erro ao criar lote de alocação:', error)
    return { success: false, error: error.message }
  }
}

export async function getLotes() {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const { data, error } = await supabaseAdmin
      .from('crm_lotes_alocacao')
      .select('id, agente_parceiro_id, descricao, qtd_contatos, liberado_em, revogado_em, observacao, agentes_parceiros ( id, name, fantasy_name )')
      .order('liberado_em', { ascending: false })
      .limit(100)
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    console.error('Erro ao listar lotes:', error)
    return { success: false, error: error.message }
  }
}

export async function revogarLote(loteId: string) {
  try {
    const { user } = await requirePermission(PERMISSION_RESOURCE, 'can_edit')
    if (!loteId) return { success: false, error: 'Lote inválido.' }

    const { data: lote, error: loteError } = await supabaseAdmin
      .from('crm_lotes_alocacao')
      .select('id, agente_parceiro_id, revogado_em')
      .eq('id', loteId)
      .maybeSingle()
    if (loteError) throw loteError
    if (!lote) return { success: false, error: 'Lote não encontrado.' }
    if (lote.revogado_em) return { success: false, error: 'Lote já revogado.' }

    // O dono anterior perde o acesso; o histórico de tabulações permanece.
    const { error: contatosError } = await supabaseAdmin
      .from('crm_contatos')
      .update({
        agente_parceiro_id: null,
        atendente_id: null,
        lote_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('lote_id', loteId)
    if (contatosError) throw contatosError

    const { error: updateError } = await supabaseAdmin
      .from('crm_lotes_alocacao')
      .update({ revogado_em: new Date().toISOString(), revogado_por: user.id })
      .eq('id', loteId)
    if (updateError) throw updateError

    revalidatePath('/alvoconsig/alocacao')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao revogar lote:', error)
    return { success: false, error: error.message }
  }
}

// ----------------------------------------------------------------------------
// Contatos (visão global)
// ----------------------------------------------------------------------------
export async function getContatosGlobal(params: {
  busca?: string
  convenioId?: string
  dono?: 'todos' | 'sem-dono' | 'com-dono'
  pagina?: number
}) {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const pagina = Math.max(1, Number.parseInt(String(params.pagina || 1), 10) || 1)
    const porPagina = 50

    let query = supabaseAdmin
      .from('crm_contatos')
      .select(
        'id, cpf, nome, telefone, margem_novo, margem_cartao_rmc, margem_cartao_rcc, refin_troco, funil_estagio, agente_parceiro_id, convenios ( id, nome ), agentes_parceiros ( id, name, fantasy_name )',
        { count: 'exact' },
      )
      .is('deleted_at', null)

    if (params.convenioId) query = query.eq('convenio_id', params.convenioId)
    if (params.dono === 'sem-dono') query = query.is('agente_parceiro_id', null)
    if (params.dono === 'com-dono') query = query.not('agente_parceiro_id', 'is', null)

    const busca = String(params.busca || '').trim()
    if (busca) {
      const digits = busca.replace(/\D/g, '')
      if (digits.length >= 4) {
        query = query.or(`cpf.ilike.%${digits}%,telefone.ilike.%${digits}%,nome.ilike.%${busca}%`)
      } else {
        query = query.ilike('nome', `%${busca}%`)
      }
    }

    const from = (pagina - 1) * porPagina
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, from + porPagina - 1)
    if (error) throw error

    return { success: true, items: data || [], total: count || 0, pagina, porPagina }
  } catch (error: any) {
    console.error('Erro ao listar contatos:', error)
    return { success: false, error: error.message }
  }
}
