import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Usuário interno = existe em public.users e está ativo. Parceiros e usuários
 * do CRM entram pelo SSO (mesmo projeto Auth) e podem ter e-mail fora do domínio
 * de parceiro; a linha em public.users (criada só pelo cadastro administrativo)
 * é o que os diferencia. Falha de consulta = não interno (fail-closed).
 */
export async function isActiveInternalUser(admin: SupabaseClient, userId: string): Promise<boolean> {
  if (!userId) return false
  const { data, error } = await admin.from('users').select('id, active').eq('id', userId).maybeSingle()
  if (error || !data) return false
  return (data as { active?: boolean | null }).active !== false
}
