/**
 * Receptor de webhooks da Assinafy.
 *
 * A Assinafy faz POST aqui a cada evento assinado (document_ready, etc.).
 * Responde 2xx rápido (a entrega tem só 2 tentativas e circuit breaker), grava
 * o evento deduplicado e atualiza o status do documento.
 *
 * Validação de origem: a inscrição registra a URL com ?secret=<webhook_secret>;
 * aqui conferimos esse segredo contra o guardado em assinafy_config. Se não
 * houver segredo configurado, aceitamos (mas o ideal é configurar um).
 */

import { NextRequest } from 'next/server'
import { getAssinafyConfig, processAssinafyWebhook } from '@/lib/assinafy'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const config = await getAssinafyConfig()
    const expectedSecret = String(config?.webhookSecret || '')

    // Segurança (M-2): fail-closed. Sem webhook_secret configurado, rejeitamos —
    // evita que qualquer um forje eventos e faça o motor avançar etapas.
    if (!expectedSecret) {
      return Response.json({ ok: false, error: 'webhook secret not configured' }, { status: 503 })
    }
    const provided = req.nextUrl.searchParams.get('secret') || ''
    if (provided !== expectedSecret) {
      return Response.json({ ok: false, error: 'invalid secret' }, { status: 401 })
    }

    let envelope: any = null
    try {
      envelope = await req.json()
    } catch {
      return Response.json({ ok: false, error: 'invalid json' }, { status: 400 })
    }

    const result = await processAssinafyWebhook(envelope)
    // Sempre 200 para não acionar o circuit breaker da Assinafy à toa.
    return Response.json({ received: true, ...result }, { status: 200 })
  } catch (error: any) {
    console.error('Erro no webhook da Assinafy:', error?.message)
    // Ainda respondemos 200: reprocessamos pela reconciliação se algo falhar.
    return Response.json({ ok: false }, { status: 200 })
  }
}

/** GET simples para verificação de que o endpoint está no ar. */
export async function GET() {
  return Response.json({ ok: true, endpoint: 'assinafy-webhook' })
}
