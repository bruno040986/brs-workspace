/* eslint-disable @typescript-eslint/no-explicit-any */
import { createAdminClient } from '@/lib/supabase/server'
import { gerarToken, hashToken } from './codigos'
import { registrarEvento, type Campanha } from './http'
import { escolherCandidata, mapearResultadoParaStatus, type Candidata } from './atendimento-regras'
import { textoAtendimentoIndicado, textoAtendimentoServidor } from './atendimento-textos'
import { enviarWhatsappPorInstancia, type ResultadoEnvio } from './whatsapp'

const VALIDADE_TOKEN_MS = 24 * 3600_000

export type TipoAtendimento = 'servidor' | 'indicado'
export type Alvo = {
  tipo: TipoAtendimento
  inscricaoId: string
  indicacaoId: string | null
  indicadorId: string | null
  cpfAlvo: string
  telefoneAlvo: string
  nomeAlvo: string
  codigo: string
  numeroIndicacao: string | null
  nomeIndicador: string | null
  telefoneVerificado: boolean
  cpfIndicador: string | null
}

/** Emite (renovando) o token de posse do cadastro concluído; só o hash fica no banco. */
export async function novoTokenAtendimento(admin: any, inscricaoId: string): Promise<string> {
  const { token, hash } = gerarToken()
  await admin
    .from('promocao_inscricoes')
    .update({ atendimento_token_hash: hash, atendimento_token_expira_em: new Date(Date.now() + VALIDADE_TOKEN_MS).toISOString() })
    .eq('id', inscricaoId)
  return token
}

export async function resolverAlvo(admin: any, campanhaId: string, tipo: TipoAtendimento, t: string): Promise<Alvo | null> {
  const hash = hashToken(t)
  const agora = Date.now()
  if (tipo === 'servidor') {
    const { data: i } = await admin
      .from('promocao_inscricoes')
      .select('id, codigo, cpf, nome, telefone, telefone_verificado, status, atendimento_token_expira_em')
      .eq('atendimento_token_hash', hash)
      .eq('campanha_id', campanhaId)
      .maybeSingle()
    if (!i || i.status !== 'ativa' || !i.atendimento_token_expira_em || new Date(i.atendimento_token_expira_em).getTime() < agora) return null
    return {
      tipo, inscricaoId: i.id, indicacaoId: null, indicadorId: null, cpfAlvo: String(i.cpf), telefoneAlvo: String(i.telefone),
      nomeAlvo: String(i.nome), codigo: String(i.codigo), numeroIndicacao: null, nomeIndicador: null,
      telefoneVerificado: Boolean(i.telefone_verificado), cpfIndicador: null,
    }
  }
  return resolverIndicacao(admin, campanhaId, hash, agora)
}

async function resolverIndicacao(admin: any, campanhaId: string, hash: string, agora: number): Promise<Alvo | null> {
  const { data: ind } = await admin
    .from('promocao_indicacoes')
    .select('id, numero, status, inscricao_id, indicador_id, comprovante_expira_em')
    .eq('comprovante_token_hash', hash)
    .eq('campanha_id', campanhaId)
    .maybeSingle()
  if (!ind || ind.status !== 'valida' || !ind.comprovante_expira_em || new Date(ind.comprovante_expira_em).getTime() < agora) return null
  const [{ data: i }, { data: dor }] = await Promise.all([
    admin.from('promocao_inscricoes').select('id, codigo, cpf, nome, telefone, status').eq('id', ind.inscricao_id).maybeSingle(),
    admin.from('promocao_indicadores').select('id, cpf, nome, telefone_verificado').eq('id', ind.indicador_id).maybeSingle(),
  ])
  if (!i || !dor || i.status !== 'ativa') return null
  return {
    tipo: 'indicado', inscricaoId: i.id, indicacaoId: ind.id, indicadorId: dor.id, cpfAlvo: String(i.cpf), telefoneAlvo: String(i.telefone),
    nomeAlvo: String(i.nome), codigo: String(i.codigo), numeroIndicacao: String(ind.numero), nomeIndicador: String(dor.nome),
    telefoneVerificado: Boolean(dor.telefone_verificado), cpfIndicador: String(dor.cpf),
  }
}

/** Token do indicador → id da indicação (botão B: só auditoria). */
export async function indicacaoPorComprovante(admin: any, campanhaId: string, t: string): Promise<string | null> {
  const { data: ind } = await admin
    .from('promocao_indicacoes')
    .select('id, status, comprovante_expira_em')
    .eq('comprovante_token_hash', hashToken(t))
    .eq('campanha_id', campanhaId)
    .maybeSingle()
  if (!ind || ind.status !== 'valida' || !ind.comprovante_expira_em || new Date(ind.comprovante_expira_em).getTime() < Date.now()) return null
  return String(ind.id)
}

export async function pedidoExistente(admin: any, campanhaId: string, cpfAlvo: string, telefoneAlvo: string): Promise<{ id: string; status: string } | null> {
  const { data } = await admin
    .from('promocao_pedidos_atendimento')
    .select('id, status')
    .eq('campanha_id', campanhaId)
    .or(`cpf_alvo.eq.${cpfAlvo},telefone_alvo.eq.${telefoneAlvo}`)
    .order('created_at', { ascending: true })
    .limit(1)
  const p = data?.[0]
  return p ? { id: String(p.id), status: String(p.status) } : null
}

/** Janela deslizante por contagem (não usa o limitador de janela fixa). */
export async function contarPedidos(admin: any, f: { campanhaId?: string; indicadorId?: string; instanciaId?: string; desdeMs: number }): Promise<number> {
  let q = admin.from('promocao_pedidos_atendimento').select('id', { count: 'exact', head: true }).gt('created_at', new Date(Date.now() - f.desdeMs).toISOString())
  if (f.campanhaId) q = q.eq('campanha_id', f.campanhaId)
  if (f.indicadorId) q = q.eq('indicador_id', f.indicadorId)
  if (f.instanciaId) q = q.eq('instancia_usada_id', f.instanciaId)
  const { count, error } = await q
  // erro de leitura = fail-closed (conta como cheio)
  return error ? Number.MAX_SAFE_INTEGER : count || 0
}

export async function escolherInstancia(admin: any, camp: Campanha): Promise<{ id: string } | 'nenhuma_conectada' | 'todas_cheias'> {
  const ids = [camp.instancia_atendimento_id, camp.instancia_atendimento_reserva_id].filter((x): x is string => Boolean(x))
  if (!ids.length || !camp.parceiro_atendimento_id) return 'nenhuma_conectada'
  const { data: insts } = await admin.from('chat_instancias').select('id, status, deleted_at, conta_id').in('id', ids)
  const contaIds = [...new Set((insts || []).map((i: any) => i.conta_id).filter(Boolean))]
  const { data: contas } = contaIds.length ? await admin.from('chat_contas').select('id, agente_parceiro_id').in('id', contaIds) : { data: [] }
  const parceiroDaConta = new Map<string, string | null>((contas || []).map((c: any) => [String(c.id), c.agente_parceiro_id ? String(c.agente_parceiro_id) : null]))
  const cands: Candidata[] = []
  for (const id of ids) {
    const i = (insts || []).find((x: any) => String(x.id) === id)
    if (!i) continue
    const [h, d] = await Promise.all([
      contarPedidos(admin, { instanciaId: id, desdeMs: 3600_000 }),
      contarPedidos(admin, { instanciaId: id, desdeMs: 24 * 3600_000 }),
    ])
    cands.push({ id, status: String(i.status), deletedAt: i.deleted_at ?? null, agenteParceiroId: parceiroDaConta.get(String(i.conta_id)) ?? null, enviosHora: h, enviosDia: d })
  }
  return escolherCandidata(cands, {
    parceiroId: camp.parceiro_atendimento_id,
    instanciaOtpId: camp.instancia_id,
    limiteHora: camp.limite_atendimento_instancia_hora,
    limiteDia: camp.limite_atendimento_instancia_dia,
  })
}

export async function criarPedido(
  admin: any,
  camp: Campanha,
  alvo: Alvo,
  extra: { consentimentoTexto?: string; consentimentoVersao?: string; ip: string; userAgent: string; instanciaId: string },
): Promise<{ id: string } | 'duplicado' | 'erro'> {
  const { data, error } = await admin
    .from('promocao_pedidos_atendimento')
    .insert({
      campanha_id: camp.id,
      tipo: alvo.tipo,
      inscricao_id: alvo.inscricaoId,
      indicacao_id: alvo.indicacaoId,
      indicador_id: alvo.indicadorId,
      cpf_alvo: alvo.cpfAlvo,
      telefone_alvo: alvo.telefoneAlvo,
      consentimento_texto: extra.consentimentoTexto ?? null,
      consentimento_versao: extra.consentimentoVersao ?? null,
      ip: extra.ip,
      user_agent: extra.userAgent.slice(0, 300),
      instancia_usada_id: extra.instanciaId,
    })
    .select('id')
    .single()
  if (error || !data) return String(error?.code) === '23505' ? 'duplicado' : 'erro'
  return { id: String(data.id) }
}

/** Envia (ou retenta, com o MESMO operation_id) o pedido, pela instância fixada nele. */
export async function enviarPedidoAtendimento(pedidoId: string): Promise<ResultadoEnvio> {
  const admin: any = await createAdminClient()
  const { data: p } = await admin.from('promocao_pedidos_atendimento').select('*').eq('id', pedidoId).maybeSingle()
  if (!p) return { resultado: 'rejeitado', mensagem: 'PEDIDO_INEXISTENTE_sem_whatsapp' } // descarta o job: nada a retentar
  if (p.status === 'enviado') return { resultado: 'confirmado', conversationId: null }
  if (p.status === 'rejeitado') return { resultado: 'rejeitado', mensagem: 'numero_sem_whatsapp' }
  if (!p.instancia_usada_id) return { resultado: 'rejeitado', mensagem: 'INSTANCIA_NAO_FIXADA' }

  const { data: insc } = await admin.from('promocao_inscricoes').select('nome, codigo').eq('id', p.inscricao_id).maybeSingle()
  if (!insc) return { resultado: 'rejeitado', mensagem: 'INSCRICAO_INEXISTENTE' }
  let texto: string
  if (p.tipo === 'servidor') {
    texto = textoAtendimentoServidor({ nome: insc.nome, codigo: insc.codigo })
  } else {
    const [{ data: ind }, { data: dor }] = await Promise.all([
      admin.from('promocao_indicacoes').select('numero').eq('id', p.indicacao_id).maybeSingle(),
      admin.from('promocao_indicadores').select('nome').eq('id', p.indicador_id).maybeSingle(),
    ])
    if (!ind || !dor) return { resultado: 'rejeitado', mensagem: 'INDICACAO_INEXISTENTE' }
    texto = textoAtendimentoIndicado({ nome: insc.nome, nomeIndicador: dor.nome, numeroIndicacao: ind.numero })
  }

  const chave = `atendimento:${pedidoId}`
  const r = await enviarWhatsappPorInstancia(
    { campanhaId: p.campanha_id, chave, tipo: p.tipo === 'servidor' ? 'atendimento_servidor' : 'atendimento_indicado', telefone: p.telefone_alvo, texto },
    p.instancia_usada_id,
  )
  const { data: envio } = await admin.from('promocao_envios').select('id').eq('chave', chave).maybeSingle()
  const status = mapearResultadoParaStatus(r)
  const patch: Record<string, unknown> = { status, envio_id: envio?.id ?? null }
  if (status === 'enviado') Object.assign(patch, { enviado_em: new Date().toISOString(), erro: null })
  else if (r.resultado !== 'confirmado') patch.erro = String(r.mensagem).slice(0, 200)
  await admin.from('promocao_pedidos_atendimento').update(patch).eq('id', pedidoId)
  if (status === 'enviado') await registrarEvento(admin, p.campanha_id, 'pedido_atendimento', pedidoId, 'atendimento.enviado', {})
  if (status === 'rejeitado') await registrarEvento(admin, p.campanha_id, 'pedido_atendimento', pedidoId, 'atendimento.rejeitado', { erro: String(patch.erro) })
  return r
}
