import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getValidGoogleToken } from '@/lib/google/oauth'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ connected: false }, { status: 401 })
    }

    const { data } = await supabase
      .from('user_google_auth')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!data) {
      return NextResponse.json({ connected: false, reason: 'not_connected' })
    }

    const token = await getValidGoogleToken(user.id)
    return NextResponse.json({ connected: !!token, reason: token ? 'ok' : 'token_invalid' })
  } catch (error) {
    console.error('Error checking Google connection:', error)
    return NextResponse.json({ connected: false }, { status: 500 })
  }
}
