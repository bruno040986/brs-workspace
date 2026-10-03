/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { cpfBloqueado } from '@/lib/promocoes/cadastro-publico'
import { atingiuLimite, FALLBACK_JOB_MS, gatesGlobais, reservarSlots, slotsDoPedido } from '@/lib/promocoes/atendimento-regras'
import {
  CONSENTIMENTO_INDICADO_GRAVADO,
  CONSENTIMENTO_INDICADO_VERSAO,
  M_FALHOU,
  M_HORARIO,
  M_JA_ENVIADO,
  M_OK,
  MSG_ERRO,
} from '@/lib/promocoes/atendimento-textos'
import { contarPedidos, criarPedido, enviarPedidoAtendimento, escolherInstancia, pedidoExistente, resolverAlvo } from '@/lib/promocoes/atendimento'
import { hashToken } from '@/lib/promocoes/codigos'
import { aplicarLimites, buscarCampanha, cadastroFechado, CAMPANHA_INDISPONIVEL, erro, ipDoRequest, JSON_INVALIDO, lerJson, logSeguro, ok, registrarEvento } from '@/lib/promocoes/http'
import { limiteTentar } from '@/lib/promocoes/rate-limit'
import { enqueueJob } from '@/lib/scp-engine/queue'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const INDISPONIVEL = () => erro('ATENDIMENTO_INDISPONIVEL', MSG_ERRO.ATENDIMENTO_INDISPONIVEL, 409)
const LINK_INVALIDO = () => erro('LINK_INVALIDO', MSG_ERRO.LINK_INVALIDO, 404)

export async function POST(request: NextRequest) {
  const body = await lerJson(request)
  if (!body) return JSON_INVALIDO()
  if (body.site) return ok({ ok: true })

  const camp = await buscarCampanha(body.campanha)
  if (!camp) return CAMPANHA_INDISPONIVEL()
  const fechado = cadastroFechado(camp)
  if (fechado) return fechado
  const ip = ipDoRequest(request)
  const limiteIp = await aplicarLimites([[`rl:atend:ip:${ip}`, 100, 3600]])
  if (limiteIp) return limiteIp

  const tipo = body.tipo
  const t = typeof body.t === 'string' ? body.t : ''
  if ((tipo !== 'servidor' && tipo !== 'indicado') || t.length < 20 || t.length > 100) return JSON_INVALIDO()
  const gate = gatesGlobais(camp, new Date())
  if (gate === 'fora_horario') return erro('FORA_HORARIO', M_HORARIO, 409)
  if (gate !== 'ok') return INDISPONIVEL()
  const limiteTok = await aplicarLimites([[`rl:atend:tok:${hashToken(t)}`, 10, 3600]])
  if (limiteTok) return limiteTok

  const admin: any = await createAdminClient()
  const alvo = await resolverAlvo(admin, camp.id, tipo, t)
  if (!alvo) return LINK_INVALIDO()
  if (tipo === 'indicado' && body.autorizacao !== true) return erro('SEM_CONSENTIMENTO', MSG_ERRO.SEM_CONSENTIMENTO, 409)
  if (!alvo.telefoneVerificado) return erro('TELEFONE_NAO_VERIFICADO', MSG_ERRO.TELEFONE_NAO_VERIFICADO, 401)
  if (await cpfBloqueado(admin, camp.id, [alvo.cpfAlvo, ...(alvo.cpfIndicador ? [alvo.cpfIndicador] : [])])) return INDISPONIVEL()

  const jaEnviado = async (status: string) =>
    erro('JA_ENVIADO', status === 'rejeitado' ? M_FALHOU[tipo as 'servidor' | 'indicado'] : M_JA_ENVIADO[tipo as 'servidor' | 'indicado'], 409, { status })
  const existente = await pedidoExistente(admin, camp.id, alvo.cpfAlvo, alvo.telefoneAlvo)
  if (existente) return jaEnviado(existente.status)

  if (tipo === 'indicado') {
    const n = await contarPedidos(admin, { campanhaId: camp.id, indicadorId: alvo.indicadorId!, desdeMs: 3600_000 })
    if (atingiuLimite(n, camp.limite_atendimento_indicador_hora)) return erro('LIMITE_INDICADOR', MSG_ERRO.LIMITE_INDICADOR, 429)
  }

  const inst = await escolherInstancia(admin, camp)
  if (inst === 'nenhuma_conectada') return INDISPONIVEL()
  if (inst === 'todas_cheias') return erro('LIMITE_INSTANCIA', MSG_ERRO.LIMITE_INSTANCIA, 429)

  // B1: reserva atômica (2ª barreira, fail-closed) imediatamente antes do insert
  const negado = await reservarSlots(slotsDoPedido(camp, { tipo, indicadorId: alvo.indicadorId, instanciaId: inst.id }), limiteTentar)
  if (negado === 'LIMITE_INDICADOR') return erro('LIMITE_INDICADOR', MSG_ERRO.LIMITE_INDICADOR, 429)
  if (negado) return erro('LIMITE_INSTANCIA', MSG_ERRO.LIMITE_INSTANCIA, 429)

  const pedido = await criarPedido(admin, camp, alvo, {
    consentimentoTexto: tipo === 'indicado' ? CONSENTIMENTO_INDICADO_GRAVADO : undefined,
    consentimentoVersao: tipo === 'indicado' ? CONSENTIMENTO_INDICADO_VERSAO : undefined,
    ip,
    userAgent: request.headers.get('user-agent') || '',
    instanciaId: inst.id,
  })
  if (pedido === 'duplicado') {
    const e2 = await pedidoExistente(admin, camp.id, alvo.cpfAlvo, alvo.telefoneAlvo)
    return jaEnviado(e2?.status ?? 'pendente')
  }
  if (pedido === 'erro') {
    logSeguro('atendimento criar pedido', 'falha no insert')
    return erro('ERRO_INTERNO', MSG_ERRO.ERRO_INTERNO, 500)
  }

  await registrarEvento(admin, camp.id, 'pedido_atendimento', pedido.id, 'atendimento.pedido_criado', {
    tipo, inscricaoId: alvo.inscricaoId, indicacaoId: alvo.indicacaoId, instanciaUsadaId: inst.id,
  })
  const fila = await enqueueJob({ kind: 'promocoes.atendimento_enviar', payload: { pedidoId: pedido.id }, dedupeKey: `promo-atend:${pedido.id}`, maxAttempts: 5, runAfterIso: new Date(Date.now() + FALLBACK_JOB_MS).toISOString() })
  const semFallback = !fila.enqueued && !fila.deduped
  if (semFallback) logSeguro('atendimento enqueue', fila.error || 'job não enfileirado')

  // envio inline continua vivo após a resposta (after) — a Vercel não congela a continuação
  const envio = enviarPedidoAtendimento(pedido.id).catch((e) => logSeguro('atendimento envio inline', e))
  after(() => envio)
  if (semFallback) {
    // sem job de fallback: espera o envio terminar; se seguir pendente, encerra (ESGOTADO) em vez de ficar pendente para sempre — o lead usa o botão receptivo
    await envio
    await admin.from('promocao_pedidos_atendimento').update({ status: 'rejeitado', erro: 'ESGOTADO' }).eq('id', pedido.id).eq('status', 'pendente')
  } else {
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([envio, new Promise((res) => { timer = setTimeout(res, 20_000) })])
    if (timer) clearTimeout(timer)
  }
  const { data: p } = await admin.from('promocao_pedidos_atendimento').select('status').eq('id', pedido.id).maybeSingle()
  const status = String(p?.status || 'pendente')
  if (status === 'rejeitado') return jaEnviado(status)
  return ok({ status: status === 'enviado' || status === 'incerto' ? status : 'pendente', mensagem: M_OK[tipo as 'servidor' | 'indicado'] })
}
