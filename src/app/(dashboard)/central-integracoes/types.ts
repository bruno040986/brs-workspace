/**
 * Tipos e rótulos compartilhados entre server actions e componentes da
 * Central de Integrações (sem código de servidor — importável no cliente).
 */

export type JobAction =
  | 'callface_calls'
  | 'vendeai_template'
  | 'vendeai_leads'
  | 'nvti_hygiene'
  | 'credit_base_import'

export type JobStatus =
  | 'loading'
  | 'queued'
  | 'materializing'
  | 'running'
  | 'waiting_window'
  | 'paused'
  | 'done'
  | 'error'
  | 'canceled'

export interface AudienceDefinition {
  tagsAny?: string[]
  tagsAll?: string[]
  tagsNone?: string[]
  customFields?: Array<{ key: string; value: string }>
  excludeDnd?: boolean
}

export interface CentralJob {
  id: string
  action: JobAction
  label: string | null
  status: JobStatus
  audience: AudienceDefinition | null
  params: Record<string, unknown> | null
  pacing: { perMinute?: number; windowStart?: string; windowEnd?: string; days?: number[] } | null
  total: number
  processed: number
  succeeded: number
  failed: number
  skipped: number
  created_by: string | null
  note: string | null
  last_error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface CentralJobItem {
  id: number
  contact_id: string | null
  phone: string | null
  name: string | null
  cpf: string | null
  status: 'pending' | 'done' | 'error' | 'skipped'
  result: unknown
  error: string | null
  processed_at: string | null
}

export interface OrchestratorEvent {
  id: number
  source: string
  event_type: string
  event_id: string
  status: string
  error: string | null
  attempts: number
  received_at: string
  processed_at: string | null
  payload?: unknown
}

export interface OrchestratorErrorLog {
  id: number
  scope: string
  message: string
  context: unknown
  webhook_event_id: number | null
  created_at: string
}

export const JOB_ACTION_LABEL: Record<JobAction, string> = {
  callface_calls: 'Ligações CallFace',
  vendeai_template: 'Template WhatsApp (Vende.AI)',
  vendeai_leads: 'Pré-cadastro Vende.AI',
  nvti_hygiene: 'Higienização NVTI',
  credit_base_import: 'Import de base (motor de crédito)',
}

export const JOB_STATUS_LABEL: Record<JobStatus, { label: string; badge: string }> = {
  loading: { label: 'Recebendo base', badge: 'badge-info' },
  queued: { label: 'Na fila', badge: 'badge-gray' },
  materializing: { label: 'Resolvendo público', badge: 'badge-info' },
  running: { label: 'Executando', badge: 'badge-info' },
  waiting_window: { label: 'Aguardando janela', badge: 'badge-warning' },
  paused: { label: 'Pausado', badge: 'badge-warning' },
  done: { label: 'Concluído', badge: 'badge-success' },
  error: { label: 'Erro', badge: 'badge-danger' },
  canceled: { label: 'Cancelado', badge: 'badge-gray' },
}

export const EVENT_STATUS_LABEL: Record<string, { label: string; badge: string }> = {
  received: { label: 'Recebido', badge: 'badge-gray' },
  processed: { label: 'Processado', badge: 'badge-success' },
  failed: { label: 'Falhou', badge: 'badge-danger' },
  retrying: { label: 'Retentando', badge: 'badge-warning' },
}
