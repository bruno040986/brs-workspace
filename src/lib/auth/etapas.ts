// M04 — Núcleo PURO (sem I/O) do login em cinco etapas: domínio, máquina de estados, pausas, erros.
// Os estados "senha_ok -> totp_ok -> email_ok -> liberada" são DERIVADOS (JWT verificado + estado do
// banco), nunca gravados pelo cliente. "email_ok" é instantâneo: o código certo grava a liberação.

export const DOMINIO_INTERNO = 'brspromotora.com.br'

/** Domínio EXATO (sem subdomínio, sem parceiro.), um único "@", minúsculas. */
export function emailDominioInterno(email: unknown): boolean {
  if (typeof email !== 'string') return false
  const e = email.trim().toLowerCase()
  if (e.length > 254 || /\s/.test(e)) return false
  const partes = e.split('@')
  return partes.length === 2 && partes[0].length > 0 && partes[1] === DOMINIO_INTERNO
}

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase().slice(0, 254)
}

/** Espelha app_private.auth_pausa_minutos: 5, 15, 30, 60, 120, teto 240. Nunca 24 h automático. */
export function pausaMinutos(pausas: number): number {
  if (!(pausas > 0)) return 0
  return [5, 15, 30, 60, 120][Math.floor(pausas) - 1] ?? 240
}

export type EstadoBanco = {
  liberada: boolean
  tem_fator: boolean
  fator_id: string | null
  prova_ativacao: boolean
  desafio_pendente: boolean
  pausa_email_seg: number
  pausa_totp_seg: number
  bloqueado_admin: boolean
  interno_ativo: boolean
}

export type ClaimsSessao = { sub?: string; session_id?: string; aal?: string; amr?: Array<{ method?: string }> | string[]; email?: string; app_metadata?: Record<string, unknown> }

export type EtapaSessao = 'anonima' | 'negada' | 'senha_ok' | 'totp_ok' | 'liberada'
export type ProximoPasso = 'login' | 'ativar_email' | 'ativar_totp' | 'totp' | 'email' | 'nenhum'

export function metodosAmr(claims: ClaimsSessao | null): string[] {
  const amr = claims?.amr
  if (!Array.isArray(amr)) return []
  return (amr as Array<string | { method?: string }>).map((m) => (typeof m === 'string' ? m : m?.method || '')).filter(Boolean)
}

/**
 * Máquina de estados. Quem não for interno ativo, estiver bloqueado, vier de método sem senha
 * (magic link/OTP/OAuth) ou tiver marca external fica em "negada" (mensagem genérica, signOut).
 */
export function calcularEtapa(
  claims: ClaimsSessao | null,
  estado: EstadoBanco | null,
): { etapa: EtapaSessao; proximo: ProximoPasso } {
  if (!claims?.sub || !claims.session_id) return { etapa: 'anonima', proximo: 'login' }
  const metodos = metodosAmr(claims)
  const externo = Boolean(claims.app_metadata?.external)
  const dominioOk = claims.email === undefined ? false : emailDominioInterno(claims.email)
  if (!estado || !estado.interno_ativo || estado.bloqueado_admin || externo || !dominioOk || !metodos.includes('password')) {
    return { etapa: 'negada', proximo: 'login' }
  }
  const aal2 = claims.aal === 'aal2' && metodos.includes('totp')
  if (estado.liberada && aal2) return { etapa: 'liberada', proximo: 'nenhum' }
  if (!estado.tem_fator) {
    return { etapa: 'senha_ok', proximo: estado.prova_ativacao ? 'ativar_totp' : 'ativar_email' }
  }
  if (!aal2) return { etapa: 'senha_ok', proximo: 'totp' }
  return { etapa: 'totp_ok', proximo: 'email' }
}

export type ClasseErroAuth = 'credencial' | 'infra'
const CODIGOS_CREDENCIAL = new Set([
  'invalid_credentials', 'email_not_confirmed', 'user_banned', 'user_not_found',
  'mfa_verification_failed', 'mfa_verification_rejected', 'invalid_grant',
])

/** Erro de credencial conta como tentativa; infraestrutura (5xx, rede, timeout, 429) NUNCA conta. */
export function classificarErroAuth(err: { status?: number; code?: string; name?: string } | null | undefined): ClasseErroAuth {
  if (!err) return 'infra'
  if (err.code && CODIGOS_CREDENCIAL.has(err.code)) return 'credencial'
  if (err.code === 'over_request_rate_limit' || err.code === 'over_email_send_rate_limit') return 'infra'
  if (err.status === 400 || err.status === 401 || err.status === 422) return err.code ? 'infra' : 'credencial'
  return 'infra'
}

export const MENSAGEM_GENERICA = 'Não foi possível concluir o acesso.'
export const MENSAGEM_INSTABILIDADE = 'Serviço de autenticação indisponível no momento. Tente novamente em instantes.'

export function mensagemPausa(segundos: number): string {
  const s = Math.max(0, Math.ceil(segundos))
  const min = Math.floor(s / 60)
  return min >= 1 ? `Muitas tentativas. Aguarde ${min} min ${String(s % 60).padStart(2, '0')} s.` : `Muitas tentativas. Aguarde ${s} s.`
}
