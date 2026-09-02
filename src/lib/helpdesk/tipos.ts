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

export type HelpdeskStatus = 'aberto' | 'plano_proposto' | 'aprovado' | 'rejeitado' | 'em_execucao' | 'concluido'

export type HelpdeskTicket = {
  id: string
  titulo: string
  descricao: string
  url: string
  menu_contexto: string
  sistema: HelpdeskSistema
  urgente: boolean
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
