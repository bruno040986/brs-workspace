/**
 * Gestão de webhooks da Z-API por instância.
 *
 * As instâncias podem ser compartilhadas com o ARW, que já tem webhooks
 * configurados. Regra de ouro: NUNCA sobrescrever às cegas. Lemos o GET /me,
 * classificamos cada URL (nossa / externa / vazia) e só alteramos com plano
 * explícito. No modo "relay" guardamos a URL externa em `webhook_relay_urls`
 * antes de assumir, e nosso endpoint repassa o payload bruto para ela.
 */

import type { ZapiInstanceRow, ZapiMe, ZapiWebhookKind } from './types'
import { ME_FIELD_BY_WEBHOOK, ZapiClient } from './client'

export const WEBHOOK_KINDS: ZapiWebhookKind[] = ['received', 'delivery', 'message_status', 'disconnected', 'connected']

export const WEBHOOK_KIND_LABELS: Record<ZapiWebhookKind, string> = {
  received: 'Mensagem recebida (respostas / opt-out)',
  delivery: 'Mensagem enviada (entrega à Z-API)',
  message_status: 'Status da mensagem (entregue / lida)',
  disconnected: 'Instância desconectada',
  connected: 'Instância conectada',
}

/** Quais webhooks o sistema realmente usa (os outros são só informativos). */
export const WEBHOOK_KINDS_WE_USE: ZapiWebhookKind[] = ['received', 'delivery', 'message_status', 'disconnected', 'connected']

export function getAppBaseUrl(): string {
  const raw = String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || '').trim()
  if (raw) return raw.replace(/\/+$/, '')
  const vercel = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '').trim()
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`
  return 'https://gestao.brspromotora.com.br'
}

export function buildOurWebhookUrl(webhookKey: string): string {
  return `${getAppBaseUrl()}/api/zapi/webhook/${encodeURIComponent(webhookKey)}`
}

export function isOurWebhookUrl(url: string | null | undefined, webhookKey?: string): boolean {
  const u = String(url || '')
  if (!u) return false
  if (!u.includes('/api/zapi/webhook/')) return false
  if (webhookKey) return u.endsWith(`/api/zapi/webhook/${webhookKey}`)
  return true
}

export type WebhookOwner = 'ours' | 'external' | 'empty'

export type WebhookState = {
  kind: ZapiWebhookKind
  label: string
  currentUrl: string
  owner: WebhookOwner
  relayUrl: string
  weUse: boolean
}

/** Classifica cada webhook a partir do GET /me. Puro. */
export function describeWebhooks(me: ZapiMe | null, instance: Pick<ZapiInstanceRow, 'webhook_key' | 'webhook_relay_urls'>): WebhookState[] {
  return WEBHOOK_KINDS.map((kind) => {
    const currentUrl = String((me as any)?.[ME_FIELD_BY_WEBHOOK[kind]] || '')
    const owner: WebhookOwner = !currentUrl ? 'empty' : isOurWebhookUrl(currentUrl, instance.webhook_key) ? 'ours' : 'external'
    return {
      kind,
      label: WEBHOOK_KIND_LABELS[kind],
      currentUrl,
      owner,
      relayUrl: String(instance.webhook_relay_urls?.[kind] || ''),
      weUse: WEBHOOK_KINDS_WE_USE.includes(kind),
    }
  })
}

export type WebhookAction = 'configure_empty' | 'assume_relay' | 'restore'

export type WebhookChange = {
  kind: ZapiWebhookKind
  action: WebhookAction
  fromUrl: string
  toUrl: string
  /** URL externa preservada para relay (só em assume_relay). */
  relayUrl?: string
}

/**
 * Planeja as alterações (puro): devolve a lista de PUTs a fazer, sem executar.
 * - configure_empty: só os vazios passam a apontar para nós;
 * - assume_relay: os externos são copiados para relay e passam a apontar para nós;
 * - restore: os nossos voltam para a URL de relay (ou vazio se não houver).
 */
export function planWebhookChanges(
  states: WebhookState[],
  instance: Pick<ZapiInstanceRow, 'webhook_key'>,
  action: WebhookAction,
  kinds: ZapiWebhookKind[] = WEBHOOK_KINDS_WE_USE,
): WebhookChange[] {
  const ours = buildOurWebhookUrl(instance.webhook_key)
  const changes: WebhookChange[] = []
  for (const s of states) {
    if (!kinds.includes(s.kind)) continue
    if (action === 'configure_empty' && s.owner === 'empty') {
      changes.push({ kind: s.kind, action, fromUrl: '', toUrl: ours })
    } else if (action === 'assume_relay' && s.owner === 'external') {
      changes.push({ kind: s.kind, action, fromUrl: s.currentUrl, toUrl: ours, relayUrl: s.currentUrl })
    } else if (action === 'assume_relay' && s.owner === 'empty') {
      changes.push({ kind: s.kind, action: 'configure_empty', fromUrl: '', toUrl: ours })
    } else if (action === 'restore' && s.owner === 'ours') {
      changes.push({ kind: s.kind, action, fromUrl: s.currentUrl, toUrl: s.relayUrl || '' })
    }
  }
  return changes
}

/** Executa o plano na Z-API e devolve o patch a persistir em zapi_instances. */
export async function applyWebhookChanges(
  client: ZapiClient,
  instance: ZapiInstanceRow,
  changes: WebhookChange[],
): Promise<{ applied: WebhookChange[]; failed: Array<{ change: WebhookChange; error: string }>; patch: Partial<ZapiInstanceRow> }> {
  const relay: Record<string, string> = { ...(instance.webhook_relay_urls || {}) }
  const flags: Record<string, boolean> = { ...(instance.webhook_flags || {}) }
  const applied: WebhookChange[] = []
  const failed: Array<{ change: WebhookChange; error: string }> = []

  for (const change of changes) {
    try {
      await client.updateWebhook(change.kind, change.toUrl)
      applied.push(change)
      if (change.action === 'assume_relay') {
        relay[change.kind] = change.relayUrl || change.fromUrl
        flags[change.kind] = true
      } else if (change.action === 'configure_empty') {
        delete relay[change.kind]
        flags[change.kind] = true
      } else if (change.action === 'restore') {
        delete relay[change.kind]
        delete flags[change.kind]
      }
    } catch (err: any) {
      failed.push({ change, error: String(err?.message || err) })
    }
  }

  const anyRelay = Object.keys(relay).length > 0
  const anyOurs = Object.values(flags).some(Boolean)
  const patch: Partial<ZapiInstanceRow> = {
    webhook_relay_urls: relay,
    webhook_flags: flags,
    webhook_mode: anyRelay ? 'relay' : anyOurs ? 'direct' : 'none',
  }
  return { applied, failed, patch }
}

/** Tipo do payload → tipo de webhook (para escolher a URL de relay). */
export function webhookKindForPayloadType(type: string | undefined | null): ZapiWebhookKind | null {
  const t = String(type || '')
  if (t === 'MessageStatusCallback') return 'message_status'
  if (t === 'DeliveryCallback') return 'delivery'
  if (t === 'ReceivedCallback' || t === 'ReceivedCallBack') return 'received'
  if (t === 'DisconnectedCallback') return 'disconnected'
  if (t === 'ConnectedCallback') return 'connected'
  return null
}
