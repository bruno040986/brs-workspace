/**
 * Cliente da Management API da YCloud (docs.ycloud.com) — o Workspace usa
 * SÓ leitura/configuração (saldo, números, WABAs, templates, webhook
 * endpoint). Envio/recebimento de mensagem é do engine (brs-alvoconsig).
 *
 * Fatos verificados 26/09/2026 (docs/ycloud/FATOS-VERIFICADOS): base
 * https://api.ycloud.com/v2, header X-API-Key, paginação por página
 * (page ≤ 100, limit 1–100, includeTotal), erro { error: { code, message,
 * requestId } }, 429 com Retry-After, teto de 200 rps / 10.000 req/h por
 * conta na Management API — o sync roda a cada 15 min com poucas dezenas de
 * chamadas por conexão, longe do teto.
 */

const BASE = 'https://api.ycloud.com/v2'

export class ErroYcloudApi extends Error {
  constructor(
    public status: number,
    public code: string,
    mensagem: string,
    public requestId: string | null = null,
  ) {
    super(mensagem)
  }
}

type Opcoes = { method?: 'GET' | 'POST'; body?: unknown; query?: Record<string, string | number | boolean | undefined>; timeoutMs?: number }

export async function chamarYcloud<T>(apiKey: string, path: string, opts: Opcoes = {}, tentativa = 0): Promise<T> {
  const url = new URL(`${BASE}${path}`)
  for (const [k, v] of Object.entries(opts.query || {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  const res = await fetch(url, {
    method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
    headers: { 'X-API-Key': apiKey, ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    cache: 'no-store',
  })
  const texto = await res.text()
  if (res.ok) return (texto ? JSON.parse(texto) : {}) as T
  // 429: respeita Retry-After UMA vez (sync é best-effort; o cron volta em 15 min)
  if (res.status === 429 && tentativa === 0) {
    const espera = Math.min(Number(res.headers.get('retry-after') || 2), 10)
    await new Promise((r) => setTimeout(r, espera * 1000))
    return chamarYcloud<T>(apiKey, path, opts, 1)
  }
  let code = ''
  let message = `YCloud HTTP ${res.status}`
  let requestId: string | null = res.headers.get('ycloud-request-id')
  try {
    const p = JSON.parse(texto) as { error?: { code?: string; message?: string; requestId?: string } }
    code = String(p.error?.code || '')
    message = String(p.error?.message || message)
    requestId = p.error?.requestId || requestId
  } catch {
    /* corpo não-JSON */
  }
  throw new ErroYcloudApi(res.status, code, message, requestId)
}

/** Lista paginada inteira (page/limit). Teto de páginas evita loop em conta anômala. */
export async function listarTudoYcloud<T>(apiKey: string, path: string, query: Record<string, string | undefined> = {}, maxPaginas = 20): Promise<T[]> {
  const itens: T[] = []
  for (let page = 1; page <= maxPaginas; page++) {
    const r = await chamarYcloud<{ items?: T[] }>(apiKey, path, { query: { ...query, page, limit: 100 } })
    const lote = r.items || []
    itens.push(...lote)
    if (lote.length < 100) break
  }
  return itens
}

// ---------------------------------------------------------------------------
// Tipos dos objetos da API (só os campos que usamos; resto fica no payload)
// ---------------------------------------------------------------------------

export type YcloudBalance = { amount?: number | string; currency?: string }

export type YcloudPhoneNumber = {
  id?: string
  phoneNumber: string
  wabaId: string
  displayPhoneNumber?: string
  verifiedName?: string
  status?: string
  nameStatus?: string
  qualityRating?: string
  messagingLimit?: string
  whatsappBusinessManagerMessagingLimit?: string
  updateEvent?: string
  qualityUpdateEvent?: string
  isOfficialBusinessAccount?: boolean
  [k: string]: unknown
}

export type YcloudBusinessAccount = { id: string; name?: string; [k: string]: unknown }

export type YcloudTemplate = {
  wabaId: string
  name: string
  language: string
  category?: string
  status?: string
  qualityRating?: string
  components?: unknown[]
  [k: string]: unknown
}

export type YcloudWebhookEndpoint = { id: string; url: string; secret?: string; enabledEvents?: string[]; status?: string }

export const ycloudApi = {
  balance: (apiKey: string) => chamarYcloud<YcloudBalance>(apiKey, '/balance'),
  phoneNumbers: (apiKey: string) => listarTudoYcloud<YcloudPhoneNumber>(apiKey, '/whatsapp/phoneNumbers'),
  businessAccounts: (apiKey: string) => listarTudoYcloud<YcloudBusinessAccount>(apiKey, '/whatsapp/businessAccounts'),
  templates: (apiKey: string, wabaId: string) => listarTudoYcloud<YcloudTemplate>(apiKey, '/whatsapp/templates', { 'filter.wabaId': wabaId }),
  criarWebhookEndpoint: (apiKey: string, body: { url: string; enabledEvents: string[]; description?: string }) =>
    chamarYcloud<YcloudWebhookEndpoint>(apiKey, '/webhookEndpoints', { body }),
  webhookEndpoint: (apiKey: string, id: string) => chamarYcloud<YcloudWebhookEndpoint>(apiKey, `/webhookEndpoints/${encodeURIComponent(id)}`),
  rotacionarSecret: (apiKey: string, id: string) =>
    chamarYcloud<YcloudWebhookEndpoint>(apiKey, `/webhookEndpoints/${encodeURIComponent(id)}/rotateSecret`, { body: {} }),
}

/** Eventos assinados no endpoint (ADR-2; v1 sem grupos/chamadas/coexistência). */
export const EVENTOS_WEBHOOK_V1 = [
  'whatsapp.inbound_message.received',
  'whatsapp.message.updated',
  'whatsapp.phone_number.quality_updated',
  'whatsapp.phone_number.name_updated',
  'whatsapp.phone_number.deleted',
  'whatsapp.template.reviewed',
  'whatsapp.template.quality_updated',
  'whatsapp.template.category_updated',
  'whatsapp.business_account.updated',
  'whatsapp.business_account.deleted',
]

/** E.164 → só dígitos (chave de `chat_instancias.numero`). */
export function somenteDigitos(telefone: string): string {
  return String(telefone || '').replace(/\D/g, '')
}
