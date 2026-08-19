/**
 * Processamento dos webhooks da Z-API.
 *
 * - MessageStatusCallback → atualiza status (monotônico) em wa_outbound_messages
 *   e propaga para wa_campaign_recipients (sent < delivered < read).
 * - DeliveryCallback → preenche message_id a partir do zaap_id; `error` → failed.
 * - ReceivedCallback → resposta ao botão anti-ban ("Não") ou texto igual ao
 *   rótulo negativo → wa_optouts + marca pendentes como optout.
 * - Connected/Disconnected → cache de status da instância.
 *
 * Idempotente: replays não regridem status.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ZapiInstanceRow, ZapiWebhookPayload } from './types'
import { normalizeBrPhone } from './phone'
import { ANTIBAN_BUTTON_NO_ID } from '@/lib/disparo-whatsapp/types'

function admin(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

const OUTBOUND_RANK: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3, failed: 9 }
const RECIPIENT_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 }

function mapStatus(zapiStatus: string): 'sent' | 'delivered' | 'read' | null {
  switch (String(zapiStatus || '').toUpperCase()) {
    case 'SENT':
      return 'sent'
    case 'RECEIVED':
      return 'delivered'
    case 'READ':
    case 'PLAYED':
      return 'read'
    default:
      return null
  }
}

function normalizeText(s: unknown): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export type WebhookProcessResult = { handled: string; updated?: number; optout?: boolean }

export async function processZapiWebhook(instance: ZapiInstanceRow, payload: ZapiWebhookPayload): Promise<WebhookProcessResult> {
  const supabase = admin()
  const type = String((payload as any)?.type || '')

  if (type === 'MessageStatusCallback') {
    const p = payload as any
    const ids: string[] = Array.isArray(p.ids) ? p.ids.map(String) : p.id ? [String(p.id)] : []
    const mapped = mapStatus(p.status)
    if (!ids.length || !mapped) return { handled: 'status_ignored' }
    return { handled: 'status', updated: await applyStatus(supabase, ids, mapped) }
  }

  if (type === 'DeliveryCallback') {
    const p = payload as any
    const zaapId = String(p.zaapId || '')
    const messageId = String(p.messageId || '')
    if (!zaapId && !messageId) return { handled: 'delivery_ignored' }
    let updated = 0
    if (p.error) {
      const { data } = await supabase
        .from('wa_outbound_messages')
        .update({ status: 'failed', error: String(p.error).slice(0, 2000), status_updated_at: new Date().toISOString() })
        .or(zaapId && messageId ? `zaap_id.eq.${zaapId},message_id.eq.${messageId}` : zaapId ? `zaap_id.eq.${zaapId}` : `message_id.eq.${messageId}`)
        .select('id, recipient_id')
      updated = data?.length || 0
      const recips = (data || []).map((r: any) => r.recipient_id).filter(Boolean)
      if (recips.length) {
        await supabase.from('wa_campaign_recipients').update({ status: 'failed', error: String(p.error).slice(0, 500) }).in('id', recips).in('status', ['sent', 'sending'])
      }
    } else if (zaapId && messageId) {
      const { data } = await supabase.from('wa_outbound_messages').update({ message_id: messageId }).eq('zaap_id', zaapId).is('message_id', null).select('id')
      updated = data?.length || 0
    }
    return { handled: 'delivery', updated }
  }

  if (type === 'ReceivedCallback' || type === 'ReceivedCallBack') {
    const p = payload as any
    if (p.fromMe || p.isGroup) return { handled: 'received_ignored' }
    const phone = normalizeBrPhone(p.phone)
    if (!phone) return { handled: 'received_ignored' }
    const buttonId = String(p.buttonsResponseMessage?.buttonId || p.listResponseMessage?.selectedRowId || '')
    const text = normalizeText(p.buttonsResponseMessage?.message || p.text?.message || '')
    let isOptout = buttonId === ANTIBAN_BUTTON_NO_ID
    let source: 'button' | 'text' = 'button'
    if (!isOptout && text) {
      // Texto igual ao rótulo negativo do último botão anti-ban enviado a esse número (7 dias)
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
      const { data: lastBtn } = await supabase
        .from('wa_outbound_messages')
        .select('payload_summary')
        .eq('phone', phone)
        .eq('source', 'campaign_button')
        .gte('sent_at', since)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const buttons: string[] = Array.isArray((lastBtn as any)?.payload_summary?.buttons) ? (lastBtn as any).payload_summary.buttons : []
      const negative = buttons[1] ? normalizeText(buttons[1]) : ''
      if (negative && text === negative) {
        isOptout = true
        source = 'text'
      } else if (['sair', 'parar', 'pare', 'nao quero receber', 'nao quero mais receber', 'remover', 'descadastrar', 'cancelar inscricao'].includes(text)) {
        isOptout = true
        source = 'text'
      }
    }
    if (!isOptout) return { handled: 'received_ignored' }

    // Campanha de origem: última mensagem de campanha para este número
    const { data: lastCampaignMsg } = await supabase
      .from('wa_outbound_messages')
      .select('campaign_id')
      .eq('phone', phone)
      .in('source', ['campaign', 'campaign_button'])
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    await supabase.from('wa_optouts').upsert(
      {
        phone,
        source,
        reason: source === 'button' ? 'Respondeu "não" ao botão anti-ban' : `Respondeu: "${String(p.text?.message || p.buttonsResponseMessage?.message || '').slice(0, 120)}"`,
        campaign_id: (lastCampaignMsg as any)?.campaign_id || null,
        instance_id: instance.id,
        message_id: String(p.messageId || '') || null,
      },
      { onConflict: 'phone', ignoreDuplicates: true },
    )
    await supabase.from('wa_campaign_recipients').update({ status: 'optout', error: 'Número pediu para não receber' }).eq('phone', phone).eq('status', 'pending')
    return { handled: 'received', optout: true }
  }

  if (type === 'ConnectedCallback' || type === 'DisconnectedCallback') {
    const p = payload as any
    const connected = type === 'ConnectedCallback' ? true : false
    await supabase
      .from('zapi_instances')
      .update({
        last_status: { connected, smartphoneConnected: connected, error: p.error || null, via: 'webhook' },
        last_checked_at: new Date().toISOString(),
      })
      .eq('id', instance.id)
    return { handled: type }
  }

  return { handled: 'ignored' }
}

async function applyStatus(supabase: SupabaseClient, ids: string[], mapped: 'sent' | 'delivered' | 'read'): Promise<number> {
  const { data: rows } = await supabase
    .from('wa_outbound_messages')
    .select('id, status, recipient_id, source')
    .in('message_id', ids)
  if (!rows || rows.length === 0) return 0
  let updated = 0
  const nowIso = new Date().toISOString()
  for (const row of rows as any[]) {
    if ((OUTBOUND_RANK[row.status] ?? 0) >= OUTBOUND_RANK[mapped]) continue
    if (row.status === 'failed') continue
    await supabase.from('wa_outbound_messages').update({ status: mapped, status_updated_at: nowIso }).eq('id', row.id)
    updated += 1
    if (row.recipient_id && row.source === 'campaign') {
      const { data: rec } = await supabase.from('wa_campaign_recipients').select('status').eq('id', row.recipient_id).maybeSingle()
      const current = String((rec as any)?.status || '')
      if (RECIPIENT_RANK[current] !== undefined && RECIPIENT_RANK[current] < RECIPIENT_RANK[mapped]) {
        await supabase.from('wa_campaign_recipients').update({ status: mapped }).eq('id', row.recipient_id).eq('status', current)
      }
    }
  }
  return updated
}

/** Repassa o payload bruto à URL original (ARW). Nunca lança. */
export async function relayWebhook(url: string, rawBody: string, contentType = 'application/json'): Promise<{ status: number | null; error: string | null }> {
  if (!url) return { status: null, error: null }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: rawBody,
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    })
    return { status: res.status, error: res.ok ? null : `HTTP ${res.status}` }
  } catch (err: any) {
    return { status: null, error: String(err?.message || err).slice(0, 500) }
  }
}
