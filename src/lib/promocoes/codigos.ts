/** Códigos, tokens e OTP (CONTRATO §3.6). Único arquivo com crypto do Node — sem rede. */
import { createHash, randomBytes, randomInt } from 'node:crypto'

export function formatarCodigo(prefixo: string, seq: number): string {
  return `${prefixo}-${seq}`
}

export function formatarNumeroSorte(n: number): string {
  return String(n).padStart(5, '0')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 32 bytes aleatórios em base64url + sha256 hex (só o hash vai pro banco). */
export function gerarToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}

export function gerarCodigoOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashOtp(codigo: string, otpId: string): string {
  return createHash('sha256').update(`${otpId}:${codigo}`).digest('hex')
}
