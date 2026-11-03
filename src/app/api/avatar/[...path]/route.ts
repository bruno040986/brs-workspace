import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireApiUser } from '@/lib/auth/server'
import { avatarPathValido } from '@/lib/auth/avatar-url'

export const dynamic = 'force-dynamic'

/** Avatar do bucket PRIVADO `avatars`: só com sessão interna liberada; baixa com service_role. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!(await requireApiUser())) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  const path = (await ctx.params).path.join('/')
  if (!avatarPathValido(path)) return new Response(null, { status: 404 })

  const admin = await createAdminClient()
  const { data, error } = await admin.storage.from('avatars').download(path)
  if (error || !data) return new Response(null, { status: 404 })

  return new Response(data.stream(), {
    headers: {
      'Content-Type': data.type || 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
