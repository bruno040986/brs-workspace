/**
 * Cofre AES-256-GCM — MESMO formato e MESMA chave (CRM_CREDENTIALS_KEY) do
 * CRM AlvoConsig e do engine: o que o Workspace cifra (credencial Z-API,
 * token da conta Chatwoot) o engine decifra. base64(iv||ciphertext||tag).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALG = 'aes-256-gcm'
const IV = 12
const TAG = 16

function chave(): Buffer {
  const raw = process.env.CRM_CREDENTIALS_KEY
  if (!raw) throw new Error('Cofre não configurado (CRM_CREDENTIALS_KEY ausente).')
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) throw new Error('CRM_CREDENTIALS_KEY inválida (32 bytes base64).')
  return buf
}

export function cofreConfigurado(): boolean {
  try {
    chave()
    return true
  } catch {
    return false
  }
}

export function cifrarJson(obj: unknown): string {
  const iv = randomBytes(IV)
  const c = createCipheriv(ALG, chave(), iv)
  const enc = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj), 'utf8')), c.final()])
  return Buffer.concat([iv, enc, c.getAuthTag()]).toString('base64')
}

export function cifrarTexto(texto: string): string {
  const iv = randomBytes(IV)
  const c = createCipheriv(ALG, chave(), iv)
  const enc = Buffer.concat([c.update(Buffer.from(texto, 'utf8')), c.final()])
  return Buffer.concat([iv, enc, c.getAuthTag()]).toString('base64')
}

export function decifrarTexto(armazenado: string): string {
  const buf = Buffer.from(armazenado, 'base64')
  const d = createDecipheriv(ALG, chave(), buf.subarray(0, IV))
  d.setAuthTag(buf.subarray(buf.length - TAG))
  return Buffer.concat([d.update(buf.subarray(IV, buf.length - TAG)), d.final()]).toString('utf8')
}
