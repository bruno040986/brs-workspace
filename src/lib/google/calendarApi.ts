// Cliente da API do Google Calendar independente de sessão (usa o
// service role para ler/renovar tokens em user_google_auth). É a
// variante que workers e server actions da Agenda usam — o oauth.ts
// original depende do cliente com sessão do usuário e continua
// servindo às rotas /api/auth e /api/calendar existentes.

import { createAdminClient } from '@/lib/supabase/server'
import { getGoogleConfigFromDb, googleConfig } from './config'

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3'

export async function getValidGoogleTokenAdmin(admin: AdminClient, userId: string): Promise<string | null> {
  const { data: googleAuth } = await admin
    .from('user_google_auth')
    .select('access_token, refresh_token, expiry_date')
    .eq('user_id', userId)
    .maybeSingle()
  if (!googleAuth?.access_token) return null

  const expiryTime = new Date(String(googleAuth.expiry_date || 0)).getTime()
  if (expiryTime - Date.now() > 5 * 60 * 1000) return String(googleAuth.access_token)

  if (!googleAuth.refresh_token) return null
  const oauthConfig = (await getGoogleConfigFromDb()) || googleConfig
  if (!oauthConfig.clientId || !oauthConfig.clientSecret) return null

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: oauthConfig.clientId,
      client_secret: oauthConfig.clientSecret,
      refresh_token: String(googleAuth.refresh_token),
      grant_type: 'refresh_token',
    }).toString(),
  })
  if (!response.ok) {
    console.error('Google token refresh failed:', response.status, await response.text().catch(() => ''))
    return null
  }

  const tokens = await response.json()
  const expiryDate = new Date(Date.now() + Number(tokens.expires_in || 0) * 1000)
  await admin
    .from('user_google_auth')
    .update({ access_token: tokens.access_token, expiry_date: expiryDate.toISOString() })
    .eq('user_id', userId)

  return String(tokens.access_token)
}

async function calendarFetch(token: string, path: string, init?: RequestInit) {
  const response = await fetch(`${CALENDAR_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  return response
}

export type GoogleEventBody = {
  summary: string
  description?: string
  location?: string
  visibility?: 'default' | 'private'
  start: { dateTime: string; timeZone?: string }
  end: { dateTime: string; timeZone?: string }
  attendees?: Array<{ email: string }>
  conferenceData?: { createRequest: { requestId: string; conferenceSolutionKey: { type: 'hangoutsMeet' } } }
}

export type GoogleEventResult = { id: string; hangoutLink: string | null }

export async function insertCalendarEvent(token: string, body: GoogleEventBody): Promise<GoogleEventResult> {
  const params = new URLSearchParams({ sendUpdates: 'all' })
  if (body.conferenceData) params.set('conferenceDataVersion', '1')
  const response = await calendarFetch(token, `/calendars/primary/events?${params.toString()}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`Google Calendar insert falhou: ${response.status} ${await response.text().catch(() => '')}`)
  }
  const data = await response.json()
  return { id: String(data.id), hangoutLink: data.hangoutLink ? String(data.hangoutLink) : null }
}

export async function patchCalendarEvent(token: string, eventId: string, body: Partial<GoogleEventBody>): Promise<GoogleEventResult> {
  const params = new URLSearchParams({ sendUpdates: 'all' })
  if (body.conferenceData) params.set('conferenceDataVersion', '1')
  const response = await calendarFetch(token, `/calendars/primary/events/${encodeURIComponent(eventId)}?${params.toString()}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`Google Calendar patch falhou: ${response.status} ${await response.text().catch(() => '')}`)
  }
  const data = await response.json()
  return { id: String(data.id), hangoutLink: data.hangoutLink ? String(data.hangoutLink) : null }
}

export async function deleteCalendarEvent(token: string, eventId: string): Promise<void> {
  const response = await calendarFetch(
    token,
    `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: 'DELETE' },
  )
  // 404/410: evento já removido no Google — nada a fazer.
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(`Google Calendar delete falhou: ${response.status}`)
  }
}

export type BusyBlock = { start: string; end: string }

export async function queryFreeBusy(token: string, timeMin: string, timeMax: string): Promise<BusyBlock[] | null> {
  const response = await calendarFetch(token, '/freeBusy', {
    method: 'POST',
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: 'primary' }] }),
  })
  if (!response.ok) return null
  const data = await response.json()
  const calendars = data?.calendars || {}
  const first = calendars.primary || calendars[Object.keys(calendars)[0] || ''] || null
  if (!first) return null
  return (first.busy || []).map((block: any) => ({ start: String(block.start), end: String(block.end) }))
}
