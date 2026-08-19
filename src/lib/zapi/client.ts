/**
 * Cliente HTTP tipado da Z-API.
 *
 * Base: https://api.z-api.io/instances/{instanceId}/token/{token}/{método}
 * Sempre envia `Client-Token` (token de segurança da conta — é no-op enquanto
 * desativado no painel e obrigatório depois) e `Content-Type: application/json`.
 *
 * Só back-end: token e client_token nunca chegam ao cliente.
 * Todo método devolve o JSON da API ou lança `ZapiError`.
 */

import type {
  ZapiDevice,
  ZapiInstanceRow,
  ZapiMe,
  ZapiSendAudioInput,
  ZapiSendButtonListInput,
  ZapiSendContactInput,
  ZapiSendDocumentInput,
  ZapiSendImageInput,
  ZapiSendResult,
  ZapiSendTextInput,
  ZapiStatus,
  ZapiWebhookKind,
} from './types'
import { normalizeBrPhone } from './phone'

export const ZAPI_BASE_URL = 'https://api.z-api.io'

export class ZapiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'ZapiError'
    this.status = status
    this.body = body
  }
}

export type ZapiCredentials = {
  instanceId: string
  token: string
  clientToken?: string
}

const WEBHOOK_PATHS: Record<ZapiWebhookKind, string> = {
  received: 'update-webhook-received',
  delivery: 'update-webhook-delivery',
  message_status: 'update-webhook-message-status',
  disconnected: 'update-webhook-disconnected',
  connected: 'update-webhook-connected',
}

/** Campo do GET /me que guarda a URL de cada webhook. */
export const ME_FIELD_BY_WEBHOOK: Record<ZapiWebhookKind, keyof ZapiMe> = {
  received: 'receivedCallbackUrl',
  delivery: 'deliveryCallbackUrl',
  message_status: 'messageStatusCallbackUrl',
  disconnected: 'disconnectedCallbackUrl',
  connected: 'connectedCallbackUrl',
}

function clampDelay(value: number | undefined): number | undefined {
  if (value === undefined || value === null) return undefined
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return undefined
  return Math.min(15, Math.max(1, n))
}

function requirePhone(raw: string): string {
  const phone = normalizeBrPhone(raw)
  if (!phone) throw new ZapiError(`Telefone inválido para envio: "${raw}"`, 0, null)
  return phone
}

export class ZapiClient {
  private readonly instanceId: string
  private readonly token: string
  private readonly clientToken: string

  constructor(credentials: ZapiCredentials) {
    this.instanceId = String(credentials.instanceId || '').trim()
    this.token = String(credentials.token || '').trim()
    this.clientToken = String(credentials.clientToken || '').trim()
    if (!this.instanceId || !this.token) {
      throw new ZapiError('Instância Z-API sem instance_id/token.', 0, null)
    }
  }

  static fromInstance(row: Pick<ZapiInstanceRow, 'instance_id' | 'token' | 'client_token'>): ZapiClient {
    return new ZapiClient({ instanceId: row.instance_id, token: row.token, clientToken: row.client_token })
  }

  /** Para testar credenciais avulsas antes de salvar. */
  static forCredentials(credentials: ZapiCredentials): ZapiClient {
    return new ZapiClient(credentials)
  }

  // -----------------------------------------------------------------------
  // Núcleo
  // -----------------------------------------------------------------------

  private async request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, timeoutMs = 15000): Promise<T> {
    const url = `${ZAPI_BASE_URL}/instances/${encodeURIComponent(this.instanceId)}/token/${encodeURIComponent(this.token)}/${path}`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.clientToken) headers['Client-Token'] = this.clientToken

    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      })
    } catch (err) {
      throw new ZapiError(`Falha de conexão com a Z-API: ${(err as Error).message}`, 0, null)
    }

    const raw = await response.text()
    let parsed: unknown = null
    if (raw) {
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = raw
      }
    }

    if (!response.ok) {
      const detail =
        parsed && typeof parsed === 'object'
          ? String((parsed as any).error || (parsed as any).message || '')
          : typeof parsed === 'string'
            ? parsed.slice(0, 200)
            : ''
      throw new ZapiError(`Z-API respondeu ${response.status}${detail ? `: ${detail}` : ''}`, response.status, parsed)
    }
    return parsed as T
  }

  // -----------------------------------------------------------------------
  // Envio
  // -----------------------------------------------------------------------

  async sendText(input: ZapiSendTextInput): Promise<ZapiSendResult> {
    return this.request<ZapiSendResult>('POST', 'send-text', {
      phone: requirePhone(input.phone),
      message: String(input.message || ''),
      delayMessage: clampDelay(input.delayMessage),
      delayTyping: clampDelay(input.delayTyping),
    })
  }

  async sendImage(input: ZapiSendImageInput): Promise<ZapiSendResult> {
    return this.request<ZapiSendResult>('POST', 'send-image', {
      phone: requirePhone(input.phone),
      image: input.image,
      caption: input.caption || undefined,
      delayMessage: clampDelay(input.delayMessage),
    }, 60000)
  }

  async sendDocument(input: ZapiSendDocumentInput): Promise<ZapiSendResult> {
    const ext = String(input.extension || 'pdf').replace(/^\./, '').toLowerCase() || 'pdf'
    return this.request<ZapiSendResult>('POST', `send-document/${encodeURIComponent(ext)}`, {
      phone: requirePhone(input.phone),
      document: input.document,
      fileName: input.fileName || undefined,
      caption: input.caption || undefined,
      delayMessage: clampDelay(input.delayMessage),
    }, 60000)
  }

  async sendAudio(input: ZapiSendAudioInput): Promise<ZapiSendResult> {
    return this.request<ZapiSendResult>('POST', 'send-audio', {
      phone: requirePhone(input.phone),
      audio: input.audio,
      waveform: input.waveform ?? true,
      delayMessage: clampDelay(input.delayMessage),
      delayTyping: clampDelay(input.delayTyping),
    }, 60000)
  }

  async sendContact(input: ZapiSendContactInput): Promise<ZapiSendResult> {
    return this.request<ZapiSendResult>('POST', 'send-contact', {
      phone: requirePhone(input.phone),
      contactName: input.contactName,
      contactPhone: normalizeBrPhone(input.contactPhone) || String(input.contactPhone || '').replace(/\D/g, ''),
      contactBusinessDescription: input.contactBusinessDescription || undefined,
      delayMessage: clampDelay(input.delayMessage),
    })
  }

  async sendButtonList(input: ZapiSendButtonListInput): Promise<ZapiSendResult> {
    return this.request<ZapiSendResult>('POST', 'send-button-list', {
      phone: requirePhone(input.phone),
      message: String(input.message || ''),
      buttonList: {
        buttons: (input.buttons || []).map((b, i) => ({ id: b.id || String(i + 1), label: b.label })),
      },
      delayMessage: clampDelay(input.delayMessage),
    })
  }

  // -----------------------------------------------------------------------
  // Instância
  // -----------------------------------------------------------------------

  async getStatus(): Promise<ZapiStatus> {
    const data = await this.request<any>('GET', 'status', undefined, 10000)
    return {
      connected: Boolean(data?.connected),
      smartphoneConnected: Boolean(data?.smartphoneConnected),
      error: data?.error ?? null,
    }
  }

  async getMe(): Promise<ZapiMe> {
    return this.request<ZapiMe>('GET', 'me', undefined, 10000)
  }

  async getDevice(): Promise<ZapiDevice> {
    return this.request<ZapiDevice>('GET', 'device', undefined, 10000)
  }

  async restart(): Promise<{ value?: boolean }> {
    return this.request('GET', 'restart', undefined, 10000)
  }

  async updateWebhook(kind: ZapiWebhookKind, url: string): Promise<unknown> {
    return this.request('PUT', WEBHOOK_PATHS[kind], { value: url }, 10000)
  }
}

export function isZapiOnline(status: ZapiStatus | null | undefined): boolean {
  return Boolean(status?.connected && status?.smartphoneConnected)
}
