'use server'

/**
 * Aba "Consulta CPF" do editor do Agente Corban — configuração INTERNA da
 * consulta de CPF paga pelo parceiro no CRM AlvoConsig (o parceiro nunca vê
 * custo BRS, margem nem o modo de faixa). Grava em crm_parceiro_config.
 */

import { createClient } from '@supabase/supabase-js'
import { requirePermission } from '@/lib/auth/server'
import { getNvtiConfig } from '@/lib/nvti/config'
import {
  calcularPrecoProximaConsulta,
  carregarConsultaParceiroConfig,
  contarConsultasParceiroMes,
  type ConsultaFaixaModo,
} from '@/lib/nvti/consulta-parceiro'
import { higienizarCpf } from '@/lib/nvti/service'
import { cleanCpf } from '@/lib/nvti/normalize'

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

const PERMISSION_RESOURCE = 'comercial-agentes'
const INCOMPLETOS_JANELA_DIAS = 7
const INCOMPLETOS_MAX_POR_CLIQUE = 200
const INCOMPLETOS_SERVICE_NAME = 'workspace-incompletos'

export type ConsultaCpfTier = {
  faixa: string
  custoBrs: number
  precoParceiro: number
  margemPercent: number | null
}

export type ConsultaCpfConfigView = {
  tiers: ConsultaCpfTier[]
  acordoCentavos: number | null
  faixaModo: ConsultaFaixaModo
  cobraCache: boolean
  cacheDays: number
  temCarteira: boolean
  saldoCentavos: number
  consultasMes: number
  precoProximaCentavos: number
  incompletos7d: number
  incompletosComCpf: number
}

function tierLabel(upTo: number | null, previous: number): string {
  if (upTo === null) return `Acima de ${previous.toLocaleString('pt-BR')}`
  return `${(previous + 1).toLocaleString('pt-BR')} a ${upTo.toLocaleString('pt-BR')}`
}

function incompletosDesde(): string {
  return new Date(Date.now() - INCOMPLETOS_JANELA_DIAS * 24 * 60 * 60 * 1000).toISOString()
}

export async function getConsultaCpfConfig(agenteParceiroId: string): Promise<
  { success: true; config: ConsultaCpfConfigView } | { success: false; error: string }
> {
  try {
    await requirePermission(PERMISSION_RESOURCE)
    if (!agenteParceiroId) return { success: false, error: 'Agente inválido.' }

    const since = incompletosDesde()
    const [nvtiConfig, config, carteiraRes, consultasMes, incompletosRes, incompletosCpfRes] = await Promise.all([
      getNvtiConfig(),
      carregarConsultaParceiroConfig(supabaseAdmin, agenteParceiroId),
      supabaseAdmin
        .from('parceiro_carteiras')
        .select('user_id, saldo_centavos')
        .eq('agente_parceiro_id', agenteParceiroId)
        .maybeSingle(),
      contarConsultasParceiroMes(supabaseAdmin, agenteParceiroId),
      supabaseAdmin
        .from('crm_contatos')
        .select('id', { count: 'exact', head: true })
        .eq('agente_parceiro_id', agenteParceiroId)
        .eq('dados_incompletos', true)
        .is('deleted_at', null)
        .gte('created_at', since),
      supabaseAdmin
        .from('crm_contatos')
        .select('id', { count: 'exact', head: true })
        .eq('agente_parceiro_id', agenteParceiroId)
        .eq('dados_incompletos', true)
        .is('deleted_at', null)
        .gte('created_at', since)
        .not('cpf', 'is', null)
        .neq('cpf', ''),
    ])

    const precoProximaCentavos = await calcularPrecoProximaConsulta(supabaseAdmin, agenteParceiroId, config, nvtiConfig.price_tiers)

    let previous = 0
    const tiers: ConsultaCpfTier[] = nvtiConfig.price_tiers.map((tier) => {
      const faixa = tierLabel(tier.up_to, previous)
      if (tier.up_to !== null) previous = tier.up_to
      const margem = tier.unit > 0 ? Math.round(((tier.parceiro - tier.unit) / tier.unit) * 1000) / 10 : null
      return { faixa, custoBrs: tier.unit, precoParceiro: tier.parceiro, margemPercent: margem }
    })

    return {
      success: true,
      config: {
        tiers,
        acordoCentavos: config.acordoCentavos,
        faixaModo: config.faixaModo,
        cobraCache: config.cobraCache,
        cacheDays: nvtiConfig.cache_days,
        temCarteira: Boolean(carteiraRes.data?.user_id),
        saldoCentavos: Number(carteiraRes.data?.saldo_centavos) || 0,
        consultasMes,
        precoProximaCentavos,
        incompletos7d: incompletosRes.count ?? 0,
        incompletosComCpf: incompletosCpfRes.count ?? 0,
      },
    }
  } catch (error) {
    console.error('Erro ao carregar config Consulta CPF do agente:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Erro ao carregar.' }
  }
}

export async function salvarConsultaCpfConfig(payload: {
  agenteParceiroId: string
  acordoCentavos: number | null
  faixaModo: ConsultaFaixaModo
  cobraCache: boolean
}): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_edit')
    if (!payload.agenteParceiroId) return { success: false, error: 'Agente inválido.' }

    let acordo: number | null = null
    if (payload.acordoCentavos !== null && payload.acordoCentavos !== undefined) {
      acordo = Math.round(Number(payload.acordoCentavos))
      if (!Number.isFinite(acordo) || acordo < 0) return { success: false, error: 'Acordo de preço inválido.' }
    }
    const faixaModo: ConsultaFaixaModo = payload.faixaModo === 'global' ? 'global' : 'individual'

    const { data: existente, error: selError } = await supabaseAdmin
      .from('crm_parceiro_config')
      .select('agente_parceiro_id')
      .eq('agente_parceiro_id', payload.agenteParceiroId)
      .maybeSingle()
    if (selError) throw selError

    const campos = {
      consulta_acordo_centavos: acordo,
      consulta_faixa_modo: faixaModo,
      consulta_cobra_cache: payload.cobraCache !== false,
    }
    if (existente) {
      const { error } = await supabaseAdmin
        .from('crm_parceiro_config')
        .update(campos)
        .eq('agente_parceiro_id', payload.agenteParceiroId)
      if (error) throw error
    } else {
      // Ainda sem config do CRM: cria a linha desabilitada só com as regras de consulta.
      const { error } = await supabaseAdmin
        .from('crm_parceiro_config')
        .insert({ agente_parceiro_id: payload.agenteParceiroId, habilitado: false, ...campos })
      if (error) throw error
    }
    return { success: true }
  } catch (error) {
    console.error('Erro ao salvar config Consulta CPF do agente:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Erro ao salvar.' }
  }
}

export type HigienizarIncompletosResult =
  | { success: true; total: number; ok: number; cache: number; erros: number; bloqueado: string | null }
  | { success: false; error: string }

/**
 * Higieniza (custo BRS, sem cobrar o parceiro) os leads com dados incompletos
 * dos últimos 7 dias que já têm CPF. Sequencial, até 200 por clique. A gravação
 * no WeSales acontece dentro do núcleo; o crm_contatos é atualizado pelo CRM.
 */
export async function higienizarIncompletosParceiro(agenteParceiroId: string): Promise<HigienizarIncompletosResult> {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_edit')
    if (!agenteParceiroId) return { success: false, error: 'Agente inválido.' }

    const { data, error } = await supabaseAdmin
      .from('crm_contatos')
      .select('id, cpf')
      .eq('agente_parceiro_id', agenteParceiroId)
      .eq('dados_incompletos', true)
      .is('deleted_at', null)
      .gte('created_at', incompletosDesde())
      .not('cpf', 'is', null)
      .neq('cpf', '')
      .order('created_at', { ascending: true })
      .limit(INCOMPLETOS_MAX_POR_CLIQUE)
    if (error) throw error

    const cpfs = Array.from(new Set((data || []).map((row) => cleanCpf(String(row.cpf || ''))).filter(Boolean)))
    let ok = 0
    let cache = 0
    let erros = 0
    let bloqueado: string | null = null
    for (const cpf of cpfs) {
      const outcome = await higienizarCpf({ cpf, origin: 'service', serviceName: INCOMPLETOS_SERVICE_NAME })
      if (outcome.status === 'ok') {
        ok += 1
        if (outcome.fromCache) cache += 1
      } else {
        erros += 1
        if (outcome.status === 'blocked_global' || outcome.status === 'not_configured') {
          bloqueado = outcome.error
          break
        }
      }
    }
    return { success: true, total: cpfs.length, ok, cache, erros, bloqueado }
  } catch (error) {
    console.error('Erro ao higienizar incompletos do parceiro:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Erro ao higienizar.' }
  }
}
