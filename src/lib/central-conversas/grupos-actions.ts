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
import { engine, engineGrupos, EngineEnvioIncertoError, mensagemErroEngine, type MembroGrupo, type ContatoConexao } from './engine'
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
  const r = await destinoDaConversa(conversationId)
  if (!r.jid.endsWith('@g.us')) throw new Error('Esta conversa não é um grupo.')
  return r
}

async function destinoDaConversa(conversationId: number): Promise<{ instanciaId: string; jid: string }> {
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  const conversa = await cli.conversa(conversationId)
  const parsed = parseIdentifier(conversa.meta?.sender?.identifier)
  if (!parsed) throw new Error('Esta conversa não tem conexão de WhatsApp associada.')
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

export async function getGrupo(conversationId: number): Promise<{ ok: true; grupo: GrupoDetalhado } | { ok: false; error: string }> {
  try {
    await requirePermission('conversas', 'can_view')
    const { instanciaId, jid } = await grupoDaConversa(conversationId)
    const inst = await instanciaDaConta(instanciaId)
    const detalhe = await engineGrupos.grupo(instanciaId, jid)
    const membros = await enriquecerNomes(instanciaId, detalhe.membros || [])
    const souAdmin = membros.some((m) => m.eu && m.admin)
    return { ok: true, grupo: { ...detalhe, membros, souAdmin, provedor: inst.provedor, instanciaId } }
  } catch (err) {
    return { ok: false, error: mensagemErroEngine(err) }
  }
}

export async function alterarParticipantes(conversationId: number, acao: 'add' | 'remove' | 'promote' | 'demote', jids: string[]): Promise<{ ok: true; resultado: Array<{ jid: string; status: string }> } | { ok: false; error: string }> {
  try {
    await requirePermission('conversas', 'can_view')
    const { instanciaId, jid } = await grupoDaConversa(conversationId)
    const normalizados = (jids || []).map(normalizarParticipante)
    if (!normalizados.length) throw new Error('Selecione ao menos um participante.')
    const resultado = await engineGrupos.participantesGrupo(instanciaId, jid, { acao, jids: normalizados })
    return { ok: true, resultado: resultado.resultado }
  } catch (err) {
    return { ok: false, error: mensagemErroEngine(err) }
  }
}

export async function linkConvite(conversationId: number): Promise<{ ok: true; link: string } | { ok: false; error: string }> {
  try {
    await requirePermission('conversas', 'can_view')
    const { instanciaId, jid } = await grupoDaConversa(conversationId)
    const { link } = await engineGrupos.convite(instanciaId, jid)
    return { ok: true, link }
  } catch (err) {
    return { ok: false, error: mensagemErroEngine(err) }
  }
}

/** Nome, descrição e/ou foto (JPEG em base64, já reduzido pela tela). Só o que vier preenchido é alterado. */
export async function atualizarGrupoConversa(conversationId: number, dados: { nome?: string; descricao?: string; fotoBase64?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requirePermission('conversas', 'can_view')
    const { instanciaId, jid } = await grupoDaConversa(conversationId)
    await engineGrupos.atualizarGrupo(instanciaId, jid, dados)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: mensagemErroEngine(err) }
  }
}

/** Invalida o link de convite atual e devolve o novo. */
export async function revogarLinkConvite(conversationId: number): Promise<{ ok: true; link: string } | { ok: false; error: string }> {
  try {
    await requirePermission('conversas', 'can_view')
    const { instanciaId, jid } = await grupoDaConversa(conversationId)
    const { link } = await engineGrupos.revogarConvite(instanciaId, jid)
    return { ok: true, link }
  } catch (err) {
    return { ok: false, error: mensagemErroEngine(err) }
  }
}

export type EnvioEspecial =
  | { tipo: 'localizacao'; lat: number; lng: number; nome?: string; endereco?: string }
  | { tipo: 'contato'; nome: string; telefone: string }
  | { tipo: 'enquete'; pergunta: string; opcoes: string[]; multipla?: boolean }
  | { tipo: 'figurinha'; imagemBase64: string }
  | { tipo: 'visualizacaoUnica'; imagemBase64: string }

/**
 * B2 (lote 2): mensagem especial na conversa aberta (Baileys). `operationId`
 * nasce na intenção do usuário (Lote 02B) — repetir o clique com a mesma chave
 * não duplica. Sem assinatura: localização/contato/enquete/figurinha não têm texto livre.
 */
export async function enviarEspecialConversa(conversationId: number, envio: EnvioEspecial, operationId: string): Promise<{ ok: true } | { ok: false; error: string; incerto?: boolean }> {
  try {
    await requirePermission('conversas', 'can_view')
    const { instanciaId, jid } = await destinoDaConversa(conversationId)
    const inst = await instanciaDaConta(instanciaId)
    if (inst.provedor !== 'baileys') throw new Error('Este tipo de mensagem só funciona em conexões Baileys.')
    if (envio.tipo === 'visualizacaoUnica') await engine.enviar(inst.id, jid, '', { operationId, imagemBase64: envio.imagemBase64, visualizacaoUnica: true })
    else await engine.enviar(inst.id, jid, '', { operationId, especial: envio })
    return { ok: true }
  } catch (err) {
    if (err instanceof EngineEnvioIncertoError) return { ok: false, incerto: true, error: 'Não foi possível confirmar se a mensagem saiu. Confira a conversa antes de tentar de novo.' }
    return { ok: false, error: mensagemErroEngine(err) }
  }
}

export async function sairDoGrupo(conversationId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requirePermission('conversas', 'can_view')
    const user = await requireCurrentUser()
    const cli = await clienteChatwootBrs()
    if (!cli) throw new Error('Chatwoot não provisionado.')
    const { instanciaId, jid } = await grupoDaConversa(conversationId)
    await engineGrupos.sairGrupo(instanciaId, jid)
    await cli.mudarStatus(conversationId, 'resolved')
    const { assinaturaDoUsuario } = await import('./actions')
    const assinatura = await assinaturaDoUsuario(user.id)
    await cli.notaInterna(conversationId, `Saímos do grupo por ${assinatura || user.email || 'usuário'}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: mensagemErroEngine(err) }
  }
}

export async function buscarContatosConexao(instanciaId: string, q?: string, page?: number): Promise<{ ok: true; itens: ContatoConexao[]; total: number; page: number } | { ok: false; error: string }> {
  try {
    await requirePermission('conversas', 'can_view')
    await instanciaDaConta(instanciaId)
    const resultado = await engineGrupos.contatos(instanciaId, { q, page, limit: 50 })
    return { ok: true, ...resultado }
  } catch (err) {
    return { ok: false, error: mensagemErroEngine(err) }
  }
}

export async function criarGrupo(input: { instanciaId: string; nome: string; participantes: string[]; mensagemInicial?: string }): Promise<{ ok: true; jid: string; nome: string; conversationId: number | null } | { ok: false; error: string }> {
  try {
    await requirePermission('conversas', 'can_view')
    const user = await requireCurrentUser()
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
    return { ok: true, jid: criado.jid, nome: criado.nome, conversationId: criado.chatwootConversationId ?? null }
  } catch (err) {
    return { ok: false, error: mensagemErroEngine(err) }
  }
}
