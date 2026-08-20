/**
 * Sincronização inbound Google Calendar → Workspace (Fase 3).
 *
 * Roda no cron por usuário conectado, com syncToken incremental:
 *  - eventos criados direto no Google entram na agenda do Workspace
 *    (origin 'google', um item por google_event_id — o sync do segundo
 *    convidado só adiciona o participante);
 *  - eventos espelhados editados no Google atualizam título/horário;
 *  - cancelamento pelo organizador remove o item (soft delete).
 * 410 GONE invalida o token e força ressincronização completa.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { getValidGoogleTokenAdmin } from '@/lib/google/calendarApi'

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>

const WINDOW_PAST_DAYS = 7
const WINDOW_FUTURE_DAYS = 60

type GoogleListedEvent = {
  id: string
  status?: string
  summary?: string
  description?: string
  eventType?: string
  visibility?: string
  hangoutLink?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
}

type SyncPage = { items: GoogleListedEvent[]; nextPageToken?: string; nextSyncToken?: string }

async function listEventsPage(
  token: string,
  params: URLSearchParams,
): Promise<{ ok: true; page: SyncPage } | { ok: false; status: number }> {
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) return { ok: false, status: response.status }
  const data = await response.json()
  return {
    ok: true,
    page: {
      items: (data.items || []) as GoogleListedEvent[],
      nextPageToken: data.nextPageToken ? String(data.nextPageToken) : undefined,
      nextSyncToken: data.nextSyncToken ? String(data.nextSyncToken) : undefined,
    },
  }
}

function eventTimes(event: GoogleListedEvent): { startAt: string | null; endAt: string | null; allDay: boolean } {
  if (event.start?.dateTime) {
    return {
      startAt: new Date(event.start.dateTime).toISOString(),
      endAt: event.end?.dateTime ? new Date(event.end.dateTime).toISOString() : null,
      allDay: false,
    }
  }
  if (event.start?.date) {
    // Dia inteiro: meia-noite em America/Sao_Paulo (UTC-3).
    return {
      startAt: `${event.start.date}T03:00:00Z`,
      endAt: event.end?.date ? `${event.end.date}T03:00:00Z` : null,
      allDay: true,
    }
  }
  return { startAt: null, endAt: null, allDay: false }
}

async function processEvent(admin: AdminClient, userId: string, event: GoogleListedEvent): Promise<void> {
  if (!event.id) return
  // Aniversários, local de trabalho, foco etc. não entram.
  if (event.eventType && event.eventType !== 'default') return

  const { data: existing } = await admin
    .from('agenda_items')
    .select('id, origin, title, start_at, end_at, google_owner_user_id, deleted_at')
    .eq('google_event_id', event.id)
    .is('deleted_at', null)
    .maybeSingle()

  if (event.status === 'cancelled') {
    // Só o cancelamento no calendário do DONO remove o item — um
    // convidado que recusa/remove da própria agenda não apaga nada.
    if (existing && String(existing.google_owner_user_id) === userId) {
      await admin.from('agenda_items').update({ deleted_at: new Date().toISOString() }).eq('id', existing.id)
    }
    return
  }

  const { startAt, endAt, allDay } = eventTimes(event)
  if (!startAt) return

  if (existing) {
    const patch: Record<string, unknown> = {}
    const title = String(event.summary || '(Sem título)')
    if (existing.origin === 'google' && title !== String(existing.title)) patch.title = title
    if (existing.origin === 'workspace' && String(existing.google_owner_user_id) === userId && title !== String(existing.title)) {
      patch.title = title
    }
    if (startAt !== String(existing.start_at || '')) patch.start_at = startAt
    if ((endAt || null) !== (existing.end_at ? String(existing.end_at) : null)) patch.end_at = endAt
    if (Object.keys(patch).length) {
      patch.updated_at = new Date().toISOString()
      await admin.from('agenda_items').update(patch).eq('id', existing.id)
    }
    // Garante o usuário como envolvido em itens vindos do Google.
    if (existing.origin === 'google') {
      await admin
        .from('agenda_item_participants')
        .upsert(
          { item_id: existing.id, user_id: userId, role: 'envolvido' },
          { onConflict: 'item_id,user_id,role', ignoreDuplicates: true },
        )
    }
    return
  }

  // Evento novo criado direto no Google → importa.
  const isPrivate = event.visibility === 'private' || event.visibility === 'confidential'
  const { data: inserted, error } = await admin
    .from('agenda_items')
    .insert({
      item_type: event.hangoutLink ? 'reuniao_virtual' : 'evento_externo',
      origin: 'google',
      title: String(event.summary || '(Sem título)'),
      description: String(event.description || '').slice(0, 4000),
      all_day: allDay,
      start_at: startAt,
      end_at: endAt,
      visibility: isPrivate ? 'privada' : 'publica',
      meeting_link_mode: event.hangoutLink ? 'externo' : 'nenhum',
      meeting_link: String(event.hangoutLink || ''),
      google_event_id: event.id,
      google_owner_user_id: userId,
      created_by: userId,
    })
    .select('id')
    .maybeSingle()
  // 23505 = outro sync importou este evento primeiro; o upsert de
  // participante da próxima rodada resolve.
  if (error && String((error as any).code || '') !== '23505') throw error
  if (inserted?.id) {
    await admin.from('agenda_item_participants').insert({ item_id: inserted.id, user_id: userId, role: 'envolvido' })
  }
}

async function syncUser(admin: AdminClient, userId: string): Promise<{ ok: boolean; error?: string }> {
  const token = await getValidGoogleTokenAdmin(admin, userId)
  if (!token) return { ok: false, error: 'token indisponível' }

  const { data: state } = await admin
    .from('agenda_google_sync_state')
    .select('sync_token')
    .eq('user_id', userId)
    .maybeSingle()

  let syncToken = state?.sync_token ? String(state.sync_token) : null
  let pageToken: string | undefined
  let newSyncToken: string | null = null

  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ maxResults: '250', singleEvents: 'true' })
    if (pageToken) params.set('pageToken', pageToken)
    else if (syncToken) params.set('syncToken', syncToken)
    else {
      const now = Date.now()
      params.set('timeMin', new Date(now - WINDOW_PAST_DAYS * 24 * 60 * 60 * 1000).toISOString())
      params.set('timeMax', new Date(now + WINDOW_FUTURE_DAYS * 24 * 60 * 60 * 1000).toISOString())
    }

    const result = await listEventsPage(token, params)
    if (!result.ok) {
      if (result.status === 410 && syncToken) {
        // Token incremental expirou — recomeça do zero na próxima página.
        syncToken = null
        pageToken = undefined
        await admin.from('agenda_google_sync_state').upsert({ user_id: userId, sync_token: null, updated_at: new Date().toISOString() })
        continue
      }
      return { ok: false, error: `Google respondeu ${result.status}` }
    }

    for (const event of result.page.items) {
      try {
        await processEvent(admin, userId, event)
      } catch (error: any) {
        console.error(`Sync agenda: erro no evento ${event.id} do usuário ${userId}:`, error?.message)
      }
    }

    if (result.page.nextPageToken) {
      pageToken = result.page.nextPageToken
      continue
    }
    newSyncToken = result.page.nextSyncToken || null
    break
  }

  await admin.from('agenda_google_sync_state').upsert({
    user_id: userId,
    sync_token: newSyncToken,
    last_synced_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  })
  return { ok: true }
}

export async function runAgendaInboundSync(options?: { budgetMs?: number }): Promise<{
  usersSynced: number
  errors: Array<{ userId: string; error: string }>
}> {
  const budgetMs = Math.max(10_000, Number(options?.budgetMs || 240_000))
  const startedAt = Date.now()
  const admin = await createAdminClient()

  const { data: connected } = await admin.from('user_google_auth').select('user_id')
  const userIds = (connected || []).map((row: any) => String(row.user_id))
  if (!userIds.length) return { usersSynced: 0, errors: [] }

  // Quem sincronizou há mais tempo vai primeiro.
  const { data: states } = await admin
    .from('agenda_google_sync_state')
    .select('user_id, last_synced_at')
    .in('user_id', userIds)
  const lastByUser = new Map<string, string>((states || []).map((row: any) => [String(row.user_id), String(row.last_synced_at || '')]))
  userIds.sort((a, b) => (lastByUser.get(a) || '').localeCompare(lastByUser.get(b) || ''))

  let usersSynced = 0
  const errors: Array<{ userId: string; error: string }> = []

  for (const userId of userIds) {
    if (Date.now() - startedAt > budgetMs) break
    const result = await syncUser(admin, userId)
    if (result.ok) usersSynced += 1
    else {
      errors.push({ userId, error: result.error || 'erro' })
      await admin.from('agenda_google_sync_state').upsert({
        user_id: userId,
        last_error: String(result.error || 'erro').slice(0, 500),
        updated_at: new Date().toISOString(),
      })
    }
  }

  return { usersSynced, errors }
}
