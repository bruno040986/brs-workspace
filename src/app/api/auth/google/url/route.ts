import { NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { googleScopes } from '@/lib/google/config'

export async function GET(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 })
    }

    const supabase = await createAdminClient()
    const { data: googleConfig, error } = await supabase
      .from('system_google_config')
      .select('client_id')
      .single()

    if (error || !googleConfig?.client_id) {
      console.error('Google config not found in database:', error)
      return NextResponse.json(
        { error: 'Google nao configurado. Acesse Configuracoes > Google para configurar.' },
        { status: 400 },
      )
    }

    const state = crypto.randomUUID()
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/google/callback`

    const params = new URLSearchParams({
      client_id: googleConfig.client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: googleScopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
    })

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
    const response = NextResponse.json({ authUrl, state })
    response.cookies.set('google_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    })
    return response
  } catch (error) {
    console.error('Error generating auth URL:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha ao gerar URL de autenticacao' },
      { status: 500 },
    )
  }
}
