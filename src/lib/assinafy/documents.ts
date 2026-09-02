/**
 * Persistência dos documentos da Assinafy e da caixa de webhooks.
 *
 * Apenas back-end (usa service role). Tolerante à migração ainda não aplicada:
 * se as tabelas não existirem, as funções avisam e seguem sem quebrar o fluxo
 * de geração de contrato.
 */

import { interpretWebhook } from './webhook'

const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01'])

function isMissingTable(error: any): boolean {
  return !!error && MISSING_TABLE_CODES.has(String(error.code || ''))
}

async function admin() {
  const { createAdminClient } = await import('@/lib/supabase/server')
  return createAdminClient()
}

export type RecordDocumentInput = {
  documentId: string
  partnerId?: string | null
  processInstanceId?: string | null
  templateId?: string
  templateName?: string
  environment?: string
  status?: string
  signers?: unknown
  signingUrls?: unknown
}

/** Grava (ou atualiza) o registro de um documento gerado. */
export async function recordAssinafyDocument(input: RecordDocumentInput): Promise<{ ok: boolean; error?: string }> {
  if (!input.documentId) return { ok: false, error: 'documentId ausente' }
  try {
    const supabase = await admin()
    const row = {
      document_id: input.documentId,
      partner_id: input.partnerId || null,
      process_instance_id: input.processInstanceId || null,
      template_id: input.templateId || null,
      template_name: input.templateName || null,
      environment: input.environment || null,
      status: input.status || null,
      signers: input.signers ?? [],
      signing_urls: input.signingUrls ?? [],
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase
      .from('assinafy_documents')
      .upsert(row, { onConflict: 'document_id' })
    if (error) throw error
    return { ok: true }
  } catch (error: any) {
    if (isMissingTable(error)) {
      console.warn('assinafy_documents ainda não existe; registro de documento ignorado.')
      return { ok: false, error: 'tabela ausente' }
    }
    console.error('Erro ao gravar assinafy_documents:', error?.message)
    return { ok: false, error: error?.message }
  }
}

/** Documentos que ainda podem mudar de status (não-terminais) — alvo do polling. */
export async function listPendingAssinafyDocuments(limit = 100): Promise<any[]> {
  try {
    const supabase = await admin()
    const { data, error } = await supabase
      .from('assinafy_documents')
      .select('*')
      .not('status', 'in', '(certificated,expired,rejected_by_signer,rejected_by_user,failed)')
      .order('updated_at', { ascending: true })
      .limit(limit)
    if (error) throw error
    return data || []
  } catch (error: any) {
    if (isMissingTable(error)) return []
    console.error('Erro ao listar documentos pendentes:', error?.message)
    return []
  }
}

/** Lista os documentos mais recentes (para exibição/status). */
export async function listRecentAssinafyDocuments(limit = 30): Promise<any[]> {
  try {
    const supabase = await admin()
    const { data, error } = await supabase
      .from('assinafy_documents')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return data || []
  } catch (error: any) {
    if (isMissingTable(error)) return []
    console.error('Erro ao listar documentos:', error?.message)
    return []
  }
}

/** Atualiza o status de um documento (usado pelo webhook e pela reconciliação). */
export async function updateAssinafyDocumentStatus(
  documentId: string,
  status: string | null,
  event?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!documentId || !status) return { ok: false, error: 'documentId/status ausente' }
  try {
    const supabase = await admin()
    const patch: Record<string, any> = { status, updated_at: new Date().toISOString() }
    if (event) {
      patch.last_event = event
      patch.last_event_at = new Date().toISOString()
    }
    const { error } = await supabase
      .from('assinafy_documents')
      .update(patch)
      .eq('document_id', documentId)
    if (error) throw error
    return { ok: true }
  } catch (error: any) {
    if (isMissingTable(error)) return { ok: false, error: 'tabela ausente' }
    console.error('Erro ao atualizar status do documento:', error?.message)
    return { ok: false, error: error?.message }
  }
}

/**
 * Processa um envelope de webhook: deduplica pelo external_id, grava na inbox e
 * atualiza o status do documento. Idempotente — reprocessar o mesmo evento não
 * causa efeito duplicado.
 */
/**
 * Cadastros Recebidos (fase D): quando um documento vinculado a um processo
 * de onboarding fica assinado ('certificated'), marca contrato/termo no
 * processo e registra o evento — o operador vê a etapa liberada na tela.
 */
async function atualizarOnboardingPorDocumento(supabase: any, documentId: string, status: string) {
  if (status !== 'certificated') return
  try {
    const { data: porContrato } = await supabase
      .from('corban_onboarding_processos')
      .select('id, contrato_status')
      .eq('contrato_assinafy_document_id', documentId)
      .maybeSingle()
    if (porContrato && porContrato.contrato_status !== 'assinado') {
      await supabase
        .from('corban_onboarding_processos')
        .update({ contrato_status: 'assinado', updated_at: new Date().toISOString() })
        .eq('id', porContrato.id)
      await supabase.from('corban_onboarding_eventos').insert({
        processo_id: porContrato.id,
        tipo: 'contrato_assinado',
        detalhe: { document_id: documentId, origem: 'webhook' },
      })
      return
    }
    const { data: porTermo } = await supabase
      .from('corban_onboarding_processos')
      .select('id, termo_status')
      .eq('termo_assinafy_document_id', documentId)
      .maybeSingle()
    if (porTermo && porTermo.termo_status !== 'assinado') {
      await supabase
        .from('corban_onboarding_processos')
        .update({ termo_status: 'assinado', updated_at: new Date().toISOString() })
        .eq('id', porTermo.id)
      await supabase.from('corban_onboarding_eventos').insert({
        processo_id: porTermo.id,
        tipo: 'termo_assinado',
        detalhe: { document_id: documentId, origem: 'webhook' },
      })
    }
  } catch (err) {
    console.error('Erro ao refletir assinatura no onboarding:', err)
  }
}

export async function processAssinafyWebhook(envelope: any): Promise<{ ok: boolean; deduped?: boolean; documentId?: string; status?: string | null }> {
  const interpreted = interpretWebhook(envelope)
  try {
    const supabase = await admin()

    // Dedup: se external_id já existe, ignora.
    if (interpreted.externalId) {
      const { data: existing } = await supabase
        .from('assinafy_webhook_inbox')
        .select('id')
        .eq('external_id', interpreted.externalId)
        .maybeSingle()
      if (existing) return { ok: true, deduped: true, documentId: interpreted.documentId, status: interpreted.status }
    }

    await supabase.from('assinafy_webhook_inbox').insert({
      external_id: interpreted.externalId || null,
      event: interpreted.event,
      document_id: interpreted.documentId || null,
      payload: envelope ?? {},
      processed: false,
    })

    if (interpreted.documentId && interpreted.status) {
      await updateAssinafyDocumentStatus(interpreted.documentId, interpreted.status, interpreted.event)
      await atualizarOnboardingPorDocumento(supabase, interpreted.documentId, interpreted.status)
    }

    if (interpreted.externalId) {
      await supabase
        .from('assinafy_webhook_inbox')
        .update({ processed: true })
        .eq('external_id', interpreted.externalId)
    }

    return { ok: true, documentId: interpreted.documentId, status: interpreted.status }
  } catch (error: any) {
    if (isMissingTable(error)) {
      console.warn('Tabelas de webhook ainda não existem; evento não persistido.')
      return { ok: false }
    }
    console.error('Erro ao processar webhook da Assinafy:', error?.message)
    return { ok: false }
  }
}
