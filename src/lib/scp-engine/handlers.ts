/**
 * Handlers embutidos do motor.
 *
 * Cada handler executa um tipo de job. São o vocabulário inicial do motor —
 * a biblioteca de Ações/Gatilhos do construtor no-code passa a mapear para
 * estes (e novos) kinds. Todos tolerantes a tabelas/config ausentes.
 *
 * `registerBuiltinHandlers` é idempotente: registra uma vez só.
 */

import type { EngineJob } from './decisions'
import { buildDedupeKey } from './decisions'
import { selectStageActions, resolveNextStage, type StageModel } from './stage-actions'

let registered = false

const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01'])
function isMissingTable(error: any): boolean {
  return !!error && MISSING_TABLE_CODES.has(String(error.code || ''))
}

async function admin() {
  const { createAdminClient } = await import('@/lib/supabase/server')
  return createAdminClient()
}

/** Atalho para enfileirar um job a partir de um handler. */
async function enqueue(input: Parameters<typeof import('./queue')['enqueueJob']>[0]) {
  const { enqueueJob } = await import('./queue')
  return enqueueJob(input)
}

/** Registra um evento na timeline da instância (process_instance_events). */
async function logInstanceEvent(instanceId: string | null | undefined, eventType: string, payload: Record<string, any> = {}) {
  if (!instanceId) return
  try {
    const supabase = await admin()
    await supabase.from('process_instance_events').insert({
      instance_id: instanceId,
      event_type: eventType,
      payload,
    })
  } catch (error: any) {
    if (!isMissingTable(error)) console.error('Erro ao registrar evento da instância:', error?.message)
  }
}

// -------------------------------------------------------------------------
// Handlers
// -------------------------------------------------------------------------

/** log_event: grava um evento arbitrário na timeline. */
async function handleLogEvent(job: EngineJob): Promise<void> {
  const eventType = String(job.payload?.event_type || 'log')
  await logInstanceEvent(job.instance_id, eventType, job.payload?.data || {})
}

/**
 * enter_stage: a instância ENTROU numa etapa — executa as ações de entrada.
 * Lê process.config, filtra os itens on_enter da etapa e enfileira um job por
 * ação (idempotente pela dedupe_key). Registra `stage_entered` na timeline.
 *
 * Guarda de idempotência: se a instância já saiu dessa etapa (current_stage_id
 * mudou), o job é ignorado — evita ações de uma etapa que a instância deixou.
 */
async function handleEnterStage(job: EngineJob): Promise<void> {
  const instanceId = job.instance_id
  const stageId = String(job.payload?.stage_id || '')
  if (!instanceId || !stageId) throw new Error('enter_stage sem instance_id/stage_id')

  const supabase = await admin()

  const { data: instance, error: iErr } = await supabase
    .from('process_instances')
    .select('id, process_id, current_stage_id')
    .eq('id', instanceId)
    .maybeSingle()
  if (iErr) throw iErr
  if (!instance) throw new Error('Instância não encontrada')

  // Job obsoleto: a instância já não está mais nessa etapa.
  if (String(instance.current_stage_id) !== stageId) return

  const { data: process, error: prErr } = await supabase
    .from('process_models')
    .select('config')
    .eq('id', instance.process_id)
    .maybeSingle()
  if (prErr) throw prErr

  await logInstanceEvent(instanceId, 'stage_entered', { stage_id: stageId })

  const actions = selectStageActions((process as any)?.config, stageId, 'on_enter')

  for (const doc of actions.documents) {
    await enqueue({
      kind: 'generate_document',
      instanceId,
      dedupeKey: buildDedupeKey('gendoc', instanceId, stageId, doc?.name || 'doc'),
      payload: { stage_id: stageId, doc },
    })
  }
  for (const email of actions.emails) {
    await enqueue({
      kind: 'send_email',
      instanceId,
      dedupeKey: buildDedupeKey('email', instanceId, stageId, email?.name || 'email'),
      payload: { stage_id: stageId, item: email },
    })
  }
  for (const wa of actions.whatsapp) {
    await enqueue({
      kind: 'send_whatsapp',
      instanceId,
      dedupeKey: buildDedupeKey('whats', instanceId, stageId, wa?.name || 'wa'),
      payload: { stage_id: stageId, item: wa },
    })
  }
}

/**
 * generate_document: gera o contrato do parceiro da instância (fluxo A da
 * Assinafy) usando o template referenciado na config da etapa, e enfileira o
 * polling do status da assinatura.
 */
async function handleGenerateDocument(job: EngineJob): Promise<void> {
  const instanceId = job.instance_id
  if (!instanceId) throw new Error('generate_document sem instance_id')

  const supabase = await admin()
  const { data: instance, error: iErr } = await supabase
    .from('process_instances')
    .select('id, partner_id')
    .eq('id', instanceId)
    .maybeSingle()
  if (iErr) throw iErr
  if (!instance?.partner_id) throw new Error('Instância sem parceiro vinculado')

  const docConfig = job.payload?.doc || {}
  const templateName = String(docConfig?.assinafy_template_name || docConfig?.template_name || '')

  const { generateContractForPartner } = await import('@/lib/assinafy')
  const result = await generateContractForPartner({
    partnerId: String(instance.partner_id),
    templateName,
    processInstanceId: instanceId,
  })
  if (!result.ok) throw new Error(result.error || 'Falha ao gerar contrato')

  await logInstanceEvent(instanceId, 'document_generated', {
    document_id: result.documentId,
    template: templateName,
    filled: result.filled?.length || 0,
    missing: result.missing?.map((m) => m.canonicalKey) || [],
  })

  // Agenda a checagem do status da assinatura (polling — rede de segurança
  // além do webhook). Roda daqui a alguns minutos.
  if (result.documentId) {
    await enqueue({
      kind: 'sync_signature_status',
      instanceId,
      dedupeKey: buildDedupeKey('syncsig', instanceId, result.documentId),
      payload: { document_id: result.documentId },
      runAfterIso: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })
  }
}

/**
 * send_email — STUB (C2a): registra a intenção na timeline para o fluxo ser
 * observável de ponta a ponta. O envio real (Resend com resolução de template
 * + token_mapping + destinatário) é o C2b.
 */
async function handleSendEmail(job: EngineJob): Promise<void> {
  const item = job.payload?.item || {}
  await logInstanceEvent(job.instance_id, 'email_pending', {
    name: item?.name || null,
    template: item?.template_name || item?.template_id || null,
    note: 'stub C2a — envio real no C2b',
  })
}

/**
 * send_whatsapp — envio REAL via Z-API (src/lib/zapi).
 *
 * Resolve o modelo em `whatsapp_templates` (por template_id, senão por nome),
 * substitui as tags do parceiro e envia para o phone_whatsapp do parceiro da
 * instância. Registra `whatsapp_sent` (ou `whatsapp_failed`) na timeline. Se
 * o item trouxer `instance_id`, usa aquela instância Z-API; senão a padrão.
 * Lança em falha para a fila fazer backoff/retentativa.
 */
async function handleSendWhatsapp(job: EngineJob): Promise<void> {
  const instanceId = job.instance_id
  if (!instanceId) throw new Error('send_whatsapp sem instance_id')
  const item = job.payload?.item || {}

  const supabase = await admin()
  const { data: instance, error: iErr } = await supabase
    .from('process_instances')
    .select('id, partner_id')
    .eq('id', instanceId)
    .maybeSingle()
  if (iErr) throw iErr
  if (!instance?.partner_id) throw new Error('Instância sem parceiro vinculado')

  const { data: partner, error: pErr } = await supabase
    .from('agentes_parceiros')
    .select('*')
    .eq('id', instance.partner_id)
    .maybeSingle()
  if (pErr) throw pErr
  if (!partner) throw new Error('Parceiro da instância não encontrado')

  // Modelo de mensagem
  let template: { id: string; name: string; body: string; is_active?: boolean } | null = null
  if (item.template_id) {
    const { data } = await supabase.from('whatsapp_templates').select('id, name, body, is_active').eq('id', item.template_id).maybeSingle()
    template = data as any
  }
  if (!template && item.template_name) {
    const { data } = await supabase.from('whatsapp_templates').select('id, name, body, is_active').eq('name', item.template_name).maybeSingle()
    template = data as any
  }
  const body = String(template?.body || item.body || item.message || '').trim()
  if (!body) throw new Error(`Modelo de WhatsApp não encontrado (${item.template_name || item.template_id || 'sem referência'})`)
  if (template && template.is_active === false) throw new Error(`Modelo de WhatsApp "${template.name}" está inativo`)

  const { renderPartnerTags, renderTemplate, resolveInstanceForSend, sendAndLog } = await import('@/lib/zapi')
  const zapiInstance = await resolveInstanceForSend(item.instance_id || null)
  if (!zapiInstance) throw new Error('Nenhuma instância Z-API ativa configurada')

  // Tags do parceiro + tags globais do SCP ({{processo.id}}, {{assinatura.link}}).
  const rendered = renderTemplate(renderPartnerTags(body, partner), {
    'processo.id': instanceId,
    'assinatura.link': partner.assinafy_signature_url || '',
  })

  const phone = String(item.phone || partner.phone_whatsapp || '')
  const res = await sendAndLog({
    instance: zapiInstance,
    phone,
    source: 'scp',
    block: { type: 'text', body: rendered },
    refs: { processInstanceId: instanceId, partnerId: partner.id },
  })

  if (!res.ok) {
    await logInstanceEvent(instanceId, 'whatsapp_failed', {
      name: item?.name || null,
      template: template?.name || item?.template_name || null,
      error: res.error,
    })
    throw new Error(res.error)
  }

  await logInstanceEvent(instanceId, 'whatsapp_sent', {
    name: item?.name || null,
    template: template?.name || item?.template_name || null,
    message_id: res.result.messageId,
    phone: res.phone,
  })
}

/**
 * advance_stage: move a instância para a próxima etapa (via transitions por
 * nome, com fallback por posição) e enfileira o enter_stage da nova etapa —
 * disparando as ações de entrada dela. Se não há próxima (terminal), conclui.
 */
async function handleAdvanceStage(job: EngineJob): Promise<void> {
  const instanceId = job.instance_id
  if (!instanceId) throw new Error('advance_stage sem instance_id')

  const supabase = await admin()

  const { data: instance, error: iErr } = await supabase
    .from('process_instances')
    .select('id, process_id, current_stage_id, status')
    .eq('id', instanceId)
    .maybeSingle()
  if (iErr) throw iErr
  if (!instance) throw new Error('Instância não encontrada')

  const { data: stages, error: sErr } = await supabase
    .from('process_stage_models')
    .select('id, name, position, config')
    .eq('process_id', instance.process_id)
    .order('position', { ascending: true })
  if (sErr) throw sErr

  const next = resolveNextStage((stages || []) as StageModel[], instance.current_stage_id)

  if (next) {
    await supabase
      .from('process_instances')
      .update({ current_stage_id: next.id, updated_at: new Date().toISOString() })
      .eq('id', instanceId)
    await logInstanceEvent(instanceId, 'stage_advanced', {
      from: instance.current_stage_id || null,
      to: next.id,
    })
    // Entrar na nova etapa dispara as ações de entrada dela.
    await enqueue({
      kind: 'enter_stage',
      instanceId,
      dedupeKey: buildDedupeKey('enter', instanceId, next.id),
      payload: { stage_id: next.id },
    })
  } else {
    await supabase
      .from('process_instances')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', instanceId)
    await logInstanceEvent(instanceId, 'process_completed', {})
  }
}

/**
 * sync_signature_status: consulta o status do documento na Assinafy e atualiza
 * o registro. Se ficou certificado e há instância vinculada, enfileira o avanço
 * de etapa (idempotente pela dedupe_key).
 */
async function handleSyncSignatureStatus(job: EngineJob): Promise<void> {
  const documentId = String(job.payload?.document_id || '')
  if (!documentId) throw new Error('sync_signature_status sem document_id')

  const { AssinafyClient, updateAssinafyDocumentStatus } = await import('@/lib/assinafy')
  const client = await AssinafyClient.fromActiveConfig()
  const doc = await client.getDocument(documentId)
  const status = String((doc as any)?.status || '')
  if (status) await updateAssinafyDocumentStatus(documentId, status, 'engine_sync')

  if (status === 'certificated' && job.instance_id) {
    const { enqueueJob } = await import('./queue')
    await enqueueJob({
      kind: 'advance_stage',
      instanceId: job.instance_id,
      dedupeKey: buildDedupeKey('advance', job.instance_id, 'doc', documentId),
      payload: { reason: 'signature_certificated', document_id: documentId },
    })
  }
}

export function registerBuiltinHandlers(deps: { registerHandler: (kind: string, fn: (job: EngineJob) => Promise<void>) => void }): void {
  if (registered) return
  deps.registerHandler('log_event', handleLogEvent)
  deps.registerHandler('enter_stage', handleEnterStage)
  deps.registerHandler('generate_document', handleGenerateDocument)
  deps.registerHandler('send_email', handleSendEmail)
  deps.registerHandler('send_whatsapp', handleSendWhatsapp)
  deps.registerHandler('advance_stage', handleAdvanceStage)
  deps.registerHandler('sync_signature_status', handleSyncSignatureStatus)
  registered = true
}
