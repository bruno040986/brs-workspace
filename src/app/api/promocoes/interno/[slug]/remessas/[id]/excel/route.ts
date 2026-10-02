/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { gerarXlsx, type ItemRemessa } from '@/lib/promocoes/remessa-logic'
import { registrarExportacao } from '@/lib/promocoes/remessa-actions'

export const runtime = 'nodejs'

export async function GET(_request: NextRequest, ctx: { params: Promise<{ slug: string; id: string }> }) {
  let userId: string
  try {
    userId = (await requirePermission('comercial-promocoes-remessa', 'can_view')).user.id
  } catch {
    return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  }

  const { slug, id } = await ctx.params
  const sb: any = await createAdminClient()
  const { data: camp } = await sb.from('promocao_campanhas').select('id').eq('slug', slug).maybeSingle()
  const { data: remessa } = camp
    ? await sb.from('promocao_remessas').select('id, data_referencia').eq('id', id).eq('campanha_id', camp.id).maybeSingle()
    : { data: null }
  if (!remessa) return NextResponse.json({ error: 'Remessa não encontrada.' }, { status: 404 })

  const { data: itens } = await sb.from('promocao_remessa_itens').select('*').eq('remessa_id', id).order('indicado_nome')
  const xlsx = gerarXlsx((itens ?? []) as ItemRemessa[])
  await registrarExportacao(id, userId)

  return new NextResponse(new Uint8Array(xlsx), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="remessa-pix-${remessa.data_referencia}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}
