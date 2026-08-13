import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCalendarEvent } from '@/lib/google/calendar'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { title, description, startTime, endTime, attendeeEmails, location } = body

    if (!title || !startTime || !endTime) {
      return NextResponse.json(
        { error: 'Missing required fields: title, startTime, endTime' },
        { status: 400 }
      )
    }

    const eventId = await createCalendarEvent(user.id, {
      title,
      description,
      startTime,
      endTime,
      attendeeEmails,
      location,
    })

    return NextResponse.json({ success: true, eventId })
  } catch (error) {
    console.error('Error creating calendar event:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create event' },
      { status: 500 }
    )
  }
}
