import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getPlainTextLength } from '@/lib/comunicados'
import { loadComunicadosCatalog } from '@/lib/comunicados-service'
import { requirePermission } from '@/lib/auth/server'
import { sanitizeRichHtml } from '@/lib/sanitize-html'

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return fallback
}

async function getCurrentUserId() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  return user.id
}

function parseTargetIds(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item)).filter(Boolean)
}

export async function GET() {
  try {
    await requirePermission('sistema-comunicados', 'can_view')
    const admin = await createAdminClient()
    const items = await loadComunicadosCatalog(admin)
    return NextResponse.json({ items })
  } catch (error) {
    const message = getErrorMessage(error, 'Falha ao carregar comunicados.')
    return NextResponse.json({ error: message }, { status: message.includes('permissao') ? 403 : 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requirePermission('sistema-comunicados', 'can_include')
    const admin = await createAdminClient()
    const body = await request.json()

    const titulo = String(body.titulo || '').trim().slice(0, 60)
    const textoHtml = sanitizeRichHtml(String(body.texto_html || body.textoHtml || '').trim())
    const targetProfileIds = parseTargetIds(body.target_profile_ids || body.targetProfileIds)
    const fixoTopo = Boolean(body.fixo_topo ?? body.fixoTopo)
    const dataInicio = String(body.data_inicio_veiculacao || body.dataInicioVeiculacao || '')
    const dataFim = String(body.data_fim_veiculacao || body.dataFimVeiculacao || '')
    const status = String(body.status || 'ativo') === 'inativo' ? 'inativo' : 'ativo'

    if (!titulo) return NextResponse.json({ error: 'Título é obrigatório.' }, { status: 400 })
    if (!textoHtml) return NextResponse.json({ error: 'Texto do comunicado é obrigatório.' }, { status: 400 })
    if (getPlainTextLength(textoHtml) > 2000) return NextResponse.json({ error: 'O texto do comunicado ultrapassa 2.000 caracteres.' }, { status: 400 })
    if (!dataInicio || !dataFim) return NextResponse.json({ error: 'Data e hora de veiculação são obrigatórias.' }, { status: 400 })
    if (new Date(dataFim).getTime() < new Date(dataInicio).getTime()) {
      return NextResponse.json({ error: 'A data final deve ser maior ou igual à data inicial.' }, { status: 400 })
    }
    if (targetProfileIds.length === 0) return NextResponse.json({ error: 'Selecione pelo menos um perfil.' }, { status: 400 })

    const { data: comunicado, error } = await admin
      .from('comunicados')
      .insert({
        titulo,
        texto_html: textoHtml,
        fixo_topo: fixoTopo,
        data_inicio_veiculacao: new Date(dataInicio).toISOString(),
        data_fim_veiculacao: new Date(dataFim).toISOString(),
        status,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (error) throw error

    const targetRows = targetProfileIds.map((profileId) => ({
      comunicado_id: comunicado.id,
      profile_id: profileId,
    }))

    const { error: targetError } = await admin.from('comunicado_target_profiles').insert(targetRows)
    if (targetError) throw targetError

    const items = await loadComunicadosCatalog(admin)
    return NextResponse.json({ success: true, items })
  } catch (error) {
    const message = getErrorMessage(error, 'Falha ao salvar comunicado.')
    console.error('Erro ao salvar comunicado:', error)
    return NextResponse.json({ error: message }, { status: message.includes('permissao') ? 403 : 500 })
  }
}
