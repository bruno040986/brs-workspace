/**
 * Tipos e constantes do subsistema "Disparo de WhatsApp" (isomórfico).
 */

export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'
export type RecipientStatus = 'pending' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped' | 'optout' | 'cancelled'
export type CampaignSourceType = 'csv' | 'agents' | 'manual'
export type RotationMode = 'sequential' | 'random'
export type ScheduleMode = 'direct' | 'batches'
export type MediaType = 'image' | 'document' | 'audio'

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendada',
  running: 'Em execução',
  paused: 'Pausada',
  completed: 'Concluída',
  cancelled: 'Cancelada',
  failed: 'Falhou',
}

export const RECIPIENT_STATUS_LABELS: Record<RecipientStatus, string> = {
  pending: 'Pendente',
  sending: 'Enviando',
  sent: 'Enviada',
  delivered: 'Entregue',
  read: 'Lida',
  failed: 'Falha',
  skipped: 'Ignorada',
  optout: 'Opt-out',
  cancelled: 'Cancelada',
}

export const SOURCE_TYPE_LABELS: Record<CampaignSourceType, string> = {
  csv: 'Planilha (CSV/XLSX)',
  agents: 'Agentes Corban',
  manual: 'Inclusão manual',
}

export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export const DELAY_MIN_LIMIT = 15
export const DELAY_MAX_LIMIT = 300

export type CampaignMedia = {
  type: MediaType
  bucket: string
  path: string
  file_name: string
  mime: string
  size: number
  /** URL assinada temporária, só para preview no wizard. */
  preview_url?: string
}

export type CampaignContact = {
  name: string
  phone: string
  description?: string
}

export type CampaignTemplateBlock = {
  id?: string
  position: number
  body: string
  media: CampaignMedia | null
  contact: CampaignContact | null
}

export type AntibanConfig = {
  title: string
  footer: string
  message: string
  positive_label: string
  negative_label: string
  /** buttons = send-button-list (depende da conta suportar); text = mensagem
   *  de texto com instrução de resposta (sempre entrega). */
  send_as?: 'buttons' | 'text'
}

export const DEFAULT_ANTIBAN: AntibanConfig = {
  title: 'Comunicação Oficial',
  footer: 'Responda para confirmar',
  message: 'Deseja continuar recebendo nossas mensagens?',
  positive_label: 'Sim, quero receber',
  negative_label: 'Não, obrigado',
  send_as: 'text',
}

/** IDs fixos dos botões (usados no webhook para detectar opt-out). */
export const ANTIBAN_BUTTON_YES_ID = 'wa_yes'
export const ANTIBAN_BUTTON_NO_ID = 'wa_optout'

export type CampaignSlotInput = {
  id?: string
  position: number
  /** ISO (UTC) */
  run_at: string
  quantity: number
}

export type CampaignScheduleConfig = {
  schedule_mode: ScheduleMode
  start_at: string | null
  allowed_weekdays: number[]
  window_start: string | null // 'HH:MM'
  window_end: string | null
  timezone: string
  slots: CampaignSlotInput[]
}

export type CampaignSettings = {
  delay_min_seconds: number
  delay_max_seconds: number
  rotate_templates: boolean
  rotation_mode: RotationMode
  antiban: AntibanConfig | null
}

export type RecipientDraft = {
  phone: string // normalizado 55DDD…
  phone_raw: string
  name: string
  variables: Record<string, string>
  source_ref: Record<string, unknown> | null
}

export type CampaignRecord = {
  id: string
  name: string
  instance_id: string
  status: CampaignStatus
  source_type: CampaignSourceType
  variables: string[]
  delay_min_seconds: number
  delay_max_seconds: number
  rotate_templates: boolean
  rotation_mode: RotationMode
  antiban: AntibanConfig | null
  schedule_mode: ScheduleMode
  start_at: string | null
  allowed_weekdays: number[]
  window_start: string | null
  window_end: string | null
  timezone: string
  next_run_at: string | null
  last_sent_at: string | null
  last_error: string | null
  consecutive_failures: number
  started_at: string | null
  finished_at: string | null
  cancelled_at: string | null
  total_count: number
  pending_count: number
  sending_count: number
  sent_count: number
  delivered_count: number
  read_count: number
  failed_count: number
  skipped_count: number
  optout_count: number
  cancelled_count: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export type CampaignRecipientRecord = {
  id: string
  campaign_id: string
  position: number
  phone: string
  phone_raw: string | null
  name: string | null
  variables: Record<string, string>
  source_ref: Record<string, unknown> | null
  slot_id: string | null
  status: RecipientStatus
  template_index: number | null
  message_id: string | null
  zaap_id: string | null
  error: string | null
  attempts: number
  claimed_at: string | null
  sent_at: string | null
  updated_at: string
}

export type CampaignSlotRecord = CampaignSlotInput & { id: string; campaign_id: string; sent_count: number }

/** Variáveis fixas disponíveis quando a base é "Agentes Corban". */
export const AGENT_FIXED_VARIABLES = [
  'nome',
  'fantasia',
  'cpf_cnpj',
  'arw_code',
  'email',
  'filial',
  'tipo_agente',
  'nivel_acesso',
  'telefone_origem',
] as const

/** Campos de telefone do Agente Corban selecionáveis no wizard. */
export type AgentPhoneField = {
  key: string
  label: string
  /** Coluna direta de agentes_parceiros ou path em corban_data. */
  source: 'column' | 'corban_data'
  path: string
}

export const AGENT_PHONE_FIELDS: AgentPhoneField[] = [
  { key: 'phone_whatsapp', label: 'WhatsApp Principal', source: 'column', path: 'phone_whatsapp' },
  { key: 'phone_whatsapp_financeiro', label: 'WhatsApp Financeiro', source: 'column', path: 'phone_whatsapp_financeiro' },
  { key: 'phone_commercial', label: 'WhatsApp do Sócio Principal (PJ)', source: 'column', path: 'phone_commercial' },
  { key: 'phone_residential', label: 'WhatsApp do Sócio Secundário (PJ)', source: 'column', path: 'phone_residential' },
  { key: 'phone_support', label: 'Telefone de Suporte', source: 'column', path: 'phone_support' },
  { key: 'commercial.whatsapp_atendimento', label: 'WhatsApp de Atendimento ao Cliente', source: 'corban_data', path: 'commercial.whatsapp_atendimento' },
  { key: 'consent.signature_whatsapp', label: 'WhatsApp para Assinatura', source: 'corban_data', path: 'consent.signature_whatsapp' },
  { key: 'socios[].phone', label: 'WhatsApp dos Sócios (todos)', source: 'corban_data', path: 'socios[].phone' },
  { key: 'witness.phone', label: 'WhatsApp da Testemunha', source: 'corban_data', path: 'witness.phone' },
]
