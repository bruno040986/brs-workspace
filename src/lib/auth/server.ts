import { createAdminClient, createClient } from '@/lib/supabase/server'
import {
  hasAnyPermission,
  hasPermission,
  type EffectivePermission,
  type PermissionAction,
  type PermissionRequirement,
} from './permissions'
import { getEffectivePermissionsForUserId } from './effectivePermissions'

// Identidade minima derivada do JWT ja validado (id/email/app_metadata),
// suficiente pra tudo que o app usa hoje (so .id e .app_metadata). Ver
// getCurrentUser() abaixo pra motivo de nao usar mais o User completo do
// supabase-js.
export type AuthenticatedUser = {
  id: string
  email?: string
  app_metadata: Record<string, unknown>
  user_metadata: Record<string, unknown>
}

// getClaims() valida o JWT localmente (assinatura + expiracao) em vez de
// bater no Supabase Auth a cada chamada como getUser() fazia — corrige a
// instabilidade em que qualquer blip do Auth derrubava todo mundo ja logado,
// nao so logins novos. Enquanto o projeto ainda usa o Legacy JWT Secret
// (simetrico), getClaims() cai de volta pra rede (mesmo custo de getUser());
// o ganho fica automatico assim que o Bruno revogar o legado a favor das
// novas JWT Signing Keys assimetricas no painel do Supabase.
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  if (error) throw error
  if (!data) return null

  const { claims } = data
  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    app_metadata: (claims.app_metadata as Record<string, unknown>) ?? {},
    user_metadata: (claims.user_metadata as Record<string, unknown>) ?? {},
  }
}

export async function requireCurrentUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser()
  if (!user) throw new Error('Usuario nao autenticado.')
  return user
}

export async function getEffectivePermissionsForUser(userId: string): Promise<EffectivePermission[]> {
  const supabase = await createAdminClient()
  return getEffectivePermissionsForUserId(supabase, userId)
}

export async function getCurrentUserEffectivePermissions(): Promise<EffectivePermission[]> {
  const user = await requireCurrentUser()
  return getEffectivePermissionsForUser(user.id)
}

export async function hasPermissionForUser(
  userId: string,
  resource: string,
  action: PermissionAction = 'can_view',
) {
  const permissions = await getEffectivePermissionsForUser(userId)
  return hasPermission(permissions, resource, action)
}

export async function requirePermission(
  resource: string,
  action: PermissionAction = 'can_view',
) {
  const user = await requireCurrentUser()
  const permissions = await getEffectivePermissionsForUser(user.id)

  if (!hasPermission(permissions, resource, action)) {
    throw new Error('Sem permissao para esta acao.')
  }

  return { user, permissions }
}

export async function requireAnyPermission(requirements: PermissionRequirement[]) {
  const user = await requireCurrentUser()
  const permissions = await getEffectivePermissionsForUser(user.id)

  if (!hasAnyPermission(permissions, requirements)) {
    throw new Error('Sem permissao para esta acao.')
  }

  return { user, permissions }
}

export async function getVisibleEffectivePermissions(userId: string) {
  const currentUser = await requireCurrentUser()

  if (currentUser.id === userId) {
    return getEffectivePermissionsForUser(userId)
  }

  const currentPermissions = await getEffectivePermissionsForUser(currentUser.id)
  const canInspectUsers = hasAnyPermission(currentPermissions, [
    { resource: 'sistema-usuarios-root', action: 'can_view' },
    { resource: 'sistema-usuarios-cadastro', action: 'can_view' },
    { resource: 'sistema-usuarios-perfis', action: 'can_view' },
  ])

  if (!canInspectUsers) {
    throw new Error('Sem permissao para consultar permissoes de outro usuario.')
  }

  return getEffectivePermissionsForUser(userId)
}
