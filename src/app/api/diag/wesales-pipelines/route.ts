/**
 * Rota de diagnóstico TEMPORÁRIA — só pra ler os pipelines/etapas reais do
 * WeSales (IDs, cores) na hora de cablear os funis "AC - Prospecção" e
 * "AC - Oferta" no CRM AlvoConsig. Remover depois de extrair os dados
 * (junto com a env DIAG_WESALES_TOKEN).
 */

import { NextRequest } from 'next/server'
import { resolvePipeline } from '@/lib/wesales/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function isAuthorized(req: NextRequest): boolean {
  const secret = String(process.env.DIAG_WESALES_TOKEN || '')
  if (!secret) return false
  const auth = req.headers.get('authorization') || ''
  if (auth === `Bearer ${secret}`) return true
  const url = new URL(req.url)
  return url.searchParams.get('token') === secret
}

const NOMES_PIPELINE = ['AC - Prospecção (1 card por lead)', 'AC - Oferta (1 card por oferta, vários por lead)']

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const resultados = await Promise.all(NOMES_PIPELINE.map((nome) => resolvePipeline(nome)))
  return Response.json({ ok: true, pipelines: resultados })
}
