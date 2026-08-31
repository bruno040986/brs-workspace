/**
 * Chat Interno (BRS Messenger) — acesso a dados das tabelas workspace_chat_*.
 *
 * Fatorado do data layer que vivia espalhado nas rotas /api/chat/* pra servir
 * dois consumidores: o GoogleChatComponent atual (que segue nas rotas, agora
 * restritas a kind 'direct') e a nova UI do Messenger via as server actions de
 * `./actions.ts`, que enxergam também os kinds novos 'equipe' (grupo fixo
 * "Equipe BRS") e 'self' (canal pessoal "Você", que recebe lembretes da
 * Agenda). Este arquivo NÃO é 'use server' de propósito: as funções recebem
 * userId e usam o admin client — quem expõe pra fora (actions.ts, cron de
 * lembretes) é responsável pela autenticação.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { deriveChatStatus, type ChatPresenceRecord, type ChatStatus } from '@/lib/chat/presence'
import { CHAT_ATTACHMENT_BUCKET, CHAT_SIGNED_URL_TTL, chatAttachmentPath, type ChatAttachment } from '@/lib/chat/attachments'

export const NOME_CANAL_EQUIPE = 'Equipe BRS'
export const NOME_CANAL_SELF = 'Você'
export const PREFIXO_LEMBRETE = '⏰ Lembrete: '

export type CanalInternoKind = 'self' | 'equipe' | 'direct'

export type CanalInterno = {
  id: string
  kind: CanalInternoKind
  nome: string
  avatarUrl: string | null
  participante: {
    id: string
    email: string
    full_name?: string
    nickname?: string | null
    status?: ChatStatus
    status_message?: string | null
  } | null
  lastMessage: { id: string; text: string; timestamp: string; senderId: string } | null
  unreadCount: number
}

export type MensagemInterno = {
  id: string
  text: string
  timestamp: string
  sender: { id: string; email: string; full_name?: string }
  text_style: { bold?: boolean; italic?: boolean; underline?: boolean } | null
  attachments: ChatAttachment[]
  delivery_status: 'sent' | 'read' | null
}

type Admin = Awaited<ReturnType<typeof createAdminClient>>

const JANELA_MENSAGENS_DIAS = 90
const LIMITE_MENSAGENS_LISTA = 2000

async function assinarAnexos(admin: Admin, raw: unknown): Promise<ChatAttachment[]> {
  const lista = Array.isArray(raw) ? (raw as ChatAttachment[]) : []
  return Promise.all(
    lista.map(async (att) => {
      const path = chatAttachmentPath(att)
      if (!path) return att
      const { data: signed } = await admin.storage.from(CHAT_ATTACHMENT_BUCKET).createSignedUrl(path, CHAT_SIGNED_URL_TTL)
      return { ...att, url: signed?.signedUrl || att.url }
    }),
  )
}

/**
 * Canais do usuário na ordem do contrato: "Você" primeiro, depois "Equipe BRS",
 * depois diretos por última atividade.
 */
export async function listarCanais(userId: string): Promise<CanalInterno[]> {
  const admin = await createAdminClient()

  const { data: meus, error: errMeus } = await admin
    .from('workspace_chat_participants')
    .select('conversation_id, last_read_at')
    .eq('user_id', userId)
  if (errMeus) throw errMeus
  const conversationIds = (meus || []).map((p) => String(p.conversation_id))
  if (!conversationIds.length) return []
  const lastReadPorConversa = new Map((meus || []).map((p) => [String(p.conversation_id), p.last_read_at as string | null]))

  const { data: conversas, error: errConv } = await admin
    .from('workspace_chat_conversations')
    .select('id, kind, created_by')
    .in('id', conversationIds)
  if (errConv) throw errConv

  const diretas = (conversas || []).filter((c) => c.kind === 'direct').map((c) => String(c.id))

  // Outro participante de cada conversa direta (equipe tem N; self só eu).
  let outroPorConversa = new Map<string, string>()
  if (diretas.length) {
    const { data: outros } = await admin
      .from('workspace_chat_participants')
      .select('conversation_id, user_id')
      .in('conversation_id', diretas)
      .neq('user_id', userId)
    outroPorConversa = new Map((outros || []).map((p) => [String(p.conversation_id), String(p.user_id)]))
  }

  const outrosIds = [...new Set(outroPorConversa.values())]
  const [{ data: usuarios }, { data: perfis }] = await Promise.all([
    outrosIds.length ? admin.from('users').select('id, name, email, avatar_url').in('id', outrosIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string | null; email: string | null; avatar_url: string | null }> }),
    outrosIds.length
      ? admin
          .from('workspace_chat_user_profiles')
          .select('user_id, nickname, status, status_message, last_seen_at, last_interaction_at, is_visible, has_focus')
          .in('user_id', outrosIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ])
  const usuarioPorId = new Map((usuarios || []).map((u) => [String(u.id), u]))
  type PerfilRow = { user_id: string; nickname?: string | null; status_message?: string | null } & ChatPresenceRecord
  const perfilPorId = new Map(((perfis || []) as PerfilRow[]).map((p) => [String(p.user_id), p]))

  // Última mensagem + não lidas (mesmo corte de janela do data layer antigo,
  // pra não reler o histórico inteiro a cada poll).
  const desdeIso = new Date(Date.now() - JANELA_MENSAGENS_DIAS * 24 * 60 * 60 * 1000).toISOString()
  const { data: mensagens, error: errMsg } = await admin
    .from('workspace_chat_messages')
    .select('id, conversation_id, sender_id, body, created_at')
    .in('conversation_id', conversationIds)
    .gte('created_at', desdeIso)
    .order('created_at', { ascending: false })
    .limit(LIMITE_MENSAGENS_LISTA)
  if (errMsg) throw errMsg

  const porConversa = new Map<string, Array<{ id: string; sender_id: string; body: string; created_at: string }>>()
  for (const m of mensagens || []) {
    const arr = porConversa.get(String(m.conversation_id)) || []
    arr.push(m)
    porConversa.set(String(m.conversation_id), arr)
  }

  const agora = Date.now()
  const canais: CanalInterno[] = []
  for (const conv of conversas || []) {
    const id = String(conv.id)
    const kind = (conv.kind === 'equipe' || conv.kind === 'self' ? conv.kind : 'direct') as CanalInternoKind
    const msgs = porConversa.get(id) || []
    const ultima = msgs[0]
    const lastReadAt = lastReadPorConversa.get(id)
    const naoLidas = msgs.filter((m) => {
      // No canal self tudo é "meu" (lembretes entram com sender = o dono);
      // o não lido é qualquer mensagem depois do último acesso.
      if (kind !== 'self' && m.sender_id === userId) return false
      if (!lastReadAt) return true
      return new Date(m.created_at).getTime() > new Date(lastReadAt).getTime()
    }).length

    if (kind === 'self') {
      canais.push({ id, kind, nome: NOME_CANAL_SELF, avatarUrl: null, participante: null, lastMessage: ultima ? { id: ultima.id, text: ultima.body, timestamp: ultima.created_at, senderId: ultima.sender_id } : null, unreadCount: naoLidas })
      continue
    }
    if (kind === 'equipe') {
      canais.push({ id, kind, nome: NOME_CANAL_EQUIPE, avatarUrl: null, participante: null, lastMessage: ultima ? { id: ultima.id, text: ultima.body, timestamp: ultima.created_at, senderId: ultima.sender_id } : null, unreadCount: naoLidas })
      continue
    }

    const outroId = outroPorConversa.get(id)
    const outro = outroId ? usuarioPorId.get(outroId) : undefined
    if (!outro) continue
    const perfil = perfilPorId.get(String(outro.id))
    canais.push({
      id,
      kind: 'direct',
      nome: String((perfil?.nickname as string | null) || outro.name || outro.email || ''),
      avatarUrl: outro.avatar_url || null,
      participante: {
        id: String(outro.id),
        email: String(outro.email || ''),
        full_name: outro.name || undefined,
        nickname: perfil?.nickname || null,
        status: deriveChatStatus(perfil, agora),
        status_message: perfil?.status_message || null,
      },
      lastMessage: ultima ? { id: ultima.id, text: ultima.body, timestamp: ultima.created_at, senderId: ultima.sender_id } : null,
      unreadCount: naoLidas,
    })
  }

  const peso = (c: CanalInterno) => (c.kind === 'self' ? 2 : c.kind === 'equipe' ? 1 : 0)
  const atividade = (c: CanalInterno) => (c.lastMessage ? new Date(c.lastMessage.timestamp).getTime() : 0)
  canais.sort((a, b) => peso(b) - peso(a) || atividade(b) - atividade(a) || a.nome.localeCompare(b.nome))
  return canais
}

async function conferirParticipacao(admin: Admin, userId: string, conversationId: string): Promise<{ kind: CanalInternoKind }> {
  const { data: participacao } = await admin
    .from('workspace_chat_participants')
    .select('conversation_id')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!participacao) throw new Error('Você não participa desta conversa.')
  const { data: conv } = await admin.from('workspace_chat_conversations').select('kind').eq('id', conversationId).maybeSingle()
  const kind = conv?.kind === 'equipe' || conv?.kind === 'self' ? conv.kind : 'direct'
  return { kind: kind as CanalInternoKind }
}

/** Mensagens da conversa (asc) e marca como lidas pro usuário. */
export async function listarMensagens(userId: string, conversationId: string): Promise<MensagemInterno[]> {
  const admin = await createAdminClient()
  const { kind } = await conferirParticipacao(admin, userId, conversationId)

  // "lido pelo outro" só faz sentido no 1-a-1.
  let lidoPeloOutroAte: string | null = null
  if (kind === 'direct') {
    const { data: outro } = await admin
      .from('workspace_chat_participants')
      .select('last_read_at')
      .eq('conversation_id', conversationId)
      .neq('user_id', userId)
      .maybeSingle()
    lidoPeloOutroAte = (outro?.last_read_at as string | null) || null
  }

  const { data: mensagens, error } = await admin
    .from('workspace_chat_messages')
    .select('id, sender_id, body, created_at, text_style, attachments')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw error

  const senderIds = [...new Set((mensagens || []).map((m) => String(m.sender_id)))]
  const { data: usuarios } = senderIds.length
    ? await admin.from('users').select('id, name, email').in('id', senderIds)
    : { data: [] as Array<{ id: string; name: string | null; email: string | null }> }
  const usuarioPorId = new Map((usuarios || []).map((u) => [String(u.id), u]))

  const resultado = await Promise.all(
    (mensagens || []).map(async (m) => {
      const sender = usuarioPorId.get(String(m.sender_id))
      const minha = String(m.sender_id) === userId
      const lida = minha && kind === 'direct' && Boolean(lidoPeloOutroAte) && new Date(m.created_at).getTime() <= new Date(lidoPeloOutroAte || 0).getTime()
      return {
        id: String(m.id),
        text: String(m.body),
        timestamp: String(m.created_at),
        sender: { id: String(sender?.id || m.sender_id), email: String(sender?.email || ''), full_name: sender?.name || undefined },
        text_style: (m.text_style as MensagemInterno['text_style']) || null,
        attachments: await assinarAnexos(admin, m.attachments),
        delivery_status: minha ? (lida ? ('read' as const) : ('sent' as const)) : null,
      }
    }),
  )

  await admin
    .from('workspace_chat_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)

  return resultado
}

/** Insert normal em workspace_chat_messages (vale pra direct, equipe e self). */
export async function inserirMensagem(
  userId: string,
  conversationId: string,
  texto: string,
  opts?: { textStyle?: MensagemInterno['text_style']; attachments?: ChatAttachment[] },
): Promise<MensagemInterno> {
  const admin = await createAdminClient()
  await conferirParticipacao(admin, userId, conversationId)
  const corpo = String(texto || '').trim()
  if (!corpo) throw new Error('Mensagem vazia.')

  const { data: inserida, error } = await admin
    .from('workspace_chat_messages')
    .insert({
      conversation_id: conversationId,
      sender_id: userId,
      body: corpo,
      text_style: opts?.textStyle || null,
      attachments: Array.isArray(opts?.attachments) ? opts?.attachments : [],
    })
    .select('id, body, created_at, text_style, attachments')
    .single()
  if (error) throw error

  await admin
    .from('workspace_chat_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)

  const { data: sender } = await admin.from('users').select('id, name, email').eq('id', userId).maybeSingle()
  return {
    id: String(inserida.id),
    text: String(inserida.body),
    timestamp: String(inserida.created_at),
    sender: { id: userId, email: String(sender?.email || ''), full_name: sender?.name || undefined },
    text_style: (inserida.text_style as MensagemInterno['text_style']) || null,
    attachments: Array.isArray(inserida.attachments) ? (inserida.attachments as ChatAttachment[]) : [],
    delivery_status: 'sent',
  }
}

/** Abre (ou acha) a conversa direta com outro usuário. */
export async function abrirDireta(userId: string, participantId: string): Promise<{ id: string }> {
  if (!participantId || participantId === userId) throw new Error('Participante inválido.')
  const admin = await createAdminClient()

  const { data: minhas } = await admin.from('workspace_chat_participants').select('conversation_id').eq('user_id', userId)
  const minhasIds = (minhas || []).map((p) => String(p.conversation_id))
  if (minhasIds.length) {
    // Só conversas 'direct' contam — equipe tem nós dois e não é a mesma coisa.
    const { data: diretas } = await admin.from('workspace_chat_conversations').select('id').eq('kind', 'direct').in('id', minhasIds)
    const diretasIds = (diretas || []).map((c) => String(c.id))
    if (diretasIds.length) {
      const { data: emComum } = await admin
        .from('workspace_chat_participants')
        .select('conversation_id')
        .eq('user_id', participantId)
        .in('conversation_id', diretasIds)
      const existente = emComum?.[0]?.conversation_id
      if (existente) return { id: String(existente) }
    }
  }

  const { data: conversa, error } = await admin.from('workspace_chat_conversations').insert({ created_by: userId, kind: 'direct' }).select('id').single()
  if (error) throw error
  const { error: errPart } = await admin.from('workspace_chat_participants').insert([
    { conversation_id: conversa.id, user_id: userId, last_read_at: new Date().toISOString() },
    { conversation_id: conversa.id, user_id: participantId },
  ])
  if (errPart) throw errPart
  return { id: String(conversa.id) }
}

/** Canal 'self' do usuário; cria se ainda não existir (usuários pré-migração). */
export async function garantirCanalSelf(userId: string): Promise<string> {
  const admin = await createAdminClient()
  const { data: minhas } = await admin.from('workspace_chat_participants').select('conversation_id').eq('user_id', userId)
  const ids = (minhas || []).map((p) => String(p.conversation_id))
  if (ids.length) {
    const { data: selfConv } = await admin.from('workspace_chat_conversations').select('id').eq('kind', 'self').in('id', ids).limit(1).maybeSingle()
    if (selfConv) return String(selfConv.id)
  }
  const { data: criada, error } = await admin.from('workspace_chat_conversations').insert({ created_by: userId, kind: 'self' }).select('id').single()
  if (error) throw error
  await admin.from('workspace_chat_participants').insert({ conversation_id: criada.id, user_id: userId })
  return String(criada.id)
}

/**
 * Entrega um lembrete da Agenda no canal "Você" do usuário: mensagem normal
 * com body "⏰ Lembrete: ..." e sender = o próprio dono. Idempotente por
 * (conversa, corpo) — retry de job não duplica o mesmo lembrete.
 */
export async function entregarLembreteSelf(userId: string, corpo: string): Promise<{ entregue: boolean }> {
  const admin = await createAdminClient()
  const conversationId = await garantirCanalSelf(userId)
  const body = `${PREFIXO_LEMBRETE}${String(corpo || '').trim()}`
  const { data: jaExiste } = await admin
    .from('workspace_chat_messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('sender_id', userId)
    .eq('body', body)
    .limit(1)
    .maybeSingle()
  if (jaExiste) return { entregue: false }
  const { error } = await admin.from('workspace_chat_messages').insert({ conversation_id: conversationId, sender_id: userId, body })
  if (error) throw error
  return { entregue: true }
}
