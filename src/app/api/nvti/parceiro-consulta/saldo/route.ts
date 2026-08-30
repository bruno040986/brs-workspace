/**
 * Saldo da carteira + preço da próxima consulta de CPF do parceiro.
 * Autentica por NVTI_SERVICE_TOKEN (fail-closed).
 *
 * GET ?agenteParceiroId=<uuid>
 * → 200 { saldoCentavos, precoCentavos, cobraCache }
 */

import { NextRequest, NextResponse } from 'next/server'
import { consultarSaldoParceiro } from '@/lib/nvti/consulta-parceiro'
import { isNvtiServiceAuthorized } from '@/lib/nvti/service-auth'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest) {
  if (!isNvtiServiceAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const agenteParceiroId = String(request.nextUrl.searchParams.get('agenteParceiroId') || '').trim()
  if (!UUID_RE.test(agenteParceiroId)) {
    return NextResponse.json({ error: 'Informe "agenteParceiroId" (uuid).' }, { status: 400 })
  }
  try {
    const { saldoCentavos, precoCentavos, cobraCache } = await consultarSaldoParceiro(agenteParceiroId)
    return NextResponse.json({ saldoCentavos, precoCentavos, cobraCache })
  } catch (error) {
    console.error('[parceiro-consulta/saldo]', error)
    return NextResponse.json({ error: 'Falha ao consultar o saldo.' }, { status: 500 })
  }
}
