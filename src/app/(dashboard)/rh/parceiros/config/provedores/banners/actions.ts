'use server'

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requireCurrentUser, requirePermission } from '@/lib/auth/server'
import {
  normalizeHubBannerSeconds,
  normalizeHubBannerTitle,
  type HubBannerRecord,
} from '@/lib/hub-banners'

const RESOURCE = 'sistema-config-banners'
const BUCKET = 'hub-banners'
const CONFIG_PATH = '/rh/parceiros/config/provedores/banners'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

// Cliente com Service Role para operações administrativas (upload e escrita)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

function extensionFromDataUrl(dataUrl: string) {
  const mime = dataUrl.slice(5, dataUrl.indexOf(';')).toLowerCase()
  if (mime === 'image/png') return 'png'
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return null
}

async function uploadHubBannerImage(dataUrl: string) {
  const ext = extensionFromDataUrl(dataUrl)
  if (!ext) {
    throw new Error('Formato de imagem não suportado. Use PNG, JPG, WEBP ou GIF.')
  }

  const base64Data = dataUrl.split(',')[1] || ''
  const blob = Buffer.from(base64Data, 'base64')
  if (!blob.length) throw new Error('Arquivo de imagem inválido.')
  if (blob.length > MAX_IMAGE_BYTES) {
    throw new Error('A imagem deve ter no máximo 5MB.')
  }

  const storagePath = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`
  const { error: uploadError } = await supabaseAdmin
    .storage
    .from(BUCKET)
    .upload(storagePath, blob, {
      contentType: ext === 'jpg' ? 'image/jpeg' : `image/${ext}`,
      upsert: false,
    })
  if (uploadError) throw uploadError

  const { data: { publicUrl } } = supabaseAdmin
    .storage
    .from(BUCKET)
    .getPublicUrl(storagePath)

  return { publicUrl, storagePath }
}

export async function getHubBanners() {
  try {
    await requirePermission(RESOURCE)

    const { data, error } = await supabaseAdmin
      .from('hub_banners')
      .select('*')
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) throw error
    return { success: true, banners: (data || []) as HubBannerRecord[] }
  } catch (error: any) {
    console.error('Erro ao buscar banners:', error)
    return { success: false, error: error.message }
  }
}

// Consumida pela home: qualquer usuário autenticado, apenas banners ativos e na vigência.
export async function getActiveHubBanners() {
  try {
    await requireCurrentUser()

    const nowIso = new Date().toISOString()
    const { data, error } = await supabaseAdmin
      .from('hub_banners')
      .select('id, title, image_url, display_seconds, starts_at, ends_at, sort_order')
      .eq('is_active', true)
      .is('deleted_at', null)
      .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
      .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) throw error
    return { success: true, banners: (data || []) as HubBannerRecord[] }
  } catch (error: any) {
    console.error('Erro ao buscar banners ativos:', error)
    return { success: false, error: error.message }
  }
}

export async function saveHubBanner(payload: {
  id?: string
  title: string
  display_seconds: number
  starts_at?: string | null
  ends_at?: string | null
  is_active?: boolean
  image_base64?: string | null
}) {
  try {
    await requirePermission(RESOURCE, payload.id ? 'can_edit' : 'can_include')

    const title = normalizeHubBannerTitle(payload.title)
    if (!title) {
      return { success: false, error: 'Informe um título para o banner.' }
    }

    if (payload.starts_at && payload.ends_at && new Date(payload.starts_at) > new Date(payload.ends_at)) {
      return { success: false, error: 'O início da vigência deve ser anterior ao fim.' }
    }

    if (!payload.id && !payload.image_base64) {
      return { success: false, error: 'Selecione a imagem do banner.' }
    }

    const row: Record<string, unknown> = {
      title,
      display_seconds: normalizeHubBannerSeconds(payload.display_seconds),
      starts_at: payload.starts_at || null,
      ends_at: payload.ends_at || null,
      is_active: payload.is_active !== false,
      updated_at: new Date().toISOString(),
    }

    if (payload.image_base64 && payload.image_base64.startsWith('data:image')) {
      const { publicUrl, storagePath } = await uploadHubBannerImage(payload.image_base64)
      row.image_url = publicUrl
      row.storage_path = storagePath
    }

    if (payload.id) {
      const { error } = await supabaseAdmin
        .from('hub_banners')
        .update(row)
        .eq('id', payload.id)
      if (error) throw error
    } else {
      const { data: maxRow } = await supabaseAdmin
        .from('hub_banners')
        .select('sort_order')
        .is('deleted_at', null)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle()

      const { error } = await supabaseAdmin
        .from('hub_banners')
        .insert({
          ...row,
          sort_order: ((maxRow as { sort_order?: number } | null)?.sort_order ?? -1) + 1,
          created_at: new Date().toISOString(),
        })
      if (error) throw error
    }

    revalidatePath(CONFIG_PATH)
    revalidatePath('/')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar banner:', error)
    if (String(error?.message || '').includes("Could not find the 'hub_banners'")) {
      return {
        success: false,
        error:
          "A tabela 'hub_banners' ainda não existe. Aplique a migration do Supabase criada para os Banners da Home.",
      }
    }
    return { success: false, error: error.message }
  }
}

export async function setHubBannerStatus(id: string, isActive: boolean) {
  try {
    await requirePermission(RESOURCE, 'can_activate_inactivate')

    if (!id) return { success: false, error: 'ID inválido.' }
    const { error } = await supabaseAdmin
      .from('hub_banners')
      .update({
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) throw error

    revalidatePath(CONFIG_PATH)
    revalidatePath('/')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alterar status do banner:', error)
    return { success: false, error: error.message }
  }
}

export async function deleteHubBanner(id: string) {
  try {
    await requirePermission(RESOURCE, 'can_delete')

    if (!id) return { success: false, error: 'ID inválido.' }
    const { error } = await supabaseAdmin
      .from('hub_banners')
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) throw error

    revalidatePath(CONFIG_PATH)
    revalidatePath('/')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao excluir banner:', error)
    return { success: false, error: error.message }
  }
}

export async function updateHubBannerOrder(orderedIds: string[]) {
  try {
    await requirePermission(RESOURCE, 'can_edit')

    const ids = (orderedIds || []).filter(Boolean)
    if (!ids.length) return { success: false, error: 'Lista de ordenação vazia.' }

    for (let index = 0; index < ids.length; index++) {
      const { error } = await supabaseAdmin
        .from('hub_banners')
        .update({ sort_order: index, updated_at: new Date().toISOString() })
        .eq('id', ids[index])
      if (error) throw error
    }

    revalidatePath(CONFIG_PATH)
    revalidatePath('/')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao reordenar banners:', error)
    return { success: false, error: error.message }
  }
}
