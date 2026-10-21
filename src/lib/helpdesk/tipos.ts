/**
 * Tipos e constantes do HelpDesk — módulo NEUTRO (sem 'use server') de
 * propósito: um arquivo de server actions só pode exportar funções async;
 * constante exportada de lá chega ao cliente como referência quebrada e
 * derruba a página (aconteceu em 02/09/2026 no 1º deploy do HelpDesk).
 */

export const HELPDESK_SISTEMAS = [
  { id: 'workspace', label: 'BRS Workspace' },
  { id: 'alvoconsig', label: 'CRM AlvoConsig' },
  { id: 'clt_orchestrator', label: 'CLT (Orquestrador)' },
  { id: 'portal_parceiro', label: 'Portal Parceiro' },
  { id: 'outro', label: 'Outro' },
] as const

export type HelpdeskSistema = (typeof HELPDESK_SISTEMAS)[number]['id']

export const HELPDESK_TIPOS = [
  { id: 'bug', label: 'Bug', emoji: '🐞' },
  { id: 'melhoria', label: 'Melhoria', emoji: '💡' },
  { id: 'ajuste', label: 'Ajuste', emoji: '🔧' },
  { id: 'duvida', label: 'Dúvida', emoji: '❓' },
] as const

export type HelpdeskTipo = (typeof HELPDESK_TIPOS)[number]['id']

// 'impede' = antigo "urgente" (o trigger de notificação ainda lê `urgente`).
export const HELPDESK_PRIORIDADES = [
  { id: 'impede', label: 'Impede de trabalhar', cor: '#dc2626' },
  { id: 'atrapalha', label: 'Atrapalha', cor: '#d97706' },
  { id: 'sugestao', label: 'Sugestão', cor: '#6b7280' },
] as const

export type HelpdeskPrioridade = (typeof HELPDESK_PRIORIDADES)[number]['id']

export const HELPDESK_MAX_ANEXOS = 5
export const HELPDESK_IMAGEM_MIME: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** Anexo já enviado para /api/chat/upload, como vai para abrirHelpdeskTicket. */
export type HelpdeskAnexoEntrada = { path: string; name: string; size: number; type: string }

/** Anexo devolvido pela listagem (URL assinada gerada no servidor). */
export type HelpdeskAnexo = { id: string; nome: string; tipo: string; tamanho: number; url: string }

/** Capturado no navegador pelo botão "Reportar problema" (só Workspace). */
export type HelpdeskContextoTecnico = {
  url?: string
  pathname?: string
  titulo?: string
  user_agent?: string
  viewport?: string
  timestamp_cliente?: string
}

export type HelpdeskStatus = 'aberto' | 'plano_proposto' | 'aprovado' | 'rejeitado' | 'em_execucao' | 'concluido'

export type HelpdeskTicket = {
  id: string
  titulo: string
  descricao: string
  url: string
  menu_contexto: string
  sistema: HelpdeskSistema
  urgente: boolean
  tipo: HelpdeskTipo
  area: string
  prioridade: HelpdeskPrioridade
  contexto_tecnico: HelpdeskContextoTecnico | null
  anexos: HelpdeskAnexo[]
  status: HelpdeskStatus
  plano_proposto: string | null
  comentario_solucao: string | null
  aberto_por: string
  aberto_por_nome: string
  aprovado_por: string | null
  created_at: string
  plano_em: string | null
  aprovado_em: string | null
  concluido_em: string | null
}

export type HelpdeskComentario = {
  id: string
  autor_tipo: 'usuario' | 'claude'
  autor_id: string | null
  autor_nome: string
  texto: string
  created_at: string
}

/** Uma linha por mudança de status (trigger no banco). `por` null = Claude/sistema. */
export type HelpdeskHistorico = {
  id: string
  de: HelpdeskStatus | null
  para: HelpdeskStatus
  por: string | null
  por_nome: string
  plano_anterior: string | null
  solucao_anterior: string | null
  created_at: string
}

export type HelpdeskAba = 'todos' | 'meus' | 'aprovacao'
