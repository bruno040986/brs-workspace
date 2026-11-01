import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import type { EventoNormalizado, EventoSeguranca } from './tipos.ts'

const CHAVE_SENSIVEL = /(pass|senha|secret|segredo|token|codigo|code|otp|cookie|authorization|apikey|api_key|jwt|bearer|credential|totp|signature|assinatura)/i
const VALOR_SENSIVEL = /^(eyJ[A-Za-z0-9_-]{5,}\.|Bearer\s)|[A-Za-z0-9_-]{40,}/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Espelha seg_sanitizar (SQL): remove chaves/valores sensíveis, limita profundidade, tamanho e cardinalidade. */
export function sanitizarPayload(valor: unknown, nivel = 0): unknown {
  if (valor === null || valor === undefined) return null
  if (nivel > 4) return '[profundo]'
  if (typeof valor === 'string') return VALOR_SENSIVEL.test(valor) ? '[removido]' : valor.slice(0, 300)
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor
  if (Array.isArray(valor)) return valor.slice(0, 20).map((v) => sanitizarPayload(v, nivel + 1))
  if (typeof valor === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valor as Record<string, unknown>).slice(0, 40)) {
      out[k.slice(0, 60)] = CHAVE_SENSIVEL.test(k) ? '[removido]' : sanitizarPayload(v, nivel + 1)
    }
    return out
  }
  return String(valor).slice(0, 100)
}

const corta = (v: string | null | undefined, n: number) => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, n) : null
}

/** Hash curto e estável de um identificador (e-mail/IP) para usar em chave de correlação sem guardar o valor na chave. */
export function hashCurto(v: string): string {
  return createHash('sha256').update(v.trim().toLowerCase()).digest('hex').slice(0, 16)
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CPF = /^(\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/
const MAX_PAYLOAD_BYTES = 16384

/** Só guarda o que parece e-mail/CPF; o resto (ex.: senha digitada no campo errado) vira marcador + hash curto. Espelha o SQL. */
export function identidadeInformadaSegura(v: string | null | undefined): string | null {
  const s = corta(v, 254)
  if (!s) return null
  return EMAIL.test(s) || CPF.test(s) ? s.toLowerCase() : `formato_invalido:${hashCurto(s)}`
}

/** Corta por tamanho ANTES de sanitizar (custo de CPU limitado). */
function payloadSeguro(p: unknown): Record<string, unknown> {
  const bruto = p ?? {}
  const bytes = Buffer.byteLength(JSON.stringify(bruto) ?? '', 'utf8')
  if (bytes > MAX_PAYLOAD_BYTES) return { truncado: true, bytes }
  const s = sanitizarPayload(bruto)
  return s && typeof s === 'object' && !Array.isArray(s) ? (s as Record<string, unknown>) : { valor: s }
}

export function normalizarEvento(e: EventoSeguranca): EventoNormalizado {
  const fonte = String(e.fonte || '').toLowerCase()
  const tipo = String(e.tipo || '').toLowerCase()
  if (!/^[a-z0-9_.-]{1,40}$/.test(fonte)) throw new Error('evento: fonte invalida')
  if (!/^[a-z0-9_.]{1,60}$/.test(tipo)) throw new Error('evento: tipo invalido')
  const ocorrido = e.ocorridoEm ? new Date(e.ocorridoEm) : new Date()
  const ip = corta(e.ipObservado, 64)
  const validado = corta(e.identidadeValidadaUserId, 40)
  const payload = payloadSeguro(e.payload)
  return {
    fonte,
    tipo,
    id_origem: corta(e.idOrigem, 120),
    ocorrido_em: (Number.isNaN(ocorrido.getTime()) ? new Date() : ocorrido).toISOString(),
    identidade_informada: identidadeInformadaSegura(e.identidadeInformada),
    identidade_validada_user_id: validado && UUID.test(validado) ? validado : null,
    request_id: corta(e.requestId, 120),
    ip_observado: ip && isIP(ip) ? ip : null,
    user_agent_observado: corta(e.userAgentObservado, 300),
    cobertura_fonte: corta(e.coberturaFonte, 200),
    payload,
  }
}
