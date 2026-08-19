/**
 * Regras de agendamento (puras, testáveis, sem I/O).
 *
 * - `nextEligibleAt`: dado "agora", quando é o próximo instante permitido pela
 *   configuração (início, dias da semana, janela de horário) no fuso da campanha.
 * - `evaluateGate`: decide se a campanha pode enviar agora, deve esperar até X,
 *   está completa ou é inválida.
 * - Fuso via Intl (sem dependência extra). Brasil não tem horário de verão hoje,
 *   mas o cálculo é genérico.
 */

import type { CampaignSlotInput, RotationMode } from './types'

export type ScheduleConfigLike = {
  start_at?: string | Date | null
  allowed_weekdays?: number[] | null
  window_start?: string | null
  window_end?: string | null
  timezone?: string | null
}

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

const formatterCache = new Map<string, Intl.DateTimeFormat>()
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatterCache.set(timeZone, f)
  }
  return f
}

export function safeTimezone(tz: string | null | undefined): string {
  const candidate = String(tz || '').trim() || 'America/Sao_Paulo'
  try {
    formatterFor(candidate)
    return candidate
  } catch {
    return 'America/Sao_Paulo'
  }
}

/** Decompõe um instante UTC nas partes de calendário do fuso dado. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value || ''
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? new Date(date).getUTCDay(),
  }
}

/** Offset (ms) do fuso em relação ao UTC para o instante dado. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - date.getTime()
}

/** Converte "data/hora local no fuso" → instante UTC. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0))
  const offset1 = tzOffsetMs(guess, timeZone)
  const candidate = new Date(guess.getTime() - offset1)
  const offset2 = tzOffsetMs(candidate, timeZone)
  return offset2 === offset1 ? candidate : new Date(guess.getTime() - offset2)
}

export function parseHHMM(value: string | null | undefined): { hour: number; minute: number } | null {
  const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Próximo instante ≥ now permitido pela configuração. Retorna null quando não
 * há nenhum dia permitido (config inválida). Procura até 15 dias à frente.
 */
export function nextEligibleAt(now: Date, cfg: ScheduleConfigLike): Date | null {
  const tz = safeTimezone(cfg.timezone)
  const start = toDate(cfg.start_at)
  let t = start && start.getTime() > now.getTime() ? new Date(start) : new Date(now)

  const allowed = Array.isArray(cfg.allowed_weekdays) && cfg.allowed_weekdays.length > 0
    ? cfg.allowed_weekdays.map(Number).filter((n) => n >= 0 && n <= 6)
    : [0, 1, 2, 3, 4, 5, 6]
  if (allowed.length === 0) return null

  const ws = parseHHMM(cfg.window_start)
  const we = parseHHMM(cfg.window_end)
  const hasWindow = !!(ws && we)

  for (let i = 0; i < 15; i++) {
    const p = zonedParts(t, tz)
    if (allowed.includes(p.weekday)) {
      if (!hasWindow) return t
      const windowStart = zonedToUtc(p.year, p.month, p.day, ws!.hour, ws!.minute, tz)
      const windowEnd = zonedToUtc(p.year, p.month, p.day, we!.hour, we!.minute, tz)
      if (windowEnd.getTime() > windowStart.getTime()) {
        if (t.getTime() < windowStart.getTime()) return windowStart
        if (t.getTime() < windowEnd.getTime()) return t
      }
    }
    // Próximo dia às 00:00 no fuso.
    const next = zonedToUtc(p.year, p.month, p.day, 0, 0, tz)
    t = new Date(next.getTime() + 24 * 60 * 60 * 1000)
    // Ajusta ao início exato do próximo dia (evita drift por DST).
    const np = zonedParts(t, tz)
    t = zonedToUtc(np.year, np.month, np.day, 0, 0, tz)
  }
  return null
}

export type Gate =
  | { kind: 'go' }
  | { kind: 'wait'; at: Date; reason: string }
  | { kind: 'complete' }
  | { kind: 'fail'; error: string }

/**
 * Modo lotes: o próximo lote é o primeiro com sent_count < quantity, em ordem.
 * Retorna null se todos os lotes já foram consumidos.
 */
export function nextPendingSlot<T extends { run_at: string | Date; quantity: number; sent_count: number; position: number }>(slots: T[]): T | null {
  const ordered = [...slots].sort((a, b) => a.position - b.position)
  return ordered.find((s) => s.sent_count < s.quantity) || null
}

export function evaluateGate(
  campaign: ScheduleConfigLike & { schedule_mode?: string | null },
  slots: Array<{ run_at: string | Date; quantity: number; sent_count: number; position: number }>,
  now: Date,
  hasPendingRecipients: boolean,
): Gate {
  if (!hasPendingRecipients) return { kind: 'complete' }
  if (campaign.schedule_mode === 'batches') {
    const slot = nextPendingSlot(slots)
    if (!slot) return { kind: 'complete' }
    const runAt = toDate(slot.run_at)
    if (!runAt) return { kind: 'fail', error: 'Lote com data inválida' }
    if (runAt.getTime() > now.getTime()) return { kind: 'wait', at: runAt, reason: 'Aguardando próximo lote' }
    return { kind: 'go' }
  }
  const at = nextEligibleAt(now, campaign)
  if (!at) return { kind: 'fail', error: 'Nenhum dia/horário permitido na configuração' }
  if (at.getTime() > now.getTime() + 1000) return { kind: 'wait', at, reason: 'Fora da janela permitida' }
  return { kind: 'go' }
}

/** Sorteio inteiro inclusivo. */
export function randomBetween(min: number, max: number, rand: () => number = Math.random): number {
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  return Math.floor(lo + rand() * (hi - lo + 1))
}

/** Índice do bloco a usar no n-ésimo envio (n começa em 0). */
export function pickTemplateIndex(mode: RotationMode, rotate: boolean, sentSoFar: number, total: number, rand: () => number = Math.random): number {
  if (total <= 1 || !rotate) return 0
  if (mode === 'random') return Math.floor(rand() * total) % total
  return sentSoFar % total
}

/** Valida lotes: soma = total, quantidades > 0, datas válidas e crescentes. */
export function validateSlots(slots: CampaignSlotInput[], totalRecipients: number): { ok: true } | { ok: false; error: string } {
  if (!slots.length) return { ok: false, error: 'Adicione pelo menos um lote.' }
  let sum = 0
  let last = -Infinity
  for (const s of [...slots].sort((a, b) => a.position - b.position)) {
    const qty = Number(s.quantity)
    if (!Number.isInteger(qty) || qty <= 0) return { ok: false, error: 'Cada lote precisa de quantidade inteira maior que zero.' }
    const t = toDate(s.run_at)
    if (!t) return { ok: false, error: 'Lote com data/hora inválida.' }
    if (t.getTime() <= last) return { ok: false, error: 'Os lotes precisam estar em ordem cronológica crescente.' }
    last = t.getTime()
    sum += qty
  }
  if (sum !== totalRecipients) {
    return { ok: false, error: `A soma dos lotes (${sum}) precisa ser igual ao total de destinatários (${totalRecipients}).` }
  }
  return { ok: true }
}

/** Resumo legível da configuração de agendamento direto (como no print). */
export function describeDirectSchedule(cfg: ScheduleConfigLike): string {
  const start = toDate(cfg.start_at)
  const tz = safeTimezone(cfg.timezone)
  const parts: string[] = []
  parts.push(start ? `Início ${start.toLocaleString('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'Início manual')
  const days = (cfg.allowed_weekdays || [0, 1, 2, 3, 4, 5, 6]).map(Number).sort((a, b) => a - b)
  const names = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  parts.push(days.length === 7 ? 'Todos os dias' : days.map((d) => names[d]).join(', '))
  if (cfg.window_start && cfg.window_end) parts.push(`${cfg.window_start} às ${cfg.window_end}`)
  else parts.push('Qualquer horário')
  return parts.join(' • ')
}
