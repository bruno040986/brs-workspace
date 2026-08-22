'use server'

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { CONVENIO_ESFERAS, PRODUTOS_CREDITO } from '@/lib/cadastros-credito'

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

export type ConvenioRecord = {
  id?: string
  nome: string
  codigo?: string | null
  esfera: string
  is_active?: boolean
}

export type TabelaCreditoRecord = {
  id?: string
  institution_id: string
  produto: string
  nome: string
  codigo?: string | null
  com_seguro: boolean
  prazos: number[]
  is_active?: boolean
}

// ----------------------------------------------------------------------------
// Lookups
// ----------------------------------------------------------------------------
export async function getCreditLookups() {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const [instituicoesRes, conveniosRes, tabelasRes] = await Promise.all([
      supabaseAdmin
        .from('financial_institutions')
        .select('id, name, logo_url, is_active')
        .is('deleted_at', null)
        .order('is_active', { ascending: false })
        .order('name', { ascending: true }),
      supabaseAdmin
        .from('convenios')
        .select('id, nome, codigo, esfera, is_active')
        .is('deleted_at', null)
        .order('is_active', { ascending: false })
        .order('nome', { ascending: true }),
      supabaseAdmin
        .from('tabelas_credito')
        .select('id, institution_id, produto, nome, codigo, com_seguro, prazos, is_active')
        .is('deleted_at', null)
        .order('is_active', { ascending: false })
        .order('nome', { ascending: true }),
    ])

    if (instituicoesRes.error) throw instituicoesRes.error
    if (conveniosRes.error) throw conveniosRes.error
    if (tabelasRes.error) throw tabelasRes.error

    return {
      success: true,
      instituicoes: instituicoesRes.data || [],
      convenios: conveniosRes.data || [],
      tabelas: tabelasRes.data || [],
    }
  } catch (error: any) {
    console.error('Erro ao carregar lookups de cadastros de crédito:', error)
    return { success: false, error: error.message }
  }
}

// ----------------------------------------------------------------------------
// Convênios
// ----------------------------------------------------------------------------
export async function getConvenios() {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const { data, error } = await supabaseAdmin
      .from('convenios')
      .select('id, nome, codigo, esfera, is_active, created_at')
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

export async function saveConvenio(payload: ConvenioRecord) {
  try {
    await requirePermission(PERMISSION_RESOURCE, payload.id ? 'can_edit' : 'can_include')

    const nome = String(payload.nome || '').trim()
    if (!nome) return { success: false, error: 'O nome do convênio é obrigatório.' }

    const esfera = CONVENIO_ESFERAS.some((item) => item.value === payload.esfera)
      ? payload.esfera
      : 'outro'

    const row = {
      nome,
      codigo: String(payload.codigo || '').trim() || null,
      esfera,
      updated_at: new Date().toISOString(),
    }

    if (payload.id) {
      const { error } = await supabaseAdmin.from('convenios').update(row).eq('id', payload.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin.from('convenios').insert(row)
      if (error) throw error
    }

    revalidatePath('/cadastros-credito/convenios')
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

    revalidatePath('/cadastros-credito/convenios')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alterar status do convênio:', error)
    return { success: false, error: error.message }
  }
}

// ----------------------------------------------------------------------------
// Tabelas de crédito
// ----------------------------------------------------------------------------
export async function getTabelasCredito() {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const { data, error } = await supabaseAdmin
      .from('tabelas_credito')
      .select('id, institution_id, produto, nome, codigo, com_seguro, prazos, is_active, financial_institutions ( id, name, logo_url )')
      .is('deleted_at', null)
      .order('is_active', { ascending: false })
      .order('nome', { ascending: true })
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar tabelas de crédito:', error)
    return { success: false, error: error.message }
  }
}

function normalizePrazos(input: unknown): number[] {
  const list = Array.isArray(input) ? input : []
  const prazos = list
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isFinite(value) && value > 0)
  return Array.from(new Set(prazos)).sort((a, b) => a - b)
}

export async function saveTabelaCredito(payload: TabelaCreditoRecord) {
  try {
    await requirePermission(PERMISSION_RESOURCE, payload.id ? 'can_edit' : 'can_include')

    const nome = String(payload.nome || '').trim()
    if (!nome) return { success: false, error: 'O nome da tabela é obrigatório.' }
    if (!payload.institution_id) return { success: false, error: 'Selecione a instituição financeira.' }
    if (!PRODUTOS_CREDITO.some((item) => item.value === payload.produto)) {
      return { success: false, error: 'Selecione o produto da tabela.' }
    }

    const row = {
      institution_id: payload.institution_id,
      produto: payload.produto,
      nome,
      codigo: String(payload.codigo || '').trim() || null,
      com_seguro: payload.com_seguro === true,
      prazos: normalizePrazos(payload.prazos),
      updated_at: new Date().toISOString(),
    }

    if (payload.id) {
      const { error } = await supabaseAdmin.from('tabelas_credito').update(row).eq('id', payload.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin.from('tabelas_credito').insert(row)
      if (error) throw error
    }

    revalidatePath('/cadastros-credito/tabelas')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar tabela de crédito:', error)
    return { success: false, error: error.message }
  }
}

export async function setTabelaCreditoStatus(id: string, isActive: boolean) {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_activate_inactivate')
    if (!id) return { success: false, error: 'ID inválido.' }

    const { error } = await supabaseAdmin
      .from('tabelas_credito')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error

    revalidatePath('/cadastros-credito/tabelas')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alterar status da tabela de crédito:', error)
    return { success: false, error: error.message }
  }
}

// ----------------------------------------------------------------------------
// Coeficientes
// ----------------------------------------------------------------------------
export async function getCoeficientes(filters?: {
  convenioId?: string
  tabelaId?: string
  apenasVigentes?: boolean
}) {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    let query = supabaseAdmin
      .from('coeficientes')
      .select(
        'id, tabela_id, convenio_id, prazo, coeficiente, vigencia_inicio, vigencia_fim, created_at, ' +
          'tabelas_credito ( id, nome, codigo, produto, com_seguro, institution_id, financial_institutions ( id, name ) ), ' +
          'convenios ( id, nome, codigo )',
      )
      .order('vigencia_inicio', { ascending: false })
      .order('prazo', { ascending: true })

    if (filters?.convenioId) query = query.eq('convenio_id', filters.convenioId)
    if (filters?.tabelaId) query = query.eq('tabela_id', filters.tabelaId)
    if (filters?.apenasVigentes) query = query.is('vigencia_fim', null)

    const { data, error } = await query.limit(500)
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar coeficientes:', error)
    return { success: false, error: error.message }
  }
}

export type NovoCoeficientePayload = {
  tabela_id: string
  convenio_id: string
  vigencia_inicio: string
  itens: Array<{ prazo: number; coeficiente: number }>
}

export async function createCoeficientes(payload: NovoCoeficientePayload) {
  try {
    const { user } = await requirePermission(PERMISSION_RESOURCE, 'can_include')

    if (!payload.tabela_id) return { success: false, error: 'Selecione a tabela de crédito.' }
    if (!payload.convenio_id) return { success: false, error: 'Selecione o convênio.' }

    const vigenciaInicio = String(payload.vigencia_inicio || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vigenciaInicio)) {
      return { success: false, error: 'Informe a data de início da vigência.' }
    }

    const itens = (payload.itens || [])
      .map((item) => ({
        prazo: Number.parseInt(String(item.prazo), 10),
        coeficiente: Number(item.coeficiente),
      }))
      .filter((item) => Number.isFinite(item.prazo) && item.prazo > 0 && Number.isFinite(item.coeficiente) && item.coeficiente > 0)

    if (itens.length === 0) {
      return { success: false, error: 'Informe ao menos um prazo com coeficiente válido.' }
    }

    const prazosDuplicados = itens.map((i) => i.prazo).filter((p, idx, arr) => arr.indexOf(p) !== idx)
    if (prazosDuplicados.length > 0) {
      return { success: false, error: `Prazo repetido na lista: ${prazosDuplicados.join(', ')}.` }
    }

    // Encerra a vigência aberta anterior da mesma chave (tabela × convênio × prazo)
    // no dia anterior ao início da nova — preserva o histórico.
    const diaAnterior = new Date(`${vigenciaInicio}T12:00:00Z`)
    diaAnterior.setUTCDate(diaAnterior.getUTCDate() - 1)
    const vigenciaFimAnterior = diaAnterior.toISOString().slice(0, 10)

    const { error: closeError } = await supabaseAdmin
      .from('coeficientes')
      .update({ vigencia_fim: vigenciaFimAnterior })
      .eq('tabela_id', payload.tabela_id)
      .eq('convenio_id', payload.convenio_id)
      .in('prazo', itens.map((item) => item.prazo))
      .is('vigencia_fim', null)
      .lt('vigencia_inicio', vigenciaInicio)
    if (closeError) throw closeError

    const rows = itens.map((item) => ({
      tabela_id: payload.tabela_id,
      convenio_id: payload.convenio_id,
      prazo: item.prazo,
      coeficiente: item.coeficiente,
      vigencia_inicio: vigenciaInicio,
      created_by: user.id,
    }))

    const { error } = await supabaseAdmin.from('coeficientes').insert(rows)
    if (error) throw error

    revalidatePath('/cadastros-credito/coeficientes')
    return { success: true, inseridos: rows.length }
  } catch (error: any) {
    console.error('Erro ao criar coeficientes:', error)
    if ((error as any)?.code === '23505') {
      return { success: false, error: 'Já existe coeficiente para essa tabela, convênio, prazo e data de início.' }
    }
    return { success: false, error: error.message }
  }
}

export async function encerrarCoeficiente(id: string, vigenciaFim: string) {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_edit')
    if (!id) return { success: false, error: 'ID inválido.' }

    const fim = String(vigenciaFim || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
      return { success: false, error: 'Informe a data de fim da vigência.' }
    }

    const { error } = await supabaseAdmin
      .from('coeficientes')
      .update({ vigencia_fim: fim })
      .eq('id', id)
    if (error) throw error

    revalidatePath('/cadastros-credito/coeficientes')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao encerrar vigência do coeficiente:', error)
    return { success: false, error: error.message }
  }
}

export async function excluirCoeficiente(id: string) {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_delete')
    if (!id) return { success: false, error: 'ID inválido.' }

    const { error } = await supabaseAdmin.from('coeficientes').delete().eq('id', id)
    if (error) throw error

    revalidatePath('/cadastros-credito/coeficientes')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao excluir coeficiente:', error)
    return { success: false, error: error.message }
  }
}
