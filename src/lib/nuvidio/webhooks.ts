/**
 * Processamento dos webhooks da Nuvidio a partir da inbox
 * (`nuvidio_webhooks_recebidos`). Fatia 1 do PLANO-NUVIDIO-CONFORMIDADE.
 *
 * Regras:
 *  - transições SÓ pra frente, guardadas no próprio UPDATE (`in('status', de)`):
 *    evento repetido ou fora de ordem nunca regride um convite já tabulado;
 *  - `nuvidio_eventos` recebe o evento só na 1ª vez que o webhook casa;
 *  - casamento em 5 passos: invite_id → call_id → GET /v1/api/call/:id →
 *    token do link → CPF do convite ativo. Sem convite: fica na inbox
 *    (visível em Provedores › Nuvidio, reprocessável).
 */
import type { createAdminClient } from '@/lib/supabase/server'
import { buscarChamada } from './client'
import { interpretarHook, type HookNormalizado } from './webhook-interpretar'

type Admin = Awaited<ReturnType<typeof createAdminClient>>
type ConviteMin = { id: string; processo_id: string | null; status: string; call_id: string }

const ATIVOS = ['aguardando_chamada', 'chamada_em_curso']
export const ERRO_IGNORADO = 'evento do vídeo autônomo (API V2) — ignorado'

export type ResultadoWebhook = { matched: boolean; status?: string; erro?: string }

async function localizarConvite(admin: Admin, h: HookNormalizado): Promise<ConviteMin | null> {
  const sel = () => admin.from('nuvidio_convites').select('id, processo_id, status, call_id')
  const um = async (q: ReturnType<typeof sel>): Promise<ConviteMin | null> =>
    ((await q.order('created_at', { ascending: false }).limit(1).maybeSingle()).data as ConviteMin | null) ?? null

  if (h.inviteId) {
    const c = await um(sel().eq('invite_id', h.inviteId))
    if (c) return c
  }
  if (h.callId) {
    const c = await um(sel().eq('call_id', h.callId))
    if (c) return c
  }
  let token = h.token
  if (h.callId && !h.inviteId) {
    const chamada = await buscarChamada(h.callId)
    if (chamada?.inviteId) {
      const c = await um(sel().eq('invite_id', chamada.inviteId))
      if (c) return c
    }
    token = token || chamada?.inviteToken || ''
  }
  if (/^[\w-]+$/.test(token)) {
    const c = await um(sel().ilike('link', `%token=${token}%`))
    if (c) return c
  }
  // ponytail: último recurso — fila/chamada sem invite casam pelo CPF do convite ativo mais recente
  if (h.cpf) {
    const c = await um(sel().eq('cpf', h.cpf).in('status', ATIVOS))
    if (c) return c
  }
  return null
}

export async function processarWebhookNuvidio(admin: Admin, inboxId: string): Promise<ResultadoWebhook> {
  const inbox = admin.from('nuvidio_webhooks_recebidos')
  const { data: row } = await inbox.select('id, payload, convite_id').eq('id', inboxId).maybeSingle()
  if (!row) return { matched: false, erro: 'inbox não encontrada' }

  const h = interpretarHook(row.payload)
  const agora = new Date().toISOString()
  const quando = h.timestamp || agora

  if (h.acao === 'ignorar') {
    await inbox.update({ processado_em: agora, erro: ERRO_IGNORADO }).eq('id', inboxId)
    return { matched: false, erro: ERRO_IGNORADO }
  }

  const convite = await localizarConvite(admin, h)
  if (!convite) {
    const erro = h.acao === 'desconhecido' ? `hook não mapeado (${h.hookType || '?'}) e sem convite correspondente` : 'sem convite correspondente'
    await inbox.update({ processado_em: agora, erro, invite_id: h.inviteId, call_id: h.callId }).eq('id', inboxId)
    return { matched: false, erro }
  }

  if (!row.convite_id) {
    await admin.from('nuvidio_eventos').insert({ convite_id: convite.id, tipo: `webhook:${h.hookType || 'desconhecido'}`, detalhe: row.payload ?? {} })
  }

  // campos que valem em qualquer status
  const sempre: Record<string, unknown> = { updated_at: agora }
  if (h.callId && !convite.call_id) sempre.call_id = h.callId
  if (h.gravacao === true) sempre.gravacao_disponivel = true

  // transição (só se o status atual estiver em `de`)
  const transicao: Record<string, unknown> = {}
  let de: string[] | null = null
  let novoStatus = ''
  switch (h.acao) {
    case 'fila_entrou':
      de = ['aguardando_chamada']
      transicao.fila_entrou_em = quando
      transicao.fila_saiu_em = null
      break
    case 'fila_saiu':
      de = ['aguardando_chamada']
      transicao.fila_saiu_em = quando
      break
    case 'chamada_iniciada':
      de = ['aguardando_chamada']
      novoStatus = 'chamada_em_curso'
      transicao.status = novoStatus
      transicao.chamada_iniciada_em = quando
      break
    case 'chamada_finalizada':
      de = ATIVOS
      novoStatus = 'chamada_realizada'
      transicao.status = novoStatus
      transicao.chamada_finalizada_em = quando
      break
    case 'agendamento':
      de = ['aguardando_chamada']
      if (h.scheduleAt) transicao.schedule_at = h.scheduleAt
      if (h.expirationAt) transicao.expiration_at = h.expirationAt
      break
    default:
      break
  }

  let aplicou = false
  if (de && Object.keys(transicao).length > 0) {
    const { data: upd } = await admin.from('nuvidio_convites').update({ ...sempre, ...transicao }).eq('id', convite.id).in('status', de).select('id')
    aplicou = (upd?.length ?? 0) > 0
  }
  if (!aplicou && Object.keys(sempre).length > 1) {
    await admin.from('nuvidio_convites').update(sempre).eq('id', convite.id)
  }

  // Lente onboarding: só registra o evento no processo. O vídeo entra no
  // processo pela ação "Arquivar gravação" (fatia 3) — nunca o link de 2 h.
  if (aplicou && novoStatus === 'chamada_realizada' && convite.processo_id) {
    await admin.from('corban_onboarding_eventos').insert({
      processo_id: convite.processo_id,
      tipo: 'nuvidio_chamada_realizada',
      detalhe: { convite_id: convite.id, gravacao: h.gravacao === true },
    })
  }

  await inbox.update({ convite_id: convite.id, invite_id: h.inviteId, call_id: h.callId, processado_em: agora, erro: '' }).eq('id', inboxId)
  return { matched: true, status: aplicou && novoStatus ? novoStatus : convite.status }
}
