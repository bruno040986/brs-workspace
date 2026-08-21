'use server'

/**
 * Server actions da Central de Integrações.
 *
 * Todas passam por requirePermission('central-integracoes') e fazem proxy à
 * Admin API do orquestrador (token só no servidor). Ações que COMANDAM algo
 * (jobs, retry) exigem can_include/can_edit; leitura exige can_view.
 *
 * Erros da Admin API viram { error } em vez de exception, para a UI mostrar a
 * mensagem sem quebrar a tela (orquestrador offline é estado esperado).
 */

import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'
import {
  ORCHESTRATORS,
  orchestratorConfigured,
  orchestratorFetch,
  OrchestratorApiError,
  type OrchestratorDef,
} from '@/lib/central/orchestrators'
import type {
  AudienceDefinition,
  CentralJob,
  CentralJobItem,
  JobAction,
  OrchestratorErrorLog,
  OrchestratorEvent,
} from './types'

type ActionResult<T> = ({ ok: true } & T) | { ok: false; error: string }

async function guard<T>(fn: () => Promise<T>): Promise<ActionResult<{ data: T }>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    if (err instanceof OrchestratorApiError) {
      return { ok: false, error: `[${err.slug}] ${err.message}` }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Erro inesperado.' }
  }
}

export interface OrchestratorSummary {
  slug: string
  name: string
  product: string
  description: string
  systems: string[]
  configured: boolean
  online: boolean
  health: {
    db: boolean
    env: Record<string, boolean>
    counters: { failedEvents: number; retryingEvents: number; activeJobs: number }
  } | null
  error: string | null
}

export interface OrchestratorStats {
  events24h: Array<{ source: string; status: string; count: number }>
  events7d: Array<{ source: string; status: string; count: number }>
  errors24h: Array<{ scope: string; count: number }>
  jobs: Array<{ status: string; count: number }>
  dailyQuota: Array<{ scope: string; used: number; limit: number | null }>
}

export interface NvtiCentralPanel {
  configured: boolean
  active: boolean
  monthSpend: number
  monthCap: number
  queries30d: { total: number; cached: number; byOrigin: Array<{ origin: string; count: number }> }
  activeBatches: number
}

export interface CentralOverview {
  orchestrators: OrchestratorSummary[]
  nvti: NvtiCentralPanel | null
}

function summarizeDef(def: OrchestratorDef) {
  return {
    slug: def.slug,
    name: def.name,
    product: def.product,
    description: def.description,
    systems: def.systems as string[],
    configured: orchestratorConfigured(def),
  }
}

export async function getCentralOverview(): Promise<CentralOverview> {
  await requirePermission('central-integracoes', 'can_view')

  const orchestrators = await Promise.all(
    ORCHESTRATORS.map(async (def): Promise<OrchestratorSummary> => {
      const base = summarizeDef(def)
      if (!base.configured) {
        return { ...base, online: false, health: null, error: `Configure ${def.tokenEnv} na Vercel.` }
      }
      try {
        const health = await orchestratorFetch<OrchestratorSummary['health'] & { ok: boolean }>(
          def.slug,
          '/api/admin/health',
          { timeoutMs: 8000 },
        )
        return { ...base, online: Boolean(health?.ok), health, error: null }
      } catch (err) {
        const message =
          err instanceof OrchestratorApiError ? err.message : 'Sem resposta do orquestrador.'
        return { ...base, online: false, health: null, error: message }
      }
    }),
  )

  let nvti: NvtiCentralPanel | null = null
  try {
    nvti = await getNvtiPanel()
  } catch {
    nvti = null
  }

  return { orchestrators, nvti }
}

async function getNvtiPanel(): Promise<NvtiCentralPanel> {
  const admin = await createAdminClient()
  const { getNvtiConfig } = await import('@/lib/nvti/config')
  const config = await getNvtiConfig()

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()

  const [spendRes, cachedRes, totalRes, batchesRes] = await Promise.all([
    admin.rpc('nvti_spend_by_user', { p_start: monthStart, p_end: now.toISOString() }),
    admin.from('nvti_queries').select('id', { count: 'exact', head: true }).gte('created_at', monthStart).eq('from_cache', true),
    admin.from('nvti_queries').select('id', { count: 'exact', head: true }).gte('created_at', monthStart),
    admin.from('nvti_batches').select('id', { count: 'exact', head: true }).in('status', ['pending', 'processing', 'paused_limit']),
  ])

  const spendRows = (spendRes.data as Array<{ origin: string; total: number; spend: number }> | null) ?? []
  const byOrigin = new Map<string, number>()
  let monthSpend = 0
  for (const row of spendRows) {
    byOrigin.set(row.origin, (byOrigin.get(row.origin) ?? 0) + Number(row.total))
    monthSpend += Number(row.spend) || 0
  }

  return {
    configured: config.has_credentials,
    active: config.is_active,
    monthSpend,
    monthCap: Number(config.monthly_cap_brl) || 0,
    queries30d: {
      total: totalRes.count ?? 0,
      cached: cachedRes.count ?? 0,
      byOrigin: [...byOrigin.entries()].map(([origin, count]) => ({ origin, count })),
    },
    activeBatches: batchesRes.count ?? 0,
  }
}

export async function getOrchestratorStats(slug: string) {
  await requirePermission('central-integracoes', 'can_view')
  return guard(() => orchestratorFetch<OrchestratorStats>(slug, '/api/admin/stats'))
}

export async function getOrchestratorEvents(
  slug: string,
  filters: { source?: string; status?: string; before?: number; limit?: number } = {},
) {
  await requirePermission('central-integracoes', 'can_view')
  const params = new URLSearchParams()
  if (filters.source) params.set('source', filters.source)
  if (filters.status) params.set('status', filters.status)
  if (filters.before) params.set('before', String(filters.before))
  params.set('limit', String(filters.limit ?? 50))
  return guard(() =>
    orchestratorFetch<{ events: OrchestratorEvent[] }>(slug, `/api/admin/events?${params}`),
  )
}

export async function getOrchestratorEventDetail(slug: string, id: number) {
  await requirePermission('central-integracoes', 'can_view')
  return guard(() =>
    orchestratorFetch<{ event: OrchestratorEvent }>(slug, `/api/admin/events?id=${id}`),
  )
}

export async function retryOrchestratorEvent(slug: string, id: number) {
  await requirePermission('central-integracoes', 'can_edit')
  return guard(() =>
    orchestratorFetch<{ ok: boolean; error?: string }>(slug, '/api/admin/events', {
      method: 'POST',
      body: { id },
      timeoutMs: 60_000,
    }),
  )
}

export async function getOrchestratorErrors(
  slug: string,
  filters: { scope?: string; before?: number; limit?: number } = {},
) {
  await requirePermission('central-integracoes', 'can_view')
  const params = new URLSearchParams()
  if (filters.scope) params.set('scope', filters.scope)
  if (filters.before) params.set('before', String(filters.before))
  params.set('limit', String(filters.limit ?? 50))
  return guard(() =>
    orchestratorFetch<{ errors: OrchestratorErrorLog[] }>(slug, `/api/admin/errors?${params}`),
  )
}

export interface WesalesMeta {
  tags: string[]
  pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }>
  customFields: Array<{ id: string; name: string; key: string; dataType: string }>
}

export async function getWesalesMeta(slug: string) {
  await requirePermission('central-integracoes', 'can_view')
  return guard(() => orchestratorFetch<WesalesMeta>(slug, '/api/admin/wesales-meta', { timeoutMs: 30_000 }))
}

export interface VendeaiMeta {
  inboxes: Array<{ id: string | number; name: string; templates: Array<{ name: string; category: string }> }>
}

export async function getVendeaiMeta(slug: string) {
  await requirePermission('central-integracoes', 'can_view')
  return guard(() => orchestratorFetch<VendeaiMeta>(slug, '/api/admin/vendeai-meta', { timeoutMs: 30_000 }))
}

export interface AudiencePreview {
  total: number
  sample: Array<{ contactId: string; phone: string | null; name: string | null; cpf: string | null }>
}

export async function previewCentralAudience(slug: string, audience: AudienceDefinition) {
  await requirePermission('central-integracoes', 'can_include')
  return guard(() =>
    orchestratorFetch<AudiencePreview>(slug, '/api/admin/audience-preview', {
      method: 'POST',
      body: { audience },
      timeoutMs: 30_000,
    }),
  )
}

export async function createCentralJob(
  slug: string,
  input: {
    action: JobAction
    label: string
    audience: AudienceDefinition
    params?: Record<string, unknown>
    pacing?: Record<string, unknown>
  },
) {
  const { user } = await requirePermission('central-integracoes', 'can_include')
  return guard(() =>
    orchestratorFetch<{ job: CentralJob }>(slug, '/api/admin/jobs', {
      method: 'POST',
      body: { ...input, createdBy: user.email ?? user.id },
      timeoutMs: 30_000,
    }),
  )
}

export async function listCentralJobs(slug: string) {
  await requirePermission('central-integracoes', 'can_view')
  return guard(() => orchestratorFetch<{ jobs: CentralJob[] }>(slug, '/api/admin/jobs?limit=100'))
}

export async function getCentralJob(slug: string, id: string, withItems = false) {
  await requirePermission('central-integracoes', 'can_view')
  return guard(() =>
    orchestratorFetch<{ job: CentralJob; items?: CentralJobItem[] }>(
      slug,
      `/api/admin/jobs?id=${encodeURIComponent(id)}${withItems ? '&items=1' : ''}`,
    ),
  )
}

export async function centralJobOp(slug: string, id: string, op: 'pause' | 'resume' | 'cancel') {
  await requirePermission('central-integracoes', 'can_include')
  return guard(() =>
    orchestratorFetch<{ job: CentralJob }>(slug, '/api/admin/jobs', {
      method: 'POST',
      body: { id, op },
    }),
  )
}
