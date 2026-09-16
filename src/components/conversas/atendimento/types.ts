import type { ChatwootConversa, ChatwootMensagem } from '@/lib/central-conversas/chatwoot'
import type {
  ConversaMeta,
  ContatoMeta,
  EntidadeBusca,
  EntidadeTipo,
  GaleriaItem,
  HistoricoChamado,
  MensagemComExtras,
} from '@/lib/central-conversas/actions'
import type { AcaoAgendada } from '@/lib/central-conversas/agendamento-actions'
import type { RespostaRapidaRow } from '@/lib/central-conversas/respostas-rapidas-actions'

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

export type { ConversaMeta, ContatoMeta, EntidadeBusca, EntidadeTipo, GaleriaItem, HistoricoChamado, MensagemComExtras, AcaoAgendada, RespostaRapidaRow }

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

export function dataCurta(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('pt-BR')
}

/** Formato dd/mm/aaaa - hh:mm pro balão de cada mensagem na thread. */
export function dataHoraCompleta(ts: number) {
  return `${dataCurta(ts)} - ${horaCurta(ts)}`
}

export function iniciais(nome?: string | null) {
  const limpo = (nome || '?').trim()
  return limpo.slice(0, 1).toUpperCase() || '?'
}

export function previaConversa(c: ChatwootConversa) {
  const ultima = c.last_non_activity_message
  if (!ultima) return ''
  let corpo = ultima.content?.trim() || ''
  const reaction = ultima.content_attributes?.reaction as { emoji?: string } | undefined
  if (reaction?.emoji || (corpo && (corpo.startsWith('Reagiu ') || corpo.startsWith('Reagiu com ')))) {
    const emoji = reaction?.emoji || corpo?.replace(/^Reagiu\s*(com)?\s*/, '') || '❤️'
    corpo = `Reagiu com ${emoji}`
  } else if (ultima.content_attributes?.revoked || ultima.content_attributes?.deleted || (corpo && corpo.includes('🚫 Mensagem apagada'))) {
    corpo = '🚫 Mensagem apagada'
  } else {
    const primeiroAnexo = ultima.attachments?.[0]
    const ehAudioAnexo = primeiroAnexo?.file_type === 'audio' || primeiroAnexo?.file_type === 'voice'
    const ehAudioTexto = /^audio\.(ogg|mp3|wav|m4a|opus)$/i.test(corpo) || /\.(ogg|mp3|wav|m4a|opus)$/i.test(corpo) || (corpo === '[sem conteúdo]' && ehAudioAnexo)

    if (ehAudioAnexo || ehAudioTexto) {
      corpo = 'Enviou um áudio'
    } else if (primeiroAnexo?.file_type === 'image' || /^imagem\.(jpg|jpeg|png|webp|gif)$/i.test(corpo)) {
      corpo = '📷 Foto'
    } else if (primeiroAnexo?.file_type === 'video' || /^video\.(mp4|avi|mov|mkv|webm)$/i.test(corpo)) {
      corpo = '🎥 Vídeo'
    } else if (primeiroAnexo?.file_type === 'file' || primeiroAnexo?.file_type === 'document') {
      corpo = '📎 Anexo'
    } else if (!corpo || corpo === '[sem conteúdo]') {
      corpo = ''
    }
  }

  if (!corpo) return ''

  const ehMinha = ultima.message_type === 1 || (ultima.message_type as unknown) === 'outgoing' || ultima.sender?.type === 'user' || (ultima as any).from_me === true
  if (ehGrupo(c)) {
    const sender = ultima.content_attributes?.sender as { nome?: string; numero?: string } | undefined
    const nome = sender?.nome || sender?.numero
    if (nome) return `${nome}: ${corpo}`
  } else if (ehMinha) {
    return `Você: ${corpo}`
  }
  return corpo
}

/**
 * O engine cria o contato do Chatwoot com `identifier = "<instanciaId>:<jid>"`
 * (bridge.ts `garantirConversa`); grupo de WhatsApp = jid terminado em `@g.us`
 * (mesma regra do engine). O `-group` antigo nunca bateu com jid real.
 */
export function parseIdentifier(identifier?: string | null): { instanciaId: string; jid: string } | null {
  const s = String(identifier || '')
  const i = s.indexOf(':')
  if (i <= 0) return null
  return { instanciaId: s.slice(0, i), jid: s.slice(i + 1) }
}

export function ehGrupo(c: ChatwootConversa) {
  const sender = c.meta?.sender as { type?: string } | undefined
  return sender?.type === 'group' || (parseIdentifier(c.meta?.sender?.identifier)?.jid.endsWith('@g.us') ?? false)
}

export type { ChatwootConversa, ChatwootMensagem }
