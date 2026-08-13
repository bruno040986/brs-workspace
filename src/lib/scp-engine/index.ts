/**
 * Motor de execução do SCP — a máquina que faz o kanban andar sozinho.
 *
 * O cron chama `runDueJobs`, que drena a fila process_jobs. Ações são
 * enfileiradas com `enqueueJob` (idempotentes pela dedupe_key). O vocabulário
 * de ações vive em handlers.ts.
 */

export * from './decisions'
export * from './queue'
export * from './engine'
export { registerBuiltinHandlers } from './handlers'
