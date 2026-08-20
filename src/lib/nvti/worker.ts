/**
 * Worker dos lotes de higienização NVTI.
 *
 * Mesmo desenho do worker de campanhas de WhatsApp: agendado pelo Vercel Cron
 * (rede de segurança) e "kickado" ao criar um lote; lock por lote com
 * renovação; estado persistido item a item — timeout no meio não perde nem
 * duplica consulta (o cache de reaproveitamento absorve reprocessos).
 *
 * Lote que esbarra em teto de gasto vira status 'paused_limit' e é retomado
 * automaticamente pelo cron quando o teto for aumentado (a checagem é barata:
 * o primeiro item bloqueado repausa o lote sem gastar nada).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/server'
import { higienizarCpf } from './service'
import type { NvtiBatchRow } from './types'

const LOCK_SECONDS = 90
const RENEW_EVERY_ITEMS = 15
const COUNTER_FLUSH_EVERY = 10
const ITEMS_PAGE_SIZE = 200

export type NvtiWorkerSummary = {
  batchesTouched: number
  itemsProcessed: number
  cached: number
  errors: number
  workRemains: boolean
  stoppedReason?: string
}

function workerIdentity(): string {
  return `nvti-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
}

async function claimNextBatch(admin: SupabaseClient, workerId: string): Promise<NvtiBatchRow | null> {
  const nowIso = new Date().toISOString()
  const until = new Date(Date.now() + LOCK_SECONDS * 1000).toISOString()

  const { data: candidates } = await admin
    .from('nvti_batches')
    .select('*')
    .in('status', ['pending', 'processing', 'paused_limit'])
    .or(`worker_lock_until.is.null,worker_lock_until.lt.${nowIso}`)
    .order('created_at', { ascending: true })
    .limit(5)

  for (const candidate of candidates || []) {
    const { data: locked } = await admin
      .from('nvti_batches')
      .update({ worker_lock_until: until, worker_lock_by: workerId, status: 'processing' })
      .eq('id', candidate.id)
      .or(`worker_lock_until.is.null,worker_lock_until.lt.${nowIso}`)
      .select('*')
      .maybeSingle()
    if (locked) return locked as NvtiBatchRow
  }
  return null
}

async function renewLock(admin: SupabaseClient, batchId: string, workerId: string): Promise<boolean> {
  const { data } = await admin
    .from('nvti_batches')
    .update({ worker_lock_until: new Date(Date.now() + LOCK_SECONDS * 1000).toISOString() })
    .eq('id', batchId)
    .eq('worker_lock_by', workerId)
    .select('id')
    .maybeSingle()
  return Boolean(data)
}

async function releaseBatch(
  admin: SupabaseClient,
  batchId: string,
  workerId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await admin
    .from('nvti_batches')
    .update({ ...patch, worker_lock_until: null, worker_lock_by: null })
    .eq('id', batchId)
    .eq('worker_lock_by', workerId)
}

/** Recontagem dos contadores do lote a partir do banco (retomada segura). */
async function recountBatch(admin: SupabaseClient, batchId: string) {
  const [processedRes, errorsRes, cachedRes] = await Promise.all([
    admin.from('nvti_batch_items').select('id', { count: 'exact', head: true }).eq('batch_id', batchId).in('status', ['done', 'error']),
    admin.from('nvti_batch_items').select('id', { count: 'exact', head: true }).eq('batch_id', batchId).eq('status', 'error'),
    admin.from('nvti_queries').select('id', { count: 'exact', head: true }).eq('batch_id', batchId).eq('from_cache', true),
  ])
  return {
    processed: processedRes.count ?? 0,
    errors: errorsRes.count ?? 0,
    cached: cachedRes.count ?? 0,
  }
}

export async function runNvtiWorker(options: { budgetMs?: number; workerId?: string } = {}): Promise<NvtiWorkerSummary> {
  const budgetMs = Math.max(10_000, options.budgetMs ?? 265_000)
  const deadline = Date.now() + budgetMs
  const workerId = options.workerId || workerIdentity()
  const admin = await createAdminClient()

  const summary: NvtiWorkerSummary = {
    batchesTouched: 0,
    itemsProcessed: 0,
    cached: 0,
    errors: 0,
    workRemains: false,
  }

  while (Date.now() < deadline - 8_000) {
    const batch = await claimNextBatch(admin, workerId)
    if (!batch) break
    summary.batchesTouched += 1

    const counters = await recountBatch(admin, batch.id)
    let sinceFlush = 0
    let sinceRenew = 0
    let paused = false
    let fatal: string | null = null

    const flushCounters = async () => {
      await admin
        .from('nvti_batches')
        .update({ processed: counters.processed, errors: counters.errors, cached: counters.cached })
        .eq('id', batch.id)
      sinceFlush = 0
    }

    batchLoop: while (true) {
      if (Date.now() > deadline - 8_000) {
        await flushCounters()
        await releaseBatch(admin, batch.id, workerId, {})
        summary.workRemains = true
        summary.stoppedReason = 'budget'
        return summary
      }

      const { data: items } = await admin
        .from('nvti_batch_items')
        .select('id, cpf')
        .eq('batch_id', batch.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(ITEMS_PAGE_SIZE)

      if (!items || !items.length) break

      for (const item of items) {
        if (Date.now() > deadline - 8_000) {
          await flushCounters()
          await releaseBatch(admin, batch.id, workerId, {})
          summary.workRemains = true
          summary.stoppedReason = 'budget'
          return summary
        }

        sinceRenew += 1
        if (sinceRenew >= RENEW_EVERY_ITEMS) {
          sinceRenew = 0
          const owned = await renewLock(admin, batch.id, workerId)
          if (!owned) {
            summary.stoppedReason = 'lock_lost'
            summary.workRemains = true
            return summary
          }
        }

        const outcome = await higienizarCpf({
          cpf: item.cpf,
          userId: batch.created_by,
          origin: 'batch',
          batchId: batch.id,
        })

        if (outcome.status === 'blocked_global' || outcome.status === 'blocked_user') {
          paused = true
          await flushCounters()
          await releaseBatch(admin, batch.id, workerId, { status: 'paused_limit', last_error: outcome.error })
          break batchLoop
        }
        if (outcome.status === 'not_configured') {
          fatal = outcome.error
          await flushCounters()
          await releaseBatch(admin, batch.id, workerId, { status: 'error', last_error: outcome.error })
          break batchLoop
        }

        if (outcome.status === 'ok') {
          await admin
            .from('nvti_batch_items')
            .update({ status: 'done', query_id: outcome.queryId || null, processed_at: new Date().toISOString() })
            .eq('id', item.id)
          counters.processed += 1
          if (outcome.fromCache) {
            counters.cached += 1
            summary.cached += 1
          }
        } else {
          await admin
            .from('nvti_batch_items')
            .update({ status: 'error', error: outcome.error.slice(0, 500), processed_at: new Date().toISOString() })
            .eq('id', item.id)
          counters.processed += 1
          counters.errors += 1
          summary.errors += 1
        }

        summary.itemsProcessed += 1
        sinceFlush += 1
        if (sinceFlush >= COUNTER_FLUSH_EVERY) await flushCounters()
      }
    }

    if (!paused && !fatal) {
      await flushCounters()
      await releaseBatch(admin, batch.id, workerId, {
        status: 'done',
        finished_at: new Date().toISOString(),
        last_error: null,
      })
    }
  }

  // Ainda existe lote elegível? (informativo para o encadeamento do cron)
  if (!summary.workRemains) {
    const { count } = await admin
      .from('nvti_batches')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'processing'])
    summary.workRemains = (count ?? 0) > 0
  }

  return summary
}

/** Aciona o worker imediatamente (o cron de 2 min é a rede de segurança). */
export async function kickNvtiWorker(): Promise<void> {
  try {
    const secret = String(process.env.CRON_SECRET || '')
    if (!secret) return
    const { getAppBaseUrl } = await import('@/lib/zapi/webhooks')
    const url = `${getAppBaseUrl()}/api/cron/nvti-batches?kick=1`
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(2500),
      cache: 'no-store',
    }).catch(() => undefined)
  } catch {
    // silencioso: o cron é a rede de segurança
  }
}
