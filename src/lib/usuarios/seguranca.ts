// Regras puras de segurança do cadastro de usuários (sem I/O, testáveis).
// `role`, `profile_id` e permissões individuais são dados de privilégio: só
// quem administra perfis/root pode defini-los; o cliente nunca decide sozinho.

export const ROLES_VALIDOS = ['admin', 'rh', 'gestor', 'consulta'] as const
export type RoleUsuario = (typeof ROLES_VALIDOS)[number]
export const ROLE_PADRAO_SEM_PRIVILEGIO: RoleUsuario = 'consulta'

export type TemPermissao = (resource: string, action: 'can_edit') => boolean

/** Quem pode definir perfil de acesso, role e permissões individuais. */
export function podeAdministrarPrivilegios(tem: TemPermissao): boolean {
  return tem('sistema-usuarios-perfis', 'can_edit') || tem('sistema-usuarios-root', 'can_edit')
}

export function normalizarRole(valor: unknown): RoleUsuario | null {
  const v = String(valor ?? '').trim().toLowerCase()
  return (ROLES_VALIDOS as readonly string[]).includes(v) ? (v as RoleUsuario) : null
}

/**
 * Decide o role a gravar. Com privilégio: o pedido, validado (inválido = erro).
 * Sem privilégio: edição mantém o atual; criação grava o role sem privilégio.
 */
export function resolverRole(args: { pedido: unknown; atual?: string | null; privilegiado: boolean }): RoleUsuario {
  if (args.privilegiado) {
    const r = normalizarRole(args.pedido)
    if (!r) throw new Error('Role inválido.')
    return r
  }
  return normalizarRole(args.atual) ?? ROLE_PADRAO_SEM_PRIVILEGIO
}

/** Sem privilégio, o perfil de acesso só pode permanecer como está (ou ficar vazio na criação). */
export function perfilPermitido(args: { pedido?: string | null; atual?: string | null; privilegiado: boolean }): boolean {
  if (args.privilegiado) return true
  return (args.pedido || null) === (args.atual || null)
}

const SENHA_MIN = 10
const SENHA_MAX = 72 // limite do bcrypt no Auth

/** Senha provisória enviada pelo cadastro: obrigatória na criação, nunca um valor padrão. */
export function validarSenhaTemporaria(senha: unknown): string {
  if (typeof senha !== 'string' || !senha) throw new Error('Informe a senha provisória (gere uma nova no cadastro).')
  if (senha.length < SENHA_MIN || senha.length > SENHA_MAX) {
    throw new Error(`A senha provisória deve ter entre ${SENHA_MIN} e ${SENHA_MAX} caracteres.`)
  }
  if (new Set(senha).size < 5) throw new Error('A senha provisória é fraca demais.')
  if (/^brs\d+$/i.test(senha)) throw new Error('A senha provisória é um padrão conhecido; gere outra.')
  return senha
}
