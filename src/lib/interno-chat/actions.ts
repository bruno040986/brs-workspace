'use server'

/**
 * Server actions do chat Interno do BRS Messenger (workspace_chat_*), agora
 * com os kinds novos 'equipe' ("Equipe BRS") e 'self' ("Você") além dos
 * diretos. Autenticação por sessão (requireCurrentUser) + admin client — o
 * acesso a dados de verdade vive em ./data.ts, compartilhado com o cron de
 * lembretes da Agenda.
 */

import { requireCurrentUser } from '@/lib/auth/server'
import {
  abrirDireta,
  inserirMensagem,
  listarCanais,
  listarMensagens,
  type CanalInterno,
  type MensagemInterno,
} from './data'

export type { CanalInterno, MensagemInterno } from './data'

/** Ordem do contrato: "Você" primeiro, depois "Equipe BRS", depois diretos por atividade. */
export async function getCanaisInterno(): Promise<CanalInterno[]> {
  const user = await requireCurrentUser()
  return listarCanais(user.id)
}

/** Mensagens da conversa (asc); marca como lidas pro usuário da sessão. */
export async function getMensagensInterno(conversationId: string): Promise<MensagemInterno[]> {
  const user = await requireCurrentUser()
  return listarMensagens(user.id, String(conversationId))
}

/** Envia mensagem — insert normal em workspace_chat_messages (direct, equipe ou self). */
export async function enviarMensagemInterno(
  conversationId: string,
  texto: string,
  opts?: { textStyle?: MensagemInterno['text_style']; attachments?: MensagemInterno['attachments'] },
): Promise<MensagemInterno> {
  const user = await requireCurrentUser()
  return inserirMensagem(user.id, String(conversationId), texto, opts)
}

/** Abre (ou reaproveita) a conversa direta com outro usuário. */
export async function abrirConversaDireta(participantId: string): Promise<{ id: string }> {
  const user = await requireCurrentUser()
  return abrirDireta(user.id, String(participantId))
}
