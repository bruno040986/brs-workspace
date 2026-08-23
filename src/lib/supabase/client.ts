import { createBrowserClient } from '@supabase/ssr'
import { WORKSPACE_AUTH_COOKIE_NAME } from './authCookie'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: WORKSPACE_AUTH_COOKIE_NAME },
    }
  )
}
