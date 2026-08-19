/**
 * Receptor de webhooks da Z-API (uma URL por instância, chave no path).
 *
 * Grava o evento em wa_webhook_events, processa (status de entrega, opt-out,
 * conexão) e, se a instância estiver em modo relay para aquele tipo, repassa o
 * payload bruto para a URL original (ARW) em background. Responde 200 rápido.
 */

import { NextRequest, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getInstanceByWebhookKey, webhookKindForPayloadType } from '@/lib/zapi'
import { processZapiWebhook, relayWebhook } from '@/lib/zapi/webhook-processor'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ webhookKey: string }> }) {
  const { webhookKey } = await ctx.params
  const instance = await getInstanceByWebhookKey(String(webhookKey || ''))
  if (!instance) return Response.json({ ok: false, error: 'unknown webhook key' }, { status: 401 })

  const raw = await req.text()
  let payload: any = null
  try {
    payload = raw ? JSON.parse(raw) : null
  } catch {
    return Response.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }
  if (!payload || typeof payload !== 'object') return Response.json({ ok: false, error: 'empty payload' }, { status: 400 })

  const kind = webhookKindForPayloadType(payload.type)
  const relayUrl = kind ? String(instance.webhook_relay_urls?.[kind] || '') : ''

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  let eventId: string | null = null
  try {
    const { data } = await supabase
      .from('wa_webhook_events')
      .insert({
        instance_id: instance.id,
        type: String(payload.type || ''),
        message_id: String(payload.messageId || (Array.isArray(payload.ids) ? payload.ids[0] : payload.id) || '') || null,
        phone: String(payload.phone || '') || null,
        payload,
      })
      .select('id')
      .maybeSingle()
    eventId = data?.id || null
  } catch (err) {
    console.error('Erro ao gravar wa_webhook_events:', err)
  }

  let result: any = null
  try {
    result = await processZapiWebhook(instance, payload)
  } catch (err: any) {
    console.error('Erro ao processar webhook Z-API:', err?.message)
  }

  if (relayUrl) {
    after(async () => {
      const r = await relayWebhook(relayUrl, raw, req.headers.get('content-type') || 'application/json')
      if (eventId) {
        await supabase
          .from('wa_webhook_events')
          .update({ relayed_at: new Date().toISOString(), relay_status: r.status, relay_error: r.error })
          .eq('id', eventId)
      }
    })
  }

  return Response.json({ value: true, ok: true, ...(result || {}) }, { status: 200 })
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ webhookKey: string }> }) {
  const { webhookKey } = await ctx.params
  const instance = await getInstanceByWebhookKey(String(webhookKey || ''))
  return Response.json({ ok: !!instance, endpoint: 'zapi-webhook' }, { status: instance ? 200 : 401 })
}
