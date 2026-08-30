/**
 * Consulta unitária de CPF PAGA pelo parceiro (usada pelo CRM AlvoConsig).
 *
 * Fluxo: carteira do parceiro → configuração interna (acordo/faixa/cache) →
 * preço em centavos → débito atômico (parceiro_aplicar_lancamento) → consulta
 * pelo MESMO núcleo das telas (`higienizarCpf`, que já grava no WeSales) →
 * estorno automático se a consulta falhar. Cada tentativa fica em
 * `parceiro_consultas_cpf` (auditoria + contagem da faixa individual).
 *
 * O custo BRS registrado no log é o custo unitário da NVTI na posição global
 * do mês (0 em cache hit) — a cobrança real da NVTI segue em nvti_queries.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/server'
import { getNvtiConfig } from './config'
import { cleanCpf, isValidCpf } from './normalize'
import { currentMonthRange, parceiroPriceForPosition, unitCostForPosition } from './pricing'
import { higienizarCpf } from './service'
import type { NvtiPriceTier, NvtiResultado } from './types'

export const CONSULTA_PARCEIRO_SERVICE_NAME = 'parceiro-crm'

export type ConsultaFaixaModo = 'individual' | 'global'

export type ConsultaParceiroConfig = {
  acordoCentavos: number | null
  faixaModo: ConsultaFaixaModo
  cobraCache: boolean
}

export type DadosConsultaParceiro = {
  nome: string
  cpf: string
  nascimento: string
  idade: string
  sexo: string
  nomeMae: string
  emails: string[]
  telefones: Array<{ numero: string; whatsapp: boolean; tipo: 'celular' | 'fixo' }>
  endereco: {
    logradouro: string
    numero: string
    complemento: string
    bairro: string
    cidade: string
    uf: string
    cep: string
  } | null
  enderecos: Array<{
    logradouro: string
    numero: string
    complemento: string
    bairro: string
    cidade: string
    uf: string
    cep: string
  }>
  score: string
  faixaScore: string
  persona: string
  scoreDigital: string
  propensaoPagamento: string
  classeEconomica: string
  ocupacao: string
  fonteRenda: string
  obito: boolean | null
  possuiVeiculo: boolean | null
  possuiImovel: boolean | null
  bolsaFamilia: boolean | null
  possuiFgts: boolean | null
  fgtsValorPresumido: string
  empresa: { cnpj: string; razao: string } | null
}

export type ConsultaParceiroInput = {
  agenteParceiroId: string
  cpf: string
  crmUsuarioId?: string | null
  contatoId?: string | null
}

export type ConsultaParceiroResult =
  | { ok: true; cacheHit: boolean; precoCentavos: number; saldoCentavos: number; dados: DadosConsultaParceiro }
  | { ok: false; status: 402; error: 'saldo_insuficiente'; saldoCentavos: number }
  | { ok: false; status: 400 | 404 | 500 | 503; error: string }

type Carteira = { userId: string; saldoCentavos: number }

async function carregarCarteira(admin: SupabaseClient, agenteParceiroId: string): Promise<Carteira | null> {
  const { data } = await admin
    .from('parceiro_carteiras')
    .select('user_id, saldo_centavos')
    .eq('agente_parceiro_id', agenteParceiroId)
    .maybeSingle()
  if (!data?.user_id) return null
  return { userId: String(data.user_id), saldoCentavos: Number(data.saldo_centavos) || 0 }
}

export async function carregarConsultaParceiroConfig(
  admin: SupabaseClient,
  agenteParceiroId: string,
): Promise<ConsultaParceiroConfig> {
  const { data } = await admin
    .from('crm_parceiro_config')
    .select('consulta_acordo_centavos, consulta_faixa_modo, consulta_cobra_cache')
    .eq('agente_parceiro_id', agenteParceiroId)
    .maybeSingle()
  const acordo = data?.consulta_acordo_centavos
  return {
    acordoCentavos: acordo === null || acordo === undefined ? null : Math.max(0, Math.round(Number(acordo)) || 0),
    faixaModo: data?.consulta_faixa_modo === 'global' ? 'global' : 'individual',
    cobraCache: data?.consulta_cobra_cache !== false,
  }
}

/** Consultas OK do parceiro no mês corrente (faixa individual). */
export async function contarConsultasParceiroMes(admin: SupabaseClient, agenteParceiroId: string): Promise<number> {
  const { start, end } = currentMonthRange()
  const { count } = await admin
    .from('parceiro_consultas_cpf')
    .select('id', { count: 'exact', head: true })
    .eq('agente_parceiro_id', agenteParceiroId)
    .eq('status', 'ok')
    .gte('created_at', start)
    .lt('created_at', end)
  return count ?? 0
}

/** Consultas da BRS na NVTI no mês corrente (faixa global — mesma base do gasto). */
async function contarConsultasGlobaisMes(admin: SupabaseClient): Promise<number> {
  const { start, end } = currentMonthRange()
  const { count } = await admin
    .from('nvti_queries')
    .select('id', { count: 'exact', head: true })
    .eq('billed', true)
    .gte('created_at', start)
    .lt('created_at', end)
  return count ?? 0
}

function toCentavos(valorReais: number): number {
  return Math.max(0, Math.round(valorReais * 100))
}

/**
 * Preço em centavos da PRÓXIMA consulta do parceiro (sem considerar cache).
 * Acordo fixo vence a tabela; sem acordo, faixa pela posição (individual/global).
 */
export async function calcularPrecoProximaConsulta(
  admin: SupabaseClient,
  agenteParceiroId: string,
  config: ConsultaParceiroConfig,
  tiers: NvtiPriceTier[],
): Promise<number> {
  if (config.acordoCentavos !== null) return config.acordoCentavos
  const posicao = config.faixaModo === 'global'
    ? (await contarConsultasGlobaisMes(admin)) + 1
    : (await contarConsultasParceiroMes(admin, agenteParceiroId)) + 1
  return toCentavos(parceiroPriceForPosition(tiers, posicao))
}

async function existeCache(admin: SupabaseClient, cpf: string, cacheDays: number): Promise<boolean> {
  if (cacheDays <= 0) return false
  const since = new Date(Date.now() - cacheDays * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await admin
    .from('nvti_queries')
    .select('id')
    .eq('cpf', cpf)
    .eq('success', true)
    .not('response', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return Boolean(data?.id)
}

function mapEndereco(e: NvtiResultado['enderecos'][number]) {
  return {
    logradouro: e.logradouro,
    numero: e.numero,
    complemento: e.complemento,
    bairro: e.bairro,
    cidade: e.cidade,
    uf: e.uf,
    cep: e.cep,
  }
}

/** Formato enxuto do resultado NVTI pro CRM (sem XML cru, sem campos técnicos). */
export function mapDadosConsultaParceiro(resultado: NvtiResultado): DadosConsultaParceiro {
  const enderecos = resultado.enderecos.map(mapEndereco)
  const celulares = resultado.celulares
    .filter((c) => !c.procon)
    .map((c) => ({ numero: `${c.ddd}${c.numero}`.replace(/\D/g, ''), whatsapp: c.whatsapp, tipo: 'celular' as const }))
  const fixos = resultado.telefones
    .filter((t) => !t.procon)
    .map((t) => ({ numero: `${t.ddd}${t.numero}`.replace(/\D/g, ''), whatsapp: false, tipo: 'fixo' as const }))
  const empresa = resultado.empresas.find((e) => e.cnpj || e.razao) || null
  const fgts = resultado.empresas.find((e) => e.possui_fgts !== null) || null
  return {
    nome: resultado.cadastro.nome,
    cpf: resultado.cadastro.cpf || resultado.cpf,
    nascimento: resultado.cadastro.nascimento,
    idade: resultado.cadastro.idade,
    sexo: resultado.cadastro.sexo,
    nomeMae: resultado.cadastro.nome_mae,
    emails: resultado.emails,
    telefones: [...celulares, ...fixos].filter((t) => t.numero),
    endereco: enderecos[0] || null,
    enderecos,
    score: resultado.credito.score,
    faixaScore: resultado.credito.faixa_score,
    persona: resultado.credito.persona_credito,
    scoreDigital: resultado.credito.score_digital,
    propensaoPagamento: resultado.credito.propensao_pagamento,
    classeEconomica: resultado.cadastro.classe_economica,
    ocupacao: resultado.cadastro.descricao_cbo,
    fonteRenda: resultado.credito.fonte_renda,
    obito: resultado.credito.obito,
    possuiVeiculo: resultado.credito.possui_veiculo,
    possuiImovel: resultado.credito.possui_imovel,
    bolsaFamilia: resultado.credito.bolsa_familia,
    possuiFgts: fgts ? fgts.possui_fgts : null,
    fgtsValorPresumido: fgts?.fgts_valor_presumido || '',
    empresa: empresa ? { cnpj: empresa.cnpj, razao: empresa.razao } : null,
  }
}

async function aplicarLancamento(
  admin: SupabaseClient,
  params: { userId: string; tipo: 'credito' | 'debito'; valorCentavos: number; motivo: string; referenciaId: string },
): Promise<{ saldo: number } | { erro: string; saldoInsuficiente: boolean }> {
  const { data, error } = await admin.rpc('parceiro_aplicar_lancamento', {
    p_user_id: params.userId,
    p_tipo: params.tipo,
    p_valor_centavos: params.valorCentavos,
    p_motivo: params.motivo,
    p_origem: 'sistema',
    p_referencia_tipo: 'consulta_cpf',
    p_referencia_id: params.referenciaId,
    p_criado_por: null,
  })
  if (error) {
    const msg = String(error.message || '')
    return { erro: msg || 'Falha ao aplicar lançamento.', saldoInsuficiente: msg.includes('saldo insuficiente') }
  }
  return { saldo: Number(data) || 0 }
}

async function buscarLancamentoId(admin: SupabaseClient, referenciaId: string, tipo: 'credito' | 'debito'): Promise<string | null> {
  const { data } = await admin
    .from('parceiro_lancamentos')
    .select('id')
    .eq('referencia_tipo', 'consulta_cpf')
    .eq('referencia_id', referenciaId)
    .eq('tipo', tipo)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.id ? String(data.id) : null
}

/** Saldo + preço da próxima consulta (ignora cache) — pro CRM mostrar antes de consultar. */
export async function consultarSaldoParceiro(agenteParceiroId: string): Promise<{
  saldoCentavos: number
  precoCentavos: number
  cobraCache: boolean
  temCarteira: boolean
}> {
  const admin = await createAdminClient()
  const [carteira, config, nvtiConfig] = await Promise.all([
    carregarCarteira(admin, agenteParceiroId),
    carregarConsultaParceiroConfig(admin, agenteParceiroId),
    getNvtiConfig(),
  ])
  const precoCentavos = await calcularPrecoProximaConsulta(admin, agenteParceiroId, config, nvtiConfig.price_tiers)
  return {
    saldoCentavos: carteira?.saldoCentavos ?? 0,
    precoCentavos,
    cobraCache: config.cobraCache,
    temCarteira: Boolean(carteira),
  }
}

export async function consultarCpfParceiro(input: ConsultaParceiroInput): Promise<ConsultaParceiroResult> {
  const admin = await createAdminClient()

  const digits = cleanCpf(input.cpf)
  const cpf = digits.padStart(11, '0')
  if (!digits || !isValidCpf(cpf)) {
    return { ok: false, status: 400, error: 'CPF inválido.' }
  }

  // 1) Carteira do parceiro.
  const carteira = await carregarCarteira(admin, input.agenteParceiroId)
  if (!carteira) return { ok: false, status: 402, error: 'saldo_insuficiente', saldoCentavos: 0 }

  // 2) Configuração interna + tabela de preços.
  const [config, nvtiConfig] = await Promise.all([
    carregarConsultaParceiroConfig(admin, input.agenteParceiroId),
    getNvtiConfig(),
  ])
  if (!nvtiConfig.has_credentials || !nvtiConfig.is_active) {
    return { ok: false, status: 503, error: 'Serviço de consulta indisponível no momento.' }
  }

  // 3) Cache (30 dias por padrão) — decide preço 0 e custo BRS 0.
  const cacheHit = await existeCache(admin, cpf, nvtiConfig.cache_days)

  // 4) Preço pro parceiro e custo BRS.
  let precoCentavos = await calcularPrecoProximaConsulta(admin, input.agenteParceiroId, config, nvtiConfig.price_tiers)
  if (cacheHit && !config.cobraCache) precoCentavos = 0
  const custoBrsCentavos = cacheHit
    ? 0
    : toCentavos(unitCostForPosition(nvtiConfig.price_tiers, (await contarConsultasGlobaisMes(admin)) + 1))

  if (precoCentavos > carteira.saldoCentavos) {
    return { ok: false, status: 402, error: 'saldo_insuficiente', saldoCentavos: carteira.saldoCentavos }
  }

  // Log primeiro (id serve de referência do lançamento) — status ajustado ao final.
  const { data: logRow, error: logError } = await admin
    .from('parceiro_consultas_cpf')
    .insert({
      agente_parceiro_id: input.agenteParceiroId,
      user_id: carteira.userId,
      crm_usuario_id: input.crmUsuarioId || null,
      contato_id: input.contatoId || null,
      cpf,
      preco_centavos: precoCentavos,
      custo_brs_centavos: custoBrsCentavos,
      cache_hit: cacheHit,
      status: 'ok',
    })
    .select('id')
    .single()
  if (logError || !logRow?.id) {
    console.error('[consulta-parceiro] falha ao registrar log:', logError)
    return { ok: false, status: 500, error: 'Falha ao registrar a consulta.' }
  }
  const logId = String(logRow.id)

  // 5) Débito atômico.
  let saldoCentavos = carteira.saldoCentavos
  if (precoCentavos > 0) {
    const debito = await aplicarLancamento(admin, {
      userId: carteira.userId,
      tipo: 'debito',
      valorCentavos: precoCentavos,
      motivo: 'Consulta de CPF (CRM)',
      referenciaId: logId,
    })
    if ('erro' in debito) {
      await admin
        .from('parceiro_consultas_cpf')
        .update({ status: 'erro', erro: debito.saldoInsuficiente ? 'saldo insuficiente' : debito.erro })
        .eq('id', logId)
      if (debito.saldoInsuficiente) {
        const atual = await carregarCarteira(admin, input.agenteParceiroId)
        return { ok: false, status: 402, error: 'saldo_insuficiente', saldoCentavos: atual?.saldoCentavos ?? 0 }
      }
      console.error('[consulta-parceiro] falha no débito:', debito.erro)
      return { ok: false, status: 500, error: 'Falha ao debitar a carteira.' }
    }
    saldoCentavos = debito.saldo
    const lancamentoId = await buscarLancamentoId(admin, logId, 'debito')
    if (lancamentoId) await admin.from('parceiro_consultas_cpf').update({ lancamento_id: lancamentoId }).eq('id', logId)
  }

  // 6) Consulta pelo núcleo (cache, teto global, nvti_queries, WeSales).
  const outcome = await higienizarCpf({
    cpf,
    origin: 'service',
    serviceName: CONSULTA_PARCEIRO_SERVICE_NAME,
  })

  if (outcome.status !== 'ok') {
    // 7) Estorno + log 'estornada'.
    if (precoCentavos > 0) {
      const estorno = await aplicarLancamento(admin, {
        userId: carteira.userId,
        tipo: 'credito',
        valorCentavos: precoCentavos,
        motivo: 'Estorno consulta CPF',
        referenciaId: logId,
      })
      if ('saldo' in estorno) saldoCentavos = estorno.saldo
      else console.error('[consulta-parceiro] falha no estorno:', estorno.erro)
    }
    await admin
      .from('parceiro_consultas_cpf')
      .update({ status: 'estornada', erro: outcome.error })
      .eq('id', logId)

    const status = outcome.status === 'invalid' ? 400 : outcome.status === 'error' ? 500 : 503
    const error = outcome.status === 'invalid'
      ? 'CPF inválido.'
      : outcome.status === 'error'
        ? 'Falha ao consultar os dados. O valor foi estornado.'
        : 'Serviço de consulta indisponível no momento. O valor foi estornado.'
    return { ok: false, status, error }
  }

  // Cache pode ter sido detectado só no núcleo (corrida) — o log reflete o que foi cobrado.
  if (outcome.fromCache !== cacheHit) {
    await admin.from('parceiro_consultas_cpf').update({ cache_hit: outcome.fromCache }).eq('id', logId)
  }

  return {
    ok: true,
    cacheHit: outcome.fromCache,
    precoCentavos,
    saldoCentavos,
    dados: mapDadosConsultaParceiro(outcome.resultado),
  }
}
