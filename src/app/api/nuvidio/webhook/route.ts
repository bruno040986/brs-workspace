/**
 * Receptor de webhooks da Nuvidio — fatia 1 (inbox durável).
 *
 * Envelope: { hookType, hookDescription, timestamp, content } (com "Enviar
 * dados completos" ligado no painel). A chave vem no header Authorization
 * (campo "Autenticação" do painel) ou em ?key=.
 *
 * Fluxo: autentica → grava o payload bruto na inbox → processa (regras em
 * src/lib/nuvidio/webhooks.ts) → responde 200. Se a inbox falhar, responde 500
 * pra Nuvidio reenviar; se só a regra falhar, o erro fica na inbox e o item é
 * reprocessável pelo card Provedores › Nuvidio.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { lerNuvidioConfigRow } from '@/lib/nuvidio/client'
import { interpretarHook } from '@/lib/nuvidio/webhook-interpretar'
import { processarWebhookNuvidio } from '@/lib/nuvidio/webhooks'

export const dynamic = 'force-dynamic'

function chaveConfere(recebida: string, esperada: string): boolean {
  const a = createHash('sha256').update(recebida).digest()
  const b = createHash('sha256').update(esperada).digest()
  return timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  const config = await lerNuvidioConfigRow()
  const esperada = String(config?.webhook_key || '')
  if (!esperada) return Response.json({ ok: false, error: 'webhook key not configured' }, { status: 503 })
  const doHeader = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const recebida = doHeader || req.nextUrl.searchParams.get('key') || ''
  if (!recebida || !chaveConfere(recebida, esperada)) return Response.json({ ok: false, error: 'invalid key' }, { status: 401 })

  let payload: unknown = null
  try {
    payload = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  const admin = await createAdminClient()
  const h = interpretarHook(payload)
  const { data: inbox, error } = await admin
    .from('nuvidio_webhooks_recebidos')
    .insert({ hook_type: h.hookType, invite_id: h.inviteId, call_id: h.callId, payload: payload ?? {} })
    .select('id')
    .single()
  if (error || !inbox) {
    console.error('Webhook Nuvidio: falha ao gravar na inbox:', error?.message)
    return Response.json({ ok: false, error: 'inbox unavailable' }, { status: 500 })
  }

  try {
    const r = await processarWebhookNuvidio(admin, inbox.id)
    return Response.json({ received: true, ...r })
  } catch (err: any) {
    const msg = String(err?.message || err).slice(0, 500)
    console.error('Webhook Nuvidio: falha ao processar', inbox.id, msg)
    await admin.from('nuvidio_webhooks_recebidos').update({ erro: `falha ao processar: ${msg}` }).eq('id', inbox.id)
    return Response.json({ received: true, matched: false, erro: 'guardado para reprocessar' })
  }
}

export async function GET() {
  return Response.json({ ok: true, endpoint: 'nuvidio-webhook' })
}
