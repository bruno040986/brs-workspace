/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { indicacaoPorAtendimentoToken } from '@/lib/promocoes/atendimento'
import { MSG_ERRO } from '@/lib/promocoes/atendimento-textos'
import { hashToken } from '@/lib/promocoes/codigos'
import { aplicarLimites, buscarCampanha, CAMPANHA_INDISPONIVEL, erro, ipDoRequest, JSON_INVALIDO, lerJson, ok, registrarEvento } from '@/lib/promocoes/http'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const TIPOS = ['indicador_sem_autorizacao', 'indicador_abriu_whatsapp_proprio']

export async function POST(request: NextRequest) {
  const body = await lerJson(request)
  if (!body) return JSON_INVALIDO()
  if (body.site) return ok({ ok: true })
  const camp = await buscarCampanha(body.campanha)
  if (!camp) return CAMPANHA_INDISPONIVEL()
  const t = typeof body.t === 'string' ? body.t : ''
  if (t.length < 20 || t.length > 100) return erro('LINK_INVALIDO', MSG_ERRO.LINK_INVALIDO, 404)
  const limite = await aplicarLimites([
    [`rl:atend-ev:ip:${ipDoRequest(request)}`, 300, 3600],
    [`rl:atend-ev:tok:${hashToken(t)}`, 30, 3600],
  ])
  if (limite) return limite
  const admin: any = await createAdminClient()
  const indicacaoId = await indicacaoPorAtendimentoToken(admin, camp.id, t)
  if (!indicacaoId) return erro('LINK_INVALIDO', MSG_ERRO.LINK_INVALIDO, 404)
  // tipo fora da allowlist: 200 sem gravar (sem oráculo)
  if (TIPOS.includes(body.tipo)) await registrarEvento(admin, camp.id, 'indicacao', indicacaoId, `atendimento.${body.tipo}`, {})
  return ok({ ok: true })
}
