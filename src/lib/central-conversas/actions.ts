'use server'

/**
 * Central de Conversas (BRS) — configuração das instâncias/canais e leitura
 * das conversas do Chatwoot. Dono aqui é sempre a BRS (owner_tipo 'brs');
 * o parceiro tem o equivalente dentro do CRM AlvoConsig.
 */

import { revalidatePath } from 'next/cache'
import { requirePermission, requireCurrentUser, getCurrentUserEffectivePermissions } from '@/lib/auth/server'

/** Pro dock do BRS Messenger decidir se mostra a aba Atendimento. */
export async function podeAtenderConversas(): Promise<boolean> {
  try {
    const perms = await getCurrentUserEffectivePermissions()
    return perms.some((p) => p.resource_name === 'conversas' && Boolean(p.can_view))
  } catch {
    return false
  }
}
import { createAdminClient } from '@/lib/supabase/server'
import { cifrarJson, cofreConfigurado, decifrarTexto } from './cofre'
import { engine, engineConfigurado } from './engine'
import { ChatwootConta } from './chatwoot'

const LIMITE_INSTANCIAS_BRS = 3

export type InstanciaView = {
  id: string
  nome: string
  papel: 'receptiva' | 'disparo'
  provedor: 'baileys' | 'zapi'
  permite_grupos: boolean
  status: string
  numero: string | null
  nome_perfil: string | null
  ultimo_qr: string | null
  qr_atualizado_em: string | null
  ultimo_erro: string | null
  conectada_em: string | null
  chatwoot_inbox_id: number | null
  ordem: number
}

const COLS_VIEW = 'id, nome, papel, provedor, permite_grupos, status, numero, nome_perfil, ultimo_qr, qr_atualizado_em, ultimo_erro, conectada_em, chatwoot_inbox_id, ordem'

async function contaBrs() {
  const admin = await createAdminClient()
  const { data } = await admin.from('chat_contas').select('id, nome, chatwoot_account_id, token_cifrado').eq('owner_tipo', 'brs').maybeSingle()
  return data
}

async function clienteChatwootBrs(): Promise<ChatwootConta | null> {
  const conta = await contaBrs()
  if (!conta) return null
  return new ChatwootConta(Number(conta.chatwoot_account_id), decifrarTexto(String(conta.token_cifrado)))
}

export async function getCentralConversasView() {
  const { permissions } = await requirePermission('central-conversas', 'can_view')
  const canEdit = permissions.some((p) => p.resource_name === 'central-conversas' && Boolean(p.can_edit))
  const admin = await createAdminClient()
  const conta = await contaBrs()
  const { data: instancias } = conta
    ? await admin.from('chat_instancias').select(COLS_VIEW).eq('conta_id', conta.id).is('deleted_at', null).order('ordem').order('created_at')
    : { data: [] as InstanciaView[] }

  let inboxes: Array<{ id: number; name: string; channel_type: string; website_token?: string; phone_number?: string }> = []
  if (conta) {
    try {
      const cli = await clienteChatwootBrs()
      inboxes = (await cli?.listarInboxes()) || []
    } catch {
      inboxes = []
    }
  }

  return {
    can_edit: canEdit,
    cofreOk: cofreConfigurado(),
    engineOk: engineConfigurado() ? await engine.saude() : false,
    chatwootUrl: String(process.env.CHATWOOT_URL || 'https://chat.brspromotora.com.br'),
    conta: conta ? { nome: String(conta.nome), chatwootAccountId: Number(conta.chatwoot_account_id) } : null,
    instancias: (instancias || []) as InstanciaView[],
    limite: LIMITE_INSTANCIAS_BRS,
    inboxes,
  }
}

export async function criarInstanciaBrs(input: { nome: string; provedor: 'baileys' | 'zapi'; zapi?: { instanceId: string; token: string; clientToken?: string } }) {
  await requirePermission('central-conversas', 'can_edit')
  const admin = await createAdminClient()
  const conta = await contaBrs()
  if (!conta) throw new Error('Chatwoot da BRS ainda não foi provisionado.')
  const nome = String(input.nome || '').trim().slice(0, 60)
  if (!nome) throw new Error('Dê um nome à instância (ex.: Suporte, Financeiro).')

  const { count } = await admin.from('chat_instancias').select('id', { count: 'exact', head: true }).eq('conta_id', conta.id).is('deleted_at', null)
  if ((count || 0) >= LIMITE_INSTANCIAS_BRS) throw new Error(`Limite de ${LIMITE_INSTANCIAS_BRS} instâncias por QR Code na BRS.`)

  let credencial: string | null = null
  if (input.provedor === 'zapi') {
    const z = input.zapi
    if (!z?.instanceId || !z?.token) throw new Error('Informe o ID da instância e o token da Z-API.')
    if (!cofreConfigurado()) throw new Error('Cofre não configurado.')
    credencial = cifrarJson({ instanceId: z.instanceId.trim(), token: z.token.trim(), clientToken: (z.clientToken || '').trim() || undefined })
  }

  const { data, error } = await admin
    .from('chat_instancias')
    .insert({
      conta_id: conta.id,
      owner_tipo: 'brs',
      nome,
      papel: 'receptiva',
      provedor: input.provedor,
      permite_grupos: true,
      credencial_cifrada: credencial,
      ordem: (count || 0) + 1,
    })
    .select('id')
    .single()
  if (error) throw error
  revalidatePath('/central-conversas')
  return { id: String(data.id) }
}

export async function conectarInstancia(instanciaId: string) {
  await requirePermission('central-conversas', 'can_edit')
  const res = await engine.conectar(instanciaId)
  revalidatePath('/central-conversas')
  return res
}

export async function statusInstancia(instanciaId: string) {
  await requirePermission('central-conversas', 'can_view')
  const admin = await createAdminClient()
  const { data } = await admin.from('chat_instancias').select(COLS_VIEW).eq('id', instanciaId).is('deleted_at', null).maybeSingle()
  if (!data) throw new Error('Instância não encontrada.')
  return data as InstanciaView
}

export async function desconectarInstancia(instanciaId: string) {
  await requirePermission('central-conversas', 'can_edit')
  await engine.desconectar(instanciaId, true)
  revalidatePath('/central-conversas')
  return { ok: true }
}

export async function excluirInstancia(instanciaId: string) {
  await requirePermission('central-conversas', 'can_edit')
  const admin = await createAdminClient()
  try {
    await engine.desconectar(instanciaId, true)
  } catch {
    // engine fora do ar: ainda assim marca como excluída
  }
  const { error } = await admin.from('chat_instancias').update({ deleted_at: new Date().toISOString(), status: 'desconectada', sessao_cifrada: null }).eq('id', instanciaId)
  if (error) throw error
  revalidatePath('/central-conversas')
  return { ok: true }
}

export async function conectar360dialog(input: { nome: string; telefone: string; apiKey: string }) {
  await requirePermission('central-conversas', 'can_edit')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot da BRS ainda não foi provisionado.')
  const telefone = String(input.telefone || '').replace(/\D/g, '')
  if (!telefone || !input.apiKey?.trim()) throw new Error('Informe o número e a API key da 360dialog.')
  const inbox = await cli.criarInbox360dialog({ nome: String(input.nome || 'WhatsApp Oficial').trim(), telefone: `+${telefone}`, apiKey: input.apiKey.trim() })
  revalidatePath('/central-conversas')
  return { inboxId: inbox.id }
}

export async function criarChatDeSite(input: { nome: string; siteUrl: string }) {
  await requirePermission('central-conversas', 'can_edit')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot da BRS ainda não foi provisionado.')
  const inbox = await cli.criarInboxSite({ nome: String(input.nome || 'Chat do site').trim(), siteUrl: String(input.siteUrl || '').trim() })
  revalidatePath('/central-conversas')
  return { inboxId: inbox.id, websiteToken: inbox.website_token }
}

// ---------------------------------------------------------------------------
// Atendimento (Central de Conversas / dock do BRS Messenger)
// ---------------------------------------------------------------------------
export async function getConversas(params: { aba: 'meus' | 'fila' | 'geral'; q?: string; page?: number }) {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) return { disponivel: false as const, conversas: [], meta: {} }
  const assigneeType = params.aba === 'meus' ? 'me' : params.aba === 'fila' ? 'unassigned' : 'all'
  const data = await cli.listarConversas({ status: 'open', assigneeType, q: params.q, page: params.page })
  return { disponivel: true as const, conversas: data.payload, meta: data.meta }
}

export async function getMensagens(conversationId: number, before?: number) {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  return cli.mensagens(conversationId, before)
}

export async function responderConversa(conversationId: number, content: string) {
  await requirePermission('conversas', 'can_view')
  const user = await requireCurrentUser()
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  const texto = String(content || '').trim()
  if (!texto) throw new Error('Mensagem vazia.')
  void user
  return cli.enviarMensagem(conversationId, texto)
}

export async function assumirConversa(conversationId: number, agenteId: number | null) {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  await cli.atribuir(conversationId, agenteId)
  return { ok: true }
}

export async function resolverConversa(conversationId: number) {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  await cli.mudarStatus(conversationId, 'resolved')
  return { ok: true }
}

export async function getAgentesChat() {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) return []
  return cli.agentes()
}
