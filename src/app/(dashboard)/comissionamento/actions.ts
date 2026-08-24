'use server'

/**
 * Server actions do Comissionamento (espelho ARW): Formas de Contrato, Tipos
 * de Formalização, Tabelas de Comissão, Prazos Comissão e Spreads.
 * Permissão: sistema-config-credito.
 */

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { ORIGENS_MARGEM } from '@/lib/comissionamento'

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

const PERMISSION_RESOURCE = 'sistema-config-credito'

const REVALIDATE_BASE = '/comissionamento'

// ----------------------------------------------------------------------------
// Lookups compartilhados
// ----------------------------------------------------------------------------
export async function getComissionamentoLookups() {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const [instituicoes, formas, formalizacoes, convenios, tiposAgente, tabelas, promotoras] = await Promise.all([
      supabaseAdmin
        .from('financial_institutions')
        .select('id, name, logo_url, is_active, imposto_comissao_percent')
        .is('deleted_at', null)
        .order('is_active', { ascending: false })
        .order('name'),
      supabaseAdmin.from('formas_contrato').select('*').order('is_active', { ascending: false }).order('nome'),
      supabaseAdmin.from('tipos_formalizacao').select('*').order('is_active', { ascending: false }).order('nome'),
      supabaseAdmin.from('convenios').select('id, nome, codigo, is_active').is('deleted_at', null).order('nome'),
      supabaseAdmin
        .from('agente_corban_tipos_agente')
        .select('id, name, codigo_arw, percentual_repasse')
        .order('codigo_arw', { ascending: true, nullsFirst: false }),
      supabaseAdmin
        .from('tabelas_comissao')
        .select('id, codigo, nome, codigo_tabela_banco, institution_id, forma_contrato_id, convenio_id, tipo_formalizacao_id, promotora_id, com_seguro, is_active')
        .is('deleted_at', null)
        .order('is_active', { ascending: false })
        .order('nome'),
      supabaseAdmin
        .from('promotoras')
        .select('id, razao_social, nome_fantasia, is_active')
        .order('is_active', { ascending: false })
        .order('razao_social'),
    ])

    const firstError = [instituicoes, formas, formalizacoes, convenios, tiposAgente, tabelas, promotoras].find((r) => r.error)
    if (firstError?.error) throw firstError.error

    return {
      success: true,
      instituicoes: instituicoes.data || [],
      formasContrato: formas.data || [],
      tiposFormalizacao: formalizacoes.data || [],
      convenios: convenios.data || [],
      tiposAgente: tiposAgente.data || [],
      tabelasComissao: tabelas.data || [],
      promotoras: (promotoras.data || []).map((row: any) => ({
        id: String(row.id),
        nome: String(row.nome_fantasia || '').trim() || String(row.razao_social || '').trim(),
        is_active: row.is_active !== false,
      })),
    }
  } catch (error: any) {
    console.error('Erro nos lookups do comissionamento:', error)
    return { success: false, error: error.message }
  }
}

// ----------------------------------------------------------------------------
// Catálogos simples (Forma de Contrato / Tipo de Formalização)
// ----------------------------------------------------------------------------
export async function saveFormaContrato(payload: {
  id?: string
  nome: string
  codigo_arw?: string | null
  origem_margem: string
}) {
  try {
    await requirePermission(PERMISSION_RESOURCE, payload.id ? 'can_edit' : 'can_include')
    const nome = String(payload.nome || '').trim()
    if (!nome) return { success: false, error: 'Informe o nome da forma de contrato.' }
    const origem = ORIGENS_MARGEM.some((o) => o.value === payload.origem_margem)
      ? payload.origem_margem
      : 'nenhuma'

    const row = {
      nome,
      codigo_arw: String(payload.codigo_arw || '').trim() || null,
      origem_margem: origem,
      updated_at: new Date().toISOString(),
    }
    const query = payload.id
      ? supabaseAdmin.from('formas_contrato').update(row).eq('id', payload.id)
      : supabaseAdmin.from('formas_contrato').insert(row)
    const { error } = await query
    if (error) throw error

    revalidatePath(`${REVALIDATE_BASE}/formas-contrato`)
    return { success: true }
  } catch (error: any) {
    if ((error as any)?.code === '23505') return { success: false, error: 'Já existe uma forma de contrato com esse nome.' }
    console.error('Erro ao salvar forma de contrato:', error)
    return { success: false, error: error.message }
  }
}

export async function setFormaContratoAtiva(id: string, isActive: boolean) {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_activate_inactivate')
    const { error } = await supabaseAdmin
      .from('formas_contrato')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    revalidatePath(`${REVALIDATE_BASE}/formas-contrato`)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function saveTipoFormalizacao(payload: { id?: string; nome: string; codigo_arw?: string | null }) {
  try {
    await requirePermission(PERMISSION_RESOURCE, payload.id ? 'can_edit' : 'can_include')
    const nome = String(payload.nome || '').trim()
    if (!nome) return { success: false, error: 'Informe o nome do tipo de formalização.' }

    const row = {
      nome,
      codigo_arw: String(payload.codigo_arw || '').trim() || null,
      updated_at: new Date().toISOString(),
    }
    const query = payload.id
      ? supabaseAdmin.from('tipos_formalizacao').update(row).eq('id', payload.id)
      : supabaseAdmin.from('tipos_formalizacao').insert(row)
    const { error } = await query
    if (error) throw error

    revalidatePath(`${REVALIDATE_BASE}/tipos-formalizacao`)
    return { success: true }
  } catch (error: any) {
    if ((error as any)?.code === '23505') return { success: false, error: 'Já existe um tipo de formalização com esse nome.' }
    console.error('Erro ao salvar tipo de formalização:', error)
    return { success: false, error: error.message }
  }
}

export async function setTipoFormalizacaoAtivo(id: string, isActive: boolean) {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_activate_inactivate')
    const { error } = await supabaseAdmin
      .from('tipos_formalizacao')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    revalidatePath(`${REVALIDATE_BASE}/tipos-formalizacao`)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

// ----------------------------------------------------------------------------
// Tipo de Agente (cadastro do Agente Corban, estendido) e Imposto por IF
// ----------------------------------------------------------------------------
export async function saveTipoAgenteComissao(payload: {
  id: string
  percentual_repasse: number | null
  codigo_arw: number | null
}) {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_edit')
    if (!payload.id) return { success: false, error: 'Tipo de agente inválido.' }
    const { error } = await supabaseAdmin
      .from('agente_corban_tipos_agente')
      .update({
        percentual_repasse: payload.percentual_repasse,
        codigo_arw: payload.codigo_arw,
      })
      .eq('id', payload.id)
    if (error) throw error
    revalidatePath(`${REVALIDATE_BASE}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar tipo de agente:', error)
    return { success: false, error: error.message }
  }
}

export async function saveImpostoInstituicao(institutionId: string, impostoPercent: number | null) {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_edit')
    if (!institutionId) return { success: false, error: 'Instituição inválida.' }
    const { error } = await supabaseAdmin
      .from('financial_institutions')
      .update({ imposto_comissao_percent: impostoPercent, updated_at: new Date().toISOString() })
      .eq('id', institutionId)
    if (error) throw error
    revalidatePath(`${REVALIDATE_BASE}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar imposto da instituição:', error)
    return { success: false, error: error.message }
  }
}

// ----------------------------------------------------------------------------
// Tabela de Comissão
// ----------------------------------------------------------------------------
export type TabelaComissaoPayload = {
  id?: string
  codigo_tabela_banco?: string | null
  nome: string
  institution_id: string
  forma_contrato_id: string
  convenio_id?: string | null
  tipo_formalizacao_id?: string | null
  /** Promotora do credenciamento subestabelecido; null = direto com a IF. */
  promotora_id?: string | null
  com_seguro?: boolean | null
  observacao?: string
  id_arw?: string | null
  /** Taxa de juros (% a.m.) — não existe no ARW, informação do Workspace. */
  taxa_juros_tipo?: 'fixa' | 'faixa' | null
  taxa_juros?: number | null
  taxa_juros_min?: number | null
  taxa_juros_max?: number | null
}

export async function getTabelasComissao() {
  try {
    await requirePermission(PERMISSION_RESOURCE)
    const { data, error } = await supabaseAdmin
      .from('tabelas_comissao')
      .select(
        '*, financial_institutions ( id, name, logo_url, imposto_comissao_percent ), formas_contrato ( id, nome, origem_margem ), convenios ( id, nome, codigo ), tipos_formalizacao ( id, nome ), promotoras ( id, razao_social, nome_fantasia ), prazos_comissao ( id )',
      )
      .is('deleted_at', null)
      .order('is_active', { ascending: false })
      .order('nome')
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    console.error('Erro ao listar tabelas de comissão:', error)
    return { success: false, error: error.message }
  }
}

export async function saveTabelaComissao(payload: TabelaComissaoPayload) {
  try {
    await requirePermission(PERMISSION_RESOURCE, payload.id ? 'can_edit' : 'can_include')
    const nome = String(payload.nome || '').trim()
    if (!nome) return { success: false, error: 'Informe o nome da tabela.' }
    if (!payload.institution_id) return { success: false, error: 'Selecione a instituição financeira.' }
    if (!payload.forma_contrato_id) return { success: false, error: 'Selecione a forma de contrato.' }

    const tipoJuros = payload.taxa_juros_tipo === 'fixa' || payload.taxa_juros_tipo === 'faixa' ? payload.taxa_juros_tipo : null
    const juros = (valor: number | null | undefined) => {
      const parsed = Number(valor)
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
    }
    const taxaFixa = tipoJuros === 'fixa' ? juros(payload.taxa_juros) : null
    const taxaMin = tipoJuros === 'faixa' ? juros(payload.taxa_juros_min) : null
    const taxaMax = tipoJuros === 'faixa' ? juros(payload.taxa_juros_max) : null
    if (tipoJuros === 'faixa' && taxaMin !== null && taxaMax !== null && taxaMin > taxaMax) {
      return { success: false, error: 'Na taxa por faixa, o mínimo deve ser menor ou igual ao máximo.' }
    }

    const row = {
      codigo_tabela_banco: String(payload.codigo_tabela_banco || '').trim() || null,
      nome,
      institution_id: payload.institution_id,
      forma_contrato_id: payload.forma_contrato_id,
      convenio_id: payload.convenio_id || null,
      tipo_formalizacao_id: payload.tipo_formalizacao_id || null,
      promotora_id: payload.promotora_id || null,
      com_seguro: payload.com_seguro ?? null,
      observacao: String(payload.observacao || ''),
      id_arw: String(payload.id_arw || '').trim() || null,
      taxa_juros_tipo: tipoJuros,
      taxa_juros: taxaFixa,
      taxa_juros_min: taxaMin,
      taxa_juros_max: taxaMax,
      updated_at: new Date().toISOString(),
    }
    const query = payload.id
      ? supabaseAdmin.from('tabelas_comissao').update(row).eq('id', payload.id)
      : supabaseAdmin.from('tabelas_comissao').insert(row)
    const { error } = await query
    if (error) throw error

    revalidatePath(`${REVALIDATE_BASE}/tabelas`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar tabela de comissão:', error)
    return { success: false, error: error.message }
  }
}

export async function setTabelaComissaoAtiva(id: string, isActive: boolean) {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_activate_inactivate')
    const { error } = await supabaseAdmin
      .from('tabelas_comissao')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    revalidatePath(`${REVALIDATE_BASE}/tabelas`)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

// ----------------------------------------------------------------------------
// Prazo Comissão
// ----------------------------------------------------------------------------
export type PrazoComissaoPayload = {
  id?: string
  tabela_comissao_id: string
  forma_pagamento: string
  valor_inicial?: number | null
  valor_final?: number | null
  prazo_inicial: number
  prazo_final: number
  data_base?: string | null
  manter_enquadramento?: boolean
  comissao?: number | null
  emissao?: number | null
  seguro?: number | null
  forma_pagamento_seguro?: string | null
  data_bloqueio?: string | null
  id_arw?: string | null
}

export async function getPrazosComissao(tabelaComissaoId?: string) {
  try {
    await requirePermission(PERMISSION_RESOURCE)
    let query = supabaseAdmin
      .from('prazos_comissao')
      .select(
        '*, tabelas_comissao ( id, codigo, nome, codigo_tabela_banco, institution_id, forma_contrato_id, convenio_id, tipo_formalizacao_id, promotora_id, com_seguro, taxa_juros_tipo, taxa_juros, taxa_juros_min, taxa_juros_max, observacao, financial_institutions ( id, name, imposto_comissao_percent ), formas_contrato ( id, nome ), convenios ( id, nome ), tipos_formalizacao ( id, nome ), promotoras ( id, razao_social, nome_fantasia ) )',
      )
      .order('created_at', { ascending: false })
      .limit(300)
    if (tabelaComissaoId) query = query.eq('tabela_comissao_id', tabelaComissaoId)
    const { data, error } = await query
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    console.error('Erro ao listar prazos comissão:', error)
    return { success: false, error: error.message }
  }
}

export async function getPrazoComissao(id: string) {
  try {
    await requirePermission(PERMISSION_RESOURCE)
    if (!id) return { success: false, error: 'ID inválido.' }
    const { data, error } = await supabaseAdmin
      .from('prazos_comissao')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) return { success: false, error: 'Prazo comissão não encontrado.' }
    return { success: true, item: data }
  } catch (error: any) {
    console.error('Erro ao buscar prazo comissão:', error)
    return { success: false, error: error.message }
  }
}

export async function savePrazoComissao(payload: PrazoComissaoPayload) {
  try {
    await requirePermission(PERMISSION_RESOURCE, payload.id ? 'can_edit' : 'can_include')
    if (!payload.tabela_comissao_id) return { success: false, error: 'Selecione a Tabela de Comissão.' }

    const prazoInicial = Number.parseInt(String(payload.prazo_inicial), 10)
    const prazoFinal = Number.parseInt(String(payload.prazo_final), 10)
    if (!Number.isFinite(prazoInicial) || prazoInicial <= 0) return { success: false, error: 'Informe o prazo inicial.' }
    if (!Number.isFinite(prazoFinal) || prazoFinal < prazoInicial) {
      return { success: false, error: 'O prazo final deve ser maior ou igual ao inicial.' }
    }

    const usaFaixa = payload.forma_pagamento === 'faixa_percentual' || payload.forma_pagamento === 'faixa_fixo'

    const row = {
      tabela_comissao_id: payload.tabela_comissao_id,
      forma_pagamento: payload.forma_pagamento,
      valor_inicial: usaFaixa ? payload.valor_inicial ?? null : null,
      valor_final: usaFaixa ? payload.valor_final ?? null : null,
      prazo_inicial: prazoInicial,
      prazo_final: prazoFinal,
      data_base: payload.data_base || null,
      manter_enquadramento: payload.manter_enquadramento !== false,
      comissao: payload.comissao ?? null,
      emissao: payload.emissao ?? null,
      seguro: payload.seguro ?? null,
      forma_pagamento_seguro: payload.forma_pagamento_seguro || null,
      data_bloqueio: payload.data_bloqueio || null,
      id_arw: String(payload.id_arw || '').trim() || null,
      updated_at: new Date().toISOString(),
    }
    const query = payload.id
      ? supabaseAdmin.from('prazos_comissao').update(row).eq('id', payload.id)
      : supabaseAdmin.from('prazos_comissao').insert(row)
    const { error } = await query
    if (error) throw error

    revalidatePath(`${REVALIDATE_BASE}/prazos`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar prazo comissão:', error)
    return { success: false, error: error.message }
  }
}

export async function excluirPrazoComissao(id: string) {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_delete')
    const { error } = await supabaseAdmin.from('prazos_comissao').delete().eq('id', id)
    if (error) throw error
    revalidatePath(`${REVALIDATE_BASE}/prazos`)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

// ----------------------------------------------------------------------------
// Spreads (margem mínima)
// ----------------------------------------------------------------------------
export type SpreadPayload = {
  id?: string
  forma_contrato_id: string
  // Arrays de ids; vazio = vale para todos.
  tipos_agente?: string[]
  instituicoes?: string[]
  convenios?: string[]
  tipos_formalizacao?: string[]
  pontos: number
  vigencia_inicio?: string
}

function normalizeIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)))
}

export async function getSpreads(filtros?: { formaContratoId?: string }) {
  try {
    await requirePermission(PERMISSION_RESOURCE)
    let query = supabaseAdmin
      .from('spreads')
      .select('*, formas_contrato ( id, nome )')
      .order('vigencia_inicio', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(500)
    if (filtros?.formaContratoId) query = query.eq('forma_contrato_id', filtros.formaContratoId)
    const { data, error } = await query
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    console.error('Erro ao listar spreads:', error)
    return { success: false, error: error.message }
  }
}

export async function saveSpread(payload: SpreadPayload) {
  try {
    const { user } = await requirePermission(PERMISSION_RESOURCE, payload.id ? 'can_edit' : 'can_include')
    if (!payload.forma_contrato_id) return { success: false, error: 'Selecione a forma de contrato.' }
    const pontos = Number(payload.pontos)
    if (!Number.isFinite(pontos) || pontos < 0) return { success: false, error: 'Informe os pontos percentuais do spread.' }

    const vigenciaInicio = String(payload.vigencia_inicio || '').slice(0, 10) || new Date().toISOString().slice(0, 10)

    const row = {
      forma_contrato_id: payload.forma_contrato_id,
      tipos_agente: normalizeIdArray(payload.tipos_agente),
      instituicoes: normalizeIdArray(payload.instituicoes),
      convenios: normalizeIdArray(payload.convenios),
      tipos_formalizacao: normalizeIdArray(payload.tipos_formalizacao),
      pontos,
      vigencia_inicio: vigenciaInicio,
      created_by: user.id,
    }
    const query = payload.id
      ? supabaseAdmin.from('spreads').update(row).eq('id', payload.id)
      : supabaseAdmin.from('spreads').insert(row)
    const { error } = await query
    if (error) throw error

    revalidatePath(`${REVALIDATE_BASE}/spreads`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar spread:', error)
    return { success: false, error: error.message }
  }
}

export async function encerrarSpread(id: string, vigenciaFim: string) {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_edit')
    const fim = String(vigenciaFim || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fim)) return { success: false, error: 'Informe a data de fim da vigência.' }
    const { error } = await supabaseAdmin.from('spreads').update({ vigencia_fim: fim }).eq('id', id)
    if (error) throw error
    revalidatePath(`${REVALIDATE_BASE}/spreads`)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
