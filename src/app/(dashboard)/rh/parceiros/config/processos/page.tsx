'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  archiveProcessModel,
  deleteProcessModel,
  duplicateProcessModel,
  getCompanyProfiles,
  getContractTemplates,
  getEmailTemplates,
  getPartnerForms,
  getProcessModels,
  getProcessStages,
  isProcessSlugAvailable,
  listAssinafyTemplateOptions,
  saveProcessModel,
  validateProcessModel,
} from '../../actions'
import {
  AlertCircle,
  Archive,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Files,
  Loader2,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Trash,
} from 'lucide-react'

type PartnerFormRow = {
  id: string
  title: string
  is_active: boolean
  schema?: any[]
}

type ProcessModelRow = {
  id?: string
  name: string
  type: string
  is_active: boolean
  is_public: boolean
  public_slug?: string | null
  form_id?: string | null
  company_profile_id?: string | null
  entry_config?: any
  config?: any
}

type CompanyProfileRow = {
  id: string
  nickname: string
  cnpj?: string | null
  is_active: boolean
  company_data?: any
  partner_primary_data?: any
  partner_secondary_data?: any
  witness_data?: any
}

type StageRow = {
  id?: string
  client_key: string
  name: string
  position: number
  color?: string | null
  bg?: string | null
  config?: any
}

type ContractTemplateRow = {
  id: string
  name: string
  body: string
  placeholders?: Array<{
    id: string
    token: string
    label: string
    required?: boolean
  }>
}

type EmailTemplateRow = {
  id: string
  name: string
  subject: string
  body: string
}

type EmailCopyRecipient = {
  type: 'tag' | 'email'
  value: string
}

type Health = {
  blocking: string[]
  warnings: string[]
}

type ProcessTab = 'formulario' | 'etapas' | 'campos' | 'documentos' | 'emails' | 'whatsapp' | 'regras'

// Abas visíveis = só as que têm efeito real no motor (scp-engine).
// As abas de E-mails / WhatsApp / Campos do Processo / Regras & SLA configuram
// recursos que ainda são stubs ou não são consumidos pelo motor; ficam OCULTAS
// (o JSX delas continua no arquivo, gated por activeTab, para reativar quando o
// envio real — frente C2b — for implementado).
const TAB_LABELS: Array<{ id: ProcessTab; label: string }> = [
  { id: 'formulario', label: 'Formulário' },
  { id: 'etapas', label: 'Etapas & Ações' },
]

const IDENTIFIER_OPTION_MAX_CHARS = 100
const SIGNATURE_LINK_TRIGGER = 'signature_link_ready'
const SIGNER_ROLE_OPTIONS = [
  { value: 'contratante', label: 'Contratante' },
  { value: 'contratado', label: 'Contratado' },
  { value: 'test1', label: 'Testemunha 1' },
  { value: 'test2', label: 'Testemunha 2' },
]

function normalizeSlug(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function parseCommaList(raw: string): string[] {
  return String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function stringifyPretty(value: any): string {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return '{}'
  }
}

function truncateText(value: string, maxChars: number) {
  const normalized = String(value || '').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars - 1)}…`
}

function extractTokens(text: string) {
  return Array.from(new Set(String(text || '').match(/\{\{[^}]+\}\}/g) || []))
}

const EMAIL_AUTOFILL_TOKENS = new Set(['{{assinatura.link}}', '{{processo.id}}', '{{campo.email_destino}}'])

function isValidEmail(value: string) {
  const normalized = String(value || '').trim()
  if (!normalized) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
}

function normalizeFieldKey(raw: string) {
  const normalized = String(raw || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return normalized || 'campo'
}

function makeClientKey(seed?: string) {
  if (seed) return seed
  return `stage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function ProcessBuilderPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  const [archivingId, setArchivingId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [forms, setForms] = useState<PartnerFormRow[]>([])
  const [processes, setProcesses] = useState<ProcessModelRow[]>([])
  const [companies, setCompanies] = useState<CompanyProfileRow[]>([])
  const [contractTemplates, setContractTemplates] = useState<ContractTemplateRow[]>([])
  const [assinafyTemplates, setAssinafyTemplates] = useState<Array<{ id: string; name: string }>>([])
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplateRow[]>([])
  const [view, setView] = useState<'list' | 'edit'>('list')

  const [selected, setSelected] = useState<ProcessModelRow | null>(null)
  const [stages, setStages] = useState<StageRow[]>([])
  const [activeTab, setActiveTab] = useState<ProcessTab>('formulario')
  // Etapa selecionada no editor-por-etapa (kanban → painel da etapa).
  const [activeStageKey, setActiveStageKey] = useState<string | null>(null)

  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')
  const [health, setHealth] = useState<Health>({ blocking: [], warnings: [] })
  const initialSnapshotRef = useRef<string>('')
  const [copyDraftByKey, setCopyDraftByKey] = useState<Record<string, string>>({})

  const selectedForm = useMemo(() => {
    if (!selected?.form_id) return null
    return forms.find((f) => f.id === selected.form_id) || null
  }, [forms, selected?.form_id])

  const formTags = useMemo(() => {
    const schema = Array.isArray(selectedForm?.schema) ? selectedForm.schema : []
    return schema
      .map((f: any) => ({
        key: String(f?.key || f?.id || ''),
        label: String(f?.label || f?.key || f?.id || ''),
        display_label: truncateText(String(f?.label || f?.key || f?.id || ''), IDENTIFIER_OPTION_MAX_CHARS),
        system_key: String(f?.system_key || ''),
        type: String(f?.type || 'text'),
        required: !!f?.required,
        mask: String(f?.mask || ''),
      }))
      .filter((o) => o.key)
  }, [selectedForm?.schema])

  const identifierOptions = useMemo(() => formTags, [formTags])

  const selectedCompany = useMemo(() => {
    if (!selected?.company_profile_id) return null
    return companies.find((company) => company.id === selected.company_profile_id) || null
  }, [companies, selected?.company_profile_id])

  const companyGlobalTagOptions = useMemo(() => {
    if (!selectedCompany) return []

    const p1 = selectedCompany.partner_primary_data || {}
    const w = selectedCompany.witness_data || {}

    const rows = [
      { key: '{{contratante.cpf}}', label: 'Contratante CPF', value: String(p1.cpf || '') },
      { key: '{{contratante.nome}}', label: 'Contratante Nome', value: String(p1.name || '') },
      { key: '{{contratante.email}}', label: 'Contratante E-mail', value: String(p1.email_signature || p1.email_professional || '') },
      { key: '{{contratante.whatsapp}}', label: 'Contratante WhatsApp', value: String(p1.whatsapp || '') },
      { key: '{{test1.cpf}}', label: 'Testemunha 1 CPF', value: String(w.cpf || '') },
      { key: '{{test1.nome}}', label: 'Testemunha 1 Nome', value: String(w.name || '') },
      { key: '{{test1.email}}', label: 'Testemunha 1 E-mail', value: String(w.email_signature || w.email_professional || '') },
      { key: '{{test1.whatsapp}}', label: 'Testemunha 1 WhatsApp', value: String(w.whatsapp || '') },
    ]

    return rows.map((row) => ({
      key: row.key,
      label: row.label,
      value: row.value,
      display_text: truncateText(`${row.label} (${row.key})${row.value ? ` • ${row.value}` : ''}`, IDENTIFIER_OPTION_MAX_CHARS),
      source: 'empresa_global',
      data_type: String(row.key || '').includes('.email}}') ? 'email' : '',
    }))
  }, [selectedCompany])

  const processTagOptions = useMemo(() => {
    const fromForm = formTags.map((tag) => ({
      key: String(tag.key),
      label: String(tag.label),
      display_text: truncateText(`${String(tag.label)} (${String(tag.key)})`, IDENTIFIER_OPTION_MAX_CHARS),
      source: 'formulario',
      data_type: String(tag.type || ''),
    }))

    const fields = getConfigArray('process_fields')
    const fromProcessFields = fields
      .filter((field: any) => field?.key)
      .map((field: any) => ({
        key: String(field.key),
        label: String(field.label || field.key),
        display_text: truncateText(
          `${String(field.label || field.key)} (${String(field.key)})`,
          IDENTIFIER_OPTION_MAX_CHARS,
        ),
        source: 'processo',
        data_type: String(field.type || ''),
      }))

    const merged = [...companyGlobalTagOptions, ...fromForm, ...fromProcessFields]
    const unique = new Map<string, { key: string; label: string; display_text: string; source: string; value?: string; data_type?: string }>()
    for (const item of merged) {
      if (!unique.has(item.key)) unique.set(item.key, item)
    }
    return Array.from(unique.values())
  }, [companyGlobalTagOptions, formTags, selected?.config])

  const processEmailTagOptions = useMemo(() => {
    return processTagOptions
      .filter((opt) => {
        const dataType = String(opt?.data_type || '').toLowerCase()
        const key = String(opt?.key || '').toLowerCase()
        const label = String(opt?.label || '').toLowerCase()
        return dataType === 'email' || key.includes('email') || label.includes('e-mail')
      })
      .map((opt) => ({
        ...opt,
        display_text: truncateText(String(opt.display_text || ''), IDENTIFIER_OPTION_MAX_CHARS),
      }))
  }, [processTagOptions])

  const publicUrl = selected?.is_public && selected?.public_slug ? `/cadastro-parceiro/${normalizeSlug(selected.public_slug)}` : ''

  const processDraftSignature = useMemo(() => stringifyPretty({ selected, stages }), [selected, stages])

  const hasPendingChanges = useMemo(() => {
    return view === 'edit' && !!selected && initialSnapshotRef.current !== processDraftSignature
  }, [view, selected, processDraftSignature])

  const canRunValidation = !!selected?.form_id && stages.length > 0
  const canOpenPublicLink = canRunValidation && health.blocking.length === 0 && !!publicUrl

  const processDocumentOptions = useMemo(() => {
    const list = getConfigArray('documents')
    return list
      .map((doc: any, idx: number) => {
        const key = String(doc?.id || doc?.template_id || `${doc?.stage_key || doc?.stage_name || 'stage'}:${doc?.name || idx}`)
        const label = String(doc?.name || doc?.template_name || `Documento ${idx + 1}`)
        const stageLabel = String(doc?.stage_name || '')
        return {
          key,
          label: stageLabel ? `${label} (${stageLabel})` : label,
        }
      })
      .filter((item) => item.key && item.label)
  }, [selected?.config])

  function getPlaceholderToken(placeholder: any) {
    const token = String(placeholder?.token || '').trim()
    if (token.startsWith('{{') && token.endsWith('}}')) return token

    const id = String(placeholder?.id || '').trim()
    if (id.startsWith('{{') && id.endsWith('}}')) return id

    const label = String(placeholder?.label || '')
    const tokenInLabel = label.match(/\{\{[^}]+\}\}/)?.[0]
    return String(tokenInLabel || '')
  }

  function suggestTagForPlaceholder(placeholder: any) {
    const token = getPlaceholderToken(placeholder)
    if (!token) return ''
    const exact = processTagOptions.find((opt) => opt.key === token)
    return exact?.key || ''
  }

  useEffect(() => {
    if (!selected) return
    const docs = getConfigArray('documents')
    if (!docs.length) return

    let changed = false
    const nextDocs = docs.map((doc: any) => {
      const template = findContractTemplate(doc)
      const placeholders = template?.placeholders || []
      if (!placeholders.length) return doc

      const currentMapping = doc?.placeholder_mapping && typeof doc.placeholder_mapping === 'object' ? doc.placeholder_mapping : {}
      const nextMapping: Record<string, string> = { ...currentMapping }
      let docChanged = false

      for (const placeholder of placeholders) {
        const placeholderId = String(placeholder?.id || '')
        if (!placeholderId) continue
        if (String(nextMapping[placeholderId] || '').trim()) continue

        const suggested = suggestTagForPlaceholder(placeholder)
        if (!suggested) continue
        nextMapping[placeholderId] = suggested
        docChanged = true
      }

      if (!docChanged) return doc
      changed = true
      return { ...doc, placeholder_mapping: nextMapping }
    })

    if (changed) setConfigArray('documents', nextDocs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.company_profile_id, selected?.form_id, contractTemplates, processTagOptions.length])

  function getConfigArray(key: string): any[] {
    const cfg = selected?.config || {}
    return Array.isArray(cfg?.[key]) ? cfg[key] : []
  }

  function setConfigArray(key: string, next: any[]) {
    setSelected((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        config: {
          ...(prev.config || {}),
          [key]: next,
        },
      }
    })
  }

  function updateConfigValue(path: string, value: any) {
    setSelected((prev) => {
      if (!prev) return prev
      const cfg = { ...(prev.config || {}) }
      const parts = path.split('.')
      let cursor: any = cfg
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]
        if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
        cursor = cursor[part]
      }
      cursor[parts[parts.length - 1]] = value
      return { ...prev, config: cfg }
    })
  }

  function getStageItems(key: string, stage: StageRow) {
    return getConfigArray(key).filter((item: any) => item?.stage_key === stage.client_key || item?.stage_name === stage.name)
  }

  function findContractTemplate(doc: any) {
    const byId = contractTemplates.find((template) => template.id === String(doc?.template_id || ''))
    if (byId) return byId
    const byName = contractTemplates.find((template) => String(template.name || '').toLowerCase() === String(doc?.template_name || '').toLowerCase())
    return byName || null
  }

  function findEmailTemplate(mail: any) {
    const byId = emailTemplates.find((template) => template.id === String(mail?.template_id || ''))
    if (byId) return byId
    const byName = emailTemplates.find((template) => String(template.name || '').toLowerCase() === String(mail?.template_name || '').toLowerCase())
    return byName || null
  }

  function normalizeCopyRecipients(raw: any): EmailCopyRecipient[] {
    const list = Array.isArray(raw) ? raw : []
    return list
      .map((entry) => ({
        type: String(entry?.type || '') as 'tag' | 'email',
        value: String(entry?.value || '').trim(),
      }))
      .filter((entry) => (entry.type === 'tag' || entry.type === 'email') && !!entry.value)
  }

  function buildUniqueFieldKey(label: string, stage: StageRow, currentIndex: number) {
    const base = normalizeFieldKey(label)
    const sameStageItems = getStageItems('process_fields', stage)
    const existingKeys = sameStageItems
      .map((item: any, idx: number) => (idx === currentIndex ? null : String(item?.key || '').trim()))
      .filter(Boolean)

    if (!existingKeys.includes(base)) return base

    let suffix = 2
    let candidate = `${base}-${suffix}`
    while (existingKeys.includes(candidate)) {
      suffix += 1
      candidate = `${base}-${suffix}`
    }
    return candidate
  }

  function addStageItem(key: string, stage: StageRow, seed: any) {
    const list = getConfigArray(key)
    setConfigArray(key, [
      ...list,
      {
        ...seed,
        stage_key: stage.client_key,
        stage_name: stage.name,
      },
    ])
  }

  function updateStageItem(key: string, stage: StageRow, localIndex: number, patch: any) {
    const list = getConfigArray(key)
    let stageCounter = -1
    const next = list.map((item: any) => {
      const sameStage = item?.stage_key === stage.client_key || item?.stage_name === stage.name
      if (!sameStage) return item
      stageCounter += 1
      if (stageCounter !== localIndex) return item
      return {
        ...item,
        ...patch,
        stage_key: stage.client_key,
        stage_name: stage.name,
      }
    })
    setConfigArray(key, next)
  }

  function removeStageItem(key: string, stage: StageRow, localIndex: number) {
    const list = getConfigArray(key)
    let stageCounter = -1
    const next = list.filter((item: any) => {
      const sameStage = item?.stage_key === stage.client_key || item?.stage_name === stage.name
      if (!sameStage) return true
      stageCounter += 1
      return stageCounter !== localIndex
    })
    setConfigArray(key, next)
  }

  function renameStageReferences(clientKey: string, oldName: string, newName: string) {
    ;['process_fields', 'documents', 'emails', 'whatsapp'].forEach((key) => {
      const list = getConfigArray(key)
      if (!list.length) return
      const next = list.map((item: any) => {
        const sameStage = item?.stage_key === clientKey || item?.stage_name === oldName
        if (!sameStage) return item
        return {
          ...item,
          stage_key: clientKey,
          stage_name: newName,
        }
      })
      setConfigArray(key, next)
    })
  }

  function removeStageReferences(stage: StageRow) {
    ;['process_fields', 'documents', 'emails', 'whatsapp'].forEach((key) => {
      const list = getConfigArray(key)
      if (!list.length) return
      const next = list.filter((item: any) => !(item?.stage_key === stage.client_key || item?.stage_name === stage.name))
      setConfigArray(key, next)
    })
  }

  function computeLocalHealth(proc: ProcessModelRow | null, stageList: StageRow[]): Health {
    const blocking: string[] = []
    const warnings: string[] = []

    if (!proc) return { blocking, warnings }

    if (!proc.name?.trim()) blocking.push('Nome do processo é obrigatório.')
    if (!proc.form_id) blocking.push('Selecione o formulário base.')
    if (!proc.entry_config?.identifier_field_key) blocking.push('Selecione o campo identificador.')

    if (stageList.length === 0) blocking.push('Cadastre ao menos uma etapa no Kanban.')

    stageList.forEach((stage) => {
      const transitions = Array.isArray(stage?.config?.transitions) ? stage.config.transitions : []
      const isTerminal = !!stage?.config?.is_terminal
      if (!isTerminal && transitions.length === 0) {
        blocking.push(`Etapa "${stage.name}" sem transição de saída.`)
      }
    })

    // Documentos: válidos quando têm um template da Assinafy selecionado (o que o
    // motor realmente usa). Legado: aceita template_name interno se existir.
    const docs = getConfigArray('documents')
    for (const doc of docs) {
      const tpl = String(doc?.assinafy_template_name || doc?.template_name || '').trim()
      if (!tpl) {
        blocking.push(`Documento "${doc?.name || 'sem nome'}" sem template da Assinafy selecionado.`)
      }
    }

    // E-mails/WhatsApp/Campos/Regras estão ocultos (stubs/sem consumo no motor),
    // então não entram na validação — evita pendências que o usuário não pode resolver.

    return { blocking, warnings }
  }

  async function loadAll() {
    setLoading(true)
    setMessage(null)
    const [pRes, fRes, dRes, eRes, cRes] = await Promise.all([
      getProcessModels(),
      getPartnerForms(),
      getContractTemplates(),
      getEmailTemplates(),
      getCompanyProfiles(),
    ])
    if (pRes.success) setProcesses((pRes.processes || []) as any)
    if (fRes.success) setForms((fRes.forms || []) as any)
    if (dRes.success) setContractTemplates((dRes.templates || []) as any)
    if (eRes.success) setEmailTemplates((eRes.templates || []) as any)
    if (cRes.success) setCompanies(((cRes.companies || []) as any[] as CompanyProfileRow[]).filter((c) => c.is_active !== false))
    setLoading(false)

    // Templates da Assinafy (Opção A) — falha silenciosa se a integração não estiver configurada.
    try {
      const aRes = await listAssinafyTemplateOptions()
      if (aRes.success) setAssinafyTemplates((aRes.options || []) as any)
    } catch {
      // integração de assinatura ainda não configurada; segue sem os templates
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  useEffect(() => {
    if (!selected) return
    if (emailTemplates.length === 0) return
    const list = getConfigArray('emails')
    if (!list.length) return

    let changed = false
    const next = list.map((item: any) => {
      if (String(item?.template_id || '').trim()) return item
      const name = String(item?.template_name || '').trim()
      if (!name) return item
      const match = emailTemplates.find((t) => String(t.name || '').toLowerCase() === name.toLowerCase())
      if (!match) return item
      changed = true
      return { ...item, template_id: match.id, template_name: match.name }
    })

    if (changed) setConfigArray('emails', next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, emailTemplates])

  useEffect(() => {
    if (!selected) return
    setHealth(computeLocalHealth(selected, stages))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, stages, contractTemplates, emailTemplates])

  async function openEdit(proc: ProcessModelRow) {
    const nextSelected: ProcessModelRow = {
      id: proc.id,
      name: proc.name || '',
      type: proc.type || 'generic',
      is_active: !!proc.is_active,
      is_public: !!proc.is_public,
      public_slug: proc.public_slug || '',
      form_id: proc.form_id || null,
      company_profile_id: proc.company_profile_id || null,
      entry_config: proc.entry_config || {},
      config: proc.config || {},
    }

    setSelected(nextSelected)
    setActiveTab('formulario')
    setActiveStageKey(null)
    setSlugStatus('idle')
    setMessage(null)
    setView('edit')

    let loadedStages: StageRow[] = []
    if (proc.id) {
      const stRes = await getProcessStages(proc.id)
      if (stRes.success) {
        loadedStages = ((stRes.stages || []) as any[]).map((s: any, idx: number) => ({
          id: s.id,
          client_key: s.id || makeClientKey(`persisted-${idx}`),
          name: s.name,
          position: typeof s.position === 'number' ? s.position : idx,
          color: s.color,
          bg: s.bg,
          config: s.config || {},
        }))
      }
    } else {
      loadedStages = [
        { client_key: makeClientKey(), name: 'Novo', position: 0, color: '#3B82F6', bg: '#EFF6FF', config: { transitions: ['Aguardando Assinatura'] } },
        { client_key: makeClientKey(), name: 'Aguardando Assinatura', position: 1, color: '#F59E0B', bg: '#FEF3C7', config: { transitions: ['Finalizado'] } },
        { client_key: makeClientKey(), name: 'Finalizado', position: 2, color: '#059669', bg: '#E6F4EA', config: { is_terminal: true, transitions: [] } },
      ]
    }
    setStages(loadedStages)

    const sig = stringifyPretty({ selected: nextSelected, stages: loadedStages })
    initialSnapshotRef.current = sig
    setHealth(computeLocalHealth(nextSelected, loadedStages))
  }

  function handleNew() {
    openEdit({
      name: 'Novo Processo',
      type: 'generic',
      is_active: true,
      is_public: true,
      public_slug: '',
      form_id: null,
      company_profile_id: null,
      entry_config: {
        dedupe: {
          enabled: true,
          scope: 'active',
          message: 'Já existe um processo ativo com este identificador. Finalize ou arquive o card antes de enviar novamente.',
        },
        identifier_normalization: 'auto',
        validate_timing: 'both',
      },
      config: {
        process_fields: [],
        documents: [],
        emails: [],
        whatsapp: [],
        rules: { default_sla_hours: null, work_calendar: 'dias_uteis', strict_stage_exit: true },
      },
    })
  }

  async function validateAndSetSlug(raw: string) {
    if (!selected) return
    const normalized = normalizeSlug(raw)
    setSelected({ ...selected, public_slug: normalized })
    if (!selected.is_public) return
    if (!normalized) {
      setSlugStatus('idle')
      return
    }
    setSlugStatus('checking')
    const res = await isProcessSlugAvailable(normalized, selected.id)
    if (res.success) {
      setSlugStatus(res.available ? 'available' : 'taken')
      setSelected((prev) => (prev ? { ...prev, public_slug: res.normalized } : prev))
    } else {
      setSlugStatus('idle')
    }
  }

  function moveStage(idx: number, dir: 'up' | 'down') {
    setStages((prev) => {
      const next = [...prev]
      const target = dir === 'up' ? idx - 1 : idx + 1
      if (target < 0 || target >= next.length) return prev
      const tmp = next[idx]
      next[idx] = next[target]
      next[target] = tmp
      return next.map((s, i) => ({ ...s, position: i }))
    })
  }

  async function runHealthValidation() {
    if (!selected) return

    const local = computeLocalHealth(selected, stages)
    if (!selected.id) {
      setHealth(local)
      setMessage({ type: local.blocking.length ? 'error' : 'success', text: local.blocking.length ? 'Existem pendências bloqueantes.' : 'Validação concluída.' })
      return
    }

    const remote = await validateProcessModel(selected.id)
    if (!remote.success) {
      setHealth(local)
      setMessage({ type: 'error', text: remote.error || 'Erro ao validar processo.' })
      return
    }

    const normalizedWarnings = (remote.warnings || []).map((w: string) =>
      w.replace(/dedupe/gi, 'duplicação').replace(/Dedupe/g, 'Duplicação')
    )

    const merged: Health = {
      blocking: [...new Set([...(local.blocking || []), ...(remote.blocking || [])])],
      warnings: [...new Set([...(local.warnings || []), ...normalizedWarnings])],
    }
    setHealth(merged)
    setMessage({
      type: merged.blocking.length ? 'error' : 'success',
      text: merged.blocking.length ? 'Validação concluída com bloqueios.' : 'Validação concluída sem erros bloqueantes.',
    })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return
    setSaving(true)
    setMessage(null)

    const payload = {
      id: selected.id,
      name: selected.name,
      type: normalizeSlug(selected.name) || selected.type || 'generic',
      is_active: !!selected.is_active,
      is_public: !!selected.is_public,
      public_slug: selected.public_slug || null,
      form_id: selected.form_id || null,
      company_profile_id: selected.company_profile_id || null,
      entry_config: selected.entry_config || {},
      config: selected.config || {},
      stages: stages.map((s, i) => ({
        id: s.id,
        name: s.name,
        position: i,
        color: s.color || null,
        bg: s.bg || null,
        config: s.config || {},
      })),
    }

    const res = await saveProcessModel(payload as any)
    if (res.success) {
      setMessage({ type: 'success', text: 'Processo salvo com sucesso.' })
      await loadAll()
      const id = (res as any).id || selected.id
      const updated = (await getProcessModels()) as any
      if (updated.success) {
        const found = (updated.processes || []).find((p: any) => p.id === id) || null
        if (found) await openEdit(found)
      }
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao salvar processo.' })
    }
    setSaving(false)
  }

  async function handleDelete(processId: string) {
    if (!confirm('Excluir este processo? Esta ação remove apenas o modelo.')) return
    setDeletingId(processId)
    const res = await deleteProcessModel(processId)
    if (res.success) {
      setMessage({ type: 'success', text: 'Processo excluído.' })
      await loadAll()
      if (selected?.id === processId) {
        setView('list')
        setSelected(null)
        setStages([])
      }
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao excluir processo.' })
    }
    setDeletingId(null)
  }

  async function handleDuplicate(processId: string) {
    setDuplicatingId(processId)
    const res = await duplicateProcessModel(processId)
    if (res.success) {
      setMessage({ type: 'success', text: 'Processo duplicado com sucesso.' })
      await loadAll()
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao duplicar processo.' })
    }
    setDuplicatingId(null)
  }

  async function handleArchive(processId: string) {
    setArchivingId(processId)
    const res = await archiveProcessModel(processId)
    if (res.success) {
      setMessage({ type: 'success', text: 'Processo arquivado (inativo).' })
      await loadAll()
      if (selected?.id === processId) {
        setSelected((prev) => (prev ? { ...prev, is_active: false } : prev))
      }
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao arquivar processo.' })
    }
    setArchivingId(null)
  }

  if (loading) {
    return (
      <div className="card" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Loader2 className="spinner" size={18} />
          Carregando processos...
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '1.5rem' }}>
      {message && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
            borderRadius: 10,
            border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
            background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: message.type === 'success' ? '#065F46' : '#991B1B',
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
          }}
        >
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span>{message.text}</span>
        </div>
      )}

      {view === 'list' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>Construtor de Processos</div>
              <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem' }}>
                Configure formulário, etapas e automações por etapa para o fluxo do processo.
              </div>
            </div>
            <button type="button" className="btn btn-primary" onClick={handleNew}>
              <Plus size={16} />
              Novo Processo
            </button>
          </div>

          <div className="card" style={{ padding: '1.25rem' }}>
            {processes.length === 0 ? (
              <div style={{ padding: '1rem', border: '1px dashed var(--brs-gray-200)', borderRadius: 8, color: 'var(--brs-gray-600)' }}>
                Nenhum processo criado ainda.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--brs-gray-100)' }}>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Nome do Processo</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Status</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Formulário vinculado</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processes.map((p: any) => (
                      <tr key={p.id} style={{ borderBottom: '1px solid var(--brs-gray-50)' }}>
                        <td style={{ padding: '0.75rem 0.5rem', fontWeight: 700, color: 'var(--brs-gray-800)' }}>{p.name}</td>
                        <td style={{ padding: '0.75rem 0.5rem', color: p.is_active ? '#065F46' : '#92400E' }}>{p.is_active ? 'Ativo' : 'Inativo'}</td>
                        <td style={{ padding: '0.75rem 0.5rem', color: 'var(--brs-gray-600)' }}>
                          {forms.find((f) => f.id === p.form_id)?.title || 'Não definido'}
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem' }}>
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <button type="button" className="btn btn-outline" onClick={() => openEdit(p)}>
                              <Pencil size={16} />
                              Editar
                            </button>
                            <button type="button" className="btn btn-outline" disabled={duplicatingId === p.id} onClick={() => handleDuplicate(p.id)}>
                              {duplicatingId === p.id ? <Loader2 size={16} className="spinner" /> : <Files size={16} />}
                              Duplicar
                            </button>
                            <button type="button" className="btn btn-outline" disabled={archivingId === p.id || !p.is_active} onClick={() => handleArchive(p.id)}>
                              {archivingId === p.id ? <Loader2 size={16} className="spinner" /> : <Archive size={16} />}
                              Arquivar
                            </button>
                            <button type="button" className="btn btn-outline text-danger" disabled={deletingId === p.id} onClick={() => handleDelete(p.id)}>
                              {deletingId === p.id ? <Loader2 size={16} className="spinner" /> : <Trash size={16} />}
                              Excluir
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {view === 'edit' && selected && (
        <div className="card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 160px)', overflow: 'hidden' }}>
          <div style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 2, borderBottom: '1px solid var(--brs-gray-100)', paddingBottom: '0.75rem', marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)', marginBottom: '0.35rem' }}>
              CRM Parceiros {'>'} Construtor de Processos {'>'} {selected.name || 'Novo Processo'}
            </div>

            <form onSubmit={handleSave}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(260px, 320px) auto', gap: '0.75rem', alignItems: 'end' }}>
                <div className="form-group">
                  <label className="form-label">Nome do Processo</label>
                  <input type="text" className="form-control" value={selected.name} onChange={(e) => setSelected({ ...selected, name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Empresa vinculada</label>
                  <select
                    className="form-control"
                    value={selected.company_profile_id || ''}
                    onChange={(e) => setSelected({ ...selected, company_profile_id: e.target.value || null })}
                  >
                    <option value="">Selecionar empresa...</option>
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.nickname}
                        {company.cnpj ? ` (${company.cnpj})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', marginBottom: '0.65rem' }}>
                  <input type="checkbox" checked={selected.is_active} onChange={(e) => setSelected({ ...selected, is_active: e.target.checked })} />
                  Ativo
                </label>
              </div>
            </form>
          </div>

          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            {TAB_LABELS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className="btn btn-ghost"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  borderRadius: 8,
                  border: `1px solid ${activeTab === tab.id ? 'var(--brs-primary-300)' : 'var(--brs-gray-200)'}`,
                  background: activeTab === tab.id ? 'var(--brs-primary-50)' : '#fff',
                  color: activeTab === tab.id ? 'var(--brs-primary-700)' : 'var(--brs-gray-700)',
                  fontWeight: activeTab === tab.id ? 700 : 600,
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '0.25rem' }}>
            {activeTab === 'formulario' && (
              <div style={{ display: 'grid', gap: '1rem' }}>
                <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)' }}>
                  <div className="section-divider" style={{ marginBottom: '1rem' }}>Formulário Base</div>
                  <div className="form-grid form-grid-2">
                    <div className="form-group">
                      <label className="form-label">Formulário</label>
                      <select
                        className="form-control"
                        value={selected.form_id || ''}
                        onChange={(e) => {
                          const nextFormId = e.target.value || null
                          setSelected((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  form_id: nextFormId,
                                  entry_config: {
                                    ...(prev.entry_config || {}),
                                    identifier_field_key: '',
                                    identifier_label: '',
                                    identifier_system_key: '',
                                    identifier_mask: '',
                                  },
                                }
                              : prev
                          )
                        }}
                      >
                        <option value="">Selecionar formulário...</option>
                        {forms.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.title}
                            {f.is_active ? ' (ativo)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Campo identificador</label>
                      <select
                        className="form-control"
                        value={selected.entry_config?.identifier_field_key || ''}
                        onChange={(e) => {
                          const key = e.target.value
                          const found = identifierOptions.find((o) => o.key === key)
                          setSelected((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  entry_config: {
                                    ...(prev.entry_config || {}),
                                    identifier_field_key: key,
                                    identifier_label: found?.label || key,
                                    identifier_system_key: found?.system_key || '',
                                    identifier_mask: found?.mask || '',
                                  },
                                }
                              : prev
                          )
                        }}
                      >
                        <option value="">Selecionar campo...</option>
                        {identifierOptions.map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.display_label || o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="form-grid form-grid-3">
                    <div className="form-group">
                      <label className="form-label">Normalização</label>
                      <select
                        className="form-control"
                        value={selected.entry_config?.identifier_normalization || 'auto'}
                        onChange={(e) =>
                          setSelected((prev) =>
                            prev ? { ...prev, entry_config: { ...(prev.entry_config || {}), identifier_normalization: e.target.value } } : prev
                          )
                        }
                      >
                        <option value="auto">Auto</option>
                        <option value="digits">Somente dígitos</option>
                        <option value="lowercase">Lowercase</option>
                        <option value="none">Sem normalizar</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Regra de Duplicidade</label>
                      <select
                        className="form-control"
                        value={selected.entry_config?.dedupe?.scope || 'active'}
                        onChange={(e) =>
                          setSelected((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  entry_config: {
                                    ...(prev.entry_config || {}),
                                    dedupe: {
                                      ...(prev.entry_config?.dedupe || {}),
                                      scope: e.target.value,
                                      enabled: true,
                                    },
                                  },
                                }
                              : prev
                          )
                        }
                      >
                        <option value="active">Bloquear se existir ativo</option>
                        <option value="active_archived">Bloquear ativo ou arquivado</option>
                        <option value="all">Bloquear em qualquer status</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Quando validar duplicação</label>
                      <select
                        className="form-control"
                        value={selected.entry_config?.validate_timing || 'both'}
                        onChange={(e) =>
                          setSelected((prev) =>
                            prev ? { ...prev, entry_config: { ...(prev.entry_config || {}), validate_timing: e.target.value } } : prev
                          )
                        }
                      >
                        <option value="both">Ao digitar e ao enviar</option>
                        <option value="on_blur">Ao digitar (blur)</option>
                        <option value="on_submit">Apenas ao enviar</option>
                      </select>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Mensagem de duplicidade para o usuário</label>
                    <textarea
                      className="form-control"
                      rows={3}
                      value={selected.entry_config?.dedupe?.message || ''}
                      onChange={(e) =>
                        setSelected((prev) =>
                          prev
                            ? {
                                ...prev,
                                entry_config: {
                                  ...(prev.entry_config || {}),
                                  dedupe: {
                                    ...(prev.entry_config?.dedupe || {}),
                                    enabled: true,
                                    message: e.target.value,
                                  },
                                },
                              }
                            : prev
                        )
                      }
                    />
                  </div>
                </div>

                <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)' }}>
                  <div className="section-divider" style={{ marginBottom: '1rem' }}>Link Público do Processo</div>
                  <div className="form-grid form-grid-3">
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', marginTop: '1.8rem' }}>
                      <input type="checkbox" checked={selected.is_public} onChange={(e) => setSelected({ ...selected, is_public: e.target.checked })} />
                      Processo público
                    </label>
                    <div className="form-group" style={{ gridColumn: 'span 2' }}>
                      <label className="form-label">Slug público</label>
                      <input
                        type="text"
                        className="form-control"
                        value={selected.public_slug || ''}
                        onChange={(e) => {
                          setSlugStatus('idle')
                          setSelected({ ...selected, public_slug: e.target.value })
                        }}
                        onBlur={() => validateAndSetSlug(selected.public_slug || '')}
                        disabled={!selected.is_public}
                      />
                      <div style={{ marginTop: '0.35rem', fontSize: '0.78rem', color: slugStatus === 'taken' ? 'var(--brs-danger)' : 'var(--brs-gray-500)' }}>
                        {slugStatus === 'checking'
                          ? 'Verificando slug...'
                          : slugStatus === 'available'
                            ? 'Slug disponível.'
                            : slugStatus === 'taken'
                              ? 'Slug em uso.'
                              : 'Use letras, números e hífen.'}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)' }}>
                  <div className="section-divider" style={{ marginBottom: '1rem' }}>Tags do Formulário</div>
                  <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--brs-gray-100)', borderRadius: 8 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: 'var(--brs-gray-50)' }}>
                          <th style={{ textAlign: 'left', padding: '0.45rem' }}>Label</th>
                          <th style={{ textAlign: 'left', padding: '0.45rem' }}>Tags para Uso (Key)</th>
                          <th style={{ textAlign: 'left', padding: '0.45rem' }}>Tipo</th>
                          <th style={{ textAlign: 'left', padding: '0.45rem' }}>Obrig.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {formTags.map((tag) => (
                          <tr key={tag.key} style={{ borderTop: '1px solid var(--brs-gray-100)' }}>
                            <td style={{ padding: '0.45rem' }}>{tag.label}</td>
                            <td style={{ padding: '0.45rem', color: 'var(--brs-gray-500)', fontFamily: 'monospace' }}>{tag.key}</td>
                            <td style={{ padding: '0.45rem' }}>{tag.type}</td>
                            <td style={{ padding: '0.45rem' }}>{tag.required ? 'Sim' : 'Não'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'etapas' && (() => {
              const activeStage = stages.find((s) => s.client_key === activeStageKey) || stages[0] || null
              const activeIdx = activeStage ? stages.findIndex((s) => s.client_key === activeStage.client_key) : -1
              const docs = activeStage ? getStageItems('documents', activeStage) : []
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Trilho do kanban de etapas (clicável) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', padding: '0.25rem 0' }}>
                    {stages.map((stage, idx) => (
                      <div key={stage.client_key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <button
                          type="button"
                          onClick={() => setActiveStageKey(stage.client_key)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.45rem',
                            padding: '0.5rem 0.8rem', borderRadius: 10, cursor: 'pointer',
                            border: `1px solid ${activeStage?.client_key === stage.client_key ? 'var(--brs-navy)' : 'var(--brs-gray-200)'}`,
                            background: activeStage?.client_key === stage.client_key ? 'var(--brs-primary-50)' : '#fff',
                            fontWeight: activeStage?.client_key === stage.client_key ? 800 : 600,
                            color: 'var(--brs-gray-800)',
                          }}
                        >
                          <span style={{ width: 10, height: 10, borderRadius: 999, background: stage.color || '#94A3B8' }} />
                          {stage.name || `Etapa ${idx + 1}`}
                          {stage?.config?.is_terminal && (
                            <span style={{ fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', color: '#065F46', background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 4, padding: '0 5px' }}>Fim</span>
                          )}
                        </button>
                        {idx < stages.length - 1 && <span style={{ color: 'var(--brs-gray-300)', fontSize: '1.1rem' }}>→</span>}
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => {
                        const key = makeClientKey()
                        setStages((prev) => [
                          ...prev,
                          { client_key: key, name: `Etapa ${prev.length + 1}`, position: prev.length, color: '#64748B', bg: '#F1F5F9', config: { transitions: [] } },
                        ])
                        setActiveStageKey(key)
                      }}
                    >
                      <Plus size={16} /> Etapa
                    </button>
                  </div>

                  {!activeStage ? (
                    <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--brs-gray-500)' }}>
                      Nenhuma etapa ainda. Clique em <strong>+ Etapa</strong> para começar a montar o fluxo.
                    </div>
                  ) : (
                    <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)' }}>
                      {/* Cabeçalho do painel da etapa */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.1rem', flexWrap: 'wrap' }}>
                        <span style={{ width: 12, height: 12, borderRadius: 999, background: activeStage.color || '#94A3B8' }} />
                        <input
                          className="form-control"
                          value={activeStage.name}
                          onChange={(e) => {
                            const newName = e.target.value
                            setStages((prev) => prev.map((s, i) => (i === activeIdx ? { ...s, name: newName } : s)))
                            renameStageReferences(activeStage.client_key, activeStage.name, newName)
                          }}
                          style={{ maxWidth: 320, fontWeight: 700 }}
                        />
                        <input
                          type="color"
                          className="form-control"
                          value={activeStage.color || '#3B82F6'}
                          onChange={(e) => setStages((prev) => prev.map((s, i) => (i === activeIdx ? { ...s, color: e.target.value } : s)))}
                          style={{ width: 46, height: 40, padding: '0.2rem' }}
                          title="Cor da etapa"
                        />
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.35rem' }}>
                          <button type="button" className="btn btn-ghost btn-xs btn-icon" title="Mover para a esquerda" onClick={() => moveStage(activeIdx, 'up')} disabled={activeIdx <= 0}>
                            <ChevronUp size={16} style={{ transform: 'rotate(-90deg)' }} />
                          </button>
                          <button type="button" className="btn btn-ghost btn-xs btn-icon" title="Mover para a direita" onClick={() => moveStage(activeIdx, 'down')} disabled={activeIdx >= stages.length - 1}>
                            <ChevronDown size={16} style={{ transform: 'rotate(-90deg)' }} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline text-danger"
                            onClick={() => {
                              if (!confirm(`Excluir a etapa "${activeStage.name}"? As ações dela também serão removidas.`)) return
                              removeStageReferences(activeStage)
                              setStages((prev) => prev.filter((_, i) => i !== activeIdx).map((s, i) => ({ ...s, position: i })))
                              setActiveStageKey(null)
                            }}
                          >
                            <Trash size={15} /> Excluir etapa
                          </button>
                        </div>
                      </div>

                      {/* ① Ao entrar: documentos */}
                      <div style={{ marginBottom: '1.25rem' }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--brs-navy)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ background: 'var(--brs-navy)', color: '#fff', width: 20, height: 20, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem' }}>1</span>
                          Ao ENTRAR nesta etapa, gerar documento(s)
                        </div>
                        {docs.length === 0 && (
                          <div style={{ fontSize: '0.82rem', color: 'var(--brs-gray-400)', marginBottom: '0.5rem' }}>
                            Nenhum documento nesta etapa. Adicione se ela gera um contrato para assinatura.
                          </div>
                        )}
                        {docs.map((doc: any, index: number) => (
                          <div key={`${activeStage.client_key}-doc-${index}`} style={{ border: '1px solid var(--brs-gray-100)', borderRadius: 8, padding: '0.65rem', marginBottom: '0.55rem' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr auto', gap: '0.6rem', alignItems: 'end' }}>
                              <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label" style={{ fontSize: '0.75rem' }}>Nome do documento</label>
                                <input className="form-control" placeholder="Ex.: Contrato PS PJ" value={doc.name || ''} onChange={(e) => updateStageItem('documents', activeStage, index, { name: e.target.value })} />
                              </div>
                              <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label" style={{ fontSize: '0.75rem' }}>Template da Assinafy (gera o contrato)</label>
                                <select
                                  className="form-control"
                                  value={doc.assinafy_template_name || ''}
                                  onChange={(e) => updateStageItem('documents', activeStage, index, { assinafy_template_name: e.target.value, trigger: 'on_enter' })}
                                >
                                  <option value="">
                                    {assinafyTemplates.length ? 'Selecionar template da Assinafy' : 'Nenhum template (configure a Assinafy)'}
                                  </option>
                                  {assinafyTemplates.map((t) => (
                                    <option key={t.id} value={t.name}>{t.name}</option>
                                  ))}
                                </select>
                              </div>
                              <button type="button" className="btn btn-outline text-danger" style={{ height: 40 }} onClick={() => removeStageItem('documents', activeStage, index)}>
                                <Trash size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                        <button type="button" className="btn btn-outline" onClick={() => addStageItem('documents', activeStage, { name: '', assinafy_template_name: '', trigger: 'on_enter' })}>
                          <Plus size={16} /> Adicionar documento
                        </button>
                      </div>

                      {/* ② Ao concluir: saída da etapa */}
                      <div style={{ borderTop: '1px dashed var(--brs-gray-200)', paddingTop: '1rem' }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--brs-navy)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ background: 'var(--brs-navy)', color: '#fff', width: 20, height: 20, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem' }}>2</span>
                          Ao CONCLUIR esta etapa
                        </div>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', marginBottom: '0.6rem' }}>
                          <input
                            type="checkbox"
                            checked={!!activeStage?.config?.is_terminal}
                            onChange={(e) =>
                              setStages((prev) =>
                                prev.map((s, i) => (i === activeIdx ? { ...s, config: { ...(s.config || {}), is_terminal: e.target.checked, transitions: e.target.checked ? [] : (s.config?.transitions || []) } } : s))
                              )
                            }
                          />
                          Esta é a etapa final (encerra o processo)
                        </label>
                        {!activeStage?.config?.is_terminal && (
                          <div className="form-group" style={{ maxWidth: 380, marginBottom: 0 }}>
                            <label className="form-label">Avançar para →</label>
                            <select
                              className="form-control"
                              value={(Array.isArray(activeStage?.config?.transitions) && activeStage.config.transitions[0]) || ''}
                              onChange={(e) => {
                                const val = e.target.value
                                setStages((prev) =>
                                  prev.map((s, i) => (i === activeIdx ? { ...s, config: { ...(s.config || {}), transitions: val ? [val] : [] } } : s))
                                )
                              }}
                            >
                              <option value="">Próxima etapa (na ordem do kanban)</option>
                              {stages
                                .filter((s) => s.client_key !== activeStage.client_key)
                                .map((s) => (
                                  <option key={s.client_key} value={s.name}>{s.name}</option>
                                ))}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}

            {activeTab === 'campos' && (
              <div style={{ display: 'grid', gap: '0.8rem' }}>
                {stages.map((stage) => {
                  const items = getStageItems('process_fields', stage)
                  return (
                    <div key={stage.client_key} className="card" style={{ padding: '0.9rem', border: '1px solid var(--brs-gray-100)' }}>
                      <div style={{ fontWeight: 800, marginBottom: '0.6rem' }}>{stage.name}</div>
                      {items.map((field: any, index: number) => (
                        <div key={`${stage.client_key}-field-${index}`} style={{ border: '1px solid var(--brs-gray-100)', borderRadius: 8, padding: '0.65rem', marginBottom: '0.55rem' }}>
                          <div className="form-grid form-grid-4">
                            <input
                              className="form-control"
                              placeholder="Nome do Campo"
                              value={field.label || ''}
                              onChange={(e) => {
                                const nextLabel = e.target.value
                                const nextKey = buildUniqueFieldKey(nextLabel || 'campo', stage, index)
                                updateStageItem('process_fields', stage, index, { label: nextLabel, key: nextKey })
                              }}
                            />
                            <select className="form-control" value={field.type || ''} onChange={(e) => updateStageItem('process_fields', stage, index, { type: e.target.value })}>
                              <option value="" disabled>Tipo de Campo</option>
                              <option value="text">Texto</option>
                              <option value="date">Data</option>
                              <option value="checkbox">CheckBox</option>
                              <option value="email">E-mail</option>
                              <option value="number">Número</option>
                            </select>
                            <button type="button" className="btn btn-outline text-danger" onClick={() => removeStageItem('process_fields', stage, index)}>
                              <Trash size={14} />
                            </button>
                          </div>
                          <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: 'var(--brs-gray-500)' }}>
                            Chave técnica gerada automaticamente: <code>{field.key || '(aguardando nome do campo)'}</code>
                          </div>
                          <div className="form-grid form-grid-3" style={{ marginTop: '0.5rem' }}>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
                              <input type="checkbox" checked={!!field.required} onChange={(e) => updateStageItem('process_fields', stage, index, { required: e.target.checked })} />
                              Obrigatório
                            </label>
                            <select className="form-control" value={field.trigger || ''} onChange={(e) => updateStageItem('process_fields', stage, index, { trigger: e.target.value })}>
                              <option value="" disabled>Gatilho de acionamento</option>
                              <option value="on_enter">Ao entrar na etapa</option>
                              <option value="on_exit">Ao sair da etapa</option>
                              <option value="manual">Manual</option>
                            </select>
                          </div>
                        </div>
                      ))}
                      <button type="button" className="btn btn-outline" onClick={() => addStageItem('process_fields', stage, { key: buildUniqueFieldKey('campo', stage, -1), label: '', type: '', required: false, trigger: '' })}>
                        <Plus size={16} />
                        Adicionar campo na etapa
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* A aba "Documentos" foi fundida no editor por etapa (aba Etapas & Ações),
                onde o documento é configurado dentro da própria etapa (① ao entrar). */}

            {activeTab === 'emails' && (
              <div style={{ display: 'grid', gap: '0.8rem' }}>
                {stages.map((stage) => {
                  const items = getStageItems('emails', stage)
                  return (
                    <div key={stage.client_key} className="card" style={{ padding: '0.9rem', border: '1px solid var(--brs-gray-100)' }}>
                      <div style={{ fontWeight: 800, marginBottom: '0.6rem' }}>{stage.name}</div>
                      {items.map((mail: any, index: number) => {
                        const template = findEmailTemplate(mail)
                        const effectiveTemplateId = String(mail?.template_id || template?.id || '')
                        const subjectText = String(template?.subject || '')
                        const bodyText = String(template?.body || '')
                        const subjectTokens = extractTokens(subjectText)
                        const bodyTokens = extractTokens(bodyText)
                        const tokenMapping = mail?.token_mapping && typeof mail.token_mapping === 'object' ? mail.token_mapping : {}
                        const pendingSubject = subjectTokens.filter((t) => !EMAIL_AUTOFILL_TOKENS.has(t) && !String(tokenMapping?.[t] || '').trim())
                        const pendingBody = bodyTokens.filter((t) => !EMAIL_AUTOFILL_TOKENS.has(t) && !String(tokenMapping?.[t] || '').trim())
                        const copyKey = `${stage.client_key}-mail-${index}`
                        const copyRecipients = normalizeCopyRecipients(mail?.copy_recipients)
                        const copyDraft = String(copyDraftByKey[copyKey] || '')
                        const hasResendPeriod = Number(mail?.resend_period_value || 0) > 0 && !!String(mail?.resend_period_unit || '')

                        return (
                          <div key={`${stage.client_key}-mail-${index}`} style={{ border: '1px solid var(--brs-gray-100)', borderRadius: 8, padding: '0.65rem', marginBottom: '0.55rem' }}>
                            <div className="form-grid form-grid-4">
                              <input className="form-control" placeholder="Nome do disparo" value={mail.name || ''} onChange={(e) => updateStageItem('emails', stage, index, { name: e.target.value })} />
                              <select
                                className="form-control"
                                value={effectiveTemplateId}
                                onChange={(e) => {
                                  const templateId = e.target.value
                                  const selectedTemplate = emailTemplates.find((t) => t.id === templateId) || null
                                  const nextTokens = selectedTemplate
                                    ? [...new Set([...extractTokens(selectedTemplate.subject || ''), ...extractTokens(selectedTemplate.body || '')])]
                                    : []
                                  const currentMapping = mail?.token_mapping && typeof mail.token_mapping === 'object' ? mail.token_mapping : {}
                                  const nextMapping: Record<string, string> = {}
                                  for (const token of nextTokens) {
                                    const mapped = String(currentMapping?.[token] || '').trim()
                                    if (mapped) nextMapping[token] = mapped
                                  }
                                  updateStageItem('emails', stage, index, {
                                    template_id: templateId,
                                    template_name: selectedTemplate?.name || '',
                                    token_mapping: nextMapping,
                                  })
                                }}
                                title={String(template?.name || mail?.template_name || '')}
                              >
                                <option value="">Selecionar modelo de e-mail</option>
                                {emailTemplates.map((t) => (
                                  <option key={t.id} value={t.id} title={t.name}>
                                    {truncateText(String(t.name || ''), IDENTIFIER_OPTION_MAX_CHARS)}
                                  </option>
                                ))}
                              </select>
                              <select
                                className="form-control"
                                value={mail.trigger || 'on_enter'}
                                onChange={(e) => {
                                  const trigger = e.target.value
                                  updateStageItem('emails', stage, index, {
                                    trigger,
                                    ...(trigger === SIGNATURE_LINK_TRIGGER ? {} : { signature_document_ref: '', signature_signer_role: '' }),
                                  })
                                }}
                              >
                                <option value="on_enter">Gatilho: ao entrar</option>
                                <option value="on_exit">Gatilho: ao sair</option>
                                <option value="manual">Gatilho: manual</option>
                                <option value={SIGNATURE_LINK_TRIGGER}>Gatilho: link de assinatura disponível</option>
                              </select>
                              <button type="button" className="btn btn-outline text-danger" onClick={() => removeStageItem('emails', stage, index)}>
                                <Trash size={14} />
                              </button>
                            </div>

                            <div className="card" style={{ marginTop: '0.5rem', padding: '0.75rem', border: '1px solid var(--brs-gray-100)', background: 'var(--brs-gray-50)' }}>
                              <div style={{ fontWeight: 800, marginBottom: '0.5rem' }}>DESTINATÁRIOS E CÓPIAS</div>
                              <div className="form-grid form-grid-2">
                                <div className="form-group">
                                  <label className="form-label">E-mail Destinatário</label>
                                  <select
                                    className="form-control"
                                    value={String(mail.recipient_field || '')}
                                    onChange={(e) => updateStageItem('emails', stage, index, { recipient_source: 'tag', recipient_field: e.target.value })}
                                  >
                                    <option value="">Selecionar tag do processo</option>
                                    {processEmailTagOptions.map((option) => (
                                      <option key={option.key} value={option.key} title={option.display_text}>
                                        {option.display_text}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div className="form-group">
                                  <label className="form-label">E-mail Cópia</label>
                                  <div style={{ display: 'grid', gap: '0.4rem' }}>
                                    <select
                                      className="form-control"
                                      defaultValue=""
                                      onChange={(e) => {
                                        const selectedKey = String(e.target.value || '')
                                        if (!selectedKey) return
                                        const next = [...copyRecipients]
                                        const already = next.some((r) => r.type === 'tag' && r.value === selectedKey)
                                        if (!already) next.push({ type: 'tag', value: selectedKey })
                                        updateStageItem('emails', stage, index, { copy_recipients: next })
                                        e.currentTarget.value = ''
                                      }}
                                    >
                                      <option value="">Adicionar tag de e-mail...</option>
                                      {processEmailTagOptions.map((option) => (
                                        <option key={option.key} value={option.key} title={option.display_text}>
                                          {option.display_text}
                                        </option>
                                      ))}
                                    </select>

                                    <div
                                      style={{
                                        display: 'flex',
                                        flexWrap: 'wrap',
                                        gap: '0.35rem',
                                        alignItems: 'center',
                                        padding: '0.45rem 0.55rem',
                                        border: '1px solid var(--brs-gray-200)',
                                        borderRadius: 10,
                                        background: 'white',
                                        minHeight: 42,
                                      }}
                                    >
                                      {copyRecipients.map((entry, chipIndex) => {
                                        const isTag = entry.type === 'tag'
                                        const opt = isTag ? processTagOptions.find((o) => o.key === entry.value) : null
                                        const label = isTag ? String(opt?.display_text || entry.value) : entry.value
                                        return (
                                          <span
                                            key={`${entry.type}:${entry.value}:${chipIndex}`}
                                            className={`badge ${isTag ? 'badge-gray' : 'badge-info'}`}
                                            title={label}
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                                          >
                                            <span style={{ fontFamily: isTag ? 'monospace' : 'inherit' }}>{label}</span>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const next = copyRecipients.filter((_, idx) => idx !== chipIndex)
                                                updateStageItem('emails', stage, index, { copy_recipients: next })
                                              }}
                                              style={{
                                                border: 'none',
                                                background: 'transparent',
                                                cursor: 'pointer',
                                                fontWeight: 900,
                                                lineHeight: 1,
                                                padding: 0,
                                              }}
                                            >
                                              ×
                                            </button>
                                          </span>
                                        )
                                      })}
                                      <input
                                        className="form-control"
                                        style={{ border: 'none', boxShadow: 'none', minWidth: 180, flex: 1, padding: 0, height: 28 }}
                                        placeholder="Digite um e-mail e pressione Enter"
                                        value={copyDraft}
                                        onChange={(e) => setCopyDraftByKey((prev) => ({ ...prev, [copyKey]: e.target.value }))}
                                        onKeyDown={(e) => {
                                          if (e.key !== 'Enter' && e.key !== 'Tab') return
                                          const raw = String(copyDraft || '').trim()
                                          if (!raw) return
                                          if (!isValidEmail(raw)) {
                                            setMessage({ type: 'error', text: `E-mail de cópia inválido: ${raw}` })
                                            return
                                          }
                                          e.preventDefault()
                                          const next = [...copyRecipients]
                                          const already = next.some((r) => r.type === 'email' && r.value.toLowerCase() === raw.toLowerCase())
                                          if (!already) next.push({ type: 'email', value: raw })
                                          updateStageItem('emails', stage, index, { copy_recipients: next })
                                          setCopyDraftByKey((prev) => ({ ...prev, [copyKey]: '' }))
                                        }}
                                        onBlur={() => {
                                          const raw = String(copyDraft || '').trim()
                                          if (!raw) return
                                          if (!isValidEmail(raw)) {
                                            setMessage({ type: 'error', text: `E-mail de cópia inválido: ${raw}` })
                                            return
                                          }
                                          const next = [...copyRecipients]
                                          const already = next.some((r) => r.type === 'email' && r.value.toLowerCase() === raw.toLowerCase())
                                          if (!already) next.push({ type: 'email', value: raw })
                                          updateStageItem('emails', stage, index, { copy_recipients: next })
                                          setCopyDraftByKey((prev) => ({ ...prev, [copyKey]: '' }))
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="card" style={{ marginTop: '0.5rem', padding: '0.75rem', border: '1px solid var(--brs-gray-100)', background: 'var(--brs-gray-50)' }}>
                              <div style={{ fontWeight: 800, marginBottom: '0.5rem' }}>REENVIO</div>
                              <div className="form-grid form-grid-3">
                                <div className="form-group">
                                  <label className="form-label">Período para Reenvio</label>
                                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    <input
                                      className="form-control"
                                      type="number"
                                      min={1}
                                      max={60}
                                      placeholder="01 a 60"
                                      value={mail.resend_period_value ?? ''}
                                      onChange={(e) => {
                                        const raw = e.target.value
                                        const nextValue = raw === '' ? '' : Math.max(0, Math.min(60, Number(raw)))
                                        if (!nextValue) {
                                          updateStageItem('emails', stage, index, {
                                            resend_period_value: '',
                                            resend_period_unit: '',
                                            resend_trigger: '',
                                            resend_repeat_count: '',
                                          })
                                          return
                                        }
                                        updateStageItem('emails', stage, index, { resend_period_value: nextValue })
                                      }}
                                    />
                                    <select
                                      className="form-control"
                                      value={String(mail.resend_period_unit || '')}
                                      onChange={(e) => {
                                        const unit = e.target.value
                                        if (!unit) {
                                          updateStageItem('emails', stage, index, {
                                            resend_period_unit: '',
                                            resend_trigger: '',
                                            resend_repeat_count: '',
                                          })
                                          return
                                        }
                                        updateStageItem('emails', stage, index, { resend_period_unit: unit })
                                      }}
                                    >
                                      <option value="">Unidade</option>
                                      <option value="minutes">Minutos</option>
                                      <option value="hours">Horas</option>
                                      <option value="days">Dias</option>
                                    </select>
                                  </div>
                                </div>

                                <div className="form-group">
                                  <label className="form-label">Gatilho de Reenvio</label>
                                  <select
                                    className="form-control"
                                    disabled={!hasResendPeriod}
                                    value={String(mail.resend_trigger || '')}
                                    onChange={(e) => updateStageItem('emails', stage, index, { resend_trigger: e.target.value })}
                                  >
                                    <option value="">Selecionar</option>
                                    <option value="signature_not_finished">Assinatura não finalizada</option>
                                    <option value="elapsed_time">Tempo decorrido</option>
                                  </select>
                                </div>

                                <div className="form-group">
                                  <label className="form-label">Número de Repetições do Reenvio</label>
                                  <input
                                    className="form-control"
                                    type="number"
                                    min={1}
                                    placeholder="Quantidade"
                                    disabled={!hasResendPeriod}
                                    value={mail.resend_repeat_count ?? ''}
                                    onChange={(e) =>
                                      updateStageItem('emails', stage, index, {
                                        resend_repeat_count: e.target.value === '' ? '' : Number(e.target.value),
                                      })
                                    }
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="card" style={{ marginTop: '0.5rem', padding: '0.75rem', border: '1px solid var(--brs-gray-100)', background: 'var(--brs-gray-50)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <div style={{ fontWeight: 800 }}>ASSUNTO DO E-MAIL</div>
                                {pendingSubject.length === 0 ? (
                                  <span className="badge badge-success">Sem pendências</span>
                                ) : (
                                  <span className="badge badge-warning">{pendingSubject.length} pendente(s)</span>
                                )}
                              </div>
                              <input className="form-control" readOnly value={subjectText} placeholder="Selecione um modelo para ver o assunto" />
                              {!template ? (
                                <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>
                                  Selecione um modelo de e-mail para listar as tags do assunto.
                                </div>
                              ) : subjectTokens.length === 0 ? (
                                <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>
                                  Nenhuma tag detectada no assunto.
                                </div>
                              ) : (
                                <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                      <tr style={{ textAlign: 'left' }}>
                                        <th style={{ padding: '0.35rem 0.25rem', fontSize: '0.8rem', color: 'var(--brs-gray-600)' }}>Tag</th>
                                        <th style={{ padding: '0.35rem 0.25rem', fontSize: '0.8rem', color: 'var(--brs-gray-600)' }}>Vincular com tag do processo</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {subjectTokens.map((token) => {
                                        const isAuto = EMAIL_AUTOFILL_TOKENS.has(token)
                                        return (
                                          <tr key={`subject-${token}`} style={{ borderTop: '1px solid var(--brs-gray-100)' }}>
                                            <td style={{ padding: '0.35rem 0.25rem', fontFamily: 'monospace', fontSize: '0.85rem' }}>{token}</td>
                                            <td style={{ padding: '0.35rem 0.25rem' }}>
                                              {isAuto ? (
                                                <input className="form-control" readOnly value="Automático" />
                                              ) : (
                                                <select
                                                  className="form-control"
                                                  value={String(tokenMapping?.[token] || '')}
                                                  onChange={(e) => {
                                                    const next = { ...(tokenMapping || {}), [token]: e.target.value }
                                                    updateStageItem('emails', stage, index, { token_mapping: next })
                                                  }}
                                                >
                                                  <option value="">Selecionar tag do processo</option>
                                                  {processTagOptions.map((option) => (
                                                    <option key={option.key} value={option.key} title={option.display_text}>
                                                      {option.display_text}
                                                    </option>
                                                  ))}
                                                </select>
                                              )}
                                            </td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>

                            <div className="card" style={{ marginTop: '0.5rem', padding: '0.75rem', border: '1px solid var(--brs-gray-100)', background: 'var(--brs-gray-50)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <div style={{ fontWeight: 800 }}>TAGs DO CORPO DO E-MAIL</div>
                                {pendingBody.length === 0 ? (
                                  <span className="badge badge-success">Sem pendências</span>
                                ) : (
                                  <span className="badge badge-warning">{pendingBody.length} pendente(s)</span>
                                )}
                              </div>
                              {!template ? (
                                <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>
                                  Selecione um modelo de e-mail para listar as tags do corpo.
                                </div>
                              ) : bodyTokens.length === 0 ? (
                                <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>
                                  Nenhuma tag detectada no corpo.
                                </div>
                              ) : (
                                <div style={{ overflowX: 'auto' }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                      <tr style={{ textAlign: 'left' }}>
                                        <th style={{ padding: '0.35rem 0.25rem', fontSize: '0.8rem', color: 'var(--brs-gray-600)' }}>Tag</th>
                                        <th style={{ padding: '0.35rem 0.25rem', fontSize: '0.8rem', color: 'var(--brs-gray-600)' }}>Vincular com tag do processo</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {bodyTokens.map((token) => {
                                        const isAuto = EMAIL_AUTOFILL_TOKENS.has(token)
                                        return (
                                          <tr key={`body-${token}`} style={{ borderTop: '1px solid var(--brs-gray-100)' }}>
                                            <td style={{ padding: '0.35rem 0.25rem', fontFamily: 'monospace', fontSize: '0.85rem' }}>{token}</td>
                                            <td style={{ padding: '0.35rem 0.25rem' }}>
                                              {isAuto ? (
                                                <input className="form-control" readOnly value="Automático" />
                                              ) : (
                                                <select
                                                  className="form-control"
                                                  value={String(tokenMapping?.[token] || '')}
                                                  onChange={(e) => {
                                                    const next = { ...(tokenMapping || {}), [token]: e.target.value }
                                                    updateStageItem('emails', stage, index, { token_mapping: next })
                                                  }}
                                                >
                                                  <option value="">Selecionar tag do processo</option>
                                                  {processTagOptions.map((option) => (
                                                    <option key={option.key} value={option.key} title={option.display_text}>
                                                      {option.display_text}
                                                    </option>
                                                  ))}
                                                </select>
                                              )}
                                            </td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>

                            {String(mail.trigger || '') === SIGNATURE_LINK_TRIGGER && (
                              <div className="form-grid form-grid-3" style={{ marginTop: '0.5rem' }}>
                                <select
                                  className="form-control"
                                  value={mail.signature_document_ref || ''}
                                  onChange={(e) => updateStageItem('emails', stage, index, { signature_document_ref: e.target.value })}
                                >
                                  <option value="">Documento de assinatura vinculado</option>
                                  {processDocumentOptions.map((docOption) => (
                                    <option key={docOption.key} value={docOption.key}>
                                      {docOption.label}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  className="form-control"
                                  value={mail.signature_signer_role || ''}
                                  onChange={(e) => updateStageItem('emails', stage, index, { signature_signer_role: e.target.value })}
                                >
                                  <option value="">Papel do assinante</option>
                                  {SIGNER_ROLE_OPTIONS.map((roleOption) => (
                                    <option key={roleOption.value} value={roleOption.value}>
                                      {roleOption.label}
                                    </option>
                                  ))}
                                </select>
                                <input className="form-control" readOnly value="Dispara quando o link do assinante é recebido da assinatura eletrônica." />
                              </div>
                            )}
                          </div>
                        )
                      })}
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() =>
                          addStageItem('emails', stage, {
                            name: '',
                            template_id: '',
                            template_name: '',
                            trigger: 'on_enter',
                            recipient_source: 'tag',
                            recipient_field: '',
                            copy_recipients: [],
                            token_mapping: {},
                            resend_period_value: '',
                            resend_period_unit: '',
                            resend_trigger: '',
                            resend_repeat_count: '',
                          })
                        }
                      >
                        <Plus size={16} />
                        Adicionar e-mail na etapa
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {activeTab === 'whatsapp' && (
              <div style={{ display: 'grid', gap: '0.8rem' }}>
                {stages.map((stage) => {
                  const items = getStageItems('whatsapp', stage)
                  return (
                    <div key={stage.client_key} className="card" style={{ padding: '0.9rem', border: '1px solid var(--brs-gray-100)' }}>
                      <div style={{ fontWeight: 800, marginBottom: '0.6rem' }}>{stage.name}</div>
                      {items.map((msg: any, index: number) => (
                        <div key={`${stage.client_key}-wa-${index}`} style={{ border: '1px solid var(--brs-gray-100)', borderRadius: 8, padding: '0.65rem', marginBottom: '0.55rem' }}>
                          <div className="form-grid form-grid-4">
                            <input className="form-control" placeholder="Nome do disparo" value={msg.name || ''} onChange={(e) => updateStageItem('whatsapp', stage, index, { name: e.target.value })} />
                            <input className="form-control" placeholder="Modelo de WhatsApp" value={msg.template_name || ''} onChange={(e) => updateStageItem('whatsapp', stage, index, { template_name: e.target.value })} />
                            <select
                              className="form-control"
                              value={msg.trigger || 'on_enter'}
                              onChange={(e) => {
                                const trigger = e.target.value
                                updateStageItem('whatsapp', stage, index, {
                                  trigger,
                                  ...(trigger === SIGNATURE_LINK_TRIGGER
                                    ? {}
                                    : { signature_document_ref: '', signature_signer_role: '' }),
                                })
                              }}
                            >
                              <option value="on_enter">Gatilho: ao entrar</option>
                              <option value="on_exit">Gatilho: ao sair</option>
                              <option value="manual">Gatilho: manual</option>
                              <option value={SIGNATURE_LINK_TRIGGER}>Gatilho: link de assinatura disponível</option>
                            </select>
                            <button type="button" className="btn btn-outline text-danger" onClick={() => removeStageItem('whatsapp', stage, index)}>
                              <Trash size={14} />
                            </button>
                          </div>
                          <div className="form-grid form-grid-3" style={{ marginTop: '0.5rem' }}>
                            <select className="form-control" value={msg.recipient_source || 'tag'} onChange={(e) => updateStageItem('whatsapp', stage, index, { recipient_source: e.target.value })}>
                              <option value="tag">Destinatário por tag</option>
                              <option value="fixed">Destinatário fixo</option>
                            </select>
                            <input className="form-control" placeholder="Tag/campo telefone" value={msg.recipient_field || ''} onChange={(e) => updateStageItem('whatsapp', stage, index, { recipient_field: e.target.value })} />
                            <input className="form-control" placeholder="Fallback telefone" value={msg.recipient_fallback || ''} onChange={(e) => updateStageItem('whatsapp', stage, index, { recipient_fallback: e.target.value })} />
                          </div>
                          {String(msg.trigger || '') === SIGNATURE_LINK_TRIGGER && (
                            <div className="form-grid form-grid-3" style={{ marginTop: '0.5rem' }}>
                              <select
                                className="form-control"
                                value={msg.signature_document_ref || ''}
                                onChange={(e) => updateStageItem('whatsapp', stage, index, { signature_document_ref: e.target.value })}
                              >
                                <option value="">Documento de assinatura vinculado</option>
                                {processDocumentOptions.map((docOption) => (
                                  <option key={docOption.key} value={docOption.key}>
                                    {docOption.label}
                                  </option>
                                ))}
                              </select>
                              <select
                                className="form-control"
                                value={msg.signature_signer_role || ''}
                                onChange={(e) => updateStageItem('whatsapp', stage, index, { signature_signer_role: e.target.value })}
                              >
                                <option value="">Papel do assinante</option>
                                {SIGNER_ROLE_OPTIONS.map((roleOption) => (
                                  <option key={roleOption.value} value={roleOption.value}>
                                    {roleOption.label}
                                  </option>
                                ))}
                              </select>
                              <input
                                className="form-control"
                                readOnly
                                value="Dispara quando o link do assinante é recebido da assinatura eletrônica."
                              />
                            </div>
                          )}
                        </div>
                      ))}
                      <button type="button" className="btn btn-outline" onClick={() => addStageItem('whatsapp', stage, { name: '', template_name: '', trigger: 'on_enter', recipient_source: 'tag' })}>
                        <Plus size={16} />
                        Adicionar WhatsApp na etapa
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {activeTab === 'regras' && (
              <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)' }}>
                <div className="section-divider" style={{ marginBottom: '1rem' }}>Regras Globais e SLA</div>
                <div className="form-grid form-grid-3">
                  <div className="form-group">
                    <label className="form-label">SLA Default (horas)</label>
                    <input
                      className="form-control"
                      type="number"
                      value={selected.config?.rules?.default_sla_hours || ''}
                      onChange={(e) => updateConfigValue('rules.default_sla_hours', Number(e.target.value || 0) || null)}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Calendário</label>
                    <select className="form-control" value={selected.config?.rules?.work_calendar || 'dias_uteis'} onChange={(e) => updateConfigValue('rules.work_calendar', e.target.value)}>
                      <option value="dias_uteis">Dias úteis</option>
                      <option value="corridos">Dias corridos</option>
                    </select>
                  </div>

                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', marginTop: '1.8rem' }}>
                    <input type="checkbox" checked={!!selected.config?.rules?.strict_stage_exit} onChange={(e) => updateConfigValue('rules.strict_stage_exit', e.target.checked)} />
                    Bloquear saída da etapa se pendências obrigatórias
                  </label>
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--brs-gray-100)', paddingTop: '0.75rem', display: 'grid', gap: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input type="text" className="form-control" readOnly value={publicUrl} style={{ maxWidth: 320 }} placeholder="/cadastro-parceiro/..." />
              <button
                type="button"
                className="btn btn-outline"
                disabled={!canOpenPublicLink}
                onClick={async () => {
                  if (!publicUrl) return
                  try {
                    await navigator.clipboard.writeText(publicUrl)
                    setMessage({ type: 'success', text: 'Link copiado.' })
                  } catch {
                    setMessage({ type: 'error', text: 'Falha ao copiar link.' })
                  }
                }}
              >
                <Copy size={15} />
                Copiar Link
              </button>
              <button type="button" className="btn btn-outline" disabled={!canOpenPublicLink} onClick={() => window.open(publicUrl, '_blank')}>
                <ExternalLink size={15} />
                Abrir Link
              </button>
              <button type="button" className="btn btn-outline" disabled={!canRunValidation} onClick={runHealthValidation}>
                <ShieldCheck size={15} />
                Validar Processo
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setView('list')}>
                Voltar para lista
              </button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={(e) => handleSave(e as any)}>
                {saving ? <Loader2 size={15} className="spinner" /> : <Save size={15} />}
                Salvar {hasPendingChanges ? '(pendente)' : ''}
              </button>
            </div>

            {(health.blocking.length > 0 || health.warnings.length > 0) && (
              <div className="card" style={{ padding: '0.75rem', border: '1px solid var(--brs-gray-100)' }}>
                {health.blocking.length > 0 && (
                  <div style={{ marginBottom: '0.45rem' }}>
                    <div style={{ fontWeight: 700, color: 'var(--brs-danger)', marginBottom: '0.25rem' }}>Erros bloqueantes</div>
                    {health.blocking.map((item, idx) => (
                      <div key={`block-${idx}`} style={{ fontSize: '0.85rem', color: '#991B1B' }}>
                        - {item}
                      </div>
                    ))}
                  </div>
                )}
                {health.warnings.length > 0 && (
                  <div>
                    <div style={{ fontWeight: 700, color: '#92400E', marginBottom: '0.25rem' }}>Alertas</div>
                    {health.warnings.map((item, idx) => (
                      <div key={`warn-${idx}`} style={{ fontSize: '0.85rem', color: '#92400E' }}>
                        - {item}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
