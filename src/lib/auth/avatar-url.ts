// Bucket `avatars` é PRIVADO: o banco guarda /api/avatar/<path> (rota autenticada), nunca a URL pública do Storage.
export const PREFIXO_PUBLICO_AVATARS = '/storage/v1/object/public/avatars/'
const PREFIXO_ROTA = '/api/avatar/'

// Mesma allowlist de agente-corban-documento.ts (duplicada de propósito para não mexer naquele módulo).
const PATH_OK_RE = /^[\p{L}\p{N}][\p{L}\p{N}._ (),-]*(?:\/[\p{L}\p{N}._ (),-]+)*$/u

export function avatarPathParaUrl(path: string): string {
  return `${PREFIXO_ROTA}${path}`
}

export function normalizarAvatarUrl(valor: string | null | undefined): string | null {
  const s = (valor ?? '').trim()
  if (!s) return null
  const i = s.indexOf(PREFIXO_PUBLICO_AVATARS)
  if (i >= 0) return avatarPathParaUrl(s.slice(i + PREFIXO_PUBLICO_AVATARS.length).split('?')[0])
  return s
}

/** Path do bucket a partir de /api/avatar/<path> (ou URL pública antiga); null se for outra coisa ou inválido. */
export function avatarPathDoValor(valor: string | null | undefined): string | null {
  const n = normalizarAvatarUrl(valor)
  if (!n || !n.startsWith(PREFIXO_ROTA)) return null
  const path = n.slice(PREFIXO_ROTA.length)
  return avatarPathValido(path) ? path : null
}

export function avatarPathValido(path: string): boolean {
  if (!path || path.length > 500 || path.includes('%') || !PATH_OK_RE.test(path)) return false
  return !path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
}
