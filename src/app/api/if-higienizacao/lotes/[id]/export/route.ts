/**
 * Download da planilha (XLSX) com o resultado de um lote de Higienização
 * Amigoz. Exige alvoconsig-higienizacao-amigoz (can_view).
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasPermissionForUser } from '@/lib/auth/server'
import { gerarPlanilhaLote } from '@/lib/if-credito/amigoz/saidas'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const params = await ctx.params
  const loteId = String(params?.id || '')
  if (!loteId) return NextResponse.json({ error: 'Lote inválido.' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  const allowed = await hasPermissionForUser(user.id, 'alvoconsig-higienizacao-amigoz', 'can_view')
  if (!allowed) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })

  try {
    const buffer = await gerarPlanilhaLote(loteId)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="higienizacao-amigoz-${loteId.slice(0, 8)}.xlsx"`,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro ao gerar a planilha.' }, { status: 500 })
  }
}
