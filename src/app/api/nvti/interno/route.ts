/**
 * Rota de serviço da higienização NVTI para os orquestradores (clt-orchestrator
 * e futuros). Autentica por token de serviço (NVTI_SERVICE_TOKEN), fail-closed.
 *
 * POST { cpfs: string[], service: string }
 * → { results: [{ cpf, status, fromCache, resultado?, error? }] }
 *
 * Passa pelo MESMO núcleo das telas: cache de reaproveitamento, teto global e
 * registro em nvti_queries (origin 'service'). Teto por usuário não se aplica.
 */

import { NextRequest, NextResponse } from 'next/server'
import { higienizarCpf } from '@/lib/nvti/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_CPFS_PER_CALL = 200

function isAuthorized(req: NextRequest): boolean {
  const secret = String(process.env.NVTI_SERVICE_TOKEN || '')
  if (!secret) return false
  const auth = req.headers.get('authorization') || ''
  return auth === `Bearer ${secret}`
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { cpfs?: unknown; service?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido.' }, { status: 400 })
  }

  const service = String(body.service || '').trim().slice(0, 100)
  if (!service) return NextResponse.json({ error: 'Informe "service" (nome do orquestrador).' }, { status: 400 })

  const cpfs = Array.isArray(body.cpfs) ? body.cpfs.map((value) => String(value || '')) : []
  if (!cpfs.length) return NextResponse.json({ error: 'Informe "cpfs" (lista não vazia).' }, { status: 400 })
  if (cpfs.length > MAX_CPFS_PER_CALL) {
    return NextResponse.json({ error: `Máximo de ${MAX_CPFS_PER_CALL} CPFs por chamada.` }, { status: 400 })
  }

  const results = []
  for (const cpf of cpfs) {
    const outcome = await higienizarCpf({ cpf, origin: 'service', serviceName: service })
    if (outcome.status === 'ok') {
      results.push({ cpf, status: 'ok', fromCache: outcome.fromCache, resultado: outcome.resultado })
    } else {
      results.push({ cpf, status: outcome.status, error: outcome.error })
      // Teto global atingido: não adianta continuar o restante da lista.
      if (outcome.status === 'blocked_global' || outcome.status === 'not_configured') break
    }
  }

  return NextResponse.json({ results })
}
