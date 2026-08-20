/**
 * Núcleo da higienização: valida CPF, aplica cache de reaproveitamento, checa
 * tetos de gasto (global e por usuário), cuida do ciclo de vida do token e
 * registra TODA consulta em nvti_queries (fonte do batimento com a fatura).
 *
 * Usado pela consulta manual (server action), pelo worker de lotes e pela rota
 * de serviço dos orquestradores.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/server'
import { getNvtiConfig, saveNvtiToken, type NvtiConfigState } from './config'
import { NvtiApiError, consultarCpfRemoto, gerarToken } from './client'
import { cleanCpf, isValidCpf } from './normalize'
import { costForCount, currentMonthRange, unitCostForPosition } from './pricing'
import type { HigienizacaoOutcome, NvtiOrigin, NvtiResultado } from './types'

const TOKEN_MAX_AGE_MS = 20 * 60 * 60 * 1000 // renova antes das 24h de validade

export type HigienizacaoInput = {
  cpf: string
  userId?: string | null
  origin: NvtiOrigin
  batchId?: string | null
  serviceName?: string | null
}

type LogRowInput = {
  cpf: string
  input: HigienizacaoInput
  fromCache: boolean
  billed: boolean
  unitCost: number
  success: boolean
  error?: string | null
  response?: NvtiResultado | null
}

async function insertQueryRow(admin: SupabaseClient, row: LogRowInput): Promise<string | undefined> {
  const { data } = await admin
    .from('nvti_queries')
    .insert({
      cpf: row.cpf,
      requested_by: row.input.userId || null,
      origin: row.input.origin,
      batch_id: row.input.batchId || null,
      service_name: row.input.serviceName || null,
      from_cache: row.fromCache,
      billed: row.billed,
      unit_cost_brl: row.unitCost,
      success: row.success,
      error: row.error || null,
      response: row.response ?? null,
    })
    .select('id')
    .single()
  return data?.id ? String(data.id) : undefined
}

async function countBilledInMonth(admin: SupabaseClient): Promise<number> {
  const { start, end } = currentMonthRange()
  const { count } = await admin
    .from('nvti_queries')
    .select('id', { count: 'exact', head: true })
    .eq('billed', true)
    .gte('created_at', start)
    .lt('created_at', end)
  return count ?? 0
}

async function getUserSpendInMonth(admin: SupabaseClient, userId: string): Promise<number> {
  const { start, end } = currentMonthRange()
  const { data } = await admin.rpc('nvti_user_spend', { p_user: userId, p_start: start, p_end: end })
  const value = Number(data)
  return Number.isFinite(value) ? value : 0
}

export async function getUserCap(admin: SupabaseClient, config: NvtiConfigState, userId: string): Promise<number> {
  const { data } = await admin
    .from('nvti_user_limits')
    .select('monthly_cap_brl')
    .eq('user_id', userId)
    .maybeSingle()
  const override = Number(data?.monthly_cap_brl)
  return Number.isFinite(override) ? override : config.user_monthly_cap_brl
}

async function ensureToken(config: NvtiConfigState, forceRefresh = false): Promise<string> {
  const generatedAt = config.token_generated_at ? new Date(config.token_generated_at).getTime() : 0
  const fresh = config.token && Date.now() - generatedAt < TOKEN_MAX_AGE_MS
  if (fresh && !forceRefresh) return config.token

  const token = await gerarToken({ usuario: config.usuario, senha: config.senha, cliente: config.cliente })
  if (config.id) await saveNvtiToken(config.id, token)
  config.token = token
  config.token_generated_at = new Date().toISOString()
  return token
}

export type SpendSnapshot = {
  billedCount: number
  globalSpend: number
  nextUnitCost: number
  monthlyCap: number
}

export async function getSpendSnapshot(admin: SupabaseClient, config: NvtiConfigState): Promise<SpendSnapshot> {
  const billedCount = await countBilledInMonth(admin)
  return {
    billedCount,
    globalSpend: costForCount(config.price_tiers, billedCount),
    nextUnitCost: unitCostForPosition(config.price_tiers, billedCount + 1),
    monthlyCap: config.monthly_cap_brl,
  }
}

export async function higienizarCpf(input: HigienizacaoInput): Promise<HigienizacaoOutcome> {
  const admin = await createAdminClient()

  const digits = cleanCpf(input.cpf)
  const cpf = digits.padStart(11, '0')
  if (!isValidCpf(cpf)) {
    return { status: 'invalid', error: `CPF inválido: "${input.cpf}"` }
  }

  const config = await getNvtiConfig()
  if (!config.has_credentials || !config.is_active) {
    return { status: 'not_configured', error: 'API Nova Vida TI não configurada ou inativa. Configure em Configurações > API Nova Vida TI.' }
  }

  // 1) Cache de reaproveitamento: consulta bem-sucedida dentro da janela é
  // servida do banco, sem nova cobrança.
  if (config.cache_days > 0) {
    const since = new Date(Date.now() - config.cache_days * 24 * 60 * 60 * 1000).toISOString()
    const { data: cachedRow } = await admin
      .from('nvti_queries')
      .select('id, response, created_at')
      .eq('cpf', cpf)
      .eq('success', true)
      .not('response', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (cachedRow?.response) {
      const resultado = cachedRow.response as NvtiResultado
      const queryId = await insertQueryRow(admin, {
        cpf,
        input,
        fromCache: true,
        billed: false,
        unitCost: 0,
        success: true,
        response: resultado,
      })
      return { status: 'ok', queryId: queryId || '', fromCache: true, unitCost: 0, resultado }
    }
  }

  // 2) Tetos de gasto — sempre ANTES de gastar.
  const snapshot = await getSpendSnapshot(admin, config)
  const unit = snapshot.nextUnitCost
  if (snapshot.globalSpend + unit > snapshot.monthlyCap + 1e-9) {
    return {
      status: 'blocked_global',
      error: `Limite mensal global atingido (teto de R$ ${snapshot.monthlyCap.toFixed(2)}). Solicite aumento a quem tem permissão de limites.`,
    }
  }
  if (input.userId) {
    const userCap = await getUserCap(admin, config, input.userId)
    const userSpend = await getUserSpendInMonth(admin, input.userId)
    if (userSpend + unit > userCap + 1e-9) {
      return {
        status: 'blocked_user',
        error: `Seu limite mensal de consultas foi atingido (teto de R$ ${userCap.toFixed(2)}). Solicite aumento a quem tem permissão de limites.`,
      }
    }
  }

  // 3) Consulta remota (token renovado sob demanda; 1 retry em token recusado).
  try {
    let token = await ensureToken(config)
    let resultado: NvtiResultado
    try {
      resultado = (await consultarCpfRemoto(config.metodo, token, cpf)).resultado
    } catch (error) {
      if (error instanceof NvtiApiError && error.kind === 'token') {
        token = await ensureToken(config, true)
        resultado = (await consultarCpfRemoto(config.metodo, token, cpf)).resultado
      } else {
        throw error
      }
    }

    const queryId = await insertQueryRow(admin, {
      cpf,
      input,
      fromCache: false,
      billed: true,
      unitCost: unit,
      success: true,
      response: resultado,
    })
    return { status: 'ok', queryId: queryId || '', fromCache: false, unitCost: unit, resultado }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao consultar a NVTI.'
    const queryId = await insertQueryRow(admin, {
      cpf,
      input,
      fromCache: false,
      billed: false,
      unitCost: 0,
      success: false,
      error: message,
    })
    return { status: 'error', error: message, queryId }
  }
}
