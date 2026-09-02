'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUserEffectivePermissions, requireCurrentUser } from './server'

export async function getMyEffectivePermissions() {
  try {
    const permissions = await getCurrentUserEffectivePermissions()
    return { success: true, permissions }
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nao foi possivel validar permissoes.',
    }
  }
}

export async function getMyHubContext() {
  try {
    const user = await requireCurrentUser()
    const supabase = await createAdminClient()

    const [{ data: profile }, { data: birthdays, error: birthdaysError }] = await Promise.all([
      supabase
        .from('users')
        .select('name')
        .eq('id', user.id)
        .maybeSingle(),
      supabase
        .from('users')
        .select('name, birth_date, avatar_url')
        .eq('active', true)
        .not('birth_date', 'is', null),
    ])

    if (birthdaysError) throw birthdaysError

    // Segurança (B-1): o mural de aniversários só precisa de dia/mês. Mascaramos o
    // ano para não expor a idade/ano de nascimento de toda a base a qualquer usuário.
    const safeBirthdays = (birthdays || []).map((b: { name?: string | null; birth_date?: string | null; avatar_url?: string | null }) => ({
      ...b,
      birth_date: b.birth_date ? `0000-${String(b.birth_date).slice(5)}` : b.birth_date,
    }))

    return {
      success: true,
      userName: profile?.name ? String(profile.name).split(' ')[0] : user.email?.split('@')[0] || '',
      birthdays: safeBirthdays,
    }
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nao foi possivel carregar o contexto do hub.',
      userName: '',
      birthdays: [],
    }
  }
}
