import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
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

function parseTargetIds(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item)).filter(Boolean)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('sistema-comunicados', 'can_edit')
    const admin = await createAdminClient()
    const { id } = await params
    const body = await request.json()

    const titulo = body.titulo !== undefined ? String(body.titulo || '').trim().slice(0, 60) : undefined
    const textoHtml = body.texto_html !== undefined || body.textoHtml !== undefined ? sanitizeRichHtml(String(body.texto_html || body.textoHtml || '').trim()) : undefined
    const targetProfileIds = body.target_profile_ids !== undefined || body.targetProfileIds !== undefined
      ? parseTargetIds(body.target_profile_ids || body.targetProfileIds)
      : undefined
    const fixoTopo = body.fixo_topo !== undefined || body.fixoTopo !== undefined ? Boolean(body.fixo_topo ?? body.fixoTopo) : undefined
    const dataInicio = body.data_inicio_veiculacao || body.dataInicioVeiculacao
    const dataFim = body.data_fim_veiculacao || body.dataFimVeiculacao
    const status = body.status ? (String(body.status) === 'inativo' ? 'inativo' : 'ativo') : undefined

    if (titulo !== undefined && !titulo) return NextResponse.json({ error: 'Título é obrigatório.' }, { status: 400 })
    if (textoHtml !== undefined && !textoHtml) return NextResponse.json({ error: 'Texto do comunicado é obrigatório.' }, { status: 400 })
    if (textoHtml !== undefined && getPlainTextLength(textoHtml) > 2000) return NextResponse.json({ error: 'O texto do comunicado ultrapassa 2.000 caracteres.' }, { status: 400 })
    if ((dataInicio || dataFim) && new Date(String(dataFim)).getTime() < new Date(String(dataInicio)).getTime()) {
      return NextResponse.json({ error: 'A data final deve ser maior ou igual à data inicial.' }, { status: 400 })
    }
    if (targetProfileIds !== undefined && targetProfileIds.length === 0) {
      return NextResponse.json({ error: 'Selecione pelo menos um perfil.' }, { status: 400 })
    }

    const updateRow: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }
    if (titulo !== undefined) updateRow.titulo = titulo
    if (textoHtml !== undefined) updateRow.texto_html = textoHtml
    if (fixoTopo !== undefined) updateRow.fixo_topo = fixoTopo
    if (dataInicio) updateRow.data_inicio_veiculacao = new Date(String(dataInicio)).toISOString()
    if (dataFim) updateRow.data_fim_veiculacao = new Date(String(dataFim)).toISOString()
    if (status) updateRow.status = status

    const { error } = await admin.from('comunicados').update(updateRow).eq('id', id)
    if (error) throw error

    if (targetProfileIds !== undefined) {
      const { error: deleteTargetError } = await admin.from('comunicado_target_profiles').delete().eq('comunicado_id', id)
      if (deleteTargetError) throw deleteTargetError

      const { error: targetError } = await admin
        .from('comunicado_target_profiles')
        .insert(targetProfileIds.map((profileId) => ({ comunicado_id: id, profile_id: profileId })))
      if (targetError) throw targetError
    }

    const items = await loadComunicadosCatalog(admin)
    return NextResponse.json({ success: true, items })
  } catch (error) {
    const message = getErrorMessage(error, 'Falha ao atualizar comunicado.')
    console.error('Erro ao atualizar comunicado:', error)
    return NextResponse.json({ error: message }, { status: message.includes('permissao') ? 403 : 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('sistema-comunicados', 'can_delete')
    const admin = await createAdminClient()
    const { id } = await params
    const { error } = await admin.from('comunicados').delete().eq('id', id)
    if (error) throw error
    const items = await loadComunicadosCatalog(admin)
    return NextResponse.json({ success: true, items })
  } catch (error) {
    const message = getErrorMessage(error, 'Falha ao excluir comunicado.')
    console.error('Erro ao excluir comunicado:', error)
    return NextResponse.json({ error: message }, { status: message.includes('permissao') ? 403 : 500 })
  }
}
