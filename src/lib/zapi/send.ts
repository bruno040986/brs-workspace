/**
 * `sendAndLog` — ÚNICO ponto de saída de mensagens WhatsApp.
 *
 * Grava a intenção em `wa_outbound_messages` antes de chamar a Z-API e
 * atualiza a linha com o resultado (message_id/zaap_id ou erro). Assim todo
 * envio (campanha, boas-vindas, motor SCP, teste) fica auditável e o webhook
 * de status consegue correlacionar pelo message_id.
 */

import type { ZapiInstanceRow, ZapiSendResult } from './types'
import { ZapiClient, ZapiError } from './client'
import { normalizeBrPhone } from './phone'

export type OutboundSource = 'campaign' | 'campaign_button' | 'campaign_contact' | 'scp' | 'welcome' | 'test' | 'manual'

export type OutboundBlock =
  | { type: 'text'; body: string; delayMessage?: number; delayTyping?: number }
  | { type: 'image'; url: string; caption?: string; delayMessage?: number }
  | { type: 'document'; url: string; extension: string; fileName?: string; caption?: string; delayMessage?: number }
  | { type: 'audio'; url: string; waveform?: boolean; delayMessage?: number }
  | { type: 'contact'; contactName: string; contactPhone: string; description?: string; delayMessage?: number }
  | { type: 'button_list'; message: string; buttons: Array<{ id?: string; label: string }>; delayMessage?: number }

export type SendAndLogInput = {
  instance: ZapiInstanceRow
  phone: string
  source: OutboundSource
  block: OutboundBlock
  refs?: {
    campaignId?: string | null
    recipientId?: string | null
    processInstanceId?: string | null
    partnerId?: string | null
    createdBy?: string | null
  }
  /** Cliente já construído (evita reconstruir a cada envio no worker). */
  client?: ZapiClient
}

export type SendAndLogResult =
  | { ok: true; logId: string | null; result: ZapiSendResult; phone: string }
  | { ok: false; logId: string | null; error: string; status?: number; phone: string | null }

async function admin() {
  const { createAdminClient } = await import('@/lib/supabase/server')
  return createAdminClient()
}

function summarize(block: OutboundBlock): Record<string, unknown> {
  switch (block.type) {
    case 'text':
      return { body_preview: block.body.slice(0, 160) }
    case 'image':
      return { caption: (block.caption || '').slice(0, 160), has_media: true }
    case 'document':
      return { file_name: block.fileName || null, extension: block.extension, caption: (block.caption || '').slice(0, 160) }
    case 'audio':
      return { has_media: true, waveform: block.waveform ?? true }
    case 'contact':
      return { contact_name: block.contactName, contact_phone: block.contactPhone }
    case 'button_list':
      return { body_preview: block.message.slice(0, 160), buttons: block.buttons.map((b) => b.label) }
  }
}

function messageTypeOf(block: OutboundBlock): string {
  return block.type
}

async function dispatch(client: ZapiClient, phone: string, block: OutboundBlock): Promise<ZapiSendResult> {
  switch (block.type) {
    case 'text':
      return client.sendText({ phone, message: block.body, delayMessage: block.delayMessage, delayTyping: block.delayTyping })
    case 'image':
      return client.sendImage({ phone, image: block.url, caption: block.caption, delayMessage: block.delayMessage })
    case 'document':
      return client.sendDocument({
        phone,
        document: block.url,
        extension: block.extension,
        fileName: block.fileName,
        caption: block.caption,
        delayMessage: block.delayMessage,
      })
    case 'audio':
      return client.sendAudio({ phone, audio: block.url, waveform: block.waveform, delayMessage: block.delayMessage })
    case 'contact':
      return client.sendContact({
        phone,
        contactName: block.contactName,
        contactPhone: block.contactPhone,
        contactBusinessDescription: block.description,
        delayMessage: block.delayMessage,
      })
    case 'button_list':
      return client.sendButtonList({ phone, message: block.message, buttons: block.buttons, delayMessage: block.delayMessage })
  }
}

export async function sendAndLog(input: SendAndLogInput): Promise<SendAndLogResult> {
  const phone = normalizeBrPhone(input.phone)
  const supabase = await admin()
  const refs = input.refs || {}

  // 1. Registra a intenção (status accepted até a Z-API responder).
  let logId: string | null = null
  try {
    const { data } = await supabase
      .from('wa_outbound_messages')
      .insert({
        instance_id: input.instance.id,
        phone: phone || String(input.phone || '').replace(/\D/g, '') || '-',
        source: input.source,
        message_type: messageTypeOf(input.block),
        status: 'accepted',
        payload_summary: summarize(input.block),
        campaign_id: refs.campaignId || null,
        recipient_id: refs.recipientId || null,
        process_instance_id: refs.processInstanceId || null,
        partner_id: refs.partnerId || null,
        created_by: refs.createdBy || null,
      })
      .select('id')
      .maybeSingle()
    logId = data?.id || null
  } catch (error) {
    console.error('Erro ao registrar wa_outbound_messages (seguindo com o envio):', error)
  }

  if (!phone) {
    const error = `Telefone inválido: "${input.phone}"`
    if (logId) await supabase.from('wa_outbound_messages').update({ status: 'failed', error }).eq('id', logId)
    return { ok: false, logId, error, phone: null }
  }

  // 2. Envia.
  try {
    const client = input.client || ZapiClient.fromInstance(input.instance)
    const result = await dispatch(client, phone, input.block)
    if (logId) {
      await supabase
        .from('wa_outbound_messages')
        .update({
          zaap_id: result?.zaapId || null,
          message_id: result?.messageId || result?.id || null,
        })
        .eq('id', logId)
    }
    return { ok: true, logId, result, phone }
  } catch (err: any) {
    const status = err instanceof ZapiError ? err.status : undefined
    const error = String(err?.message || 'Falha ao enviar pela Z-API')
    if (logId) {
      await supabase.from('wa_outbound_messages').update({ status: 'failed', error: error.slice(0, 2000) }).eq('id', logId)
    }
    return { ok: false, logId, error, status, phone }
  }
}
