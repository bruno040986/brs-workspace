import { getGoogleConfigFromDb, googleConfig, googleScopes, isGoogleConfigured } from './config'
import { createClient } from '@/lib/supabase/server'

/**
 * Gera a URL de autorização do Google OAuth
 */
export function generateGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: googleConfig.clientId,
    redirect_uri: googleConfig.redirectUri,
    response_type: 'code',
    scope: googleScopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  })

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

async function getOAuthConfig() {
  return (await getGoogleConfigFromDb()) || googleConfig
}

/**
 * Renova o access_token usando o refresh_token
 */
export async function refreshGoogleToken(userId: string): Promise<string | null> {
  const supabase = await createClient()

  // Buscar o refresh_token do usuário
  const { data: googleAuth, error: fetchError } = await supabase
    .from('user_google_auth')
    .select('refresh_token, expiry_date')
    .eq('user_id', userId)
    .single()

  if (fetchError || !googleAuth?.refresh_token) {
    console.error('No refresh token found:', fetchError)
    return null
  }

  try {
    const oauthConfig = await getOAuthConfig()
    if (!oauthConfig.clientId || !oauthConfig.clientSecret) return null

    // Chamar a API do Google para renovar
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: oauthConfig.clientId,
        client_secret: oauthConfig.clientSecret,
        refresh_token: googleAuth.refresh_token,
        grant_type: 'refresh_token',
      }).toString(),
    })

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.statusText}`)
    }

    const tokens = await response.json()

    // Atualizar o access_token e expiry_date
    const expiryDate = new Date()
    expiryDate.setSeconds(expiryDate.getSeconds() + tokens.expires_in)

    const { error: updateError } = await supabase
      .from('user_google_auth')
      .update({
        access_token: tokens.access_token,
        expiry_date: expiryDate.toISOString(),
      })
      .eq('user_id', userId)

    if (updateError) {
      throw new Error(`Failed to update token: ${updateError.message}`)
    }

    return tokens.access_token
  } catch (error) {
    console.error('Error refreshing Google token:', error)
    return null
  }
}

/**
 * Obtém o access_token válido para o usuário (renovando se necessário)
 */
export async function getValidGoogleToken(userId: string): Promise<string | null> {
  const supabase = await createClient()

  const { data: googleAuth, error } = await supabase
    .from('user_google_auth')
    .select('access_token, expiry_date, refresh_token')
    .eq('user_id', userId)
    .single()

  if (error || !googleAuth) {
    return null
  }

  // Se o token expirou ou vai expirar em menos de 5 minutos, renovar
  const expiryTime = new Date(googleAuth.expiry_date).getTime()
  const now = Date.now()
  const timeLeft = expiryTime - now

  if (timeLeft < 5 * 60 * 1000) {
    // Token expirado ou expirando em menos de 5 minutos
    return await refreshGoogleToken(userId)
  }

  return googleAuth.access_token
}

/**
 * Desconecta a conta Google do usuário
 */
export async function disconnectGoogleAccount(userId: string): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('user_google_auth')
    .delete()
    .eq('user_id', userId)

  if (error) {
    throw new Error(`Failed to disconnect Google account: ${error.message}`)
  }
}

// Re-export para conveniência
export { isGoogleConfigured }
