/**
 * Interpretação dos webhooks da Assinafy.
 *
 * A Assinafy entrega cada evento no máximo 2 vezes e entra em circuit breaker
 * após 10 falhas — então o webhook é a via rápida, e a reconciliação por polling
 * é a rede de segurança. Este módulo só interpreta o envelope (lógica pura);
 * a persistência e o polling ficam em documents.ts.
 */

import type { AssinafyDocumentStatus, AssinafyWebhookEvent } from './types'

/** Statuses terminais: não muda mais, não precisa reconciliar. */
export const TERMINAL_DOCUMENT_STATUSES: AssinafyDocumentStatus[] = [
  'certificated',
  'expired',
  'rejected_by_signer',
  'rejected_by_user',
  'failed',
]

export function isTerminalStatus(status: string | null | undefined): boolean {
  return TERMINAL_DOCUMENT_STATUSES.includes(String(status || '') as AssinafyDocumentStatus)
}

/** Status derivado de um evento, quando o objeto não traz o status atual. */
const EVENT_TO_STATUS: Partial<Record<AssinafyWebhookEvent, AssinafyDocumentStatus>> = {
  document_uploaded: 'uploaded',
  document_metadata_ready: 'metadata_ready',
  signature_requested: 'pending_signature',
  document_ready: 'certificated',
  document_processing_failed: 'failed',
  signer_rejected_document: 'rejected_by_signer',
  user_rejected_document: 'rejected_by_user',
}

export type WebhookInterpretation = {
  /** ID interno da atividade — chave de deduplicação. */
  externalId: string
  event: string
  documentId: string
  /** Novo status a aplicar, ou null quando o evento não muda o status (ex.: visualizou). */
  status: AssinafyDocumentStatus | null
  /** Nome do signatário envolvido, quando o evento traz. */
  signerName?: string
}

function extractDocumentId(envelope: any): string {
  const obj = envelope?.object
  if (obj && typeof obj === 'object') {
    // object pode ser o próprio Document, ou trazer document aninhado.
    if (String(obj.type || '') === 'Document' && obj.id) return String(obj.id)
    if (obj.document?.id) return String(obj.document.id)
    if (obj.id) return String(obj.id)
  }
  const payload = envelope?.payload
  if (payload && typeof payload === 'object') {
    if (payload.document_id) return String(payload.document_id)
    if (Array.isArray(payload.document_ids) && payload.document_ids[0]) return String(payload.document_ids[0])
  }
  return ''
}

/**
 * Interpreta o envelope do webhook. Prioriza o status que vem no objeto Document
 * (autoritativo); se ausente, deriva do tipo de evento.
 */
export function interpretWebhook(envelope: any): WebhookInterpretation {
  const event = String(envelope?.event || '')
  const externalId = String(envelope?.id ?? '')
  const documentId = extractDocumentId(envelope)

  const objectStatus = String(envelope?.object?.status || '') as AssinafyDocumentStatus
  const derived = EVENT_TO_STATUS[event as AssinafyWebhookEvent] || null
  const status = (objectStatus || derived || null) as AssinafyDocumentStatus | null

  const payload = envelope?.payload || {}
  const signerName =
    payload.signer_full_name || payload.user_name || payload.signer_email || undefined

  return { externalId, event, documentId, status, signerName }
}
