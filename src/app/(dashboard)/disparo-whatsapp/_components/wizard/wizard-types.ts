import type { AntibanConfig, CampaignContact, CampaignMedia, CampaignSlotInput, CampaignSourceType, RecipientDraft, RotationMode, ScheduleMode } from '@/lib/disparo-whatsapp'

export type WizardBlock = {
  key: string
  body: string
  media: CampaignMedia | null
  contact: CampaignContact | null
}

export type WizardSettings = {
  delay_min_seconds: number
  delay_max_seconds: number
  rotate_templates: boolean
  rotation_mode: RotationMode
  antiban_enabled: boolean
  antiban: AntibanConfig
}

export type WizardSchedule = {
  schedule_mode: ScheduleMode
  start_at_local: string // 'YYYY-MM-DDTHH:MM' no fuso local do navegador ('' = manual)
  allowed_weekdays: number[]
  restrict_hours: boolean
  window_start: string
  window_end: string
  slots: Array<{ key: string; date: string; time: string; quantity: number }>
}

export type WizardState = {
  draftId: string | null
  name: string
  instanceId: string
  sourceType: CampaignSourceType
  variables: string[]
  recipients: RecipientDraft[]
  /** Destinatários já gravados num rascunho existente (quando não reimportados). */
  storedRecipientCount: number
  recipientsDirty: boolean
  blocks: WizardBlock[]
  settings: WizardSettings
  schedule: WizardSchedule
}

export function newKey(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Converte 'YYYY-MM-DDTHH:MM' (hora local do navegador) em ISO UTC. */
export function localToIso(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function slotsToInputs(slots: WizardSchedule['slots']): CampaignSlotInput[] {
  return slots.map((s, i) => ({ position: i, run_at: localToIso(`${s.date}T${s.time}`) || '', quantity: Number(s.quantity) || 0 }))
}
