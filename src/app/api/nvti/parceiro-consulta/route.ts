/**
 * Consulta de CPF paga pelo parceiro (CRM AlvoConsig → Workspace).
 * Autentica por token de serviço (NVTI_SERVICE_TOKEN), fail-closed.
 *
 * POST { agenteParceiroId, cpf, crmUsuarioId?, contatoId? }
 * → 200 { ok: true, cacheHit, precoCentavos, saldoCentavos, dados }
 * → 402 { error: 'saldo_insuficiente', saldoCentavos }
 * → 400/500/503 { error }
 */

import { NextRequest, NextResponse } from 'next/server'
import { consultarCpfParceiro } from '@/lib/nvti/consulta-parceiro'
import { isNvtiServiceAuthorized } from '@/lib/nvti/service-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function optionalUuid(value: unknown): string | null {
  const str = String(value || '').trim()
  return str && UUID_RE.test(str) ? str : null
}

export async function POST(request: NextRequest) {
  if (!isNvtiServiceAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { agenteParceiroId?: unknown; cpf?: unknown; crmUsuarioId?: unknown; contatoId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido.' }, { status: 400 })
  }

  const agenteParceiroId = optionalUuid(body.agenteParceiroId)
  if (!agenteParceiroId) return NextResponse.json({ error: 'Informe "agenteParceiroId" (uuid).' }, { status: 400 })
  const cpf = String(body.cpf || '').trim()
  if (!cpf) return NextResponse.json({ error: 'Informe "cpf".' }, { status: 400 })

  const result = await consultarCpfParceiro({
    agenteParceiroId,
    cpf,
    crmUsuarioId: optionalUuid(body.crmUsuarioId),
    contatoId: optionalUuid(body.contatoId),
  })

  if (result.ok) return NextResponse.json(result)
  if (result.status === 402) {
    return NextResponse.json({ error: 'saldo_insuficiente', saldoCentavos: result.saldoCentavos }, { status: 402 })
  }
  return NextResponse.json({ error: result.error }, { status: result.status })
}
