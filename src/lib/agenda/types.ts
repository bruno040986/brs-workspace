export type AgendaItemType = 'tarefa' | 'reuniao_virtual' | 'reuniao_presencial' | 'evento_externo'
export type AgendaPriority = 'alta' | 'media' | 'baixa'
export type AgendaTaskStatus = 'pendente' | 'em_andamento' | 'aguardando' | 'feito'
export type AgendaVisibility = 'publica' | 'privada'
export type AgendaMeetingLinkMode = 'nenhum' | 'gerar_meet' | 'externo'

export const AGENDA_ITEM_TYPES: Array<{ value: AgendaItemType; label: string; color: string }> = [
  { value: 'tarefa', label: 'Tarefa', color: '#2563eb' },
  { value: 'reuniao_virtual', label: 'Reunião virtual', color: '#7c3aed' },
  { value: 'reuniao_presencial', label: 'Reunião presencial', color: '#0d9488' },
  { value: 'evento_externo', label: 'Evento externo / visita', color: '#ea580c' },
]

export const AGENDA_PRIORITIES: Array<{ value: AgendaPriority; label: string; color: string; order: number }> = [
  { value: 'alta', label: 'Alta', color: '#dc2626', order: 0 },
  { value: 'media', label: 'Média', color: '#d97706', order: 1 },
  { value: 'baixa', label: 'Baixa', color: '#16a34a', order: 2 },
]

export const AGENDA_TASK_STATUSES: Array<{ value: AgendaTaskStatus; label: string }> = [
  { value: 'pendente', label: 'Pendente' },
  { value: 'em_andamento', label: 'Em andamento' },
  { value: 'aguardando', label: 'Aguardando' },
  { value: 'feito', label: 'Feito' },
]

// Registros do Workspace que aceitam vínculo com um item de agenda.
export const AGENDA_LINK_ENTITY_TYPES: Array<{ value: string; label: string; table: string; nameColumn: string }> = [
  { value: 'financial_institution', label: 'Instituição Financeira', table: 'financial_institutions', nameColumn: 'name' },
  { value: 'promotora', label: 'Promotora', table: 'promotoras', nameColumn: 'razao_social' },
  { value: 'agente_parceiro', label: 'Agente / Corban', table: 'agentes_parceiros', nameColumn: 'name' },
  { value: 'commercial_entity', label: 'Estrutura Comercial', table: 'commercial_entities', nameColumn: 'name' },
]

export type AgendaParticipant = {
  user_id: string
  name: string
  avatar_url?: string | null
  role: 'envolvido' | 'autorizado'
}

export type AgendaItemLink = {
  entity_type: string
  entity_id: string
  label: string
}

export type AgendaItem = {
  id: string
  item_type: AgendaItemType
  title: string
  description: string
  all_day: boolean
  due_date: string | null
  start_at: string | null
  end_at: string | null
  priority: AgendaPriority
  status: AgendaTaskStatus | null
  visibility: AgendaVisibility
  meeting_link_mode: AgendaMeetingLinkMode
  meeting_link: string
  created_by: string
  created_by_name: string
  created_at: string
  updated_at: string
  participants: AgendaParticipant[]
  links: AgendaItemLink[]
  // true quando o item é privado e o usuário atual não está autorizado:
  // título/descrição chegam mascarados pela server action.
  masked?: boolean
}

export type AgendaItemPayload = {
  id?: string
  item_type: AgendaItemType
  title: string
  description: string
  all_day: boolean
  due_date: string | null
  start_at: string | null
  end_at: string | null
  priority: AgendaPriority
  status: AgendaTaskStatus | null
  visibility: AgendaVisibility
  meeting_link_mode: AgendaMeetingLinkMode
  meeting_link: string
  participant_user_ids: string[]
  authorized_user_ids: string[]
  links: AgendaItemLink[]
}

export function priorityOrder(priority: AgendaPriority): number {
  return AGENDA_PRIORITIES.find((p) => p.value === priority)?.order ?? 1
}

export function itemTypeMeta(type: AgendaItemType) {
  return AGENDA_ITEM_TYPES.find((t) => t.value === type) || AGENDA_ITEM_TYPES[0]
}
