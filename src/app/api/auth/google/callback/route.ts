import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')
  const savedState = request.cookies.get('google_oauth_state')?.value

  if (error) {
    return NextResponse.redirect(new URL(`/?error=${error}`, request.url))
  }

  if (!code) {
    return NextResponse.redirect(new URL('/?error=no_code', request.url))
  }
  if (!state || !savedState || state !== savedState) {
    return NextResponse.redirect(new URL('/?error=invalid_oauth_state', request.url))
  }

  try {
    const adminSupabase = await createAdminClient()
    const currentUser = await requireApiUser()

    if (!currentUser) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    const { data: config, error: configError } = await adminSupabase
      .from('system_google_config')
      .select('client_id, client_secret')
      .single()

    if (configError || !config?.client_id || !config?.client_secret) {
      throw new Error('Google credentials not configured')
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.client_id,
        client_secret: config.client_secret,
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }).toString(),
    })

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.statusText}`)
    }

    const tokens = await tokenResponse.json()

    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })

    if (!userResponse.ok) {
      throw new Error('Failed to fetch user info')
    }

    const googleUser = await userResponse.json()
    const expiryDate = new Date()
    expiryDate.setSeconds(expiryDate.getSeconds() + tokens.expires_in)

    let refreshTokenToSave = tokens.refresh_token || null
    if (!refreshTokenToSave) {
      const { data: existingAuth } = await adminSupabase
        .from('user_google_auth')
        .select('refresh_token')
        .eq('user_id', currentUser.id)
        .maybeSingle()
      if (!existingAuth?.refresh_token) {
        throw new Error('Google nao retornou refresh_token. Revogue o acesso do app no Google e conecte novamente.')
      }
      refreshTokenToSave = existingAuth.refresh_token
    }

    const { error: upsertError } = await adminSupabase
      .from('user_google_auth')
      .upsert(
        {
          user_id: currentUser.id,
          email_vinculado: googleUser.email,
          access_token: tokens.access_token,
          refresh_token: refreshTokenToSave,
          expiry_date: expiryDate.toISOString(),
        },
        { onConflict: 'user_id' },
      )

    if (upsertError) {
      throw new Error(`Failed to save tokens: ${upsertError.message}`)
    }

    const response = NextResponse.redirect(new URL('/?google_auth=success', request.url))
    response.cookies.set('google_oauth_state', '', { path: '/', maxAge: 0 })
    return response
  } catch (err) {
    console.error('Google OAuth callback error:', err)
    const response = NextResponse.redirect(new URL('/?error=auth_failed', request.url))
    response.cookies.set('google_oauth_state', '', { path: '/', maxAge: 0 })
    return response
  }
}
