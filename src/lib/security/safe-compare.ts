import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Comparação de segredos em tempo constante. Compara os SHA-256 dos dois
 * lados (tamanho fixo), então nem o conteúdo nem o comprimento vazam pelo tempo.
 * Segredo vazio nunca confere (fail-closed).
 */
export function safeEqual(recebido: string | null | undefined, esperado: string | null | undefined): boolean {
  const a = String(recebido ?? '')
  const b = String(esperado ?? '')
  if (!b) return false
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

/** `Authorization: Bearer <CRON_SECRET>` dos crons; sem CRON_SECRET ninguém entra. */
export function isCronAuthorized(authorization: string | null | undefined, secret: string | undefined = process.env.CRON_SECRET): boolean {
  const s = String(secret ?? '')
  if (!s) return false
  return safeEqual(authorization, `Bearer ${s}`)
}
