export type ScpAutomationKind = 'actions' | 'triggers'

export type ScpAutomationTypeOption = {
  value: string
  label: string
}

export type ScpAutomationRow = {
  id: string
  name: string
  code: string
  type: string
  description: string | null
  config: Record<string, any> | null
  is_active: boolean
  deleted_at: string | null
  created_at: string | null
  updated_at: string | null
}

export const SCP_AUTOMATION_LIBRARY_RESOURCE = 'scp-acoes-gatilhos'
export const SCP_AUTOMATION_LIBRARY_ROUTE = '/rh/parceiros/config/acoes-gatilhos'
export const SCP_AUTOMATION_LIBRARY_ACCESS_RESOURCES = [
  'scp-acoes-gatilhos',
  'scp-processos',
  'scp-construtor',
  'scp-documentos',
  'scp-emails',
  'scp-whatsapp',
  'scp-crm',
] as const

export const SCP_AUTOMATION_ACTION_TYPES: ScpAutomationTypeOption[] = [
  { value: 'create_update_record', label: 'Criar/atualizar cadastro' },
  { value: 'generate_document', label: 'Gerar documento' },
  { value: 'send_assinafy', label: 'Enviar para Assinafy' },
  { value: 'send_email', label: 'Enviar e-mail' },
  { value: 'send_whatsapp', label: 'Enviar WhatsApp' },
  { value: 'open_human_validation', label: 'Abrir validação humana' },
  { value: 'register_event', label: 'Registrar evento' },
  { value: 'update_stage', label: 'Atualizar etapa' },
  { value: 'update_status', label: 'Atualizar status' },
  { value: 'save_links', label: 'Salvar links' },
]

export const SCP_AUTOMATION_TRIGGER_TYPES: ScpAutomationTypeOption[] = [
  { value: 'on_stage_enter', label: 'Entrada na etapa' },
  { value: 'on_stage_exit', label: 'Saída da etapa' },
  { value: 'manual_button', label: 'Botão manual' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'timeout', label: 'Timeout' },
  { value: 'signature_completed', label: 'Conclusão de assinatura' },
  { value: 'validation_completed', label: 'Conclusão de validação' },
  { value: 'external_return', label: 'Retorno externo' },
]

export function getScpAutomationTypes(kind: ScpAutomationKind) {
  return kind === 'actions' ? SCP_AUTOMATION_ACTION_TYPES : SCP_AUTOMATION_TRIGGER_TYPES
}

export function getScpAutomationKindLabel(kind: ScpAutomationKind) {
  return kind === 'actions' ? 'Ações' : 'Gatilhos'
}

export function getScpAutomationTable(kind: ScpAutomationKind) {
  return kind === 'actions' ? 'scp_automation_actions' : 'scp_automation_triggers'
}

export function getScpAutomationTypeLabel(kind: ScpAutomationKind, value: string) {
  const option = getScpAutomationTypes(kind).find((item) => item.value === String(value || ''))
  return option?.label || String(value || '—')
}

export function normalizeScpAutomationText(value: any) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

export function normalizeScpAutomationCode(value: any) {
  return normalizeScpAutomationText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
}

export function normalizeScpAutomationConfig(value: any) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

export function formatScpAutomationConfig(value: any) {
  const config = normalizeScpAutomationConfig(value)
  if (!config || Object.keys(config).length === 0) return '{}'

  try {
    return JSON.stringify(config, null, 2)
  } catch {
    return '{}'
  }
}

export function buildScpAutomationDuplicateCode(baseCode: string, existingCodes: Iterable<string>) {
  const normalizedBase = normalizeScpAutomationCode(baseCode) || 'copia'
  const existing = new Set(
    Array.from(existingCodes || [])
      .map((code) => normalizeScpAutomationCode(code))
      .filter(Boolean),
  )

  let candidate = `${normalizedBase}_copia`
  let counter = 2
  while (existing.has(candidate)) {
    candidate = `${normalizedBase}_copia_${counter}`
    counter += 1
  }

  return candidate
}
