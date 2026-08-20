'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/permissions'
import { getNvtiConfig } from '@/lib/nvti/config'
import { getSpendSnapshot, getUserCap, higienizarCpf } from '@/lib/nvti/service'
import { costForCount } from '@/lib/nvti/pricing'
import type { HigienizacaoOutcome, NvtiBatchRow } from '@/lib/nvti/types'

export type NvtiPanorama = {
  configured: boolean
  active: boolean
  metodo: string
  cacheDays: number
  global: { spend: number; cap: number; billedCount: number; nextUnit: number }
  user: { spend: number; cap: number }
  canImport: boolean
  canSeeConsumo: boolean
  canEditLimites: boolean
}

export async function getNvtiPanorama(): Promise<NvtiPanorama> {
  const { user, permissions } = await requirePermission('operacional-nvti', 'can_view')
  const admin = await createAdminClient()
  const config = await getNvtiConfig()
  const snapshot = await getSpendSnapshot(admin, config)

  const { data: userSpendData } = await admin.rpc('nvti_user_spend', {
    p_user: user.id,
    p_start: monthStartIso(),
    p_end: monthEndIso(),
  })
  const userSpend = Number(userSpendData) || 0
  const userCap = await getUserCap(admin, config, user.id)

  return {
    configured: config.has_credentials,
    active: config.is_active,
    metodo: config.metodo,
    cacheDays: config.cache_days,
    global: {
      spend: snapshot.globalSpend,
      cap: snapshot.monthlyCap,
      billedCount: snapshot.billedCount,
      nextUnit: snapshot.nextUnitCost,
    },
    user: { spend: userSpend, cap: userCap },
    canImport: hasPermission(permissions, 'operacional-nvti', 'can_include'),
    canSeeConsumo: hasPermission(permissions, 'operacional-nvti-consumo', 'can_view'),
    canEditLimites: hasPermission(permissions, 'operacional-nvti-limites', 'can_edit'),
  }
}

function monthStartIso(reference = new Date()): string {
  return new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1)).toISOString()
}

function monthEndIso(reference = new Date()): string {
  return new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 1)).toISOString()
}

export async function consultarCpfNvti(cpf: string): Promise<HigienizacaoOutcome> {
  const { user } = await requirePermission('operacional-nvti', 'can_include')
  return higienizarCpf({ cpf, userId: user.id, origin: 'manual' })
}

export type NvtiBatchListItem = NvtiBatchRow & { created_by_name: string }

export async function listNvtiBatches(): Promise<NvtiBatchListItem[]> {
  const { user, permissions } = await requirePermission('operacional-nvti', 'can_view')
  const admin = await createAdminClient()
  const seeAll = hasPermission(permissions, 'operacional-nvti-consumo', 'can_view')

  let query = admin
    .from('nvti_batches')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  if (!seeAll) query = query.eq('created_by', user.id)

  const { data: batches } = await query
  const rows = (batches || []) as NvtiBatchRow[]
  const userIds = Array.from(new Set(rows.map((row) => row.created_by)))
  const names = await getUserNames(admin, userIds)
  return rows.map((row) => ({ ...row, created_by_name: names.get(row.created_by) || '—' }))
}

export async function cancelNvtiBatch(batchId: string): Promise<{ ok: boolean }> {
  const { user, permissions } = await requirePermission('operacional-nvti', 'can_include')
  const admin = await createAdminClient()
  const { data: batch } = await admin
    .from('nvti_batches')
    .select('id, created_by, status')
    .eq('id', batchId)
    .maybeSingle()
  if (!batch) throw new Error('Lote não encontrado.')
  const isOwner = batch.created_by === user.id
  const isAdmin = hasPermission(permissions, 'operacional-nvti-limites', 'can_edit')
  if (!isOwner && !isAdmin) throw new Error('Sem permissão para cancelar este lote.')
  if (!['pending', 'processing', 'paused_limit'].includes(String(batch.status))) {
    throw new Error('Este lote não pode mais ser cancelado.')
  }
  await admin.from('nvti_batches').update({ status: 'canceled' }).eq('id', batchId)
  return { ok: true }
}

async function getUserNames(
  admin: Awaited<ReturnType<typeof createAdminClient>>,
  userIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (!userIds.length) return names
  const { data } = await admin.from('users').select('id, name, email').in('id', userIds)
  for (const row of data || []) {
    names.set(String(row.id), String(row.name || row.email || '—'))
  }
  return names
}

export type NvtiConsumoUsuario = {
  userId: string
  name: string
  total: number
  billed: number
  cached: number
  errors: number
  spend: number
  cap: number | null
}

export type NvtiConsumo = {
  year: number
  month: number
  totalQueries: number
  billedCount: number
  cachedCount: number
  errorCount: number
  spendEstimate: number
  byOrigin: Array<{ origin: string; total: number; billed: number; spend: number }>
  byUser: NvtiConsumoUsuario[]
}

export async function getNvtiConsumo(year?: number, month?: number): Promise<NvtiConsumo> {
  await requirePermission('operacional-nvti-consumo', 'can_view')
  const admin = await createAdminClient()
  const config = await getNvtiConfig()

  const now = new Date()
  const y = Number.isFinite(year) ? Number(year) : now.getUTCFullYear()
  const m = Number.isFinite(month) ? Number(month) : now.getUTCMonth() + 1
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString()
  const end = new Date(Date.UTC(y, m, 1)).toISOString()

  const { data } = await admin.rpc('nvti_spend_by_user', { p_start: start, p_end: end })
  type SpendRow = {
    user_id: string | null
    origin: string
    total: number
    billed_count: number
    cached_count: number
    error_count: number
    spend: number
  }
  const rows = (Array.isArray(data) ? data : []) as SpendRow[]

  const byOriginMap = new Map<string, { origin: string; total: number; billed: number; spend: number }>()
  const byUserMap = new Map<string, NvtiConsumoUsuario>()
  let totalQueries = 0
  let billedCount = 0
  let cachedCount = 0
  let errorCount = 0

  for (const row of rows) {
    totalQueries += Number(row.total) || 0
    billedCount += Number(row.billed_count) || 0
    cachedCount += Number(row.cached_count) || 0
    errorCount += Number(row.error_count) || 0

    const originEntry = byOriginMap.get(row.origin) || { origin: row.origin, total: 0, billed: 0, spend: 0 }
    originEntry.total += Number(row.total) || 0
    originEntry.billed += Number(row.billed_count) || 0
    originEntry.spend += Number(row.spend) || 0
    byOriginMap.set(row.origin, originEntry)

    const userKey = row.user_id || 'service'
    const userEntry = byUserMap.get(userKey) || {
      userId: userKey,
      name: row.user_id ? '' : 'Orquestradores (serviço)',
      total: 0,
      billed: 0,
      cached: 0,
      errors: 0,
      spend: 0,
      cap: null,
    }
    userEntry.total += Number(row.total) || 0
    userEntry.billed += Number(row.billed_count) || 0
    userEntry.cached += Number(row.cached_count) || 0
    userEntry.errors += Number(row.error_count) || 0
    userEntry.spend += Number(row.spend) || 0
    byUserMap.set(userKey, userEntry)
  }

  const realUserIds = Array.from(byUserMap.keys()).filter((key) => key !== 'service')
  const names = await getUserNames(admin, realUserIds)
  const { data: limits } = realUserIds.length
    ? await admin.from('nvti_user_limits').select('user_id, monthly_cap_brl').in('user_id', realUserIds)
    : { data: [] }
  const capOverrides = new Map((limits || []).map((row) => [String(row.user_id), Number(row.monthly_cap_brl)]))

  const byUser = Array.from(byUserMap.values())
    .map((entry) => ({
      ...entry,
      name: entry.userId === 'service' ? entry.name : names.get(entry.userId) || '—',
      cap: entry.userId === 'service' ? null : capOverrides.get(entry.userId) ?? config.user_monthly_cap_brl,
    }))
    .sort((a, b) => b.spend - a.spend || b.total - a.total)

  // Estimativa em cascata a partir da contagem cobrada (bate com a régua da proposta).
  const spendEstimate = costForCount(config.price_tiers, billedCount)

  return {
    year: y,
    month: m,
    totalQueries,
    billedCount,
    cachedCount,
    errorCount,
    spendEstimate,
    byOrigin: Array.from(byOriginMap.values()).sort((a, b) => b.total - a.total),
    byUser,
  }
}

export type NvtiLimitesState = {
  globalCap: number
  defaultUserCap: number
  users: Array<{ userId: string; name: string; cap: number | null; spend: number }>
}

export async function getNvtiLimites(): Promise<NvtiLimitesState> {
  await requirePermission('operacional-nvti-limites', 'can_view')
  const admin = await createAdminClient()
  const config = await getNvtiConfig()

  const { data: users } = await admin.from('users').select('id, name, email').order('name', { ascending: true })
  const { data: limits } = await admin.from('nvti_user_limits').select('user_id, monthly_cap_brl')
  const capOverrides = new Map((limits || []).map((row) => [String(row.user_id), Number(row.monthly_cap_brl)]))

  const start = monthStartIso()
  const end = monthEndIso()
  const { data: spendRows } = await admin.rpc('nvti_spend_by_user', { p_start: start, p_end: end })
  const spendByUser = new Map<string, number>()
  for (const row of (Array.isArray(spendRows) ? spendRows : []) as Array<{ user_id: string | null; spend: number }>) {
    if (!row.user_id) continue
    spendByUser.set(String(row.user_id), (spendByUser.get(String(row.user_id)) || 0) + (Number(row.spend) || 0))
  }

  return {
    globalCap: config.monthly_cap_brl,
    defaultUserCap: config.user_monthly_cap_brl,
    users: (users || []).map((row) => ({
      userId: String(row.id),
      name: String(row.name || row.email || '—'),
      cap: capOverrides.has(String(row.id)) ? capOverrides.get(String(row.id))! : null,
      spend: spendByUser.get(String(row.id)) || 0,
    })),
  }
}

export async function setNvtiGlobalCap(newCap: number): Promise<{ ok: boolean }> {
  const { user } = await requirePermission('operacional-nvti-limites', 'can_edit')
  const cap = Number(newCap)
  if (!Number.isFinite(cap) || cap < 0) throw new Error('Informe um valor válido para o teto global.')

  const admin = await createAdminClient()
  const config = await getNvtiConfig()
  if (!config.id) throw new Error('Configure a API Nova Vida TI antes de definir limites.')

  await admin.from('nvti_config').update({ monthly_cap_brl: cap }).eq('id', config.id)
  await admin.from('nvti_limit_events').insert({
    scope: 'global',
    old_value: config.monthly_cap_brl,
    new_value: cap,
    changed_by: user.id,
  })
  return { ok: true }
}

export async function setNvtiDefaultUserCap(newCap: number): Promise<{ ok: boolean }> {
  const { user } = await requirePermission('operacional-nvti-limites', 'can_edit')
  const cap = Number(newCap)
  if (!Number.isFinite(cap) || cap < 0) throw new Error('Informe um valor válido para o teto padrão por usuário.')

  const admin = await createAdminClient()
  const config = await getNvtiConfig()
  if (!config.id) throw new Error('Configure a API Nova Vida TI antes de definir limites.')

  await admin.from('nvti_config').update({ user_monthly_cap_brl: cap }).eq('id', config.id)
  await admin.from('nvti_limit_events').insert({
    scope: 'user',
    user_id: null,
    old_value: config.user_monthly_cap_brl,
    new_value: cap,
    changed_by: user.id,
  })
  return { ok: true }
}

export async function setNvtiUserCap(userId: string, newCap: number | null): Promise<{ ok: boolean }> {
  const { user } = await requirePermission('operacional-nvti-limites', 'can_edit')
  if (!userId) throw new Error('Usuário inválido.')

  const admin = await createAdminClient()
  const { data: existing } = await admin
    .from('nvti_user_limits')
    .select('monthly_cap_brl')
    .eq('user_id', userId)
    .maybeSingle()
  const oldValue = existing ? Number(existing.monthly_cap_brl) : null

  if (newCap === null) {
    await admin.from('nvti_user_limits').delete().eq('user_id', userId)
  } else {
    const cap = Number(newCap)
    if (!Number.isFinite(cap) || cap < 0) throw new Error('Informe um valor válido para o teto do usuário.')
    await admin.from('nvti_user_limits').upsert(
      { user_id: userId, monthly_cap_brl: cap, updated_by: user.id, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
  }

  const config = await getNvtiConfig()
  await admin.from('nvti_limit_events').insert({
    scope: 'user',
    user_id: userId,
    old_value: oldValue,
    new_value: newCap === null ? config.user_monthly_cap_brl : Number(newCap),
    changed_by: user.id,
  })
  return { ok: true }
}
