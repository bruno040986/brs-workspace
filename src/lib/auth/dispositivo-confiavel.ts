import { createHmac, timingSafeEqual } from 'node:crypto'

// C1: dispositivo confiavel = cookie `brs_dc` = `<exp>.<HMAC(segredo, identificador|exp)>`, emitido so apos login completo (etapa 5).
// Um terceiro nao o tem, entao as pausas so-por-identificador (leve/duro) nao trancam o titular; par e ip continuam valendo.
export const COOKIE_DISPOSITIVO = 'brs_dc'
export const DISPOSITIVO_TTL_SEG = 90 * 24 * 3600 // PROPOSTA: 90 dias

const mac = (segredo: string, identificador: string, exp: number) => createHmac('sha256', segredo).update(`${identificador}|${exp}`).digest('hex')

export function emitirDispositivo(segredo: string, identificador: string, agoraMs = Date.now()): string {
  const exp = Math.floor(agoraMs / 1000) + DISPOSITIVO_TTL_SEG
  return `${exp}.${mac(segredo, identificador, exp)}`
}

export function dispositivoValido(segredo: string, identificador: string, valor: unknown, agoraMs = Date.now()): boolean {
  if (typeof valor !== 'string') return false
  const m = /^(\d{1,12})\.([0-9a-f]{64})$/.exec(valor)
  if (!m || Number(m[1]) <= Math.floor(agoraMs / 1000)) return false
  const a = Buffer.from(m[2], 'hex'), b = Buffer.from(mac(segredo, identificador, Number(m[1])), 'hex')
  return timingSafeEqual(a, b)
}
