/**
 * Fila do motor: operações no banco sobre process_jobs.
 *
 * `enqueue` é idempotente (dedupe_key). `claimDueJobs` usa lock otimista — dois
 * crons concorrentes nunca pegam o mesmo job. Tolerante à migração ainda não
 * aplicada (não quebra o resto do sistema).
 */

import { planFailureOutcome, type EngineJob } from './decisions'

const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01'])
function isMissingTable(error: any): boolean {
  return !!error && MISSING_TABLE_CODES.has(String(error.code || ''))
}

async function admin() {
  const { createAdminClient } = await import('@/lib/supabase/server')
  return createAdminClient()
}

export type EnqueueInput = {
  kind: string
  instanceId?: string | null
  payload?: Record<string, any>
  dedupeKey?: string
  runAfterIso?: string
  maxAttempts?: number
}

/**
 * Enfileira um job. Se a dedupe_key já existir, NÃO cria outro (idempotente):
 * retorna { enqueued: false, deduped: true }.
 */
export async function enqueueJob(input: EnqueueInput): Promise<{ enqueued: boolean; deduped?: boolean; id?: string; error?: string }> {
  try {
    const supabase = await admin()
    const row = {
      kind: input.kind,
      instance_id: input.instanceId || null,
      payload: input.payload || {},
      dedupe_key: input.dedupeKey || null,
      run_after: input.runAfterIso || new Date().toISOString(),
      max_attempts: input.maxAttempts ?? 5,
      status: 'pending' as const,
    }

    const { data, error } = await supabase.from('process_jobs').insert(row).select('id').maybeSingle()
    if (error) {
      // Violação de unique na dedupe_key → já existe, tudo certo.
      if (String(error.code || '') === '23505') return { enqueued: false, deduped: true }
      throw error
    }
    return { enqueued: true, id: String(data?.id || '') }
  } catch (error: any) {
    if (isMissingTable(error)) return { enqueued: false, error: 'tabela ausente' }
    console.error('Erro ao enfileirar job:', error?.message)
    return { enqueued: false, error: error?.message }
  }
}

/**
 * Reivindica até `limit` jobs pendentes e vencidos, marcando cada um como
 * running via update condicional (status ainda = pending). Se o update não
 * pegar a linha, outro worker levou — segue para o próximo.
 */
export async function claimDueJobs(workerId: string, limit = 10): Promise<EngineJob[]> {
  try {
    const supabase = await admin()
    const nowIso = new Date().toISOString()

    const { data: candidates, error } = await supabase
      .from('process_jobs')
      .select('*')
      .eq('status', 'pending')
      .lte('run_after', nowIso)
      .order('run_after', { ascending: true })
      .limit(limit)
    if (error) throw error

    const claimed: EngineJob[] = []
    for (const job of candidates || []) {
      const { data: updated, error: updErr } = await supabase
        .from('process_jobs')
        .update({
          status: 'running',
          locked_at: nowIso,
          locked_by: workerId,
          attempts: (job.attempts || 0) + 1,
          updated_at: nowIso,
        })
        .eq('id', job.id)
        .eq('status', 'pending') // lock otimista
        .select('*')
        .maybeSingle()
      if (updErr) continue
      if (updated) claimed.push(updated as EngineJob)
    }
    return claimed
  } catch (error: any) {
    if (isMissingTable(error)) return []
    console.error('Erro ao reivindicar jobs:', error?.message)
    return []
  }
}

/** Marca um job como concluído. */
export async function completeJob(jobId: string): Promise<void> {
  try {
    const supabase = await admin()
    await supabase
      .from('process_jobs')
      .update({ status: 'done', last_error: null, updated_at: new Date().toISOString() })
      .eq('id', jobId)
  } catch (error: any) {
    if (!isMissingTable(error)) console.error('Erro ao concluir job:', error?.message)
  }
}

/**
 * Registra a falha de um job: reagenda com backoff enquanto houver tentativas,
 * senão marca failed. A decisão vem de planFailureOutcome (pura, testada).
 */
export async function failJob(job: EngineJob, errorMessage: string): Promise<void> {
  try {
    const supabase = await admin()
    const nowIso = new Date().toISOString()
    const outcome = planFailureOutcome(job.attempts, job.max_attempts, nowIso)
    const patch: Record<string, any> = {
      status: outcome.status,
      last_error: String(errorMessage || '').slice(0, 2000),
      updated_at: nowIso,
      locked_at: null,
      locked_by: null,
    }
    if (outcome.runAfterIso) patch.run_after = outcome.runAfterIso
    await supabase.from('process_jobs').update(patch).eq('id', job.id)
  } catch (error: any) {
    if (!isMissingTable(error)) console.error('Erro ao registrar falha do job:', error?.message)
  }
}

/** Lista jobs recentes (para inspeção/monitoramento). */
export async function listRecentJobs(limit = 30): Promise<EngineJob[]> {
  try {
    const supabase = await admin()
    const { data, error } = await supabase
      .from('process_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data || []) as EngineJob[]
  } catch (error: any) {
    if (isMissingTable(error)) return []
    console.error('Erro ao listar jobs:', error?.message)
    return []
  }
}
