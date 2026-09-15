'use server'

/**
 * Grupos de WhatsApp (Fase C do BRS Messenger — paridade Digisac).
 * Spec: docs/ROTEIRO-BRS-MESSENGER-FASE-C.md. Mesma permissão `conversas` das
 * demais actions de atendimento (sem permissão nova nesta fase).
 *
 * Regra de ouro: NUNCA ler `chat_instancias.papel`/`permite_grupos` — a única
 * capacidade que gateia grupo é `provedor === 'baileys'` (Z-API devolve 501
 * PROVEDOR_NAO_SUPORTADO, a UI esconde a aba/ações).
 */

import { requirePermission, requireCurrentUser } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { clienteChatwootBrs, contaBrs } from './actions'
import { engine, engineGrupos, mensagemErroEngine, type MembroGrupo, type ContatoConexao } from './engine'
import { parseIdentifier } from '@/components/conversas/atendimento/types'

function normalizarParticipante(input: string): string {
  const v = String(input || '').trim()
  if (v.endsWith('@g.us') || v.endsWith('@s.whatsapp.net') || v.includes('@')) return v
  const digitos = v.replace(/\D/g, '')
  if (digitos.length < 10) throw new Error(`Número inválido: ${input}`)
  return digitos.length <= 11 ? `55${digitos}` : digitos
}

/**
 * Resolve instância + jid a partir da conversa (NUNCA aceitar instanciaId/jid
 * vindos do cliente pra ações em conversa existente) e valida posse pela
 * conta BRS.
 */
async function grupoDaConversa(conversationId: number): Promise<{ instanciaId: string; jid: string }> {
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  const conversa = await cli.conversa(conversationId)
  const parsed = parseIdentifier(conversa.meta?.sender?.identifier)
  if (!parsed || !parsed.jid.endsWith('@g.us')) throw new Error('Esta conversa não é um grupo.')
  const admin = await createAdminClient()
  const conta = await contaBrs()
  if (!conta) throw new Error('Chatwoot não provisionado.')
  const { data: inst } = await admin
    .from('chat_instancias')
    .select('id, provedor')
    .eq('id', parsed.instanciaId)
    .eq('conta_id', conta.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!inst) throw new Error('Conexão do grupo não encontrada.')
  return { instanciaId: String(inst.id), jid: parsed.jid }
}

/** Valida posse de uma instância avulsa (sem conversa ainda) pela conta BRS. */
async function instanciaDaConta(instanciaId: string): Promise<{ id: string; provedor: string }> {
  const admin = await createAdminClient()
  const conta = await contaBrs()
  if (!conta) throw new Error('Chatwoot não provisionado.')
  const { data: inst } = await admin
    .from('chat_instancias')
    .select('id, provedor')
    .eq('id', instanciaId)
    .eq('conta_id', conta.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!inst) throw new Error('Conexão não encontrada.')
  return { id: String(inst.id), provedor: String(inst.provedor) }
}

export type GrupoDetalhado = {
  jid: string
  instanciaId: string
  nome: string
  descricao?: string
  foto?: string
  criado_em?: string
  dono?: string
  membros: MembroGrupo[]
  souAdmin: boolean
  provedor: string
}

/** Enriquece `membros[].nome` (vem `null` no metadata) com a lista de contatos da conexão — best-effort. */
async function enriquecerNomes(instanciaId: string, membros: MembroGrupo[]): Promise<MembroGrupo[]> {
  try {
    const { itens } = await engineGrupos.contatos(instanciaId, { limit: 200 })
    const porJid = new Map(itens.map((c) => [c.jid, c]))
    return membros.map((m) => (m.nome ? m : { ...m, nome: porJid.get(m.jid)?.nome ?? null }))
  } catch {
    return membros
  }
}

export async function getGrupo(conversationId: number): Promise<GrupoDetalhado> {
  await requirePermission('conversas', 'can_view')
  try {
    const { instanciaId, jid } = await grupoDaConversa(conversationId)
    const inst = await instanciaDaConta(instanciaId)
    const detalhe = await engineGrupos.grupo(instanciaId, jid)
    const membros = await enriquecerNomes(instanciaId, detalhe.membros || [])
    const souAdmin = membros.some((m) => m.eu && m.admin)
    return { ...detalhe, membros, souAdmin, provedor: inst.provedor, instanciaId }
  } catch (err) {
    throw new Error(mensagemErroEngine(err))
  }
}

export async function alterarParticipantes(conversationId: number, acao: 'add' | 'remove' | 'promote' | 'demote', jids: string[]): Promise<{ ok: boolean; resultado: Array<{ jid: string; status: string }> }> {
  await requirePermission('conversas', 'can_view')
  try {
    const { instanciaId, jid } = await grupoDaConversa(conversationId)
    const normalizados = (jids || []).map(normalizarParticipante)
    if (!normalizados.length) throw new Error('Selecione ao menos um participante.')
    return await engineGrupos.participantesGrupo(instanciaId, jid, { acao, jids: normalizados })
  } catch (err) {
    throw new Error(mensagemErroEngine(err))
  }
}

export async function linkConvite(conversationId: number): Promise<{ link: string }> {
  await requirePermission('conversas', 'can_view')
  try {
    const { instanciaId, jid } = await grupoDaConversa(conversationId)
    return await engineGrupos.convite(instanciaId, jid)
  } catch (err) {
    throw new Error(mensagemErroEngine(err))
  }
}

export async function sairDoGrupo(conversationId: number): Promise<{ ok: true }> {
  await requirePermission('conversas', 'can_view')
  const user = await requireCurrentUser()
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  try {
    const { instanciaId, jid } = await grupoDaConversa(conversationId)
    await engineGrupos.sairGrupo(instanciaId, jid)
    await cli.mudarStatus(conversationId, 'resolved')
    const { assinaturaDoUsuario } = await import('./actions')
    const assinatura = await assinaturaDoUsuario(user.id)
    await cli.notaInterna(conversationId, `Saímos do grupo por ${assinatura || user.email || 'usuário'}`)
    return { ok: true }
  } catch (err) {
    throw new Error(mensagemErroEngine(err))
  }
}

export async function buscarContatosConexao(instanciaId: string, q?: string, page?: number): Promise<{ itens: ContatoConexao[]; total: number; page: number }> {
  await requirePermission('conversas', 'can_view')
  try {
    await instanciaDaConta(instanciaId)
    return await engineGrupos.contatos(instanciaId, { q, page, limit: 50 })
  } catch (err) {
    throw new Error(mensagemErroEngine(err))
  }
}

export async function criarGrupo(input: { instanciaId: string; nome: string; participantes: string[]; mensagemInicial?: string }): Promise<{ jid: string; nome: string }> {
  await requirePermission('conversas', 'can_view')
  const user = await requireCurrentUser()
  try {
    const inst = await instanciaDaConta(input.instanciaId)
    if (inst.provedor !== 'baileys') throw new Error('Gestão de grupo só em conexões Baileys.')
    const nome = String(input.nome || '').trim()
    if (!nome) throw new Error('Dê um nome ao grupo.')
    const participantes = (input.participantes || []).map(normalizarParticipante)
    if (!participantes.length) throw new Error('Selecione ao menos um participante.')
    const criado = await engineGrupos.criarGrupo(inst.id, { nome, participantes })
    const mensagemInicial = String(input.mensagemInicial || '').trim()
    if (mensagemInicial) {
      const { assinaturaDoUsuario } = await import('./actions')
      const assinatura = await assinaturaDoUsuario(user.id)
      const texto = `*${assinatura}:*\n${mensagemInicial}`
      try {
        await engine.enviar(inst.id, criado.jid, texto, { operationId: globalThis.crypto.randomUUID() })
      } catch {
        // grupo já nasceu; a mensagem inicial é best-effort (fato 3 do roteiro)
      }
    }
    return criado
  } catch (err) {
    throw new Error(mensagemErroEngine(err))
  }
}
