/**
 * Receptor de webhooks da Nuvidio (hooks configurados no painel/API deles
 * apontando para /api/nuvidio/webhook?key=<webhook_key do card>).
 *
 * Eventos esperados (docs): novo cliente esperando, nova chamada iniciada,
 * chamada finalizada, convite expirou, cliente agendou/reagendou. Como o
 * payload exato varia por evento, a extração é defensiva: procuramos o
 * inviteId em vários campos candidatos e guardamos SEMPRE o payload bruto
 * em nuvidio_eventos — nada se perde, mesmo evento desconhecido.
 *
 * Fail-closed: sem webhook_key configurada, rejeita (mesmo padrão Assinafy).
 */
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { buscarLinkGravacao, lerNuvidioConfigRow } from '@/lib/nuvidio/client'

export const dynamic = 'force-dynamic'

function extrair(obj: any, chaves: string[]): string {
  for (const chave of chaves) {
    const partes = chave.split('.')
    let atual = obj
    for (const p of partes) atual = atual?.[p]
    if (atual != null && String(atual).trim()) return String(atual).trim()
  }
  return ''
}

export async function POST(req: NextRequest) {
  try {
    const config = await lerNuvidioConfigRow()
    const esperado = String(config?.webhook_key || '')
    if (!esperado) return Response.json({ ok: false, error: 'webhook key not configured' }, { status: 503 })
    const recebido = req.nextUrl.searchParams.get('key') || ''
    if (recebido !== esperado) return Response.json({ ok: false, error: 'invalid key' }, { status: 401 })

    let payload: any = null
    try {
      payload = await req.json()
    } catch {
      return Response.json({ ok: false, error: 'invalid json' }, { status: 400 })
    }

    const admin = await createAdminClient()
    const evento = extrair(payload, ['event', 'type', 'hook', 'eventName']).toLowerCase()
    const inviteId = extrair(payload, ['inviteId', 'invite._id', 'invite.id', 'invite', 'data.inviteId', 'data.invite._id', 'call.inviteId', 'call.invite._id'])
    const callId = extrair(payload, ['callId', 'call._id', 'call.id', 'data.callId', 'data.call._id'])

    type ConviteMin = { id: string; processo_id: string | null; status: string }
    let convite: ConviteMin | null = null
    if (inviteId) {
      const { data } = await admin
        .from('nuvidio_convites')
        .select('id, processo_id, status')
        .eq('invite_id', inviteId)
        .maybeSingle()
      convite = (data as ConviteMin | null) ?? null
    }

    // registra SEMPRE (mesmo sem casar convite — vai num convite sintético? não:
    // sem convite, loga no console e devolve 200 pra não acionar retry infinito)
    if (!convite) {
      console.warn('Webhook Nuvidio sem convite correspondente:', evento, inviteId || callId)
      return Response.json({ received: true, matched: false })
    }

    await admin.from('nuvidio_eventos').insert({
      convite_id: convite.id,
      tipo: `webhook:${evento || 'desconhecido'}`,
      detalhe: payload ?? {},
    })

    const agora = new Date().toISOString()
    const patch: Record<string, unknown> = { updated_at: agora }

    if (/esperando|waiting|queue/.test(evento)) {
      // cliente entrou na fila — status segue aguardando; a tela de
      // atendimento toca o telefone via polling/realtime do evento
    } else if (/iniciad|started|nova-chamada|call.start/.test(evento)) {
      patch.status = 'chamada_em_curso'
      patch.chamada_iniciada_em = agora
    } else if (/finaliz|ended|closed|fechou/.test(evento)) {
      patch.status = 'chamada_realizada'
      patch.chamada_finalizada_em = agora
      const gravacao = await buscarLinkGravacao(callId || inviteId)
      if (gravacao) patch.gravacao_url = gravacao
    } else if (/expir/.test(evento)) {
      if (convite.status === 'aguardando_chamada') patch.status = 'expirado'
    }

    if (Object.keys(patch).length > 1) {
      await admin.from('nuvidio_convites').update(patch).eq('id', convite.id)
    }

    // Lente onboarding: chamada realizada com gravação → alimenta o processo
    if (convite.processo_id && patch.status === 'chamada_realizada') {
      await admin
        .from('corban_onboarding_processos')
        .update({
          ...(patch.gravacao_url ? { nuvidio_video_url: String(patch.gravacao_url) } : {}),
          updated_at: agora,
        })
        .eq('id', convite.processo_id)
      await admin.from('corban_onboarding_eventos').insert({
        processo_id: convite.processo_id,
        tipo: 'nuvidio_chamada_realizada',
        detalhe: { convite_id: convite.id, gravacao: Boolean(patch.gravacao_url) },
      })
    }

    return Response.json({ received: true, matched: true, status: patch.status || convite.status })
  } catch (error: any) {
    console.error('Erro no webhook da Nuvidio:', error?.message)
    return Response.json({ ok: false }, { status: 200 })
  }
}

export async function GET() {
  return Response.json({ ok: true, endpoint: 'nuvidio-webhook' })
}
