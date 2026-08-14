import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'

const MAX_FILE_SIZE = 15 * 1024 * 1024

// Allowlist de tipos aceitos no chat. Evita servir HTML/SVG/JS (XSS armazenado)
// a partir de URL pública no domínio do projeto.
const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
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
const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/zip': 'zip',
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const admin = await createAdminClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'File missing' }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'Arquivo acima de 15MB' }, { status: 400 })
    }

    // Segurança (A-3): só tipos da allowlist; extensão e contentType derivados do
    // MIME validado, nunca do valor arbitrário enviado pelo cliente.
    const mime = String(file.type || '').toLowerCase()
    if (!ALLOWED_MIME.has(mime)) {
      return NextResponse.json({ error: 'Tipo de arquivo não permitido.' }, { status: 400 })
    }
    const ext = EXT_BY_MIME[mime] || 'bin'
    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const bytes = await file.arrayBuffer()

    const { error: uploadError } = await admin.storage
      .from('workspace-chat')
      .upload(path, bytes, { contentType: mime, upsert: false })

    if (uploadError) throw uploadError

    const { data: publicData } = admin.storage.from('workspace-chat').getPublicUrl(path)

    return NextResponse.json({
      name: file.name,
      size: file.size,
      type: file.type,
      url: publicData.publicUrl,
    })
  } catch (error) {
    console.error('Error uploading file:', error)
    return NextResponse.json({ error: 'Falha no upload. Verifique bucket workspace-chat.' }, { status: 500 })
  }
}
