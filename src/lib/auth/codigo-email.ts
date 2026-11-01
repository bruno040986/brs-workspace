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

/** Hash do identificador (e-mail normalizado): guardado em auth_tentativas.identificador para o desbloqueio administrativo. */
export function identificadorSenha(segredo: string, emailNormalizado: string): string {
  return createHmac('sha256', segredo).update(emailNormalizado).digest('hex')
}

// I2: pausa de senha. Terceiro que digita o e-mail da vitima NAO a tranca: a pausa escalonada vale por
// (identificador, origem); por IP ha limitador proprio; so por identificador e pausa fixa curta (sem escalada) que
// Turnstile valido dispensa. Limiares abaixo; a pausa fixa nunca passa de 5 min.
export const LIMITE_PAR = 3 // falhas em 15 min => pausa escalonada 5..240 min, so para a origem que errou
export const LIMITE_IP = 20 // falhas (qualquer e-mail) em 15 min => pausa fixa
export const LIMITE_IDENTIFICADOR = 10 // falhas de qualquer origem em 15 min => pausa fixa
export const PAUSA_FIXA_MIN = 5

export function chavesSenha(segredo: string, emailNormalizado: string, ip: string | null) {
  const h = (s: string) => createHmac('sha256', segredo).update(s).digest('hex')
  return {
    identificador: h(emailNormalizado),
    par: chaveSenha(segredo, `${emailNormalizado}|${ip || 'sem-ip'}`),
    id: 'si:' + h(emailNormalizado),
    ip: ip ? 'ip:' + h('ip|' + ip) : null,
  }
}
