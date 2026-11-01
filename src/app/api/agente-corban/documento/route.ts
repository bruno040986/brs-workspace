import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAnyPermission } from '@/lib/auth/server'
import { BUCKET_DOCUMENTOS, nomeArquivoSeguro, resolverDocumentoDoAgente } from '@/lib/agente-corban-documento'

export const dynamic = 'force-dynamic'

/**
 * Download autenticado de documento do parceiro (bucket privado `partner-documents`).
 * GET ?agente=<uuid>&ref=<path ou URL antiga gravada no corban_data>
 * `ref` é só referência: o servidor exige que ela conste no corban_data do agente (ou seja
 * upload de correção dele) e baixa com service_role. Nunca devolve URL do Storage.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAnyPermission([
      { resource: 'agente-corban-cadastros-recebidos', action: 'can_view' },
      { resource: 'agente-corban', action: 'can_view' },
    ])
  } catch {
    return NextResponse.json({ error: 'sem acesso' }, { status: 403 })
  }

  const agenteId = request.nextUrl.searchParams.get('agente') ?? ''
  const admin = await createAdminClient()
  const { data: agente } = await admin.from('agentes_parceiros').select('corban_data').eq('id', agenteId).maybeSingle()
  const path = agente ? resolverDocumentoDoAgente(agente.corban_data, agenteId, request.nextUrl.searchParams.get('ref')) : null
  if (!path) return NextResponse.json({ error: 'documento indisponível' }, { status: 404 })

  const { data, error } = await admin.storage.from(BUCKET_DOCUMENTOS).download(path)
  if (error || !data) return NextResponse.json({ error: 'documento indisponível' }, { status: 404 })

  return new Response(data.stream(), {
    headers: {
      'Content-Type': data.type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${nomeArquivoSeguro(path)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
      'Cache-Control': 'private, no-store',
    },
  })
}
