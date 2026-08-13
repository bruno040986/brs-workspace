// Configuração do Google OAuth a partir das variáveis de ambiente
// Este arquivo será substituído para ler do banco de dados

export const googleConfig = {
  clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  redirectUri: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/google/callback`,
}

export const googleScopes = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar',
]

export function isGoogleConfigured(): boolean {
  return !!(googleConfig.clientId && googleConfig.clientSecret)
}

/**
 * Busca a configuração do Google no banco de dados
 * Retorna null se não configurado
 */
export async function getGoogleConfigFromDb() {
  try {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const supabase = await createAdminClient()

    const { data, error } = await supabase
      .from('system_google_config')
      .select('client_id, client_secret')
      .single()

    if (error || !data) {
      return null
    }

    if (!data.client_id || !data.client_secret) {
      return null
    }

    return {
      clientId: data.client_id,
      clientSecret: data.client_secret,
      redirectUri: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/google/callback`,
    }
  } catch (error) {
    console.error('Error fetching Google config from DB:', error)
    return null
  }
}
