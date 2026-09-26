/**
 * Interpretação PURA do envelope de webhook da Nuvidio (sem I/O) — testável
 * com os payloads da doc (scripts/nuvidio-webhook-check.ts).
 *
 * Envelope (docs.nuvidio.com/reference/hooks-2): { hookType, hookDescription,
 * timestamp, content }. ATENÇÃO: `content.id` muda de significado por evento —
 * id da CHAMADA nos eventos de chamada (new_call_started, call_*, attendant_*),
 * id da FILA nos de fila (new_client_waiting, client_left_queue) e id do
 * CONVITE nos de agendamento (customer_*). Por isso o mapa é explícito.
 */

export type AcaoHook =
  | 'fila_entrou'
  | 'fila_saiu'
  | 'chamada_iniciada'
  | 'chamada_finalizada'
  | 'agendamento'
  | 'so_evento'
  | 'ignorar'
  | 'desconhecido'

export type HookNormalizado = {
  hookType: string
  acao: AcaoHook
  /** id do convite na Nuvidio (content.invite.id ou content.id em evento de convite) */
  inviteId: string
  /** id da chamada (content.id em evento de chamada) */
  callId: string
  /** token do convite (invite.token, content.token ou ?token= no link/origin) */
  token: string
  /** CPF só dígitos (content.customer.cpf) */
  cpf: string
  /** true/false quando o evento diz se há gravação; null quando não diz */
  gravacao: boolean | null
  /** agendamento: início/fim (ISO) */
  scheduleAt: string
  expirationAt: string
  /** carimbo do evento (ISO) ou '' */
  timestamp: string
}

const FILA_ENTROU = new Set(['new_client_waiting'])
const FILA_SAIU = new Set(['client_left_queue'])
const CHAMADA_INICIADA = new Set(['new_call_started'])
const CHAMADA_FINALIZADA = new Set(['call_finished', 'attendant_closed_call'])
const AGENDAMENTO = new Set(['customer_scheduled_call', 'customer_rescheduled_call'])

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function tokenDaUrl(url: string): string {
  return url.match(/[?&]token=([\w-]+)/)?.[1] ?? ''
}

function isoOuVazio(v: unknown): string {
  const s = str(v)
  return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : ''
}

export function interpretarHook(payload: any): HookNormalizado {
  const hookType = str(payload?.hookType || payload?.event || payload?.type).toLowerCase()
  const c = payload?.content ?? payload?.data ?? {}

  let acao: AcaoHook
  if (hookType.startsWith('video_autonomous')) acao = 'ignorar'
  else if (FILA_ENTROU.has(hookType)) acao = 'fila_entrou'
  else if (FILA_SAIU.has(hookType)) acao = 'fila_saiu'
  else if (CHAMADA_INICIADA.has(hookType)) acao = 'chamada_iniciada'
  else if (CHAMADA_FINALIZADA.has(hookType)) acao = 'chamada_finalizada'
  else if (AGENDAMENTO.has(hookType)) acao = 'agendamento'
  else if (hookType.startsWith('call_') || hookType.startsWith('attendant_')) acao = 'so_evento'
  else if (hookType.startsWith('customer_') && (c?.initialDate || c?.token)) acao = 'agendamento'
  else acao = hookType ? 'desconhecido' : 'desconhecido'

  const eventoDeChamada = acao === 'chamada_iniciada' || acao === 'chamada_finalizada' || acao === 'so_evento'
  const eventoDeConvite = acao === 'agendamento'

  const inviteId = str(c?.invite?.id || c?.invite?._id) || (eventoDeConvite ? str(c?.id) : '')
  const callId = eventoDeChamada ? str(c?.id || c?.call?.id) : ''
  const token =
    str(c?.invite?.token) ||
    (eventoDeConvite ? str(c?.token) : '') ||
    tokenDaUrl(str(c?.queue?.origin)) ||
    tokenDaUrl(str(c?.origin)) ||
    tokenDaUrl(str(c?.link)) ||
    tokenDaUrl(str(c?.invite?.link))

  const cpf = str(c?.customer?.cpf).replace(/\D/g, '')
  const gravacao = typeof c?.recorded === 'boolean' ? Boolean(c.recorded) && !Boolean(c?.recordingDeleted) : null

  return {
    hookType,
    acao,
    inviteId,
    callId,
    token,
    cpf,
    gravacao,
    scheduleAt: eventoDeConvite ? isoOuVazio(c?.initialDate) : '',
    expirationAt: eventoDeConvite ? isoOuVazio(c?.expirationDate) : '',
    timestamp: isoOuVazio(payload?.timestamp),
  }
}
