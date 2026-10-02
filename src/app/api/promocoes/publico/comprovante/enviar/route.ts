/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { hashToken } from '@/lib/promocoes/codigos'
import { enviarComprovanteIndicacao, proximoNEnvio } from '@/lib/promocoes/comprovante-envio'
import { aplicarLimites, buscarCampanha, CAMPANHA_INDISPONIVEL, erro, ipDoRequest, JSON_INVALIDO, lerJson, logSeguro, ok } from '@/lib/promocoes/http'
import { enqueueJob } from '@/lib/scp-engine/queue'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const body = await lerJson(request)
  if (!body) return JSON_INVALIDO()
  if (body.site) return ok({ ok: true })

  const camp = await buscarCampanha(body.campanha, ['ativa'])
  if (!camp) return CAMPANHA_INDISPONIVEL()
  const t = typeof body.t === 'string' ? body.t : ''
  if (t.length < 20 || t.length > 100) return erro('LINK_INVALIDO', 'Este comprovante não está mais disponível.', 404)
  const hash = hashToken(t)
  const limite = await aplicarLimites([
    [`rl:compenv:ip:${ipDoRequest(request)}`, 20, 3600],
    [`rl:compenv:tok:${hash}`, 6, 86400],
  ])
  if (limite) return limite

  const admin: any = await createAdminClient()
  const { data: ind } = await admin
    .from('promocao_indicacoes')
    .select('id, status, comprovante_expira_em')
    .eq('comprovante_token_hash', hash)
    .eq('campanha_id', camp.id)
    .maybeSingle()
  if (!ind || ind.status !== 'valida' || !ind.comprovante_expira_em || new Date(ind.comprovante_expira_em).getTime() < Date.now()) {
    return erro('LINK_INVALIDO', 'Este comprovante não está mais disponível.', 404)
  }

  const n = await proximoNEnvio(admin, `comprovante-ind:${ind.id}`)
  if (!n) return erro('LIMITE_EXCEDIDO', 'Limite de envios do comprovante atingido.', 429)

  try {
    const r = await enviarComprovanteIndicacao(ind.id, n)
    if (r.resultado === 'confirmado') return ok({ envio: 'enviado' })
    const semWhatsapp = r.resultado === 'rejeitado' && /sem_whatsapp|not.?on.?whatsapp/i.test(r.mensagem)
    if (!semWhatsapp) {
      await enqueueJob({ kind: 'promocoes.enviar_comprovante', payload: { tipo: 'indicacao', id: ind.id, n }, dedupeKey: `promo-comp:indicacao:${ind.id}:${n}`, maxAttempts: 5 })
    }
    return ok({ envio: r.resultado === 'incerto' ? 'incerto' : 'pendente' })
  } catch (e) {
    logSeguro('comprovante enviar', e)
    return ok({ envio: 'pendente' })
  }
}
