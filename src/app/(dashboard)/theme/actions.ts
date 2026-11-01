'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireCurrentUser } from '@/lib/auth/server'
import type { ThemePreference } from '@/types'

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export async function setMyThemePreference(preference: ThemePreference) {
  try {
    if (!isThemePreference(preference)) return { success: false, error: 'Preferência inválida.' }

    const userId = (await requireCurrentUser()).id // M04: gate da sessao interna completa

    const admin = await createAdminClient()
    const { error: uErr } = await admin.from('users').update({ theme_preference: preference }).eq('id', userId)
    if (uErr) throw uErr

    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

