'use server'

import { getValidGoogleToken } from './oauth'

export interface CalendarEvent {
  id: string
  title: string
  description?: string
  start: string
  end: string
  isAllDay: boolean
  attendees?: Array<{
    email: string
    displayName?: string
    responseStatus: 'accepted' | 'declined' | 'tentative' | 'needsAction'
  }>
  location?: string
  organizer?: {
    email: string
    displayName?: string
  }
}

/**
 * Busca os eventos do calendário do usuário logado
 */
export async function getMyCalendarEvents(
  userId: string,
  timeMin?: string,
  timeMax?: string,
): Promise<CalendarEvent[]> {
  const accessToken = await getValidGoogleToken(userId)
  if (!accessToken) {
    throw new Error('No valid Google token found')
  }

  const now = new Date()
  const endOfDay = new Date(now)
  endOfDay.setHours(23, 59, 59, 999)

  const params = new URLSearchParams({
    calendarId: 'primary',
    timeMin: timeMin || now.toISOString(),
    timeMax: timeMax || endOfDay.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  })

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${params.get('calendarId')}/events?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch calendar events: ${response.statusText}`)
  }

  const data = await response.json()

  return (data.items || []).map((event: any) => ({
    id: event.id,
    title: event.summary,
    description: event.description,
    start: event.start.dateTime || event.start.date,
    end: event.end.dateTime || event.end.date,
    isAllDay: !event.start.dateTime,
    location: event.location,
    attendees: (event.attendees || []).map((attendee: any) => ({
      email: attendee.email,
      displayName: attendee.displayName,
      responseStatus: attendee.responseStatus || 'needsAction',
    })),
    organizer: event.organizer
      ? {
          email: event.organizer.email,
          displayName: event.organizer.displayName,
        }
      : undefined,
  }))
}

/**
 * Busca os eventos da agenda de outro usuário (dentro do workspace Google)
 */
export async function getUserCalendarEvents(
  userId: string,
  targetUserEmail: string,
  timeMin?: string,
  timeMax?: string,
): Promise<CalendarEvent[]> {
  const accessToken = await getValidGoogleToken(userId)
  if (!accessToken) {
    throw new Error('No valid Google token found')
  }

  const now = new Date()
  const endOfDay = new Date(now)
  endOfDay.setHours(23, 59, 59, 999)

  const params = new URLSearchParams({
    calendarId: targetUserEmail,
    timeMin: timeMin || now.toISOString(),
    timeMax: timeMax || endOfDay.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  })

  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetUserEmail)}/events?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    )

    if (!response.ok) {
      // Se falhar, pode ser por permissão insuficiente
      console.warn(`Cannot access calendar for ${targetUserEmail}: ${response.statusText}`)
      return []
    }

    const data = await response.json()

    return (data.items || []).map((event: any) => ({
      id: event.id,
      title: event.summary,
      description: event.description,
      start: event.start.dateTime || event.start.date,
      end: event.end.dateTime || event.end.date,
      isAllDay: !event.start.dateTime,
      location: event.location,
      attendees: (event.attendees || []).map((attendee: any) => ({
        email: attendee.email,
        displayName: attendee.displayName,
        responseStatus: attendee.responseStatus || 'needsAction',
      })),
      organizer: event.organizer
        ? {
            email: event.organizer.email,
            displayName: event.organizer.displayName,
          }
        : undefined,
    }))
  } catch (error) {
    console.error(`Error fetching calendar for ${targetUserEmail}:`, error)
    return []
  }
}

/**
 * Cria um novo evento no calendário do usuário
 */
export async function createCalendarEvent(
  userId: string,
  event: {
    title: string
    description?: string
    startTime: string // ISO string
    endTime: string // ISO string
    attendeeEmails?: string[]
    location?: string
  },
): Promise<string> {
  const accessToken = await getValidGoogleToken(userId)
  if (!accessToken) {
    throw new Error('No valid Google token found')
  }

  const eventBody = {
    summary: event.title,
    description: event.description,
    start: {
      dateTime: event.startTime,
    },
    end: {
      dateTime: event.endTime,
    },
    location: event.location,
    attendees: (event.attendeeEmails || []).map((email) => ({
      email,
    })),
  }

  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(eventBody),
  })

  if (!response.ok) {
    throw new Error(`Failed to create event: ${response.statusText}`)
  }

  const data = await response.json()
  return data.id
}
