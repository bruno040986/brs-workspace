// Espelhamento outbound Agenda → Google Calendar (Fase 2).
// A fonte da verdade é o banco do Workspace; o evento vive no
// calendário do "dono" (organizador conectado) e o Google distribui
// aos envolvidos como convidados — inclusive quem não conectou conta.

import type { createAdminClient } from '@/lib/supabase/server'
import {
  deleteCalendarEvent,
  getValidGoogleTokenAdmin,
  insertCalendarEvent,
  patchCalendarEvent,
  type GoogleEventBody,
} from '@/lib/google/calendarApi'

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>

const SAO_PAULO_TZ = 'America/Sao_Paulo'

export type MirrorResult =
  | { mirrored: true; meetLink: string | null }
  | { mirrored: false; reason: 'nao_aplicavel' | 'sem_conexao' | 'erro'; detail?: string }

async function resolveOrganizer(
  admin: AdminClient,
  candidates: string[],
): Promise<{ userId: string; token: string } | null> {
  for (const userId of candidates) {
    if (!userId) continue
    const token = await getValidGoogleTokenAdmin(admin, userId)
    if (token) return { userId, token }
  }
  return null
}

async function attendeeEmails(admin: AdminClient, userIds: string[]): Promise<string[]> {
  if (!userIds.length) return []
  const [{ data: connected }, { data: users }] = await Promise.all([
    admin.from('user_google_auth').select('user_id, email_vinculado').in('user_id', userIds),
    admin.from('users').select('id, email').in('id', userIds),
  ])
  const byUser = new Map<string, string>()
  for (const row of users || []) {
    if (row.email) byUser.set(String(row.id), String(row.email))
  }
  for (const row of connected || []) {
    if (row.email_vinculado) byUser.set(String(row.user_id), String(row.email_vinculado))
  }
  return Array.from(new Set(Array.from(byUser.values()).filter(Boolean)))
}

export async function mirrorAgendaItemToGoogle(
  admin: AdminClient,
  itemId: string,
  actorUserId: string,
): Promise<MirrorResult> {
  try {
    const { data: item } = await admin
      .from('agenda_items')
      .select('*')
      .eq('id', itemId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!item || item.item_type === 'tarefa' || !item.start_at) {
      return { mirrored: false, reason: 'nao_aplicavel' }
    }

    const { data: participantRows } = await admin
      .from('agenda_item_participants')
      .select('user_id')
      .eq('item_id', itemId)
      .eq('role', 'envolvido')
    const involvedIds = Array.from(new Set((participantRows || []).map((row: any) => String(row.user_id))))

    const organizer = await resolveOrganizer(admin, [
      String(item.google_owner_user_id || ''),
      actorUserId,
      String(item.created_by || ''),
      ...involvedIds,
    ])
    if (!organizer) return { mirrored: false, reason: 'sem_conexao' }

    const emails = await attendeeEmails(admin, involvedIds)
    const startAt = String(item.start_at)
    const endAt = item.end_at
      ? String(item.end_at)
      : new Date(new Date(startAt).getTime() + 60 * 60 * 1000).toISOString()

    const isExternalLink = item.meeting_link_mode === 'externo' && item.meeting_link
    const wantsMeet = item.meeting_link_mode === 'gerar_meet'
    const hasMeetAlready = wantsMeet && Boolean(item.meeting_link)

    const description = [
      String(item.description || ''),
      isExternalLink ? `Link da reunião: ${item.meeting_link}` : '',
      'Criado pelo BRS Workspace.',
    ]
      .filter(Boolean)
      .join('\n\n')

    const body: GoogleEventBody = {
      summary: String(item.title),
      description,
      visibility: item.visibility === 'privada' ? 'private' : 'default',
      start: { dateTime: startAt, timeZone: SAO_PAULO_TZ },
      end: { dateTime: endAt, timeZone: SAO_PAULO_TZ },
      attendees: emails.map((email) => ({ email })),
    }
    if (isExternalLink) body.location = String(item.meeting_link)
    if (wantsMeet && !hasMeetAlready) {
      body.conferenceData = {
        createRequest: {
          requestId: `brs-${itemId}-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      }
    }

    let result: { id: string; hangoutLink: string | null }
    if (item.google_event_id && String(item.google_owner_user_id) === organizer.userId) {
      try {
        result = await patchCalendarEvent(organizer.token, String(item.google_event_id), body)
      } catch {
        // Evento sumiu do Google (excluído por lá) — recria.
        result = await insertCalendarEvent(organizer.token, body)
      }
    } else {
      result = await insertCalendarEvent(organizer.token, body)
    }

    const meetLink = wantsMeet ? result.hangoutLink || String(item.meeting_link || '') || null : null
    const updates: Record<string, unknown> = {
      google_event_id: result.id,
      google_owner_user_id: organizer.userId,
    }
    if (wantsMeet && meetLink) updates.meeting_link = meetLink
    await admin.from('agenda_items').update(updates).eq('id', itemId)

    return { mirrored: true, meetLink }
  } catch (error: any) {
    console.error('Erro ao espelhar item no Google Calendar:', error)
    return { mirrored: false, reason: 'erro', detail: String(error?.message || error) }
  }
}

export async function removeAgendaItemFromGoogle(
  admin: AdminClient,
  item: { google_event_id: string | null; google_owner_user_id: string | null },
): Promise<void> {
  if (!item.google_event_id || !item.google_owner_user_id) return
  try {
    const token = await getValidGoogleTokenAdmin(admin, String(item.google_owner_user_id))
    if (!token) return
    await deleteCalendarEvent(token, String(item.google_event_id))
  } catch (error) {
    console.error('Erro ao remover evento do Google Calendar:', error)
  }
}
