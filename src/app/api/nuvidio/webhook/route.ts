/**
 * Receptor de webhooks da Nuvidio (hooks configurados no painel/API deles
 * apontando para /api/nuvidio/webhook?key=<webhook_key do card>).
 *
 * Envelope (docs.nuvidio.com/reference/hooks-2): { hookType, hookDescription,
 * timestamp, content } — hookType ∈ new_client_waiting | new_call_started |
 * call_finished | ... Com "Enviar dados completos" ligado, content traz
 * invite.id (só na chamada finalizada), id da chamada, customer.cpf e
 * queue.origin (link com ?token=). A extração é defensiva e casa o convite
 * por invite_id → token do link → CPF do convite ativo; o payload bruto vai
 * SEMPRE pra nuvidio_eventos quando casa.
 *
 * Fail-closed: sem webhook_key configurada, rejeita. A chave vem em ?key= ou
 * no header Authorization (campo "Autenticação" do painel da Nuvidio).
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
    const recebido = req.nextUrl.searchParams.get('key') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    if (recebido !== esperado) return Response.json({ ok: false, error: 'invalid key' }, { status: 401 })

    let payload: any = null
    try {
      payload = await req.json()
    } catch {
      return Response.json({ ok: false, error: 'invalid json' }, { status: 400 })
    }

    const admin = await createAdminClient()
    const evento = extrair(payload, ['hookType', 'event', 'type', 'hook', 'eventName']).toLowerCase()
    const inviteId = extrair(payload, ['content.invite.id', 'content.invite._id', 'content.inviteId', 'inviteId', 'invite.id', 'invite._id', 'data.inviteId', 'data.invite.id'])
    const callId = extrair(payload, ['content.id', 'content.call.id', 'callId', 'call.id', 'call._id', 'data.callId'])
    const inviteToken =
      extrair(payload, ['content.invite.token', 'invite.token']) ||
      (extrair(payload, ['content.queue.origin', 'content.origin', 'origin']).match(/[?&]token=([\w-]+)/)?.[1] ?? '')
    const cpf = extrair(payload, ['content.customer.cpf', 'customer.cpf']).replace(/\D/g, '')

    type ConviteMin = { id: string; processo_id: string | null; status: string }
    const buscar = () => admin.from('nuvidio_convites').select('id, processo_id, status')
    let convite: ConviteMin | null = null
    if (inviteId) convite = ((await buscar().eq('invite_id', inviteId).maybeSingle()).data as ConviteMin | null) ?? null
    if (!convite && /^[\w-]+$/.test(inviteToken)) {
      convite = ((await buscar().ilike('link', `%token=${inviteToken}%`).order('created_at', { ascending: false }).limit(1).maybeSingle()).data as ConviteMin | null) ?? null
    }
    // ponytail: fila/chamada iniciada não trazem o invite — casa pelo CPF do convite ativo mais recente; trocar por call_id persistido se colidir
    if (!convite && cpf) {
      convite = ((await buscar().eq('cpf', cpf).in('status', ['aguardando_chamada', 'chamada_em_curso']).order('created_at', { ascending: false }).limit(1).maybeSingle()).data as ConviteMin | null) ?? null
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
    } else if (/finaliz|finished|ended|closed|fechou/.test(evento)) {
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
