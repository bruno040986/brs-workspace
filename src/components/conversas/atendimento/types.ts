import type { ChatwootConversa, ChatwootMensagem } from '@/lib/central-conversas/chatwoot'
import type { ConversaMeta, EntidadeBusca, EntidadeTipo } from '@/lib/central-conversas/actions'

/**
 * Tipos compartilhados pelos blocos reutilizáveis de Atendimento
 * (ListaConversas / ThreadConversa / PainelContato / AtendimentoCompleto /
 * AtendimentoCompacto). `EntidadeTipo`/`ConversaMeta`/`EntidadeBusca` vêm
 * direto de `src/lib/central-conversas/actions.ts` (fonte da verdade); só os
 * tipos de apoio puramente visuais nascem aqui.
 */

export type ConversaAtendimento = ChatwootConversa & {
  atendimentoMeta: ConversaMeta | null
}

export type AgenteChat = { id: number; name: string }

export type TagConta = { titulo: string; cor: string | null }

export type RespostaRapida = { id: number; atalho: string; conteudo: string }

export type InboxAtendimento = { id: number; nome: string; tipo: string }
export type InstanciaAtendimento = {
  id: string
  nome: string
  inboxId: number | null
  papel: 'receptiva' | 'disparo'
  provedor: 'baileys' | 'zapi'
  status: string
}

export type { ConversaMeta, EntidadeBusca, EntidadeTipo }

export const VINCULO_LABEL: Record<EntidadeTipo, string> = {
  parceiro: 'Parceiro',
  instituicao: 'Instituição',
  promotora: 'Promotora',
}

export const VINCULO_COR: Record<EntidadeTipo, { bg: string; text: string }> = {
  parceiro: { bg: 'rgba(0,120,215,0.14)', text: '#0f4c81' },
  instituicao: { bg: 'rgba(22,163,74,0.14)', text: '#15803d' },
  promotora: { bg: 'rgba(100,116,139,0.18)', text: '#475569' },
}

export function horaCurta(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function iniciais(nome?: string | null) {
  const limpo = (nome || '?').trim()
  return limpo.slice(0, 1).toUpperCase() || '?'
}

export function previaConversa(c: ChatwootConversa) {
  const ultima = c.last_non_activity_message
  if (!ultima) return ''
  if (ultima.content) return ultima.content
  if (ultima.attachments?.length) {
    const tipo = ultima.attachments[0].file_type
    return tipo === 'image' ? '📷 Foto' : tipo === 'audio' ? '🎤 Áudio' : '📎 Anexo'
  }
  return ''
}

export function ehGrupo(c: ChatwootConversa) {
  // Chatwoot marca conversas de grupo com identifier composto ou sender do tipo "group";
  // como o cliente pode não expor isso ainda, checamos os dois formatos possíveis.
  const sender = c.meta?.sender as { type?: string } | undefined
  return sender?.type === 'group' || String(c.meta?.sender?.identifier || '').includes('-group')
}

export type { ChatwootConversa, ChatwootMensagem }
