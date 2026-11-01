import { createHmac, timingSafeEqual } from 'node:crypto'

// C1: dispositivo confiavel = cookie `brs_dc` = `<iat>.<user_id>.<epoch>.<HMAC(segredo, identificador|user_id|epoch|iat)>`, emitido so apos login completo (etapa 5).
// Preso ao estado da conta: `epoch` = credencial_epoch do banco (sobe em troca de senha, bloqueio administrativo, logout "todas", sessao negada).
// Um terceiro nao o tem, entao as pausas so-por-identificador (leve/duro) nao trancam o titular; par e ip continuam valendo.
export const COOKIE_DISPOSITIVO = 'brs_dc'
export const DISPOSITIVO_TTL_SEG = 90 * 24 * 3600 // PROPOSTA: 90 dias
export const DISPOSITIVO_TETO_DURO_SEG = 30 * 24 * 3600 // PROPOSTA: acima de 30 dias o cookie nao dispensa o teto duro sem Turnstile valido

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const mac = (segredo: string, identificador: string, userId: string, epoch: number, iat: number) =>
  createHmac('sha256', segredo).update(`${identificador}|${userId}|${epoch}|${iat}`).digest('hex')

export function emitirDispositivo(segredo: string, identificador: string, userId: string, epoch: number, agoraMs = Date.now()): string {
  const iat = Math.floor(agoraMs / 1000)
  return `${iat}.${userId}.${epoch}.${mac(segredo, identificador, userId, epoch, iat)}`
}

/** Le o user_id do cookie (ainda NAO validado) so para consultar o epoch no banco. */
export function userIdDoDispositivo(valor: unknown): string | null {
  const m = typeof valor === 'string' ? new RegExp(`^\\d{1,12}\\.(${UUID})\\.\\d{1,9}\\.[0-9a-f]{64}$`).exec(valor) : null
  return m ? m[1] : null
}

/** Idade do cookie em segundos se valido para (identificador, epoch atual do banco); null se invalido, expirado ou epoch divergente. */
export function dispositivoValido(segredo: string, identificador: string, epochAtual: number | null | undefined, valor: unknown, agoraMs = Date.now()): number | null {
  if (typeof valor !== 'string' || epochAtual == null) return null
  const m = new RegExp(`^(\\d{1,12})\\.(${UUID})\\.(\\d{1,9})\\.([0-9a-f]{64})$`).exec(valor)
  if (!m) return null
  const iat = Number(m[1]), epoch = Number(m[3]), agora = Math.floor(agoraMs / 1000)
  if (epoch !== epochAtual || iat > agora + 60 || agora - iat >= DISPOSITIVO_TTL_SEG) return null
  const a = Buffer.from(m[4], 'hex'), b = Buffer.from(mac(segredo, identificador, m[2], epoch, iat), 'hex')
  return timingSafeEqual(a, b) ? Math.max(0, agora - iat) : null
}
