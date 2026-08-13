'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

export async function getGoogleConfig() {
  const { permissions } = await requirePermission('sistema-config-google', 'can_view')
  const canEdit = permissions.some(
    (permission) =>
      permission.resource_name === 'sistema-config-google' &&
      Boolean(permission.can_edit),
  )

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from('system_google_config')
    .select('*')
    .single()

  if (error) {
    return {
      id: '',
      client_id: '',
      client_secret: '',
      has_client_secret: false,
      can_edit: canEdit,
    }
  }
  return {
    ...data,
    client_secret: canEdit ? '' : '',
    has_client_secret: Boolean(data.client_secret),
    can_edit: canEdit,
  }
}

export async function updateGoogleConfig(formData: FormData) {
  await requirePermission('sistema-config-google', 'can_edit')

  const supabase = await createAdminClient()
  
  const client_id = formData.get('client_id') as string
  const client_secret = formData.get('client_secret') as string
  const id = formData.get('id') as string

  if (id) {
    const payload: Record<string, string> = {
      client_id,
      updated_at: new Date().toISOString(),
    }
    if (client_secret) payload.client_secret = client_secret

    const { error } = await supabase
      .from('system_google_config')
      .update(payload)
      .match({ id })

    if (error) throw new Error(error.message)
  } else {
    if (!client_secret) throw new Error('Client Secret e obrigatorio na primeira configuracao.')

    const { error } = await supabase
      .from('system_google_config')
      .insert({
        client_id,
        client_secret,
        updated_at: new Date().toISOString(),
      })

    if (error) throw new Error(error.message)
  }

  revalidatePath('/rh/parceiros/config/provedores/google')
  return { success: true }
}
