// API de Conversões da Meta — evento Lead server-side. Funções puras + envio com fetch injetável.
// Sem PII além de telefone com hash; sem custom_data; token nunca sai daqui para log/evento.
import { createHash } from 'node:crypto'
import { telefoneParaE164Digitos } from './validacao.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FBP = /^fb\.\d\.\d+\.\d+$/
const FBC = /^fb\.\d\.\d+\..{1,200}$/
const SITE = 'https://nuazul.com.br'

export const validarFbp = (v: unknown): v is string => typeof v === 'string' && FBP.test(v)
export const validarFbc = (v: unknown): v is string => typeof v === 'string' && FBC.test(v)

/** SHA-256 hex minúsculo do telefone em dígitos com DDI 55 (sem '+'); null se inválido. */
export function hashTelefone(telefone: string): string | null {
  const e164 = telefoneParaE164Digitos(telefone)
  return e164 ? createHash('sha256').update(e164).digest('hex') : null
}

export type EntradaLead = {
  tracking: unknown
  telefone: string
  ip: string
  userAgent: string
  testEventCode?: string | null
  agoraMs?: number
}

/** Corpo do POST /events, ou null se não deve enviar (sem consentimento explícito ou eventId inválido). */
export function montarEventoLead(e: EntradaLead): Record<string, unknown> | null {
  const t = e.tracking && typeof e.tracking === 'object' ? (e.tracking as Record<string, unknown>) : {}
  if (t.consentimento_cookies !== true) return null
  if (typeof t.eventId !== 'string' || !UUID.test(t.eventId)) return null
  const user_data: Record<string, unknown> = {}
  if (e.ip) user_data.client_ip_address = e.ip
  if (e.userAgent) user_data.client_user_agent = e.userAgent
  if (validarFbp(t.fbp)) user_data.fbp = t.fbp
  if (validarFbc(t.fbc)) user_data.fbc = t.fbc
  const ph = hashTelefone(e.telefone)
  if (ph) user_data.ph = [ph]
  const corpo: Record<string, unknown> = {
    data: [{
      event_name: 'Lead',
      event_time: Math.floor((e.agoraMs ?? Date.now()) / 1000),
      event_id: t.eventId,
      action_source: 'website',
      event_source_url: SITE,
      user_data,
    }],
  }
  if (e.testEventCode) corpo.test_event_code = e.testEventCode
  return corpo
}

export type ResultadoCapi = { ok: boolean; status: number }

/** Envia com timeout de 5 s e UMA nova tentativa em erro de rede/5xx (mesmo event_id: a Meta deduplica). status 0 = rede/timeout. */
export async function enviarEventoCapi(
  corpo: Record<string, unknown>,
  cfg: { token: string; datasetId: string },
  fetchFn: typeof fetch = fetch,
): Promise<ResultadoCapi> {
  let status = 0
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 5000)
    try {
      const r = await fetchFn(`https://graph.facebook.com/v21.0/${encodeURIComponent(cfg.datasetId)}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
        body: JSON.stringify(corpo),
        signal: ac.signal,
      })
      status = r.status
      if (r.ok) return { ok: true, status }
      if (status < 500) return { ok: false, status }
    } catch {
      status = 0
    } finally {
      clearTimeout(timer)
    }
  }
  return { ok: false, status }
}
