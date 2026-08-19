/**
 * Upload de mídia para campanhas de WhatsApp (imagem, documento, áudio).
 * Bucket privado `wa-campaign-media`; a URL assinada é gerada na hora do envio.
 * Exige permissão comercial-disparo-whatsapp (can_include).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { hasPermissionForUser } from '@/lib/auth/server'
import { MEDIA_BUCKET } from '@/lib/disparo-whatsapp/worker'

export const dynamic = 'force-dynamic'

const MAX_FILE_SIZE = 15 * 1024 * 1024

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])
const DOC_MIME = new Set([
  'application/pdf',
  'text/plain', 'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
])
const AUDIO_MIME = new Set(['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/opus', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/x-m4a'])

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/zip': 'zip',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'audio/opus': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/x-m4a': 'm4a',
}

function kindOf(mime: string): 'image' | 'document' | 'audio' | null {
  if (IMAGE_MIME.has(mime)) return 'image'
  if (DOC_MIME.has(mime)) return 'document'
  if (AUDIO_MIME.has(mime)) return 'audio'
  return null
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const admin = await createAdminClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const allowed = await hasPermissionForUser(user.id, 'comercial-disparo-whatsapp', 'can_include')
    if (!allowed) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })

    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'Arquivo ausente.' }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'Arquivo acima de 15MB.' }, { status: 400 })

    // MIME pode vir com parâmetros (audio/webm;codecs=opus)
    const mime = String(file.type || '').toLowerCase().split(';')[0].trim()
    const kind = kindOf(mime)
    if (!kind) return NextResponse.json({ error: `Tipo de arquivo não permitido (${mime || 'desconhecido'}).` }, { status: 400 })
    const ext = EXT_BY_MIME[mime] || 'bin'
    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const bytes = await file.arrayBuffer()

    const { error: uploadError } = await admin.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: mime, upsert: false })
    if (uploadError) throw uploadError

    const { data: signed } = await admin.storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600)
    return NextResponse.json({
      type: kind,
      bucket: MEDIA_BUCKET,
      path,
      file_name: file.name || `arquivo.${ext}`,
      mime,
      size: file.size,
      preview_url: signed?.signedUrl || '',
    })
  } catch (error: any) {
    console.error('Erro no upload de mídia da campanha:', error)
    return NextResponse.json({ error: error?.message || 'Falha no upload.' }, { status: 500 })
  }
}
