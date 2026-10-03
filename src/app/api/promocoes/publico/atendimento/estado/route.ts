/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { cpfBloqueado } from '@/lib/promocoes/cadastro-publico'
import { botaoDoEstado, gatesGlobais } from '@/lib/promocoes/atendimento-regras'
import { M_FALHOU, M_JA_ENVIADO, MSG_ERRO } from '@/lib/promocoes/atendimento-textos'
import { escolherInstancia, pedidoExistente, resolverAlvo } from '@/lib/promocoes/atendimento'
import { hashToken } from '@/lib/promocoes/codigos'
import { aplicarLimites, buscarCampanha, CAMPANHA_INDISPONIVEL, erro, ipDoRequest, JSON_INVALIDO, ok } from '@/lib/promocoes/http'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const camp = await buscarCampanha(sp.get('campanha'))
  if (!camp) return CAMPANHA_INDISPONIVEL()
  const tipo = sp.get('tipo')
  const t = sp.get('t') || ''
  if ((tipo !== 'servidor' && tipo !== 'indicado') || t.length < 20 || t.length > 100) return JSON_INVALIDO()
  const limite = await aplicarLimites([
    [`rl:atend-est:ip:${ipDoRequest(request)}`, 300, 3600],
    [`rl:atend-est:tok:${hashToken(t)}`, 60, 3600],
  ])
  if (limite) return limite

  const admin: any = await createAdminClient()
  const alvo = await resolverAlvo(admin, camp.id, tipo, t)
  if (!alvo) return erro('LINK_INVALIDO', MSG_ERRO.LINK_INVALIDO, 404)

  const pedido = await pedidoExistente(admin, camp.id, alvo.cpfAlvo, alvo.telefoneAlvo)
  const gate = gatesGlobais(camp, new Date())
  let bloqueado = false
  let algumaConectada = false
  if (!pedido && gate === 'ok' && alvo.telefoneVerificado) {
    bloqueado = await cpfBloqueado(admin, camp.id, [alvo.cpfAlvo, ...(alvo.cpfIndicador ? [alvo.cpfIndicador] : [])])
    if (!bloqueado) algumaConectada = (await escolherInstancia(admin, camp)) !== 'nenhuma_conectada'
  }
  const botao = botaoDoEstado({ pedidoStatus: pedido?.status ?? null, gate, telefoneVerificado: alvo.telefoneVerificado, bloqueado, algumaConectada })
  const mensagem = botao === 'falhou' ? M_FALHOU[tipo] : botao === 'ja_enviado' ? M_JA_ENVIADO[tipo] : ''
  return ok({ botao, status: pedido?.status ?? null, mensagem })
}
