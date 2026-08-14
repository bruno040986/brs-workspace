'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireCurrentUser } from '@/lib/auth/server'

// Limpa a exigência de troca de senha após o usuário definir uma nova.
// A troca da senha em si é feita no cliente (supabase.auth.updateUser); aqui
// apenas removemos a flag do app_metadata para liberar o acesso.
export async function clearPasswordResetFlag() {
  try {
    const user = await requireCurrentUser()
    const admin = await createAdminClient()
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { temp_password_reset_required: false },
    })
    if (error) throw error
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error?.message || 'Falha ao concluir a troca de senha.' }
  }
}
