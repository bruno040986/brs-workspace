/**
 * Cron diário: encerra campanhas do AlvoConsig cuja vigência acabou.
 *
 * Agendado pelo Vercel Cron (ver vercel.json). Protegido por CRON_SECRET —
 * o Vercel envia `Authorization: Bearer <CRON_SECRET>`.
 *
 * Para cada campanha vencida (ativa/encerrando): chama a RPC
 * crm_encerrar_campanha (expurga a cópia local exceto negociação aberta e
 * certificação pendente) e, se encerrada, reverte no WeSales as tags dos
 * leads não certificados (voltam pro pool — TAG_DISPONIVEL). Campanhas com
 * fila ainda pendente ficam 'encerrando' e o cron insiste no dia seguinte.
 */

import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { reverterTagsDaCampanha } from '@/lib/alvoconsig/campanha-encerramento'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function isAuthorized(req: NextRequest): boolean {
  const secret = String(process.env.CRON_SECRET || '')
  if (!secret) return false
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const admin = await createAdminClient()
  const hoje = new Date().toISOString().slice(0, 10)

  const { data: campanhas, error } = await admin
    .from('crm_campanhas')
    .select('id, agente_parceiro_id')
    .in('status', ['ativa', 'encerrando'])
    .lt('vigencia_fim', hoje)
  if (error) {
    console.error('Erro ao listar campanhas vencidas:', error)
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }

  let encerradas = 0
  let aguardandoFila = 0
  let revertidos = 0
  for (const campanha of campanhas || []) {
    const { data: resultado, error: rpcError } = await admin.rpc('crm_encerrar_campanha', { p_campanha_id: campanha.id })
    if (rpcError) {
      console.error(`Erro ao encerrar campanha ${campanha.id}:`, rpcError)
      continue
    }
    const payload = resultado as { ok: boolean; motivo?: string; expurgados?: number; mantidos?: number }
    if (!payload.ok) {
      aguardandoFila += 1
      continue
    }
    encerradas += 1
    const { revertidos: n } = await reverterTagsDaCampanha(admin, campanha.id, campanha.agente_parceiro_id)
    revertidos += n
  }

  return Response.json({ ok: true, avaliadas: campanhas?.length || 0, encerradas, aguardandoFila, revertidos })
}
