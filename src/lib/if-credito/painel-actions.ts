'use server'

/**
 * Painel de Operações — leitura das Propostas de Crédito (modelo canônico
 * IF-agnóstico, ver Fatia 1). Permissão: `operacional-painel-operacoes`.
 * Fatia 3 do plano (docs/ROTEIRO-PROPOSTAS-CREDITO-FATIAS-2-3.md): SÓ leitura
 * das nossas tabelas — nenhuma chamada à IF (criar/simular/cancelar de
 * verdade = Fatia 4, o adaptador).
 */
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'

const RESOURCE = 'operacional-painel-operacoes'

export type PropostaCredito = {
  id: string
  cpf: string
  nome_cliente: string
  telefone_cliente: string | null
  valor_solicitado: number | null
  valor_parcela: number | null
  num_parcelas: number | null
  status: string
  liberacao_automatica: boolean
  instituicao_financeira_id: string
  instituicao_nome: string
  convenio_id: string | null
  convenio_nome: string
  forma_contrato_id: string | null
  forma_contrato_nome: string
  nuvidio_convite_id: string | null
  nuvidio_status: string | null
  id_externo_if: string | null
  observacao: string
  created_at: string
  updated_at: string
}

const SELECT_PROPOSTA = `*,
  instituicao:instituicao_financeira_id(name),
  convenio:convenio_id(nome_reduzido),
  forma:forma_contrato_id(nome),
  nuvidio:nuvidio_convite_id(id,status,link,department_nome)`

function mapProposta(r: any): PropostaCredito {
  return {
    ...r,
    instituicao_nome: r.instituicao?.name || '',
    convenio_nome: r.convenio?.nome_reduzido || '',
    forma_contrato_nome: r.forma?.nome || '',
    nuvidio_status: r.nuvidio?.status || null,
  }
}

export type FormaContratoOpcao = { id: string; nome: string }

/** Formas de contrato ativas — para montar as abas do painel. */
export async function listarFormasContratoAtivas(): Promise<{ success: boolean; data?: FormaContratoOpcao[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const admin = await createAdminClient()
    const { data, error } = await admin.from('formas_contrato').select('id, nome').eq('is_active', true).order('nome')
    if (error) throw error
    return { success: true, data: (data || []).map((f: any) => ({ id: String(f.id), nome: String(f.nome || '') })) }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function listarPropostas(filtro?: {
  forma_contrato_id?: string
  status?: string
  instituicao_id?: string
  convenio_id?: string
  busca?: string
}): Promise<{ success: boolean; data?: PropostaCredito[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const admin = await createAdminClient()
    let query = admin.from('propostas_credito').select(SELECT_PROPOSTA).order('updated_at', { ascending: false }).limit(500)
    if (filtro?.forma_contrato_id) query = query.eq('forma_contrato_id', filtro.forma_contrato_id)
    if (filtro?.status) query = query.eq('status', filtro.status)
    if (filtro?.instituicao_id) query = query.eq('instituicao_financeira_id', filtro.instituicao_id)
    if (filtro?.convenio_id) query = query.eq('convenio_id', filtro.convenio_id)
    const { data, error } = await query
    if (error) throw error

    const busca = String(filtro?.busca || '').trim().toLowerCase()
    const rows = (data || [])
      .map(mapProposta)
      .filter((r) => !busca || `${r.nome_cliente} ${r.cpf}`.toLowerCase().includes(busca))
    return { success: true, data: rows }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export type WebhookEvento = {
  id: string
  webhook: string | null
  tipo_webhook: string | null
  observacao: string | null
  processado: boolean
  erro: string | null
  recebido_em: string
  payload: Record<string, unknown>
}

export type PropostaDetalhe = PropostaCredito & {
  payload_bruto: Record<string, unknown>
  cartao: Array<{ id: string; tipo: 'saque' | 'margem'; valor: number | null; percentual: number | null; num_parcelas: number | null; valor_parcela: number | null }>
  contratosOrigem: Array<{ id: string; tipo: string; banco_origem: string | null; contrato_origem: string | null; saldo_devedor: number | null; parcela: number | null; num_parcelas_restantes: number | null }>
  timeline: WebhookEvento[]
  nuvidio: { id: string; status: string; link: string; department_nome: string } | null
}

export async function getProposta(id: string): Promise<{ success: boolean; data?: PropostaDetalhe; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    if (!id) throw new Error('Proposta inválida.')
    const admin = await createAdminClient()

    const { data: proposta, error } = await admin.from('propostas_credito').select(SELECT_PROPOSTA).eq('id', id).maybeSingle()
    if (error) throw error
    if (!proposta) throw new Error('Proposta não encontrada.')
    const p: any = proposta

    const [{ data: cartao }, { data: origem }] = await Promise.all([
      admin.from('proposta_cartao_operacoes').select('*').eq('proposta_id', id),
      admin.from('proposta_contratos_origem').select('*').eq('proposta_id', id),
    ])

    let eventosQuery = admin.from('if_webhook_eventos').select('*').order('recebido_em', { ascending: true })
    eventosQuery = p.request_id
      ? eventosQuery.or(`proposta_id.eq.${id},request_id.eq.${p.request_id}`)
      : eventosQuery.eq('proposta_id', id)
    const { data: eventos } = await eventosQuery

    return {
      success: true,
      data: {
        ...mapProposta(p),
        payload_bruto: p.payload_bruto || {},
        nuvidio: p.nuvidio ? { id: p.nuvidio.id, status: p.nuvidio.status, link: p.nuvidio.link, department_nome: p.nuvidio.department_nome } : null,
        cartao: cartao || [],
        contratosOrigem: origem || [],
        timeline: (eventos || []) as WebhookEvento[],
      },
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
