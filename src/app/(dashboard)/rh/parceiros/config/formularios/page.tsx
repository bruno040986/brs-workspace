'use client'

import { useState, useEffect, useRef } from 'react'
import { getPartnerForms, savePartnerForm, deletePartnerForm } from '../../actions'
import { Plus, Trash, Save, Loader2, X, ChevronUp, ChevronDown, Eye, CheckCircle, AlertCircle, Phone, Monitor, Copy, Pencil, Files } from 'lucide-react'
import { getSystemKeyOptionGroups, SYSTEM_KEY_NONE } from '@/lib/agente-corban-fields'

interface FormField {
  key: string
  label: string
  description?: string
  type: 'text' | 'select' | 'checkbox' | 'file'
  hidden?: boolean
  mask?: 'none' | 'cpf' | 'cnpj' | 'cep' | 'email' | 'phone_landline' | 'phone_mobile' | 'date' | 'pix_uuid' | 'bank_account' | 'bank_agency_with_digit' | 'bank_agency_without_digit' | 'bank_agency_digit'
  system_key?: string
  required: boolean
  options?: string[] // Para campos de seleção (manual)
  options_source?: 'banks' | 'ufs' // Listas prontas (API)
  conditional?: {
    field_id: string
    value: string
  }
}

interface PartnerFormConfig {
  schema_version?: number
  intro?: { title?: string; text?: string; start_label?: string }
  closing?: { title?: string; lead?: string; text?: string; button_label?: string; button_url?: string }
  submit?: { finish_label?: string }
  branding?: { primary_color?: string; accent_color?: string; logo_url?: string; favicon_url?: string }
}

interface PartnerForm {
  id?: string
  title: string
  slug?: string
  is_active: boolean
  schema: FormField[]
  config?: PartnerFormConfig
  created_at?: string
  updated_at?: string
}

type BlockId =
  | 'empresa'
  | 'socio_principal'
  | 'socio_secundario'
  | 'contato_pj'
  | 'bancario_pj'
  | 'pessoa_fisica'
  | 'contato_pf'
  | 'endereco_pf'
  | 'assinatura_pf'
  | 'bancario_pf'

/**
 * As opções de vínculo vêm do dicionário canônico do Agente Corban — escolher um
 * campo aqui é escolher um campo da entidade, não uma etiqueta solta. Adicionar
 * um campo novo ao dicionário o faz aparecer neste seletor automaticamente.
 */
const SYSTEM_KEY_GROUPS = getSystemKeyOptionGroups()

/** Todas as opções em lista plana, para validação e busca reversa. */
const SYSTEM_KEY_VALUES = new Set<string>([
  SYSTEM_KEY_NONE.value,
  ...SYSTEM_KEY_GROUPS.flatMap((group) => group.options.map((option) => option.value)),
])

export default function SchemaBuilderPage() {
  const [forms, setForms] = useState<PartnerForm[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [view, setView] = useState<'list' | 'edit'>('list')
  const [optionsDraft, setOptionsDraft] = useState<Record<string, string>>({})

  // Form Ativo no Editor
  const [selectedForm, setSelectedForm] = useState<PartnerForm | null>(null)
  const [builderTab, setBuilderTab] = useState<'flow' | 'fields'>('flow')
  
  // Preview States
  const [previewValues, setPreviewValues] = useState<Record<string, any>>({})
  const [previewDevice, setPreviewDevice] = useState<'mobile' | 'desktop'>('mobile')
  const [lookupBanks, setLookupBanks] = useState<Array<{ code: string | number; name: string }>>([])
  const [lookupUfs, setLookupUfs] = useState<Array<{ sigla: string; nome: string }>>([])
  const [activePreviewFieldKey, setActivePreviewFieldKey] = useState<string | null>(null)
  const previewScrollLockRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const [blockToAdd, setBlockToAdd] = useState<BlockId | ''>('')
  const [showFieldPalette, setShowFieldPalette] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')

  function activatePreviewForField(key: string) {
    setActivePreviewFieldKey(key)
    if (previewScrollLockRef.current) clearTimeout(previewScrollLockRef.current)
    previewScrollLockRef.current = setTimeout(() => {
      previewScrollLockRef.current = null
    }, 900)
  }

  function truncateLabel(value: any, maxChars = 100): string {
    const s = String(value ?? '')
    if (s.length <= maxChars) return s
    return `${s.slice(0, Math.max(0, maxChars - 1))}…`
  }

  useEffect(() => {
    if (!activePreviewFieldKey) return
    try {
      const root = previewScrollRef.current
      const el = root?.querySelector<HTMLElement>(`#preview_field_${activePreviewFieldKey}`) || document.getElementById(`preview_field_${activePreviewFieldKey}`)
      if (!el) return
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    } catch {
      // ignore
    }
  }, [activePreviewFieldKey])

  function normalizeForm(raw: any): PartnerForm {
    const schema = Array.isArray(raw?.schema) ? raw.schema : []
    const normalizedSchema: FormField[] = schema.map((f: any, idx: number) => {
      const key = f?.key || f?.id || `field_${idx}`
      return {
        key,
        label: f?.label ?? '',
        description: f?.description ?? '',
        type: f?.type ?? 'text',
        hidden: !!f?.hidden,
        mask: f?.mask ?? 'none',
        system_key: f?.system_key ?? 'none',
        required: !!f?.required,
        options: f?.options,
        options_source: f?.options_source,
        conditional: f?.conditional,
      }
    })

    return {
      id: raw?.id,
      title: raw?.title ?? '',
      slug: raw?.slug ?? '',
      is_active: !!raw?.is_active,
      schema: normalizedSchema,
      config: raw?.config || { schema_version: 2 },
      created_at: raw?.created_at,
      updated_at: raw?.updated_at,
    }
  }

  useEffect(() => {
    async function loadForms() {
      setLoading(true)
      const res = await getPartnerForms()
      if (res.success && res.forms) {
        const normalized = (res.forms as any[]).map(normalizeForm)
        setForms(normalized)
        // Inicia na visão de lista; o usuário escolhe editar ou criar novo
        if (normalized.length === 0) setSelectedForm(null)
      } else {
        setMessage({ type: 'error', text: 'Erro ao carregar formulários.' })
      }
      setLoading(false)
    }

    loadForms()
  }, [])

  function createField(part: string): string {
    const rnd = Math.random().toString(36).slice(2, 7)
    return `field_${part}_${Date.now()}_${rnd}`
  }

  function addBlock(blockId: BlockId) {
    if (!selectedForm) return

    const newFields: FormField[] = []
    const push = (field: Omit<FormField, 'key'> & { key?: string }) => {
      newFields.push({
        key: field.key || createField(String(field.system_key || 'custom')),
        label: field.label,
        description: field.description,
        type: field.type,
        hidden: field.hidden,
        mask: field.mask,
        system_key: field.system_key,
        required: !!field.required,
        options: field.options,
        options_source: field.options_source,
        conditional: field.conditional,
      })
    }

    const addCommonBankBlock = (person: 'pj' | 'pf') => {
      const prefix = person === 'pj' ? 'PJ' : 'PF'
      push({ label: `Banco (${prefix})`, type: 'select', required: true, system_key: 'bank_name', options_source: 'banks' })
      push({ label: `Agência (${prefix})`, type: 'text', required: true, system_key: 'bank_agency', mask: 'bank_agency_with_digit' })
      push({ label: `Conta Bancária (${prefix})`, type: 'text', required: true, system_key: 'bank_account', mask: 'bank_account' })
      push({ label: `Tipo de Conta (${prefix})`, type: 'select', required: true, system_key: 'bank_account_type', options: ['Corrente', 'Poupança'] })

      // PIX
      const pixTypeKey = createField(`${person}_pix_type`)
      push({
        key: pixTypeKey,
        label: `Tipo de Chave Pix (${prefix})`,
        type: 'select',
        required: true,
        system_key: 'pix_type',
        options: person === 'pj'
          ? ['CNPJ', 'Dados Bancários', 'Celular', 'E-mail', 'Chave Aleatória']
          : ['CPF', 'Dados Bancários', 'Celular', 'E-mail', 'Chave Aleatória'],
      })
      push({
        label: `Chave Pix (${prefix})`,
        type: 'text',
        required: false,
        system_key: 'pix_key',
        mask: 'none',
        conditional: { field_id: pixTypeKey, value: 'Celular' }
      })
      push({
        label: `Chave Pix (${prefix}) - E-mail`,
        type: 'text',
        required: false,
        system_key: 'pix_key',
        mask: 'email',
        conditional: { field_id: pixTypeKey, value: 'E-mail' }
      })
      push({
        label: `Chave Pix (${prefix}) - Aleatória (UUID)`,
        type: 'text',
        required: false,
        system_key: 'pix_key',
        mask: 'pix_uuid',
        conditional: { field_id: pixTypeKey, value: 'Chave Aleatória' }
      })

      push({
        label: `Período de Pagamento (${prefix})`,
        type: 'select',
        required: true,
        system_key: 'payment_period',
        options: ['Diário', 'Semanal']
      } as any)
    }

    if (blockId === 'empresa') {
      // Campo CNPJ como gatilho
      push({ label: 'CNPJ', type: 'text', required: true, system_key: 'cpf_cnpj', mask: 'cnpj' })
      // Campos principais (CNPJ.WS)
      push({ label: 'Razão Social', type: 'text', required: true, system_key: 'name', mask: 'none' })
      push({ label: 'Nome Fantasia', type: 'text', required: false, system_key: 'fantasy_name', mask: 'none' })
      push({ label: 'Data de Abertura', type: 'text', required: false, system_key: 'company_opening_date', mask: 'date' } as any)
      push({ label: 'Situação Cadastral', type: 'text', required: false, system_key: 'company_registration_status', mask: 'none' } as any)
      push({ label: 'Porte da Empresa', type: 'text', required: false, system_key: 'company_size', mask: 'none' } as any)
      push({ label: 'Capital Social', type: 'text', required: false, system_key: 'company_capital_social', mask: 'none' } as any)
      push({ label: 'Natureza Jurídica', type: 'text', required: false, system_key: 'company_legal_nature', mask: 'none' } as any)
      push({ label: 'País', type: 'text', required: false, system_key: 'company_country', mask: 'none' } as any)
      push({ label: 'Estado (UF)', type: 'select', required: false, system_key: 'address_state', options_source: 'ufs' })
      push({ label: 'Cidade', type: 'text', required: false, system_key: 'address_city', mask: 'none' })
      push({ label: 'CEP', type: 'text', required: false, system_key: 'cep', mask: 'cep' })
      push({ label: 'Bairro', type: 'text', required: false, system_key: 'address_neighborhood', mask: 'none' })
      push({ label: 'Logradouro', type: 'text', required: false, system_key: 'address_street', mask: 'none' })
      push({ label: 'Número', type: 'text', required: false, system_key: 'address_number', mask: 'none' })
      push({ label: 'Complemento', type: 'text', required: false, system_key: 'address_complement', mask: 'none' })
      // Ao adicionar Empresa, já adiciona Contato PJ e Sócio (ocultáveis)
      // Contato PJ (obrigatórios os principais)
      push({ label: 'E-mail Principal (PJ)', type: 'text', required: true, system_key: 'email_comissao', mask: 'email' })
      push({ label: 'WhatsApp Principal (PJ)', type: 'text', required: true, system_key: 'phone_whatsapp', mask: 'phone_mobile' })

      // Sócio Principal (mínimo)
      push({ label: 'Nome do Sócio Principal', type: 'text', required: false, system_key: 'representante_legal', mask: 'none' })
    }

    if (blockId === 'socio_principal') {
      push({ label: 'CPF do Sócio Principal', type: 'text', required: false, system_key: 'partner_1_cpf', mask: 'cpf' } as any)
      push({ label: 'Nome Completo do Sócio Principal', type: 'text', required: false, system_key: 'partner_1_name', mask: 'none' } as any)
      push({ label: 'Data de Nascimento do Sócio Principal', type: 'text', required: false, system_key: 'partner_1_birth_date', mask: 'date' } as any)
      push({ label: 'E-mail Pessoal do Sócio Principal', type: 'text', required: false, system_key: 'partner_1_email', mask: 'email' } as any)
      push({ label: 'WhatsApp do Sócio Principal', type: 'text', required: false, system_key: 'partner_1_whatsapp', mask: 'phone_mobile' } as any)
      push({ label: 'CEP do Sócio Principal', type: 'text', required: false, system_key: 'partner_1_cep', mask: 'cep' } as any)
      push({ label: 'Endereço do Sócio Principal', type: 'text', required: false, system_key: 'partner_1_address_street', mask: 'none' } as any)
      push({ label: 'Número (Sócio Principal)', type: 'text', required: false, system_key: 'partner_1_address_number', mask: 'none' } as any)
      push({ label: 'Complemento (Sócio Principal)', type: 'text', required: false, system_key: 'partner_1_address_complement', mask: 'none' } as any)
      push({ label: 'Bairro (Sócio Principal)', type: 'text', required: false, system_key: 'partner_1_address_neighborhood', mask: 'none' } as any)
      push({ label: 'Cidade (Sócio Principal)', type: 'text', required: false, system_key: 'partner_1_address_city', mask: 'none' } as any)
      push({ label: 'UF (Sócio Principal)', type: 'select', required: false, system_key: 'partner_1_address_state', options_source: 'ufs' } as any)
    }

    if (blockId === 'socio_secundario') {
      push({ label: 'CPF do Sócio Secundário', type: 'text', required: false, system_key: 'partner_2_cpf', mask: 'cpf' } as any)
      push({ label: 'Nome Completo do Sócio Secundário', type: 'text', required: false, system_key: 'partner_2_name', mask: 'none' } as any)
      push({ label: 'Data de Nascimento do Sócio Secundário', type: 'text', required: false, system_key: 'partner_2_birth_date', mask: 'date' } as any)
      push({ label: 'E-mail Pessoal do Sócio Secundário', type: 'text', required: false, system_key: 'partner_2_email', mask: 'email' } as any)
      push({ label: 'WhatsApp do Sócio Secundário', type: 'text', required: false, system_key: 'partner_2_whatsapp', mask: 'phone_mobile' } as any)
    }

    if (blockId === 'contato_pj') {
      push({ label: 'WhatsApp Principal (PJ)', type: 'text', required: true, system_key: 'phone_whatsapp', mask: 'phone_mobile' })
      push({ label: 'E-mail Principal (PJ)', type: 'text', required: true, system_key: 'email_comissao', mask: 'email' })
      push({ label: 'E-mail Financeiro (PJ)', type: 'text', required: false, system_key: 'email_financeiro', mask: 'email' } as any)
      push({ label: 'E-mail Jurídico (PJ)', type: 'text', required: false, system_key: 'email_juridico', mask: 'email' } as any)
      push({ label: 'WhatsApp Financeiro (PJ)', type: 'text', required: false, system_key: 'phone_whatsapp_financeiro', mask: 'phone_mobile' })
    }

    if (blockId === 'bancario_pj') {
      addCommonBankBlock('pj')
    }

    if (blockId === 'pessoa_fisica') {
      push({ label: 'CPF', type: 'text', required: true, system_key: 'cpf_cnpj', mask: 'cpf' })
      push({ label: 'Nome Completo', type: 'text', required: true, system_key: 'name', mask: 'none' })
      push({ label: 'Data de Nascimento', type: 'text', required: true, system_key: 'birth_date', mask: 'date' })
    }

    if (blockId === 'contato_pf') {
      push({ label: 'E-mail Principal (PF)', type: 'text', required: true, system_key: 'email_comissao', mask: 'email' })
      push({ label: 'WhatsApp Principal (PF)', type: 'text', required: true, system_key: 'phone_whatsapp', mask: 'phone_mobile' })
      push({ label: 'E-mail Jurídico (PF)', type: 'text', required: false, system_key: 'email_juridico', mask: 'email' } as any)
      push({ label: 'E-mail Financeiro (PF)', type: 'text', required: false, system_key: 'email_financeiro', mask: 'email' } as any)
      push({ label: 'WhatsApp Financeiro (PF)', type: 'text', required: false, system_key: 'phone_whatsapp_financeiro', mask: 'phone_mobile' })
    }

    if (blockId === 'endereco_pf') {
      push({ label: 'CEP (PF)', type: 'text', required: true, system_key: 'cep', mask: 'cep' })
      push({ label: 'Rua (PF)', type: 'text', required: true, system_key: 'address_street', mask: 'none' })
      push({ label: 'Número (PF)', type: 'text', required: true, system_key: 'address_number', mask: 'none' })
      push({ label: 'Complemento (PF)', type: 'text', required: false, system_key: 'address_complement', mask: 'none' })
      push({ label: 'Bairro (PF)', type: 'text', required: true, system_key: 'address_neighborhood', mask: 'none' })
      push({ label: 'Cidade (PF)', type: 'text', required: true, system_key: 'address_city', mask: 'none' })
      push({ label: 'Estado (UF) (PF)', type: 'select', required: true, system_key: 'address_state', options_source: 'ufs' })
    }

    if (blockId === 'assinatura_pf') {
      push({ label: 'E-mail Pessoal (Assinatura)', type: 'text', required: true, system_key: 'signature_email', mask: 'email' } as any)
      push({ label: 'WhatsApp Pessoal (Assinatura)', type: 'text', required: true, system_key: 'signature_whatsapp', mask: 'phone_mobile' } as any)
    }

    if (blockId === 'bancario_pf') {
      addCommonBankBlock('pf')
    }

    if (newFields.length === 0) return

    setSelectedForm({
      ...selectedForm,
      schema: [...selectedForm.schema, ...newFields],
    })
  }

  function parseOptionsInput(raw: string): string[] {
    return String(raw || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
  }

  /** Normaliza o slug do link público: minúsculas, sem acento, hífens. */
  function normalizeSlug(raw: string): string {
    return String(raw || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  useEffect(() => {
    // Listas prontas (sem cadastro manual)
    async function loadLookups() {
      try {
        const [banksRes, ufsRes] = await Promise.all([
          fetch('/api/lookups/banks'),
          fetch('/api/lookups/ufs'),
        ])

        if (banksRes.ok) {
          const data = await banksRes.json()
          const banks = Array.isArray(data?.banks) ? data.banks : []
          setLookupBanks(
            banks
              .filter((b: any) => b && b.name)
              .map((b: any) => ({ code: b.code ?? '', name: b.name ?? '' }))
          )
        }

        if (ufsRes.ok) {
          const data = await ufsRes.json()
          const ufs = Array.isArray(data?.ufs) ? data.ufs : []
          setLookupUfs(
            ufs
              .filter((u: any) => u && u.sigla)
              .map((u: any) => ({
                sigla: String(u.sigla || '').toUpperCase(),
                nome: String(u.nome || ''),
              }))
          )
        }
      } catch {
        // ignore
      }
    }

    loadLookups()
  }, [])

  function handleNewForm() {
    setSelectedForm({
      title: 'Formulário de Cadastro de Parceiros',
      slug: '',
      is_active: true,
      config: {
        schema_version: 2,
        intro: { title: 'Cadastro de Parceiro', text: 'Preencha os dados para iniciar seu cadastro.', start_label: 'Iniciar' },
        submit: { finish_label: 'Finalizar e Enviar' },
        branding: { primary_color: '#8A2BE2', accent_color: '#FF2D6D' }
      },
      schema: [
        {
          key: 'field_lgpd',
          label: 'Aceito os termos da LGPD para coleta de dados cadastrais',
          type: 'checkbox',
          required: true,
          system_key: 'lgpd_consent'
        },
        {
          key: 'field_p_type',
          label: 'Tipo de Pessoa',
          type: 'select',
          required: true,
          system_key: 'person_type',
          options: ['Física', 'Jurídica']
        }
      ]
    })
    setView('edit')
  }

  async function reloadFormsAndSyncSelected(selectedId?: string) {
    const reload = await getPartnerForms()
    if (reload.success && reload.forms) {
      const normalized = (reload.forms as any[]).map(normalizeForm)
      setForms(normalized)
      if (selectedId) {
        const next = normalized.find((f) => f.id === selectedId)
        if (next) setSelectedForm(next)
      }
    }
  }

  async function handleDuplicate(form: PartnerForm) {
    if (!form) return
    setSaving(true)
    setMessage(null)
    const payload: PartnerForm = {
      title: `${form.title} (Cópia)`,
      slug: '',
      is_active: false,
      schema: Array.isArray(form.schema) ? JSON.parse(JSON.stringify(form.schema)) : [],
      config: form.config ? JSON.parse(JSON.stringify(form.config)) : { schema_version: 2 },
    }
    const res = await savePartnerForm(payload as any)
    if (res.success) {
      setMessage({ type: 'success', text: 'Formulário duplicado com sucesso.' })
      await reloadFormsAndSyncSelected((res as any).id)
      setView('edit')
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao duplicar formulário.' })
    }
    setSaving(false)
  }

  async function handleDelete(form: PartnerForm) {
    if (!form?.id) return
    const ok = confirm(`Excluir o formulário "${form.title}"? Esta ação não pode ser desfeita.`)
    if (!ok) return
    setDeletingId(form.id)
    setMessage(null)
    const res = await deletePartnerForm(form.id)
    if (res.success) {
      setMessage({ type: 'success', text: 'Formulário excluído.' })
      if (selectedForm?.id === form.id) setSelectedForm(null)
      setView('list')
      await reloadFormsAndSyncSelected()
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao excluir formulário.' })
    }
    setDeletingId(null)
  }

  function addField() {
    if (!selectedForm) return
    const newField: FormField = {
      key: `field_${Date.now()}`,
      label: 'Nova Pergunta',
      type: 'text',
      mask: 'none',
      system_key: 'none',
      required: false
    }
    setSelectedForm({
      ...selectedForm,
      schema: [...selectedForm.schema, newField]
    })
  }

  /** Cria uma pergunta já vinculada a um campo do dicionário canônico. */
  function addFieldFromSystemKey(systemKey: string, rawLabel: string) {
    if (!selectedForm) return
    // Remove os hints do label do dicionário: "(consulta automática)", "(só PF)"…
    const cleanLabel = rawLabel.replace(/\s*\([^)]*\)\s*$/, '').trim() || rawLabel
    const newField: FormField = {
      key: createField(systemKey),
      label: cleanLabel,
      type: 'text',
      mask: 'none',
      system_key: systemKey,
      required: false,
    }
    setSelectedForm({ ...selectedForm, schema: [...selectedForm.schema, newField] })
  }

  function removeField(key: string) {
    if (!selectedForm) return
    setSelectedForm({
      ...selectedForm,
      schema: selectedForm.schema.filter(f => f.key !== key)
    })
  }

  function updateField(key: string, updates: Partial<FormField>) {
    if (!selectedForm) return
    setSelectedForm({
      ...selectedForm,
      schema: selectedForm.schema.map(f => (f.key === key ? { ...f, ...updates } : f))
    })
  }

  function moveField(index: number, direction: 'up' | 'down') {
    if (!selectedForm) return
    const schemaCopy = [...selectedForm.schema]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= schemaCopy.length) return

    // Swap elements
    const temp = schemaCopy[index]
    schemaCopy[index] = schemaCopy[targetIndex]
    schemaCopy[targetIndex] = temp

    setSelectedForm({
      ...selectedForm,
      schema: schemaCopy
    })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedForm) return

    setSaving(true)
    setMessage(null)

    // Flush de rascunhos de opções manuais que só seriam commitados no blur —
    // garante que nada se perde ao salvar com o cursor ainda no campo.
    const flushedSchema = selectedForm.schema.map((f) => {
      if (f.type === 'select' && !f.options_source && optionsDraft[f.key] !== undefined) {
        return { ...f, options: parseOptionsInput(optionsDraft[f.key]) }
      }
      return f
    })
    const formToSave: PartnerForm = {
      ...selectedForm,
      slug: selectedForm.slug ? normalizeSlug(selectedForm.slug) : '',
      schema: flushedSchema,
    }
    if (flushedSchema !== selectedForm.schema) setSelectedForm(formToSave)

    const res = await savePartnerForm(formToSave as any)
    if (res.success) {
      setMessage({ type: 'success', text: 'Estrutura do formulário salva com sucesso!' })
      await reloadFormsAndSyncSelected((res as any).id || selectedForm.id)
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao salvar formulário.' })
    }
    setSaving(false)
  }

  // Avaliação de exibição de campo condicional no preview
  function shouldShowFieldInPreview(field: FormField): boolean {
    if (field.hidden) return false
    if (!field.conditional || !field.conditional.field_id) return true
    const currentVal = previewValues[field.conditional.field_id]
    return String(currentVal) === String(field.conditional.value)
  }

  function updateFormConfig(next: Partial<PartnerFormConfig>) {
    if (!selectedForm) return
    setSelectedForm({
      ...selectedForm,
      config: {
        ...(selectedForm.config || {}),
        ...next,
      }
    })
  }

  function updateBranding(next: Partial<NonNullable<PartnerFormConfig['branding']>>) {
    if (!selectedForm) return
    const current = selectedForm.config?.branding || {}
    updateFormConfig({ branding: { ...current, ...next } })
  }

  if (loading) {
    return (
      <div className="page-content" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
      </div>
    )
  }

  return (
    <div className="page-content" style={{ maxWidth: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--brs-gray-800)', margin: 0 }}>
            Construtor de Formulário (SCP)
          </h1>
          <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
            Construa e altere o formulário de cadastro público para novos parceiros
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {view === 'edit' && (
            <button className="btn btn-outline" type="button" onClick={() => setView('list')}>
              <ChevronUp size={16} style={{ transform: 'rotate(-90deg)' }} />
              Voltar para Lista
            </button>
          )}

          {view === 'list' && (
            <>
              <button className="btn btn-outline" type="button" onClick={handleNewForm}>
                <Plus size={16} />
                Novo Formulário
              </button>
            </>
          )}
        </div>
      </div>

      {message && (
        <div 
          style={{ 
            padding: '1rem', 
            borderRadius: '8px', 
            marginBottom: '1.5rem', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.75rem',
            background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: message.type === 'success' ? '#065F46' : '#991B1B',
            border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`
          }}
        >
          {message.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      {view === 'list' && (
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, color: 'var(--brs-gray-800)' }}>Formulários criados</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)' }}>{forms.length} total</div>
          </div>

          {forms.length === 0 ? (
            <div style={{ padding: '1rem', border: '1px dashed var(--brs-gray-200)', borderRadius: 8, color: 'var(--brs-gray-600)' }}>
              Nenhum formulário criado ainda. Clique em <strong>Novo Formulário</strong> para começar.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Título</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Ativo</th>
                    <th style={{ padding: '0.75rem 0.5rem', width: 260 }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {forms.map(f => {
                    return (
                      <tr key={f.id} style={{ borderTop: '1px solid var(--brs-gray-100)' }}>
                        <td style={{ padding: '0.75rem 0.5rem', color: 'var(--brs-gray-800)', fontWeight: 600 }}>
                          {f.title}
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem' }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            padding: '0.15rem 0.5rem',
                            borderRadius: 999,
                            fontSize: '0.75rem',
                            border: `1px solid ${f.is_active ? '#A7F3D0' : 'var(--brs-gray-200)'}`,
                            background: f.is_active ? '#ECFDF5' : 'var(--brs-gray-50)',
                            color: f.is_active ? '#065F46' : 'var(--brs-gray-600)',
                          }}>
                            {f.is_active ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-outline"
                            onClick={() => {
                              setSelectedForm(f)
                              setBuilderTab('flow')
                              setView('edit')
                            }}
                          >
                              <Pencil size={16} />
                              Editar
                            </button>
                            <button type="button" className="btn btn-outline" disabled={saving} onClick={() => handleDuplicate(f)}>
                              <Files size={16} />
                              Duplicar
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline text-danger"
                              disabled={!f.id || deletingId === f.id}
                              onClick={() => handleDelete(f)}
                            >
                              {deletingId === f.id ? <Loader2 size={16} className="spinner" /> : <Trash size={16} />}
                              Excluir
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {view === 'edit' && selectedForm && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '1.5rem', alignItems: 'stretch', height: 'calc(100dvh - 220px)', overflow: 'hidden' }}>
          
          {/* LADO ESQUERDO: Construtor / Lista de Campos */}
          <div className="card" style={{ padding: '1.5rem', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', alignItems: 'flex-end' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Título do Formulário</label>
                  <input 
                    type="text" 
                    className="form-control" 
                    required
                    value={selectedForm.title}
                    onChange={e => setSelectedForm({ ...selectedForm, title: e.target.value })}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', height: '40px', paddingBottom: '8px' }}>
                  <input 
                    type="checkbox" 
                    id="formActive" 
                    checked={selectedForm.is_active}
                    onChange={e => setSelectedForm({ ...selectedForm, is_active: e.target.checked })}
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="formActive" style={{ fontSize: '0.875rem', color: 'var(--brs-gray-700)', cursor: 'pointer' }}>
                    Ativo para recebimento
                  </label>
                </div>
              </div>

              {/* Abas do construtor */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setBuilderTab('flow')}
                  style={{
                    borderRadius: 8,
                    border: `1px solid ${builderTab === 'flow' ? 'var(--brs-primary-300)' : 'var(--brs-gray-200)'}`,
                    background: builderTab === 'flow' ? 'var(--brs-primary-50)' : '#fff',
                    color: builderTab === 'flow' ? 'var(--brs-primary-700)' : 'var(--brs-gray-700)',
                    fontWeight: builderTab === 'flow' ? 700 : 600,
                  }}
                >
                  Telas & Aparência
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setBuilderTab('fields')}
                  style={{
                    borderRadius: 8,
                    border: `1px solid ${builderTab === 'fields' ? 'var(--brs-primary-300)' : 'var(--brs-gray-200)'}`,
                    background: builderTab === 'fields' ? 'var(--brs-primary-50)' : '#fff',
                    color: builderTab === 'fields' ? 'var(--brs-primary-700)' : 'var(--brs-gray-700)',
                    fontWeight: builderTab === 'fields' ? 700 : 600,
                  }}
                >
                  Perguntas e Campos do Formulário
                </button>
              </div>

              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {builderTab === 'flow' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '0.25rem' }}>
                  {/* 1) Abertura */}
                  <div className="card" style={{ flexShrink: 0, padding: '1rem', background: '#fff', border: '1px solid var(--brs-gray-100)' }}>
                    <div className="section-divider" style={{ marginBottom: '1rem' }}>Tela de Abertura</div>
                    <div className="form-grid form-grid-2">
                      <div className="form-group">
                        <label className="form-label">Título Inicial</label>
                        <input
                          type="text"
                          className="form-control"
                          value={selectedForm.config?.intro?.title || ''}
                          onChange={e => updateFormConfig({ intro: { ...(selectedForm.config?.intro || {}), title: e.target.value } })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Label Botão Iniciar</label>
                        <input
                          type="text"
                          className="form-control"
                          value={selectedForm.config?.intro?.start_label || ''}
                          onChange={e => updateFormConfig({ intro: { ...(selectedForm.config?.intro || {}), start_label: e.target.value } })}
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Texto Inicial</label>
                      <textarea
                        className="form-control"
                        rows={3}
                        value={selectedForm.config?.intro?.text || ''}
                        onChange={e => updateFormConfig({ intro: { ...(selectedForm.config?.intro || {}), text: e.target.value } })}
                      />
                    </div>
                  </div>

                  {/* 2) Marca (Branding) */}
                  <div className="card" style={{ flexShrink: 0, padding: '1rem', background: '#fff', border: '1px solid var(--brs-gray-100)' }}>
                    <div className="section-divider" style={{ marginBottom: '1rem' }}>Marca (Branding)</div>
                    <div className="form-grid form-grid-2">
                      <div className="form-group">
                        <label className="form-label">Cor Primária</label>
                        <input
                          type="color"
                          className="form-control"
                          value={selectedForm.config?.branding?.primary_color || '#8A2BE2'}
                          onChange={e => updateBranding({ primary_color: e.target.value })}
                          style={{ height: 40, padding: '0.25rem' }}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Cor Destaque</label>
                        <input
                          type="color"
                          className="form-control"
                          value={selectedForm.config?.branding?.accent_color || '#FF2D6D'}
                          onChange={e => updateBranding({ accent_color: e.target.value })}
                          style={{ height: 40, padding: '0.25rem' }}
                        />
                      </div>
                    </div>
                    <div className="form-grid form-grid-2">
                      <div className="form-group">
                        <label className="form-label">Logo URL (opcional)</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="https://..."
                          value={selectedForm.config?.branding?.logo_url || ''}
                          onChange={e => updateBranding({ logo_url: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Favicon URL (opcional)</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="https://..."
                          value={selectedForm.config?.branding?.favicon_url || ''}
                          onChange={e => updateBranding({ favicon_url: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 3) Link público (slug) */}
                  <div className="card" style={{ flexShrink: 0, padding: '1rem', background: '#fff', border: '1px solid var(--brs-gray-100)' }}>
                    <div className="section-divider" style={{ marginBottom: '1rem' }}>Link Público</div>
                    <div className="form-group">
                      <label className="form-label">Endereço (slug)</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="cadastro-parceiro-brs"
                        value={selectedForm.slug || ''}
                        onChange={e => setSelectedForm({ ...selectedForm, slug: e.target.value })}
                        onBlur={e => setSelectedForm({ ...selectedForm, slug: normalizeSlug(e.target.value) })}
                      />
                      <div style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>
                        O formulário fica acessível em <code>/cadastro-parceiro/{selectedForm.slug ? normalizeSlug(selectedForm.slug) : 'seu-slug'}</code>. Deixe em branco se o acesso for pelo link do Processo.
                      </div>
                    </div>
                  </div>

                  {/* 4) Encerramento */}
                  <div className="card" style={{ flexShrink: 0, padding: '1rem', background: '#fff', border: '1px solid var(--brs-gray-100)' }}>
                    <div className="section-divider" style={{ marginBottom: '1rem' }}>Tela de Encerramento</div>
                    <div className="form-grid form-grid-2">
                      <div className="form-group">
                        <label className="form-label">Título</label>
                        <input
                          type="text"
                          className="form-control"
                          value={selectedForm.config?.closing?.title || ''}
                          onChange={e => updateFormConfig({ closing: { ...(selectedForm.config?.closing || {}), title: e.target.value } })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Subtítulo / Linha Verde</label>
                        <input
                          type="text"
                          className="form-control"
                          value={selectedForm.config?.closing?.lead || ''}
                          onChange={e => updateFormConfig({ closing: { ...(selectedForm.config?.closing || {}), lead: e.target.value } })}
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Texto</label>
                      <textarea
                        className="form-control"
                        rows={4}
                        value={selectedForm.config?.closing?.text || ''}
                        onChange={e => updateFormConfig({ closing: { ...(selectedForm.config?.closing || {}), text: e.target.value } })}
                      />
                      <div style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>
                        Dica: use quebras de linha para separar parágrafos.
                      </div>
                    </div>
                    <div className="form-grid form-grid-3">
                      <div className="form-group">
                        <label className="form-label">Label do Botão Finalizar</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="Finalizar e Enviar"
                          value={selectedForm.config?.submit?.finish_label || ''}
                          onChange={e => updateFormConfig({ submit: { ...(selectedForm.config?.submit || {}), finish_label: e.target.value } })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Label do Botão (encerramento)</label>
                        <input
                          type="text"
                          className="form-control"
                          value={selectedForm.config?.closing?.button_label || ''}
                          onChange={e => updateFormConfig({ closing: { ...(selectedForm.config?.closing || {}), button_label: e.target.value } })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Link do Botão (URL)</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="https://..."
                          value={selectedForm.config?.closing?.button_url || ''}
                          onChange={e => updateFormConfig({ closing: { ...(selectedForm.config?.closing || {}), button_url: e.target.value } })}
                        />
                      </div>
                    </div>
                  </div>
                  </div>
                ) : (
                  <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    {/* Lista de perguntas (rolagem completa) */}
                    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem', overflowY: 'auto', paddingRight: '0.25rem' }}>
                <div style={{ flexShrink: 0, fontWeight: 600, fontSize: '0.875rem', color: 'var(--brs-gray-800)', borderBottom: '1px solid var(--brs-gray-100)', paddingBottom: '0.5rem' }}>
                  Perguntas e Campos do Formulário
                </div>



                {selectedForm.schema.map((field, idx) => (
                  <div
                    key={field.key}
                    id={`builder_field_${field.key}`}
                    style={{
                      flexShrink: 0,
                      padding: '1rem',
                      borderRadius: '8px',
                      background: field.hidden ? '#F3F4F6' : '#F9FAFB',
                      border: '1px solid var(--brs-gray-200)',
                      opacity: field.hidden ? 0.85 : 1
                    }}
                  >
                    {/* Cabeçalho do card: nº da pergunta + badges + controles */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem' }}>
                      <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--brs-gray-400)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Pergunta {idx + 1}
                      </span>
                      {field.hidden && (
                        <span style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--brs-gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', background: 'var(--brs-gray-200)', padding: '1px 6px', borderRadius: 4 }}>
                          Oculto
                        </span>
                      )}
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
                        <button type="button" className="btn btn-ghost btn-xs btn-icon" onClick={() => moveField(idx, 'up')} disabled={idx === 0}>
                          <ChevronUp size={14} />
                        </button>
                        <button type="button" className="btn btn-ghost btn-xs btn-icon" onClick={() => moveField(idx, 'down')} disabled={idx === selectedForm.schema.length - 1}>
                          <ChevronDown size={14} />
                        </button>
                        <button type="button" className="btn btn-ghost btn-xs btn-icon text-danger" onClick={() => removeField(field.key)}>
                          <Trash size={14} />
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1rem', marginBottom: '0.75rem' }}>
                      {/* Label da pergunta */}
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Título da Pergunta / Label</label>
                        <input 
                          type="text" 
                          className="form-control" 
                          value={field.label}
                          onFocus={() => activatePreviewForField(field.key)}
                          onChange={e => updateField(field.key, { label: e.target.value })}
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Observação (opcional)</label>
                        <input 
                          type="text" 
                          className="form-control" 
                          value={field.description || ''}
                          onFocus={() => activatePreviewForField(field.key)}
                          onChange={e => updateField(field.key, { description: e.target.value })}
                          placeholder="Texto menor/itálico exibido abaixo do título"
                        />
                      </div>

                      {/* Tipo do campo */}
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Tipo do Campo</label>
                        <select
                          className="form-control"
                          value={field.type}
                          onFocus={() => activatePreviewForField(field.key)}
                          onChange={e => {
                            const nextType = String(e.target.value || 'text')
                            if (!['text', 'select', 'checkbox', 'file'].includes(nextType)) return
                            updateField(field.key, {
                              type: nextType as any,
                              options: nextType === 'select'
                                ? (field.options?.length ? field.options : ['Opção 1', 'Opção 2'])
                                : undefined,
                              options_source: nextType === 'select' ? (field.options_source || undefined) : undefined,
                              mask: nextType === 'text' ? (field.mask || 'none') : 'none',
                            })
                          }}
                        >
                          <option value="text">Texto / Digitação</option>
                          <option value="select">Seleção (Dropdown)</option>
                          <option value="checkbox">Aceite / Caixa de Seleção</option>
                          <option value="file">Upload de Arquivo (PDF/Imagem)</option>
                        </select>
                      </div>
                    </div>

                    {/* Propriedades Adicionais do campo */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '0.75rem' }}>
                      {/* Máscara de validação */}
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Máscara / Validação</label>
                        <select 
                          className="form-control"
                          value={field.mask || 'none'}
                          onFocus={() => activatePreviewForField(field.key)}
                          onChange={e => updateField(field.key, { mask: e.target.value as any })}
                          disabled={field.type !== 'text'}
                        >
                          <option value="none">Sem validação</option>
                          <option value="cpf">CPF</option>
                          <option value="cnpj">CNPJ</option>
                          <option value="cep">CEP</option>
                          <option value="email">E-mail</option>
                          <option value="phone_landline">Telefone Fixo</option>
                          <option value="phone_mobile">Telefone Celular</option>
                          <option value="date">Data</option>
                          <option value="pix_uuid">Chave Pix Aleatória (UUID)</option>
                          <option value="bank_account">Conta Bancária</option>
                          <option value="bank_agency_with_digit">Agência com Dígito (0000-0)</option>
                          <option value="bank_agency_without_digit">Agência sem Dígito (0000)</option>
                          <option value="bank_agency_digit">Dígito de Agência (0)</option>
                        </select>
                      </div>

                      {/* Mapeamento de Campo do Sistema */}
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Campo do Agente Corban</label>
                        <select
                          className="form-control"
                          value={field.system_key || 'none'}
                          onFocus={() => activatePreviewForField(field.key)}
                          onChange={e => updateField(field.key, { system_key: e.target.value })}
                        >
                          <option value={SYSTEM_KEY_NONE.value}>{SYSTEM_KEY_NONE.label}</option>
                          {SYSTEM_KEY_GROUPS.map(group => (
                            <optgroup key={group.group} label={group.label}>
                              {group.options.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </optgroup>
                          ))}
                          {/* Vínculo salvo que saiu do dicionário: mantém visível em vez de sumir calado. */}
                          {field.system_key && !SYSTEM_KEY_VALUES.has(field.system_key) && (
                            <optgroup label="Vínculo desconhecido">
                              <option value={field.system_key}>{field.system_key}</option>
                            </optgroup>
                          )}
                        </select>
                      </div>

                      {/* Obrigatório */}
                      <div className="form-group" style={{ display: 'flex', alignItems: 'center', height: '40px', paddingLeft: '0.25rem' }}>
                        <input 
                          type="checkbox" 
                          id={`req_${field.key}`}
                          checked={field.required}
                          onChange={e => updateField(field.key, { required: e.target.checked })}
                          style={{ cursor: 'pointer' }}
                        />
                        <label htmlFor={`req_${field.key}`} style={{ fontSize: '0.75rem', cursor: 'pointer', marginLeft: '0.5rem', userSelect: 'none' }}>
                          Resposta Obrigatória
                        </label>
                      </div>
                    </div>

                    {/* Configuração de dropdown options se aplicável */}
                    <div className="form-group" style={{ display: 'flex', alignItems: 'center', height: '40px', paddingLeft: '0.25rem', marginBottom: '0.75rem' }}>
                      <input
                        type="checkbox"
                        id={`hid_${field.key}`}
                        checked={!!field.hidden}
                        onChange={e => updateField(field.key, { hidden: e.target.checked })}
                        style={{ cursor: 'pointer' }}
                      />
                      <label htmlFor={`hid_${field.key}`} style={{ fontSize: '0.75rem', cursor: 'pointer', marginLeft: '0.5rem', userSelect: 'none', opacity: 0.8 }}>
                        Ocultar (não mostrar no público)
                      </label>
                    </div>

                    {field.type === 'select' && (
                      <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Fonte de opções</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.2fr', gap: '0.75rem' }}>
                          <select
                            className="form-control"
                            value={field.options_source || 'manual'}
                            onFocus={() => activatePreviewForField(field.key)}
                            onChange={e => {
                              const src = String(e.target.value || 'manual')
                              if (src === 'manual') {
                                updateField(field.key, {
                                  options_source: undefined,
                                  options: field.options?.length ? field.options : ['Opção 1', 'Opção 2'],
                                })
                                setOptionsDraft((prev) => ({
                                  ...prev,
                                  [field.key]: (field.options?.join(', ') || prev[field.key] || 'Opção 1, Opção 2'),
                                }))
                                return
                              }
                              if (src === 'banks' || src === 'ufs') {
                                updateField(field.key, { options_source: src as any, options: undefined })
                              }
                            }}
                          >
                            <option value="manual">Manual (digitado)</option>
                            <option value="banks">Lista de Bancos (BrasilAPI)</option>
                            <option value="ufs">Lista de UFs (BrasilAPI)</option>
                          </select>

                          {!field.options_source ? (
                            <input
                              type="text"
                              className="form-control"
                              placeholder="Opção A, Opção B, Opção C"
                              value={optionsDraft[field.key] ?? (field.options?.join(', ') || '')}
                              onFocus={() => activatePreviewForField(field.key)}
                              onChange={e => setOptionsDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
                              onBlur={() => {
                                const raw = optionsDraft[field.key] ?? (field.options?.join(', ') || '')
                                updateField(field.key, { options: parseOptionsInput(raw) })
                              }}
                            />
                          ) : (
                            <input
                              type="text"
                              className="form-control"
                              readOnly
                              onFocus={() => activatePreviewForField(field.key)}
                              value={
                                field.options_source === 'banks'
                                  ? 'Lista de bancos (automática)'
                                  : 'Lista de UFs (automática)'
                              }
                            />
                          )}
                        </div>
                      </div>
                    )}

                    {/* Regra de condicional */}
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input 
                        type="checkbox" 
                        id={`cond_chk_${field.key}`}
                        checked={!!field.conditional}
                        onChange={e => {
                          if (e.target.checked) {
                            updateField(field.key, { conditional: { field_id: '', value: '' } })
                          } else {
                            updateField(field.key, { conditional: undefined })
                          }
                        }}
                        style={{ cursor: 'pointer' }}
                      />
                      <label htmlFor={`cond_chk_${field.key}`} style={{ fontSize: '0.75rem', cursor: 'pointer', userSelect: 'none' }}>
                        Adicionar Condicional de Exibição
                      </label>

                      {field.conditional && (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginLeft: '1rem', flex: 1 }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>Exibir se:</span>
                          <select 
                            className="form-control"
                            style={{
                              padding: '2px 8px',
                              fontSize: '0.75rem',
                              height: '28px',
                              flex: 1,
                              maxWidth: '100ch',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            value={field.conditional.field_id}
                            onChange={e => updateField(field.key, { conditional: { ...field.conditional!, field_id: e.target.value, value: '' } })}
                          >
                            <option value="">Escolher pergunta...</option>
                            {selectedForm.schema
                              .filter(f => f.key !== field.key)
                              .map(f => (
                                <option key={f.key} value={f.key}>{truncateLabel(f.label || f.key, 100)}</option>
                              ))}
                          </select>
                          <span style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>for igual a</span>
                          {(() => {
                            const refField = selectedForm.schema.find(f => f.key === field.conditional!.field_id)
                            // Se o campo referenciado é um select com opções manuais, oferece um dropdown do valor.
                            if (refField?.type === 'select' && !refField.options_source && (refField.options?.length || 0) > 0) {
                              return (
                                <select
                                  className="form-control"
                                  style={{ padding: '2px 8px', fontSize: '0.75rem', height: '28px', minWidth: '120px' }}
                                  value={field.conditional!.value}
                                  onChange={e => updateField(field.key, { conditional: { ...field.conditional!, value: e.target.value } })}
                                >
                                  <option value="">Escolher valor...</option>
                                  {(refField.options || []).map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                </select>
                              )
                            }
                            return (
                              <input
                                type="text"
                                className="form-control"
                                placeholder="Valor exato"
                                style={{ padding: '2px 8px', fontSize: '0.75rem', height: '28px', width: '120px' }}
                                value={field.conditional!.value}
                                onChange={e => updateField(field.key, { conditional: { ...field.conditional!, value: e.target.value } })}
                              />
                            )
                          })()}
                        </div>
                      )}
                    </div>

                  </div>
                ))}
              </div>

              {/* Botões do Footer do Construtor */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-outline" onClick={addField}>
                    <Plus size={16} />
                    Adicionar Pergunta
                  </button>

                  <button type="button" className="btn btn-outline" onClick={() => { setPaletteQuery(''); setShowFieldPalette(true) }}>
                    <Plus size={16} />
                    Adicionar do dicionário
                  </button>

                  {/* Adicionar Bloco em 1 passo: insere ao escolher */}
                  <select
                    className="form-control"
                    value={blockToAdd}
                    onChange={(e) => {
                      const val = e.target.value as BlockId | ''
                      if (val) {
                        addBlock(val as BlockId)
                        setBlockToAdd('')
                      }
                    }}
                    style={{ minWidth: 240 }}
                  >
                    <option value="">Adicionar Bloco pronto…</option>
                    <option value="empresa">Bloco Empresa (CNPJ.WS + Contato PJ + Sócio)</option>
                    <option value="contato_pj">Bloco Contato PJ</option>
                    <option value="bancario_pj">Bloco Bancário PJ</option>
                    <option value="socio_principal">Bloco Sócio (Principal)</option>
                    <option value="socio_secundario">Bloco Sócio (Secundário)</option>
                    <option value="pessoa_fisica">Bloco Pessoa Física (CPFHub)</option>
                    <option value="contato_pf">Bloco Contato PF</option>
                    <option value="endereco_pf">Bloco Endereço PF (CEP)</option>
                    <option value="assinatura_pf">Bloco Assinatura PF</option>
                    <option value="bancario_pf">Bloco Bancário PF</option>
                  </select>
                </div>

                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
                  Salvar Formulário
                </button>
              </div>
                  </div>
                )}
              </div>
            </form>
          </div>

          {/* LADO DIREITO: Preview Interativo (Smartphone / Desktop) */}
          <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--brs-gray-800)' }}>
                Pré-visualização (Preview)
              </div>
              <div style={{ display: 'flex', gap: '0.25rem', background: 'var(--brs-gray-100)', padding: '2px', borderRadius: '6px' }}>
                <button 
                  type="button" 
                  className={`btn btn-ghost btn-xs btn-icon ${previewDevice === 'mobile' ? 'active' : ''}`}
                  onClick={() => setPreviewDevice('mobile')}
                  style={{ background: previewDevice === 'mobile' ? '#fff' : 'transparent', borderRadius: '4px', border: 'none' }}
                >
                  <Phone size={14} />
                </button>
                <button 
                  type="button" 
                  className={`btn btn-ghost btn-xs btn-icon ${previewDevice === 'desktop' ? 'active' : ''}`}
                  onClick={() => setPreviewDevice('desktop')}
                  style={{ background: previewDevice === 'desktop' ? '#fff' : 'transparent', borderRadius: '4px', border: 'none' }}
                >
                  <Monitor size={14} />
                </button>
              </div>
            </div>

            {/* Renderização do Aparelho */}
            <div 
              style={{ 
                margin: '0 auto',
                width: previewDevice === 'mobile' ? '360px' : '100%', 
                height: previewDevice === 'mobile' ? '640px' : '500px', 
                border: previewDevice === 'mobile' ? '12px solid #1E293B' : '1px solid var(--brs-gray-200)',
                borderRadius: previewDevice === 'mobile' ? '32px' : '8px',
                background: '#0B132B', // Fundo escuro premium baseado no manual da BRS Promotora
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                position: 'relative'
              }}
            >
              {/* Top Notch Mobile */}
              {previewDevice === 'mobile' && (
                <div style={{ width: '150px', height: '20px', background: '#1E293B', borderRadius: '0 0 12px 12px', margin: '0 auto', zIndex: 10 }} />
              )}

              {/* Cabeçalho do App de Cadastro (Identidade BRS Promotora) */}
              <div 
                style={{ 
                  padding: '1.25rem', 
                  background: 'linear-gradient(135deg, #0B132B 0%, #1c0f30 100%)',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem'
                }}
              >
                {selectedForm.config?.branding?.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selectedForm.config.branding.logo_url}
                    alt="Logo"
                    style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'contain', background: 'rgba(255,255,255,0.06)' }}
                  />
                ) : (
                  <div 
                    style={{ 
                      width: '32px', 
                      height: '32px', 
                      borderRadius: '8px', 
                      background: `linear-gradient(135deg, ${selectedForm.config?.branding?.accent_color || '#FF2D6D'} 0%, ${selectedForm.config?.branding?.primary_color || '#8A2BE2'} 100%)`
                    }} 
                  />
                )}
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700, color: '#fff', letterSpacing: '0.5px' }}>
                    {(selectedForm.config?.intro?.title || selectedForm.title || 'Formulário').toUpperCase()}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' }}>Formulário público</p>
                </div>
              </div>

              {/* Conteúdo do Form no Preview */}
              <div ref={previewScrollRef} style={{ flex: 1, padding: '1.25rem', overflowY: 'auto' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', marginBottom: '1rem' }}>
                  {selectedForm.title}
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {selectedForm.schema.map(field => {
                    if (!shouldShowFieldInPreview(field)) return null

                    return (
                      <div
                        key={field.key}
                        id={`preview_field_${field.key}`}
                        style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', scrollMarginTop: 16 }}
                      >
                        
                        {/* Se for checkbox, o layout de label é diferente */}
                        {field.type !== 'checkbox' ? (
                          <>
                            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>
                              {field.label} {field.required && <span style={{ color: '#FF2D6D' }}>*</span>}
                            </label>

                            {!!field.description && (
                              <div style={{ marginTop: '-2px', fontSize: '0.7rem', fontStyle: 'italic', color: 'rgba(255,255,255,0.55)' }}>
                                {field.description}
                              </div>
                            )}
                            
                            {field.type === 'text' && (
                              <input 
                                type="text"
                                className="form-control"
                                placeholder={
                                  field.mask === 'cep' ? '00000-000' :
                                  field.mask === 'phone_mobile' ? '(00) 90000-0000' :
                                  field.mask === 'phone_landline' ? '(00) 0000-0000' :
                                  field.mask === 'cpf' ? '000.000.000-00' :
                                  field.mask === 'cnpj' ? '00.000.000/0000-00' : ''
                                }
                                style={{ 
                                  background: 'rgba(255,255,255,0.05)', 
                                  border: '1px solid rgba(255,255,255,0.15)', 
                                  color: '#fff', 
                                  fontSize: '0.875rem',
                                  borderRadius: '6px',
                                  height: '36px'
                                }}
                                value={previewValues[field.key] || ''}
                                onChange={e => setPreviewValues({ ...previewValues, [field.key]: e.target.value })}
                              />
                            )}

                            {field.type === 'select' && (
                              <select 
                                className="form-control"
                                style={{ 
                                  background: 'rgba(255,255,255,0.05)', 
                                  border: '1px solid rgba(255,255,255,0.15)', 
                                  color: '#fff', 
                                  fontSize: '0.875rem',
                                  borderRadius: '6px',
                                  height: '36px'
                                }}
                                value={previewValues[field.key] || ''}
                                onChange={e => setPreviewValues({ ...previewValues, [field.key]: e.target.value })}
                              >
                                <option value="" style={{ color: '#000' }}>Selecione uma opção...</option>
                                {field.options_source === 'banks'
                                  ? lookupBanks.map(b => {
                                      const code = String(b.code ?? '')
                                      const codeLabel =
                                        code && /^\d+$/.test(code)
                                          ? `[${code.padStart(3, '0')}] `
                                          : (code ? `[${code}] ` : '')
                                      return (
                                        <option key={`${code}_${b.name}`} value={`${code}|${b.name}`} style={{ color: '#000' }}>
                                          {codeLabel}{b.name}
                                        </option>
                                      )
                                    })
                                  : field.options_source === 'ufs'
                                    ? lookupUfs.map(u => (
                                        <option key={u.sigla} value={u.sigla} style={{ color: '#000' }}>
                                          {u.sigla}{u.nome ? ` - ${u.nome}` : ''}
                                        </option>
                                      ))
                                    : field.options?.map(opt => (
                                        <option key={opt} value={opt} style={{ color: '#000' }}>{opt}</option>
                                      ))
                                }
                              </select>
                            )}

                            {field.type === 'file' && (
                              <div 
                                style={{ 
                                  border: '1px dashed rgba(255,255,255,0.25)', 
                                  padding: '0.75rem', 
                                  borderRadius: '6px', 
                                  textAlign: 'center',
                                  background: 'rgba(255,255,255,0.02)',
                                  color: 'rgba(255,255,255,0.5)',
                                  fontSize: '0.75rem',
                                  cursor: 'pointer'
                                }}
                              >
                                Clique para anexar arquivo (PDF/Imagem)
                              </div>
                            )}
                          </>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginTop: '0.25rem' }}>
                            <input 
                              type="checkbox"
                              id={`prev_chk_${field.key}`}
                              checked={!!previewValues[field.key]}
                              onChange={e => setPreviewValues({ ...previewValues, [field.key]: e.target.checked })}
                              style={{ marginTop: '3px' }}
                            />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                              <label htmlFor={`prev_chk_${field.key}`} style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.8)', cursor: 'pointer', lineHeight: '1.2' }}>
                                {field.label} {field.required && <span style={{ color: '#FF2D6D' }}>*</span>}
                              </label>
                              {!!field.description && (
                                <div style={{ fontSize: '0.7rem', fontStyle: 'italic', color: 'rgba(255,255,255,0.55)' }}>
                                  {field.description}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                      </div>
                    )
                  })}
                </div>

                {/* Botão de Enviar Simulado */}
                <button 
                  type="button" 
                  style={{ 
                    marginTop: '1.5rem', 
                    width: '100%', 
                    height: '40px',
                    borderRadius: '8px', 
                    background: `linear-gradient(90deg, ${selectedForm.config?.branding?.accent_color || '#FF2D6D'} 0%, ${selectedForm.config?.branding?.primary_color || '#8A2BE2'} 100%)`, 
                    border: 'none', 
                    color: '#fff', 
                    fontWeight: 600, 
                    fontSize: '0.875rem', 
                    cursor: 'pointer'
                  }}
                >
                  {selectedForm.config?.submit?.finish_label || 'Finalizar e Enviar'}
                </button>
              </div>

              {/* Botão Home Bar Mobile */}
              {previewDevice === 'mobile' && (
                <div style={{ width: '120px', height: '4px', background: 'rgba(255,255,255,0.3)', borderRadius: '2px', margin: '8px auto' }} />
              )}
            </div>
          </div>

        </div>
      )}

      {/* Paleta: adicionar pergunta a partir do dicionário canônico */}
      {showFieldPalette && selectedForm && (
        <div
          onClick={() => setShowFieldPalette(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 12, width: 'min(560px, 96vw)', maxHeight: '82vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(0,0,0,0.25)', overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--brs-gray-100)' }}>
              <Plus size={18} style={{ color: 'var(--brs-navy)' }} />
              <strong style={{ flex: 1, color: 'var(--brs-gray-800)' }}>Adicionar campo do dicionário</strong>
              <button type="button" className="btn btn-ghost" onClick={() => setShowFieldPalette(false)} style={{ padding: 4 }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ padding: '0.75rem 1rem 0' }}>
              <input
                type="text"
                className="form-control"
                autoFocus
                placeholder="Buscar campo… (ex.: CNPJ, banco, e-mail)"
                value={paletteQuery}
                onChange={e => setPaletteQuery(e.target.value)}
              />
              <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)', margin: '0.5rem 0' }}>
                Cria uma pergunta já vinculada ao campo do Agente Corban. Você ajusta tipo/máscara depois.
              </div>
            </div>
            <div style={{ overflowY: 'auto', padding: '0 1rem 1rem', flex: 1, minHeight: 0 }}>
              {(() => {
                const q = paletteQuery.trim().toLowerCase()
                const groups = SYSTEM_KEY_GROUPS
                  .map(group => ({
                    ...group,
                    options: group.options.filter(o => !q || o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)),
                  }))
                  .filter(group => group.options.length > 0)
                if (groups.length === 0) {
                  return <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-400)', padding: '1rem 0', textAlign: 'center' }}>Nenhum campo encontrado para “{paletteQuery}”.</div>
                }
                return groups.map(group => (
                  <div key={group.group} style={{ marginBottom: '0.85rem' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--brs-gray-500)', margin: '0.35rem 0' }}>
                      {group.label}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                      {group.options.map(option => (
                        <button
                          key={option.value}
                          type="button"
                          className="btn btn-outline"
                          title={`${option.label} — ${option.value}`}
                          onClick={() => { addFieldFromSystemKey(option.value, option.label); setShowFieldPalette(false); setBuilderTab('fields') }}
                          style={{ padding: '3px 8px', fontSize: '0.75rem' }}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
