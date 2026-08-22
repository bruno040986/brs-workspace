'use server'

/**
 * Coeficientes Financeiros — coeficiente fornecido pela IF, por Tabela de
 * Comissão × prazo específico, com vigência (lançar novo encerra o anterior).
 * Permissão: sistema-config-credito.
 */

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

const PERMISSION_RESOURCE = 'sistema-config-credito'

export async function getCoeficientesLookups() {
  try {
    await requirePermission(PERMISSION_RESOURCE)
    const [tabelas, convenios] = await Promise.all([
      supabaseAdmin
        .from('tabelas_comissao')
        .select('id, nome, codigo_tabela_banco, com_seguro, convenio_id, financial_institutions ( id, name ), formas_contrato ( id, nome ), convenios ( id, nome, codigo ), prazos_comissao ( prazo_inicial, prazo_final )')
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('nome'),
      supabaseAdmin.from('convenios').select('id, nome, codigo').is('deleted_at', null).order('nome'),
    ])
    if (tabelas.error) throw tabelas.error
    if (convenios.error) throw convenios.error
    return { success: true, tabelas: tabelas.data || [], convenios: convenios.data || [] }
  } catch (error: any) {
    console.error('Erro nos lookups de coeficientes:', error)
    return { success: false, error: error.message }
  }
}

export async function getCoeficientes(filtros?: {
  tabelaComissaoId?: string
  convenioId?: string
  apenasVigentes?: boolean
}) {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    let query = supabaseAdmin
      .from('coeficientes')
      .select(
        'id, tabela_comissao_id, prazo, coeficiente, vigencia_inicio, vigencia_fim, created_at, ' +
          'tabelas_comissao!inner ( id, nome, codigo_tabela_banco, com_seguro, convenio_id, financial_institutions ( id, name ), formas_contrato ( id, nome ), convenios ( id, nome ) )',
      )
      .order('vigencia_inicio', { ascending: false })
      .order('prazo', { ascending: true })

    if (filtros?.tabelaComissaoId) query = query.eq('tabela_comissao_id', filtros.tabelaComissaoId)
    if (filtros?.convenioId) query = query.eq('tabelas_comissao.convenio_id', filtros.convenioId)
    if (filtros?.apenasVigentes) query = query.is('vigencia_fim', null)

    const { data, error } = await query.limit(500)
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar coeficientes:', error)
    return { success: false, error: error.message }
  }
}

export type NovoCoeficientePayload = {
  tabela_comissao_id: string
  vigencia_inicio: string
  itens: Array<{ prazo: number; coeficiente: number }>
}

export async function createCoeficientes(payload: NovoCoeficientePayload) {
  try {
    const { user } = await requirePermission(PERMISSION_RESOURCE, 'can_include')

    if (!payload.tabela_comissao_id) return { success: false, error: 'Selecione a Tabela de Comissão.' }

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

    // Encerra a vigência aberta anterior (mesma tabela × prazo) no dia anterior.
    const diaAnterior = new Date(`${vigenciaInicio}T12:00:00Z`)
    diaAnterior.setUTCDate(diaAnterior.getUTCDate() - 1)
    const { error: closeError } = await supabaseAdmin
      .from('coeficientes')
      .update({ vigencia_fim: diaAnterior.toISOString().slice(0, 10) })
      .eq('tabela_comissao_id', payload.tabela_comissao_id)
      .in('prazo', itens.map((item) => item.prazo))
      .is('vigencia_fim', null)
      .lt('vigencia_inicio', vigenciaInicio)
    if (closeError) throw closeError

    const rows = itens.map((item) => ({
      tabela_comissao_id: payload.tabela_comissao_id,
      prazo: item.prazo,
      coeficiente: item.coeficiente,
      vigencia_inicio: vigenciaInicio,
      created_by: user.id,
    }))

    const { error } = await supabaseAdmin.from('coeficientes').insert(rows)
    if (error) throw error

    revalidatePath('/coeficientes')
    return { success: true, inseridos: rows.length }
  } catch (error: any) {
    console.error('Erro ao criar coeficientes:', error)
    if ((error as any)?.code === '23505') {
      return { success: false, error: 'Já existe coeficiente para essa tabela, prazo e data de início.' }
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

    const { error } = await supabaseAdmin.from('coeficientes').update({ vigencia_fim: fim }).eq('id', id)
    if (error) throw error

    revalidatePath('/coeficientes')
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

    revalidatePath('/coeficientes')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao excluir coeficiente:', error)
    return { success: false, error: error.message }
  }
}
