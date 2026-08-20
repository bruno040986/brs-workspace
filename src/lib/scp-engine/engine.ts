/**
 * Núcleo de execução do motor: claim → dispatch → complete/fail.
 *
 * Contrato de execução (o que faltava e travou o desenvolvimento anterior):
 *  - cada job é reivindicado com lock otimista (não roda duas vezes);
 *  - o handler executa a ação; se lançar, o job é reagendado com backoff;
 *  - ações são idempotentes pela dedupe_key ao serem enfileiradas.
 */

import { claimDueJobs, completeJob, failJob } from './queue'
import { registerBuiltinHandlers } from './handlers'
import { registerAgendaHandlers } from '@/lib/agenda/reminders'
import type { EngineJob } from './decisions'

export type JobHandler = (job: EngineJob) => Promise<void>

const handlers = new Map<string, JobHandler>()

export function registerHandler(kind: string, fn: JobHandler): void {
  handlers.set(kind, fn)
}

export function getRegisteredKinds(): string[] {
  return Array.from(handlers.keys())
}

/** Executa um único job pelo handler do seu kind. Lança se não houver handler. */
export async function executeJob(job: EngineJob): Promise<void> {
  const handler = handlers.get(job.kind)
  if (!handler) throw new Error(`Handler desconhecido para kind='${job.kind}'`)
  await handler(job)
}

export type RunResult = {
  claimed: number
  results: Array<{ id: string; kind: string; ok: boolean; error?: string }>
}

/**
 * Drena a fila: reivindica os jobs vencidos e executa cada um, marcando
 * concluído ou reagendando em caso de falha. É o que o cron chama.
 */
export async function runDueJobs(workerId: string, limit = 10): Promise<RunResult> {
  registerBuiltinHandlers({ registerHandler })
  registerAgendaHandlers({ registerHandler })

  const claimed = await claimDueJobs(workerId, limit)
  const results: RunResult['results'] = []

  for (const job of claimed) {
    try {
      await executeJob(job)
      await completeJob(job.id)
      results.push({ id: job.id, kind: job.kind, ok: true })
    } catch (err: any) {
      await failJob(job, err?.message || String(err))
      results.push({ id: job.id, kind: job.kind, ok: false, error: err?.message || String(err) })
    }
  }

  return { claimed: claimed.length, results }
}
