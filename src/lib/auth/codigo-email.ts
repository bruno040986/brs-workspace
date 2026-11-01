import { createHmac, randomInt } from 'node:crypto'

// Código de e-mail da etapa 4: 6 dígitos aleatórios (CSPRNG), HMAC com segredo de servidor,
// uso único e tentativas limitadas no banco. O código nunca é gravado nem logado.
export const CODIGO_TTL_SEG = 600
export const CODIGO_MAX_TENTATIVAS = 5

export function gerarCodigo(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function formatoCodigoValido(codigo: unknown): codigo is string {
  return typeof codigo === 'string' && /^\d{6}$/.test(codigo.trim())
}

export function segredoCodigo(env: Record<string, string | undefined> = process.env): string {
  const s = env.AUTH_CODIGO_SEGREDO
  if (!s || s.length < 32) throw new Error('AUTH_CODIGO_SEGREDO ausente ou curto (min. 32).')
  return s
}

/** HMAC-SHA256 preso a usuário, sessão e finalidade: o código de outra sessão não confere. */
export function hashCodigo(segredo: string, userId: string, sessionId: string, finalidade: string, codigo: string): string {
  return createHmac('sha256', segredo).update(`${userId}:${sessionId}:${finalidade}:${codigo.trim()}`).digest('hex')
}

/** Chave estável (sem guardar o e-mail em claro) do contador da etapa senha. */
export function chaveSenha(segredo: string, emailNormalizado: string): string {
  return 's:' + createHmac('sha256', segredo).update(emailNormalizado).digest('hex')
}
