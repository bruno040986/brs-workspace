/**
 * Decisões puras do motor de execução do SCP.
 *
 * Isolar aqui a lógica sem I/O (backoff, prazo, retry, chave de dedupe) deixa o
 * comportamento do motor testável de verdade — que é justamente o que faltava
 * para a execução ser confiável e retomável.
 */

export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'canceled'

export type EngineJob = {
  id: string
  instance_id?: string | null
  kind: string
  payload?: Record<string, any>
  dedupe_key?: string | null
  status: JobStatus
  run_after: string
  attempts: number
  max_attempts: number
}

/** Backoff exponencial com teto. `attempts` é o nº da tentativa que acabou de falhar. */
export function computeBackoffSeconds(attempts: number, baseSeconds = 60, capSeconds = 3600): number {
  const n = Math.max(1, Math.floor(attempts))
  const delay = baseSeconds * Math.pow(2, n - 1)
  return Math.min(delay, capSeconds)
}

/** Um job está pronto para rodar? (pendente e com run_after já vencido) */
export function isJobDue(job: Pick<EngineJob, 'status' | 'run_after'>, nowIso: string): boolean {
  if (job.status !== 'pending') return false
  const runAfter = Date.parse(job.run_after)
  const now = Date.parse(nowIso)
  if (Number.isNaN(runAfter) || Number.isNaN(now)) return false
  return runAfter <= now
}

/** Ainda há tentativas? */
export function shouldRetry(attempts: number, maxAttempts: number): boolean {
  return attempts < maxAttempts
}

/**
 * Decide o próximo estado após uma falha: reagenda (pending + run_after futuro)
 * enquanto houver tentativas; senão marca failed.
 */
export function planFailureOutcome(
  attempts: number,
  maxAttempts: number,
  nowIso: string,
): { status: JobStatus; runAfterIso?: string } {
  if (shouldRetry(attempts, maxAttempts)) {
    const backoff = computeBackoffSeconds(attempts)
    const next = new Date(Date.parse(nowIso) + backoff * 1000).toISOString()
    return { status: 'pending', runAfterIso: next }
  }
  return { status: 'failed' }
}

/**
 * Chave de deduplicação idempotente. Ex.: buildDedupeKey('instance', id, 'stage', s, 'action', a).
 * Garante que a mesma ação não seja enfileirada/executada duas vezes.
 */
export function buildDedupeKey(...parts: Array<string | number | null | undefined>): string {
  return parts
    .filter((p) => p !== null && p !== undefined && String(p).trim() !== '')
    .map((p) => String(p).trim())
    .join(':')
}
