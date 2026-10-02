import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { enqueueJob } from '@/lib/scp-engine/queue'
import { proximoNEnvio } from '@/lib/promocoes/comprovante-envio'
import { enviarComprovanteNumeros } from '@/lib/promocoes/jobs-geracao'
import { LIMITE_EXCEDIDO, LINK_INVALIDO, carregarGeracao, ipDe, limiteExcedido, registrarEvento, tokenValido } from '@/lib/promocoes/geracao-publico'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return LINK_INVALIDO()
  if (body.site) return NextResponse.json({ envio: 'pendente' })
  const { t } = body
  if (!tokenValido(t)) return LINK_INVALIDO()

  const admin: any = await createAdminClient()
  if (await limiteExcedido(admin, `rl:geracao:ip:${ipDe(request)}`, 30, 600)) return LIMITE_EXCEDIDO()

  const carregada = await carregarGeracao(admin, t, true)
  if (!carregada || carregada.estado !== 'ok' || carregada.g.status !== 'usado') return LINK_INVALIDO()
  if (body.campanha && carregada.campanha.slug !== body.campanha) return LINK_INVALIDO()
  const { g } = carregada

  const n = await proximoNEnvio(admin, `comprovante-num:${g.id}`)
  if (n === null) return LIMITE_EXCEDIDO()
  let envio: 'enviado' | 'incerto' | 'pendente' = 'pendente'
  try {
    const r = await enviarComprovanteNumeros(g.id, n)
    if (r.resultado === 'confirmado') envio = 'enviado'
    else if (r.resultado === 'incerto') envio = 'incerto'
  } catch (e: any) {
    console.error('comprovante numeros inline falhou', g.id, e?.message)
  }

  if (envio !== 'enviado') {
    await enqueueJob({ kind: 'promocoes.enviar_comprovante', payload: { tipo: 'numeros', id: g.id, n }, dedupeKey: `promo-comp:numeros:${g.id}:${n}`, maxAttempts: 5 })
  }
  await registrarEvento(admin, g, 'geracao.comprovante_solicitado', { n, envio })
  return NextResponse.json({ envio })
}
