'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  CheckCircle,
  Copy,
  Edit2,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Users,
} from 'lucide-react'
import {
  deleteCommercialEntity,
  reactivateCommercialEntity,
  type CommercialCardLinkRow,
  getCommercialCardLinks,
  getCompanyProfiles,
  getCommercialEntities,
  saveCommercialEntity,
} from '../../actions'
import { buildCommercialCardLinks } from '@/lib/commercial-card'
import PublicCommercialCard from '@/app/cartao/_components/PublicCommercialCard'
import type { PublicCommercialCardData, PublicCommercialCardLink } from '@/lib/commercial-card-public'

type Role = 'superintendente' | 'supervisor' | 'gerente'
type TabKey =
  | 'dados'
  | 'arw'
  | 'documentos'
  | 'contratos'
  | 'remuneracao'
  | 'veiculo'
  | 'cartao'

type BankLookup = {
  code?: string | number
  name?: string
  fullName?: string
  ispb?: string
}

type UfLookup = {
  sigla: string
  nome: string
}

type CompanyProfileOption = {
  id: string
  nickname: string
  is_active: boolean
  company_data?: {
    site?: string
    email_support?: string
    instagram?: string
    facebook?: string
    tiktok?: string
    youtube?: string
    whatsapp_support?: string
    whatsapp_community?: string
    linkedin?: string
  }
}

type SystemUserOption = {
  id: string
  name: string
  email: string
  cpf: string
  avatar_url?: string | null
}

type CertificationRow = {
  id: string
  certificadora: string
  tipo_certificado: string
  nome_certificado: string
  numero_certificado: string
  data_exame: string
  data_validade: string
  situacao: string
}

type PeriodRow = {
  id: string
  dia_pagamento: string
  data_inicial: string
  data_final: string
  valor: string
}

type VehiclePhotoKey =
  | 'foto_frontal'
  | 'foto_lateral_direita'
  | 'foto_lateral_esquerda'
  | 'foto_traseira'
  | 'foto_hodometro'

type CommercialDraft = {
  id?: string
  name: string
  cpf_cnpj: string
  role: Role
  parent_id: string | null
  user_id: string | null
  status: 'ativo' | 'inativo'
  arw_code?: string
  filial?: string
  nivel_acesso?: string
  tipo_agente?: string
  regra_fisico?: string
  phone_whatsapp?: string
  email_comissao?: string
  google_drive_url?: string
  commercial_slug?: string
  card_enabled?: boolean
  cadastral_data: Record<string, any>
  arw_data: Record<string, any>
  documents_data: { drive_url?: string; certifications: CertificationRow[] }
  contract_data: { data_inicial_contrato: string; remuneracao_fixa: PeriodRow[]; diaria_pernoite: PeriodRow[] }
  remuneration_variable_data: Record<string, any>
  vehicle_rental_data: Record<string, any>
  card_data: Record<string, any>
  parent?: { id: string; name: string; role: string; cadastral_data?: Record<string, any> | null }
}

type CardSocialKey = 'instagram' | 'facebook' | 'linkedin' | 'tiktok' | 'threads' | 'x' | 'youtube' | 'community'
type CardSocialFlagKey = `show_${CardSocialKey}`

const CARD_SOCIAL_FIELDS: Array<{
  key: CardSocialKey
  flag: CardSocialFlagKey
  label: string
}> = [
  { key: 'instagram', flag: 'show_instagram', label: 'Instagram' },
  { key: 'facebook', flag: 'show_facebook', label: 'Facebook' },
  { key: 'linkedin', flag: 'show_linkedin', label: 'LinkedIn' },
  { key: 'tiktok', flag: 'show_tiktok', label: 'TikTok' },
  { key: 'threads', flag: 'show_threads', label: 'Threads' },
  { key: 'x', flag: 'show_x', label: 'X' },
  { key: 'youtube', flag: 'show_youtube', label: 'Canal do YouTube' },
  { key: 'community', flag: 'show_community', label: 'Comunidade WhatsApp' },
]

type EntityRow = {
  id: string
  name: string
  cpf_cnpj: string
  role: Role
  parent_id: string | null
  user_id: string | null
  status: 'ativo' | 'inativo'
  arw_code?: string | null
  filial?: string | null
  nivel_acesso?: string | null
  tipo_agente?: string | null
  regra_fisico?: string | null
  phone_whatsapp?: string | null
  email_comissao?: string | null
  google_drive_url?: string | null
  commercial_slug?: string | null
  card_enabled?: boolean | null
  cadastral_data?: Record<string, any> | null
  arw_data?: Record<string, any> | null
  documents_data?: { drive_url?: string; certifications?: CertificationRow[] } | null
  contract_data?: { data_inicial_contrato?: string; remuneracao_fixa?: PeriodRow[]; diaria_pernoite?: PeriodRow[] } | null
  remuneration_variable_data?: Record<string, any> | null
  vehicle_rental_data?: Record<string, any> | null
  card_data?: Record<string, any> | null
  parent?: { id: string; name: string; role: string; cadastral_data?: Record<string, any> | null }
}

const EMPTY_DOCUMENT_ROW = (): CertificationRow => ({
  id: `cert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  certificadora: '',
  tipo_certificado: '',
  nome_certificado: '',
  numero_certificado: '',
  data_exame: '',
  data_validade: '',
  situacao: '',
})

const EMPTY_PERIOD_ROW = (): PeriodRow => ({
  id: `period-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  dia_pagamento: '',
  data_inicial: '',
  data_final: '',
  valor: '',
})

const EMPTY_DRAFT: CommercialDraft = {
  name: '',
  cpf_cnpj: '',
  role: 'gerente',
  parent_id: null,
  user_id: null,
  status: 'ativo',
  arw_code: '',
  filial: '',
  nivel_acesso: '',
  tipo_agente: '',
  regra_fisico: '',
  phone_whatsapp: '',
  email_comissao: '',
  google_drive_url: '',
  commercial_slug: '',
  card_enabled: false,
  cadastral_data: {
    commercial_name: '',
    fantasy_name: '',
    address_street: '',
    address_neighborhood: '',
    address_city: '',
    address_state: '',
    address_number: '',
    address_number_is_empty: false,
    address_complement: '',
    cep: '',
    bank_code: '',
    bank_name: '',
    bank_agency: '',
    bank_account: '',
    bank_account_type: 'Corrente',
    pix_type: 'cnpj',
    pix_key: '',
    cpf: '',
    full_name: '',
    birth_date: '',
    sex: 'M',
    residential_cep: '',
    residential_address_street: '',
    residential_address_neighborhood: '',
    residential_address_city: '',
    residential_address_state: '',
    residential_address_number: '',
    residential_address_number_is_empty: false,
    residential_address_complement: '',
    latitude: '',
    longitude: '',
    phone_whatsapp: '',
    email_professional: '',
    email_personal: '',
    cargo_comercial: 'Gerente Comercial',
    supervisor_vinculado: '',
    cnpjws_payload: {},
    cpfhub_payload: {},
  },
  arw_data: {
    codigo_agente_arw_cnpj: '',
    codigo_agente_arw_pf: '',
    unidade: '',
    nivel_acesso_arw: '',
    tipo_agente_arw: '',
  },
  documents_data: {
    drive_url: '',
    certifications: [EMPTY_DOCUMENT_ROW(), EMPTY_DOCUMENT_ROW(), EMPTY_DOCUMENT_ROW(), EMPTY_DOCUMENT_ROW(), EMPTY_DOCUMENT_ROW()],
  },
  contract_data: {
    data_inicial_contrato: '',
    remuneracao_fixa: [EMPTY_PERIOD_ROW()],
    diaria_pernoite: [EMPTY_PERIOD_ROW()],
  },
  remuneration_variable_data: {},
  vehicle_rental_data: {
    tipo_veiculo: 'carro',
    marca: '',
    modelo: '',
    ano_combustivel: '',
    codigo_fipe: '',
    placa: '',
    cor: '',
    chassi: '',
    renavam: '',
    cpf_cnpj_proprietario: '',
    nome_proprietario: '',
    valor_aluguel: '',
    fotos: {},
  },
  card_data: {
    show_instagram: true,
    show_facebook: true,
    show_linkedin: true,
    show_tiktok: true,
    show_threads: true,
    show_x: true,
    show_youtube: true,
    show_community: true,
    instagram: '',
    facebook: '',
    linkedin: '',
    tiktok: '',
    threads: '',
    x: '',
    youtube: '',
    community: '',
  },
}

function onlyDigits(value: string) {
  return String(value || '').replace(/\D/g, '')
}

function maskCpf(value: string) {
  const v = onlyDigits(value).slice(0, 11)
  return v
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2')
}

function maskCnpj(value: string) {
  const v = onlyDigits(value).slice(0, 14)
  return v
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

function maskCep(value: string) {
  const v = onlyDigits(value).slice(0, 8)
  return v.replace(/^(\d{5})(\d)/, '$1-$2')
}

function maskPhone(value: string) {
  const v = onlyDigits(value).slice(0, 11)
  if (v.length <= 10) {
    return v.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
  }
  return v.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2')
}

function maskAgency(value: string) {
  const v = onlyDigits(value).slice(0, 5).padStart(5, '0')
  return `${v.slice(0, 4)}-${v.slice(4)}`
}

function maskAccount(value: string) {
  const v = onlyDigits(value).slice(0, 11).padStart(11, '0')
  return `${v.slice(0, 10)}-${v.slice(10)}`
}

function normalizeAgencyValue(value: string) {
  const digits = onlyDigits(value).slice(0, 5).padStart(5, '0')
  return `${digits.slice(0, 4)}-${digits.slice(4)}`
}

function normalizeAccountValue(value: string) {
  const digits = onlyDigits(value).slice(0, 11).padStart(11, '0')
  return `${digits.slice(0, 10)}-${digits.slice(10)}`
}

function normalizeDateToInputValue(value: unknown) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  }

  const slashMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`
  }

  const digits = onlyDigits(raw)
  if (digits.length === 8) {
    const first = Number(digits.slice(0, 4))
    const last = Number(digits.slice(4, 8))
    if (first > 1900 && first < 2100) {
      return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
    }
    if (last > 1900 && last < 2100) {
      return `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`
    }
  }

  return ''
}

function normalizeAddressNumberValue(value: string) {
  const trimmed = String(value || '').trim().toUpperCase()
  if (!trimmed) return ''
  if (/^S\/?N$/.test(trimmed)) return 'S/N'
  return onlyDigits(trimmed).slice(0, 6)
}

function normalizeAddressNumberInputValue(value: string) {
  const trimmed = String(value || '').trim().toUpperCase()
  if (!trimmed) return ''
  if (trimmed.startsWith('S')) {
    return trimmed.replace(/[^SN/]/g, '').replace(/^S\/?N?$/, 'S/N')
  }
  return onlyDigits(trimmed).slice(0, 6)
}

function formatUuidValue(value: string) {
  const hex = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase().slice(0, 32)
  if (!hex) return ''
  const parts = [8, 4, 4, 4, 12]
  const chunks: string[] = []
  let cursor = 0
  for (const part of parts) {
    const chunk = hex.slice(cursor, cursor + part)
    if (!chunk) break
    chunks.push(chunk)
    cursor += part
  }
  return chunks.join('-')
}

function maskUuidInput(value: string) {
  const raw = String(value || '').toUpperCase().replace(/[^0-9A-F-]/g, '')
  const withoutHyphens = raw.replace(/-/g, '')
  return formatUuidValue(withoutHyphens)
}

function normalizePixKeyValue(value: string, type: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (type === 'cnpj') return maskCnpj(raw)
  if (type === 'bank') return 'Dados Bancários cadastrados'
  if (type === 'phone') return onlyDigits(raw).slice(0, 11)
  if (type === 'random') return formatUuidValue(raw)
  if (type === 'email') return maskEmailInput(raw)
  return raw
}

function getDerivedPixKeyValue(entity?: CommercialDraft | null) {
  const type = String(entity?.cadastral_data?.pix_type || 'cnpj')
  const rawCnpj = maskCnpj(entity?.cpf_cnpj || '')

  if (type === 'cnpj') return rawCnpj
  if (type === 'bank') return 'Dados Bancários cadastrados'
  if (type === 'phone') return maskPhone(entity?.cadastral_data?.pix_key || '')
  if (type === 'random') return formatUuidValue(entity?.cadastral_data?.pix_key || '')
  if (type === 'email') return maskEmailInput(entity?.cadastral_data?.pix_key || '')
  return entity?.cadastral_data?.pix_key || ''
}

function normalizeEmailValue(value: string) {
  return String(value || '').trim().toLowerCase()
}

function maskEmailInput(value: string) {
  const raw = String(value || '').toLowerCase().replace(/\s+/g, '')
  if (!raw) return ''

  const parts = raw.split('@')
  const localPart = (parts[0] || '').replace(/[^a-z0-9._%+-]/g, '')
  const domainPart = parts.slice(1).join('').replace(/[^a-z0-9.-]/g, '')

  if (parts.length <= 1) return localPart
  return `${localPart}@${domainPart}`
}

function formatBankLabel(bank: BankLookup) {
  return `${String(bank.code || '').padStart(3, '0')} - ${bank.name || bank.fullName || ''}`.trim()
}

function normalizeSlug(input: string) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function toJsonArray<T>(value: unknown, fallback: T[]): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback
}

function normalizeDraft(row?: Partial<EntityRow> | null): CommercialDraft {
  const source = row || {}
  const cadastral = { ...EMPTY_DRAFT.cadastral_data, ...(source.cadastral_data || {}) }
  const arw = { ...EMPTY_DRAFT.arw_data, ...(source.arw_data || {}) }
  const documents = {
    drive_url: source.documents_data?.drive_url || '',
    certifications: toJsonArray(source.documents_data?.certifications, EMPTY_DRAFT.documents_data.certifications).map((item) => ({
      ...EMPTY_DOCUMENT_ROW(),
      ...item,
      id: item?.id || EMPTY_DOCUMENT_ROW().id,
    })),
  }
  const contract = {
    data_inicial_contrato: source.contract_data?.data_inicial_contrato || '',
    remuneracao_fixa: toJsonArray(source.contract_data?.remuneracao_fixa, EMPTY_DRAFT.contract_data.remuneracao_fixa).map((item) => ({
      ...EMPTY_PERIOD_ROW(),
      ...item,
      id: item?.id || EMPTY_PERIOD_ROW().id,
    })),
    diaria_pernoite: toJsonArray(source.contract_data?.diaria_pernoite, EMPTY_DRAFT.contract_data.diaria_pernoite).map((item) => ({
      ...EMPTY_PERIOD_ROW(),
      ...item,
      id: item?.id || EMPTY_PERIOD_ROW().id,
    })),
  }
  const vehicle = {
    ...EMPTY_DRAFT.vehicle_rental_data,
    ...(source.vehicle_rental_data || {}),
    fotos: { ...(EMPTY_DRAFT.vehicle_rental_data.fotos as Record<string, string>), ...(source.vehicle_rental_data?.fotos || {}) },
  }
  const card = { ...EMPTY_DRAFT.card_data, ...(source.card_data || {}) }
  cadastral.address_number_is_empty = String(cadastral.address_number || '').toUpperCase() === 'S/N'
  cadastral.residential_address_number_is_empty = String(cadastral.residential_address_number || '').toUpperCase() === 'S/N'

  return {
    ...EMPTY_DRAFT,
    ...source,
    name: source.name || '',
    cpf_cnpj: source.cpf_cnpj || '',
    role: source.role || 'gerente',
    parent_id: source.parent_id || null,
    user_id: source.user_id || null,
    status: source.status || 'ativo',
    arw_code: source.arw_code || '',
    filial: source.filial || '',
    nivel_acesso: source.nivel_acesso || '',
    tipo_agente: source.tipo_agente || '',
    regra_fisico: source.regra_fisico || '',
    phone_whatsapp: source.phone_whatsapp || '',
    email_comissao: source.email_comissao || '',
    google_drive_url: source.google_drive_url || '',
    commercial_slug: source.commercial_slug || '',
    card_enabled: !!source.card_enabled,
    cadastral_data: cadastral,
    arw_data: arw,
    documents_data: documents,
    contract_data: contract,
    remuneration_variable_data: { ...(source.remuneration_variable_data || {}) },
    vehicle_rental_data: vehicle,
    card_data: card,
    parent: source.parent,
  }
}

function copyText(value: string) {
  if (typeof navigator === 'undefined') return
  navigator.clipboard?.writeText(value).catch(() => {})
}

function dayBefore(dateStr: string) {
  if (!dateStr) return ''
  const date = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  date.setDate(date.getDate() - 1)
  return date.toISOString().slice(0, 10)
}

function normalizePeriods(rows: PeriodRow[]) {
  const ordered = [...rows]
    .filter((row) => row.data_inicial || row.valor || row.dia_pagamento)
    .sort((a, b) => String(a.data_inicial || '').localeCompare(String(b.data_inicial || '')))
  return ordered.map((row, index) => ({
    ...row,
    data_final: index < ordered.length - 1 ? dayBefore(ordered[index + 1].data_inicial) : '',
  }))
}

function buildCardName(draft: CommercialDraft) {
  return String(draft.cadastral_data?.commercial_name || draft.name || '').trim()
}

function buildCardRole(draft: CommercialDraft) {
  const sex = String(draft.cadastral_data?.sex || '').toLowerCase()
  const base = draft.role === 'superintendente' ? 'Superintendente Comercial' : draft.role === 'supervisor' ? 'Supervisor Comercial' : 'Gerente Comercial'
  if (draft.role === 'gerente') return 'Gerente Comercial'
  if (sex === 'f' && draft.role === 'supervisor') return 'Supervisora Comercial'
  if (sex === 'f' && draft.role === 'superintendente') return 'Superintendente Comercial'
  return base
}

function isCardSocialEnabled(cardData: Record<string, any> | null | undefined, flag: CardSocialFlagKey) {
  return !!cardData?.[flag]
}

function CardPreview({
  data,
  viewport,
}: {
  data: (PublicCommercialCardData & { slug: string }) | null
  viewport: 'mobile' | 'desktop'
}) {
  if (!data) {
    return (
      <div style={{ width: '100%', minHeight: 480, display: 'grid', placeItems: 'center', borderRadius: 24, border: '1px dashed var(--brs-gray-200)', background: '#fff' }}>
        <div style={{ color: 'var(--brs-gray-400)', textAlign: 'center', padding: '1.5rem' }}>Selecione uma entidade para ver o cartão oficial.</div>
      </div>
    )
  }

  return (
    <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      <div
        style={{
          width: viewport === 'mobile' ? 'min(100%, 430px)' : 'min(100%, 760px)',
          transition: 'width 180ms ease',
        }}
      >
        <PublicCommercialCard {...data} />
      </div>
    </div>
  )
}

function RowField({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      {children}
      {hint ? (
        <div style={{ marginTop: 6, fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>{hint}</div>
      ) : null}
    </div>
  )
}

export default function ComercialConfigPage() {
  const [entities, setEntities] = useState<EntityRow[]>([])
  const [systemUsers, setSystemUsers] = useState<SystemUserOption[]>([])
  const [banks, setBanks] = useState<BankLookup[]>([])
  const [ufs, setUfs] = useState<UfLookup[]>([])
  const [loading, setLoading] = useState(true)
  const [banksLoading, setBanksLoading] = useState(false)
  const [ufsLoading, setUfsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [view, setView] = useState<'list' | 'edit'>('list')
  const [activeTab, setActiveTab] = useState<TabKey>('dados')
  const [previewMode, setPreviewMode] = useState<'mobile' | 'desktop'>('mobile')
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all')
  const [statusFilter, setStatusFilter] = useState<'ativo' | 'inativo' | 'all'>('ativo')
  const [bankSearch, setBankSearch] = useState('')
  const [bankDropdownOpen, setBankDropdownOpen] = useState(false)
  const [companyOptions, setCompanyOptions] = useState<CompanyProfileOption[]>([])
  const [cardLinks, setCardLinks] = useState<CommercialCardLinkRow[]>([])
  const [editingEntity, setEditingEntity] = useState<CommercialDraft | null>(null)
  const selectedLinkedUser = useMemo(() => {
    if (!editingEntity?.user_id) return null
    return systemUsers.find((user) => user.id === editingEntity.user_id) || null
  }, [editingEntity?.user_id, systemUsers])
  const selectedCompanyProfile = useMemo(() => {
    const unit = String(editingEntity?.arw_data?.unidade || '').trim().toLowerCase()
    if (!unit) return null
    return (
      companyOptions.find((company) => company.is_active !== false && String(company.nickname || '').trim().toLowerCase() === unit) || null
    )
  }, [companyOptions, editingEntity?.arw_data?.unidade])
  const previewCompanyProfile = useMemo(
    () =>
      selectedCompanyProfile
        ? {
            nickname: selectedCompanyProfile.nickname,
            company_data: selectedCompanyProfile.company_data || {},
          }
        : null,
    [selectedCompanyProfile],
  )
  const companyPreviewLinks = useMemo(
    () => buildCommercialCardLinks(selectedCompanyProfile, editingEntity?.commercial_slug),
    [selectedCompanyProfile, editingEntity?.commercial_slug],
  )
  const previewCardData = useMemo<(PublicCommercialCardData & { slug: string }) | null>(() => {
    if (!editingEntity) return null

    const parentRow = editingEntity.parent_id ? entities.find((entity) => entity.id === editingEntity.parent_id) || null : null
    const superiorRow = parentRow?.parent_id ? entities.find((entity) => entity.id === parentRow.parent_id) || null : null
    const parentUser = parentRow?.user_id ? systemUsers.find((user) => user.id === parentRow.user_id) || null : null
    const superiorUser = superiorRow?.user_id ? systemUsers.find((user) => user.id === superiorRow.user_id) || null : null

    const currentCardLinks = [...cardLinks]
      .filter((link) => link.is_active)
      .sort((a, b) => a.position - b.position)
      .map((link) => ({
        id: link.id,
        name: link.name,
        destination_url: link.destination_url,
        icon_key: link.icon_key,
        position: link.position,
        is_active: link.is_active,
      }))

    return {
      slug: editingEntity.commercial_slug || normalizeSlug(buildCardName(editingEntity) || 'cartao'),
      entity: {
        id: editingEntity.id || `preview-${normalizeSlug(editingEntity.commercial_slug || buildCardName(editingEntity) || 'cartao')}`,
        name: editingEntity.name || '',
        role: editingEntity.role,
        status: editingEntity.status,
        commercial_slug: editingEntity.commercial_slug || null,
        card_enabled: !!editingEntity.card_enabled,
        user_id: editingEntity.user_id,
        parent_id: editingEntity.parent_id,
        phone_whatsapp: String(editingEntity.cadastral_data?.phone_whatsapp || editingEntity.phone_whatsapp || ''),
        email_comissao: String(editingEntity.cadastral_data?.email_professional || editingEntity.email_comissao || ''),
        cadastral_data: editingEntity.cadastral_data || {},
        arw_data: editingEntity.arw_data || {},
        card_data: editingEntity.card_data || {},
      },
      companyProfile: previewCompanyProfile,
      linkedUser: selectedLinkedUser
        ? {
            id: selectedLinkedUser.id,
            name: selectedLinkedUser.name,
            avatar_url: selectedLinkedUser.avatar_url || null,
          }
        : null,
      cardLinks: currentCardLinks as PublicCommercialCardLink[],
      parent: parentRow
        ? {
            id: parentRow.id,
            name: parentRow.name,
            role: parentRow.role as Role,
            commercial_slug: parentRow.commercial_slug || null,
            cadastral_data: parentRow.cadastral_data || {},
            user_id: parentRow.user_id,
            avatar_url: parentUser?.avatar_url || null,
          }
        : null,
      superior: superiorRow
        ? {
            id: superiorRow.id,
            name: superiorRow.name,
            role: superiorRow.role as Role,
            commercial_slug: superiorRow.commercial_slug || null,
            cadastral_data: superiorRow.cadastral_data || {},
            user_id: superiorRow.user_id,
            avatar_url: superiorUser?.avatar_url || null,
          }
        : null,
    }
  }, [cardLinks, editingEntity, entities, previewCompanyProfile, selectedLinkedUser, systemUsers])
  const filteredBanks = useMemo(() => {
    const query = bankSearch.trim().toLowerCase()
    if (!bankDropdownOpen || query.length < 3) return []
    return banks
      .filter((bank) => {
        const label = formatBankLabel(bank).toLowerCase()
        const code = String(bank.code || '').toLowerCase()
        return label.includes(query) || code.includes(query)
      })
      .slice(0, 12)
  }, [banks, bankSearch])

  async function loadData() {
    setLoading(true)
    const [res, companiesRes, cardLinksRes] = await Promise.all([getCommercialEntities(), getCompanyProfiles(), getCommercialCardLinks()])
    if (res.success && res.entities && res.systemUsers) {
      setEntities(res.entities as EntityRow[])
      setSystemUsers(res.systemUsers)
    } else {
      setMessage({ type: 'error', text: 'Erro ao carregar dados comerciais.' })
    }
    if (companiesRes.success && Array.isArray(companiesRes.companies)) {
      setCompanyOptions(
        companiesRes.companies
          .filter((company: any) => company?.is_active !== false && String(company?.nickname || '').trim())
          .map((company: any) => ({
            id: String(company.id || ''),
            nickname: String(company.nickname || '').trim(),
            is_active: company?.is_active !== false,
            company_data: company?.company_data || {},
          })),
      )
    } else {
      setCompanyOptions([])
    }
    if (cardLinksRes.success && Array.isArray(cardLinksRes.links)) {
      setCardLinks(cardLinksRes.links as CommercialCardLinkRow[])
    } else {
      setCardLinks([])
    }
    setLoading(false)
  }

  async function loadBanks() {
    if (banks.length || banksLoading) return
    setBanksLoading(true)
    try {
      const res = await fetch('/api/lookups/banks')
      const data = await res.json()
      setBanks(Array.isArray(data?.banks) ? data.banks : [])
    } catch {
      setBanks([])
    } finally {
      setBanksLoading(false)
    }
  }

  async function loadUfs() {
    if (ufs.length || ufsLoading) return
    setUfsLoading(true)
    try {
      const res = await fetch('/api/lookups/ufs')
      const data = await res.json()
      setUfs(Array.isArray(data?.ufs) ? data.ufs : [])
    } catch {
      setUfs([])
    } finally {
      setUfsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    loadBanks()
    loadUfs()
  }, [])

  useEffect(() => {
    if (!editingEntity) {
      setBankSearch('')
      setBankDropdownOpen(false)
      return
    }

    const currentBankCode = String(editingEntity.cadastral_data.bank_code || '').trim()
    const currentBankName = String(editingEntity.cadastral_data.bank_name || '').trim()
    if (currentBankCode || currentBankName) {
      setBankSearch(currentBankName || currentBankCode)
    } else {
      setBankSearch('')
    }
    setBankDropdownOpen(false)
  }, [editingEntity?.id, editingEntity?.cadastral_data.bank_code, editingEntity?.cadastral_data.bank_name])

  const superintendentes = useMemo(() => entities.filter((e) => e.role === 'superintendente' && e.status === 'ativo'), [entities])
  const supervisores = useMemo(() => entities.filter((e) => e.role === 'supervisor' && e.status === 'ativo'), [entities])

  const filteredEntities = useMemo(() => {
    return entities.filter((ent) => {
      const matchesSearch =
        ent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ent.cpf_cnpj.includes(searchQuery) ||
        String(ent.arw_code || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(ent.commercial_slug || '').toLowerCase().includes(searchQuery.toLowerCase())
      const matchesRole = roleFilter === 'all' || ent.role === roleFilter
      const matchesStatus = statusFilter === 'all' || ent.status === statusFilter
      return matchesSearch && matchesRole && matchesStatus
    })
  }, [entities, roleFilter, searchQuery, statusFilter])

  function openCreate() {
    setEditingEntity(normalizeDraft(null))
    setActiveTab('dados')
    setPreviewMode('mobile')
    setView('edit')
  }

  function openEdit(entity: EntityRow) {
    setEditingEntity(normalizeDraft(entity))
    setActiveTab('dados')
    setPreviewMode('mobile')
    setView('edit')
  }

  function updateDraft(patch: Partial<CommercialDraft>) {
    setEditingEntity((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  function updateNested(section: keyof Pick<CommercialDraft, 'cadastral_data' | 'arw_data' | 'card_data' | 'vehicle_rental_data' | 'remuneration_variable_data'>, patch: Record<string, any>) {
    setEditingEntity((prev) => (prev ? { ...prev, [section]: { ...(prev as any)[section], ...patch } } : prev))
  }

  function updateDocumentRows(next: CertificationRow[]) {
    setEditingEntity((prev) =>
      prev
        ? {
            ...prev,
            documents_data: {
              ...prev.documents_data,
              certifications: next,
            },
          }
        : prev,
    )
  }

  function updatePeriodRows(section: 'remuneracao_fixa' | 'diaria_pernoite', next: PeriodRow[]) {
    setEditingEntity((prev) =>
      prev
        ? {
            ...prev,
            contract_data: {
              ...prev.contract_data,
              [section]: next,
            },
          }
        : prev,
    )
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editingEntity?.name || !editingEntity?.role || !editingEntity?.cpf_cnpj) {
      setMessage({ type: 'error', text: 'Nome, Cargo e CPF/CNPJ sao obrigatorios.' })
      return
    }

    setSaving(true)
    setMessage(null)

    const draftToSave: any = {
      ...editingEntity,
      commercial_slug: normalizeSlug(String(editingEntity.commercial_slug || buildCardName(editingEntity).split(' ')[0] || '')),
      phone_whatsapp: editingEntity.cadastral_data?.phone_whatsapp || editingEntity.phone_whatsapp || '',
      email_comissao: normalizeEmailValue(editingEntity.cadastral_data?.email_professional || editingEntity.email_comissao || ''),
      google_drive_url: editingEntity.documents_data?.drive_url || editingEntity.google_drive_url || '',
      cadastral_data: {
        ...(editingEntity.cadastral_data || {}),
        address_number_is_empty: !!editingEntity.cadastral_data?.address_number_is_empty,
        residential_address_number_is_empty: !!editingEntity.cadastral_data?.residential_address_number_is_empty,
        address_number: editingEntity.cadastral_data?.address_number_is_empty ? 'S/N' : normalizeAddressNumberValue(editingEntity.cadastral_data?.address_number || ''),
        residential_address_number: editingEntity.cadastral_data?.residential_address_number_is_empty
          ? 'S/N'
          : normalizeAddressNumberValue(editingEntity.cadastral_data?.residential_address_number || ''),
        bank_code: String(editingEntity.cadastral_data?.bank_code || ''),
        bank_name: String(editingEntity.cadastral_data?.bank_name || ''),
        bank_agency: String(editingEntity.cadastral_data?.bank_agency || ''),
        bank_account: String(editingEntity.cadastral_data?.bank_account || ''),
        bank_account_type: editingEntity.cadastral_data?.bank_account_type || 'Corrente',
        pix_type: String(editingEntity.cadastral_data?.pix_type || 'cnpj'),
        pix_key: normalizePixKeyValue(
          getDerivedPixKeyValue(editingEntity),
          String(editingEntity.cadastral_data?.pix_type || 'cnpj'),
        ),
        phone_whatsapp: editingEntity.cadastral_data?.phone_whatsapp || editingEntity.phone_whatsapp || '',
        email_professional: normalizeEmailValue(editingEntity.cadastral_data?.email_professional || editingEntity.email_comissao || ''),
        email_personal: normalizeEmailValue(editingEntity.cadastral_data?.email_personal || ''),
        commercial_name: String(editingEntity.cadastral_data?.commercial_name || '').trim(),
      },
      documents_data: {
        ...(editingEntity.documents_data || {}),
        certifications: editingEntity.documents_data?.certifications || [],
      },
      contract_data: {
        ...(editingEntity.contract_data || {}),
        remuneracao_fixa: normalizePeriods(editingEntity.contract_data?.remuneracao_fixa || []),
        diaria_pernoite: normalizePeriods(editingEntity.contract_data?.diaria_pernoite || []),
      },
      vehicle_rental_data: {
        ...(editingEntity.vehicle_rental_data || {}),
      },
    }

    const res = await saveCommercialEntity(draftToSave)
    if (res.success) {
      setMessage({ type: 'success', text: 'Entidade comercial salva com sucesso.' })
      setView('list')
      setEditingEntity(null)
      await loadData()
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao salvar entidade.' })
    }
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Deseja realmente inativar esta entidade comercial?')) return
    const res = await deleteCommercialEntity(id)
    if (res.success) {
      setMessage({ type: 'success', text: 'Entidade comercial inativada.' })
      await loadData()
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao inativar.' })
    }
  }

  async function handleReactivate(id: string) {
    if (!confirm('Deseja reativar esta entidade comercial?')) return
    const res = await reactivateCommercialEntity(id)
    if (res.success) {
      setMessage({ type: 'success', text: 'Entidade comercial reativada.' })
      await loadData()
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao reativar.' })
    }
  }

  async function fillCompanyByCnpj() {
    if (!editingEntity) return
    const cnpj = onlyDigits(editingEntity.cpf_cnpj || '')
    if (cnpj.length !== 14) {
      setMessage({ type: 'error', text: 'Informe um CNPJ valido para consulta.' })
      return
    }

    setMessage(null)
    try {
      const res = await fetch(`https://publica.cnpj.ws/cnpj/${cnpj}`)
      if (!res.ok) throw new Error('CNPJ nao encontrado.')
      const data = await res.json()
      const est = data?.estabelecimento || {}
      const ddd = String(est?.ddd1 || '')
      const tel = String(est?.telefone1 || '')
      setEditingEntity((prev) =>
        prev
          ? {
              ...prev,
              name: data?.razao_social || prev.name,
              cadastral_data: {
                ...(prev.cadastral_data || {}),
                commercial_name: est?.nome_fantasia || prev.cadastral_data?.commercial_name || '',
                fantasy_name: est?.nome_fantasia || prev.cadastral_data?.fantasy_name || '',
                cep: est?.cep || prev.cadastral_data?.cep || '',
                address_street: est?.logradouro || prev.cadastral_data?.address_street || '',
                address_neighborhood: est?.bairro || prev.cadastral_data?.address_neighborhood || '',
                address_city: est?.cidade?.nome || prev.cadastral_data?.address_city || '',
                address_state: est?.estado?.sigla || prev.cadastral_data?.address_state || '',
                address_number: est?.numero || prev.cadastral_data?.address_number || '',
                address_complement: est?.complemento || prev.cadastral_data?.address_complement || '',
                phone_whatsapp: `${ddd}${tel}` || prev.cadastral_data?.phone_whatsapp || '',
                cnpjws_payload: data,
              },
            }
          : prev,
      )
      setMessage({ type: 'success', text: 'Dados preenchidos via CNPJ.ws.' })
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Erro ao consultar CNPJ.' })
    }
  }

  async function fillAddressByCep(target: 'company' | 'residential') {
    if (!editingEntity) return
    const cep = onlyDigits(target === 'company' ? editingEntity.cadastral_data?.cep : editingEntity.cadastral_data?.residential_cep)
    if (cep.length !== 8) {
      setMessage({ type: 'error', text: 'Informe um CEP valido para a consulta.' })
      return
    }

    try {
      const res = await fetch(`https://brasilapi.com.br/api/cep/v1/${cep}`)
      if (!res.ok) throw new Error('CEP nao encontrado.')
      const data = await res.json()
      setEditingEntity((prev) =>
        prev
          ? {
              ...prev,
              cadastral_data: {
                ...(prev.cadastral_data || {}),
                ...(target === 'company'
                  ? {
                      cep,
                      address_street: data.street || prev.cadastral_data?.address_street || '',
                      address_neighborhood: data.neighborhood || prev.cadastral_data?.address_neighborhood || '',
                      address_city: data.city || prev.cadastral_data?.address_city || '',
                      address_state: data.state || prev.cadastral_data?.address_state || '',
                    }
                  : {
                      residential_cep: cep,
                      residential_address_street: data.street || prev.cadastral_data?.residential_address_street || '',
                      residential_address_neighborhood: data.neighborhood || prev.cadastral_data?.residential_address_neighborhood || '',
                      residential_address_city: data.city || prev.cadastral_data?.residential_address_city || '',
                      residential_address_state: data.state || prev.cadastral_data?.residential_address_state || '',
                    }),
              },
            }
          : prev,
      )
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Erro ao consultar CEP.' })
    }
  }

  async function fillPersonByCpf() {
    if (!editingEntity) return
    const cpf = onlyDigits(editingEntity.cadastral_data?.cpf || editingEntity.cpf_cnpj || '')
    if (cpf.length !== 11) {
      setMessage({ type: 'error', text: 'Informe um CPF valido para consulta.' })
      return
    }

    try {
      const res = await fetch(`/api/cpfhub/cpf/${cpf}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('CPF nao encontrado.')
      const data = await res.json()
      const payload = data?.result || data?.data || data || {}
      const fullName =
        payload?.nome ||
        payload?.name ||
        payload?.nome_completo ||
        payload?.full_name ||
        payload?.pessoa?.nome ||
        payload?.dados_cadastrais?.nome ||
        ''
      const birthDateRaw =
        payload?.data_nascimento ||
        payload?.birth_date ||
        payload?.birthDate ||
        payload?.nascimento ||
        payload?.dataNascimento ||
        payload?.data_nasc ||
        payload?.pessoa?.data_nascimento ||
        payload?.dados_cadastrais?.data_nascimento ||
        payload?.dados_cadastrais?.nascimento ||
        payload?.dados?.data_nascimento ||
        payload?.dados?.nascimento ||
        (payload?.year && payload?.month && payload?.day ? `${payload.year}-${String(payload.month).padStart(2, '0')}-${String(payload.day).padStart(2, '0')}` : '') ||
        ''
      const sexValue = String(payload?.gender || payload?.sexo || payload?.sex || '').trim().toUpperCase()
      setEditingEntity((prev) =>
        prev
          ? {
              ...prev,
              cadastral_data: {
                ...(prev.cadastral_data || {}),
                cpf,
                full_name: fullName || prev.cadastral_data?.full_name || '',
                birth_date: normalizeDateToInputValue(birthDateRaw) || prev.cadastral_data?.birth_date || '',
                sex: sexValue === 'F' || sexValue === 'FEMININO' ? 'F' : sexValue === 'M' || sexValue === 'MASCULINO' ? 'M' : prev.cadastral_data?.sex || 'M',
                cpfhub_payload: data,
              },
            }
          : prev,
      )
      setMessage({ type: 'success', text: 'Dados preenchidos via CPFHub.' })
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Erro ao consultar CPF.' })
    }
  }

  function addCertRow() {
    updateDocumentRows([...(editingEntity?.documents_data.certifications || []), EMPTY_DOCUMENT_ROW()])
  }

  function addPeriod(section: 'remuneracao_fixa' | 'diaria_pernoite') {
    updatePeriodRows(section, [...(editingEntity?.contract_data[section] || []), EMPTY_PERIOD_ROW()])
  }

  function addVehiclePhoto(key: VehiclePhotoKey, value: string) {
    setEditingEntity((prev) =>
      prev
        ? {
            ...prev,
            vehicle_rental_data: {
              ...(prev.vehicle_rental_data || {}),
              fotos: {
                ...(prev.vehicle_rental_data?.fotos || {}),
                [key]: value,
              },
            },
          }
        : prev,
    )
  }

  return (
    <div className="page-content">
      {view === 'list' ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--brs-gray-800)', margin: 0 }}>
                Estrutura Comercial BRS Promotora
              </h1>
              <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
                Gerencie superintendentes, supervisores, gerentes, o cartao virtual e as tabelas de apoio.
              </p>
            </div>
            <button className="btn btn-primary" onClick={openCreate}>
              <Plus size={16} />
              Nova Entidade Comercial
            </button>
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
                border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
              }}
            >
              {message.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
              <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
            </div>
          )}

          <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }}>
                <Search size={16} />
              </span>
              <input
                type="text"
                className="form-control"
                placeholder="Buscar por nome, CPF/CNPJ, slug ou codigo ARW..."
                style={{ paddingLeft: '2.25rem', width: '100%' }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <select className="form-control" style={{ width: '220px' }} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as any)}>
              <option value="all">Todos os cargos</option>
              <option value="superintendente">Superintendente</option>
              <option value="supervisor">Supervisor</option>
              <option value="gerente">Gerente Comercial</option>
            </select>
            <select className="form-control" style={{ width: '150px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
              <option value="ativo">Ativos</option>
              <option value="inativo">Inativos</option>
              <option value="all">Todos</option>
            </select>
          </div>

          <div className="card">
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nome Comercial</th>
                    <th>Cargo</th>
                    <th>Subordinação</th>
                    <th>Link Cartão Virtual</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '3rem' }}>
                        <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
                      </td>
                    </tr>
                  ) : filteredEntities.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '3rem' }}>
                        <div className="empty-state">
                          <Users size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                          <h3>Nenhuma entidade comercial cadastrada</h3>
                          <p>Crie uma nova vaga comercial para montar a estrutura e o cartao virtual.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredEntities.map((ent) => (
                      <tr key={ent.id}>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--brs-gray-800)' }}>
                            {ent.cadastral_data?.commercial_name || ent.name}
                          </div>
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              ent.role === 'superintendente' ? 'badge-primary' : ent.role === 'supervisor' ? 'badge-success' : 'badge-warning'
                            }`}
                          >
                            {ent.role === 'superintendente' ? 'Superintendente' : ent.role === 'supervisor' ? 'Supervisor' : 'Gerente'}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.875rem' }}>
                          {ent.parent ? (
                            <div>
                              {((ent.parent as any)?.cadastral_data?.commercial_name || ent.parent.name) as string}{' '}
                              <small style={{ color: 'var(--brs-gray-400)' }}>({ent.parent.role})</small>
                            </div>
                          ) : ent.role === 'superintendente' ? (
                            <span style={{ fontWeight: 600, color: 'var(--brs-gray-700)' }}>Superintendente</span>
                          ) : (
                            <span style={{ color: 'var(--brs-gray-300)' }}>- Direto</span>
                          )}
                        </td>
                        <td>
                          {ent.commercial_slug ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                              <a
                                href={`https://${ent.commercial_slug}.brspromotora.com.br`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  color: '#2563EB',
                                  fontSize: '0.875rem',
                                  textDecoration: 'none',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  minWidth: 0,
                                }}
                                title={`${ent.commercial_slug}.brspromotora.com.br`}
                              >
                                {ent.commercial_slug}.brspromotora.com.br
                              </a>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm btn-icon"
                                onClick={() => copyText(`${ent.commercial_slug}.brspromotora.com.br`)}
                                title="Copiar link do cartão virtual"
                              >
                                <Copy size={16} />
                              </button>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--brs-gray-300)', fontSize: '0.875rem' }}>-</span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${ent.status === 'ativo' ? 'badge-success' : 'badge-gray'}`}>
                            {ent.status === 'ativo' ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(ent)}>
                              <Edit2 size={16} />
                            </button>
                            {ent.status === 'ativo' ? (
                              <button className="btn btn-ghost btn-sm btn-icon text-danger" title="Inativar entidade comercial" onClick={() => handleDelete(ent.id)}>
                                <Ban size={16} />
                              </button>
                            ) : (
                              <button className="btn btn-ghost btn-sm btn-icon" title="Reativar entidade comercial" onClick={() => handleReactivate(ent.id)}>
                                <RotateCcw size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <form onSubmit={handleSave} style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button type="button" className="btn btn-outline" onClick={() => setView('list')}>
                  <ArrowLeft size={16} />
                  Voltar
                </button>
                <div>
                  <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, color: 'var(--brs-gray-800)' }}>
                    {editingEntity?.id ? 'Editar Entidade Comercial' : 'Nova Entidade Comercial'}
                  </h1>
                  <p style={{ margin: '0.25rem 0 0', color: 'var(--brs-gray-400)', fontSize: '0.875rem' }}>
                    Tela completa com abas, preview e integrações.
                  </p>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button type="button" className="btn btn-outline" onClick={() => copyText(String(editingEntity?.commercial_slug || ''))} disabled={!editingEntity?.commercial_slug}>
                <Copy size={16} />
                Copiar slug
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
                Salvar Cadastro
              </button>
            </div>
          </div>

          {message && (
            <div
              style={{
                padding: '1rem',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
                color: message.type === 'success' ? '#065F46' : '#991B1B',
                border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
              }}
            >
              {message.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
              <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
            </div>
          )}

          <div className="tabs-list" style={{ overflowX: 'auto', whiteSpace: 'nowrap' }}>
            {[
              { id: 'dados', label: 'Dados Cadastrais' },
              { id: 'arw', label: 'ARW' },
              { id: 'documentos', label: 'Documentos' },
              { id: 'contratos', label: 'Dados Contratuais' },
              { id: 'remuneracao', label: 'Remuneração Variável' },
              { id: 'veiculo', label: 'Aluguel de Veículo' },
              { id: 'cartao', label: 'Cartão Virtual' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id as TabKey)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="card" style={{ padding: '1rem' }}>
            {activeTab === 'dados' && editingEntity && (
              <div style={{ display: 'grid', gap: '1rem' }}>
                <div className="form-grid form-grid-2">
                  <RowField
                    label="Vincular a Usuario do Workspace (Opcional)"
                    hint="Ao vincular, o usuario herda as travas de visualizacao do CRM."
                  >
                    <select className="form-control" value={editingEntity.user_id || ''} onChange={(e) => updateDraft({ user_id: e.target.value || null })}>
                      <option value="">Nao vincular a usuario de acesso</option>
                      {systemUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name} ({user.email})
                        </option>
                      ))}
                    </select>
                  </RowField>

                  <RowField label="Status">
                    <select className="form-control" value={editingEntity.status} onChange={(e) => updateDraft({ status: e.target.value as any })}>
                      <option value="ativo">Ativo</option>
                      <option value="inativo">Inativo</option>
                    </select>
                  </RowField>
                </div>

                <div style={{ display: 'grid', gap: '1rem' }}>
                  <div
                    style={{
                      display: 'grid',
                      gap: '1rem',
                      gridTemplateColumns: 'minmax(240px, 1.15fr) minmax(260px, 1.45fr) minmax(220px, 1.1fr)',
                    }}
                  >
                    <RowField label="CNPJ">
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <input className="form-control" placeholder="00.000.000/0000-00" value={maskCnpj(editingEntity.cpf_cnpj)} onChange={(e) => updateDraft({ cpf_cnpj: onlyDigits(e.target.value) })} />
                        <button type="button" className="btn btn-outline" onClick={fillCompanyByCnpj}>
                          Buscar
                        </button>
                      </div>
                    </RowField>

                    <RowField label="Razão Social">
                      <input
                        className="form-control"
                        value={editingEntity.name}
                        onChange={(e) => {
                          const next = e.target.value
                          updateDraft({
                            name: next,
                            commercial_slug: editingEntity.commercial_slug || normalizeSlug(String(next).split(' ')[0] || ''),
                          })
                        }}
                      />
                    </RowField>

                    <RowField label="Nome Comercial" hint="Nome utilizado no cartão virtual.">
                      <input
                        className="form-control"
                        value={editingEntity.cadastral_data.commercial_name || ''}
                        onChange={(e) => {
                          const next = e.target.value
                          updateNested('cadastral_data', { commercial_name: next })
                          if (!editingEntity.commercial_slug) {
                            updateDraft({ commercial_slug: normalizeSlug(String(next).split(' ')[0] || '') })
                          }
                        }}
                      />
                    </RowField>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gap: '1rem',
                      gridTemplateColumns: 'minmax(160px, 0.8fr) minmax(280px, 1.6fr) minmax(220px, 1.3fr) minmax(220px, 1.3fr) minmax(72px, 0.35fr)',
                      alignItems: 'start',
                    }}
                  >
                    <RowField label="CEP">
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <input className="form-control" style={{ maxWidth: 130 }} placeholder="00000-000" value={maskCep(editingEntity.cadastral_data.cep || '')} onChange={(e) => updateNested('cadastral_data', { cep: onlyDigits(e.target.value) })} />
                        <button type="button" className="btn btn-outline" onClick={() => fillAddressByCep('company')}>
                          Buscar
                        </button>
                      </div>
                    </RowField>
                    <RowField label="Endereço / Logradouro">
                      <input className="form-control" placeholder="Rua, Avenida, Trecho, Travessa..." value={editingEntity.cadastral_data.address_street || ''} onChange={(e) => updateNested('cadastral_data', { address_street: e.target.value })} />
                    </RowField>
                    <RowField label="Bairro">
                      <input className="form-control" value={editingEntity.cadastral_data.address_neighborhood || ''} onChange={(e) => updateNested('cadastral_data', { address_neighborhood: e.target.value })} />
                    </RowField>
                    <RowField label="Cidade">
                      <input className="form-control" value={editingEntity.cadastral_data.address_city || ''} onChange={(e) => updateNested('cadastral_data', { address_city: e.target.value })} />
                    </RowField>
                    <RowField label="UF">
                      <select
                        className="form-control"
                        style={{ maxWidth: 92 }}
                        value={editingEntity.cadastral_data.address_state || ''}
                        onChange={(e) => updateNested('cadastral_data', { address_state: e.target.value })}
                      >
                        <option value="">UF</option>
                        {ufsLoading ? (
                          <option value="" disabled>
                            Carregando...
                          </option>
                        ) : null}
                        {ufs.map((uf) => (
                          <option key={uf.sigla} value={uf.sigla}>
                            {uf.sigla}
                          </option>
                        ))}
                      </select>
                    </RowField>
                  </div>

                  <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'minmax(180px, 0.55fr) minmax(0, 1.45fr)', alignItems: 'start' }}>
                    <RowField label="Número" hint='Apenas número, se não tiver número no endereço, marque a opção ao lado "Sem número".'>
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        <input
                          className="form-control"
                          style={{ maxWidth: 120 }}
                          placeholder="00"
                          inputMode="numeric"
                          maxLength={6}
                          disabled={!!editingEntity.cadastral_data.address_number_is_empty}
                          value={editingEntity.cadastral_data.address_number_is_empty ? 'S/N' : editingEntity.cadastral_data.address_number || ''}
                          onChange={(e) =>
                            updateNested('cadastral_data', {
                              address_number: onlyDigits(e.target.value).slice(0, 6),
                              address_number_is_empty: false,
                            })
                          }
                          onBlur={(e) =>
                            updateNested('cadastral_data', {
                              address_number: editingEntity.cadastral_data.address_number_is_empty ? 'S/N' : normalizeAddressNumberValue(e.target.value).slice(0, 6),
                            })
                          }
                        />
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', color: 'var(--brs-gray-600)', whiteSpace: 'nowrap' }}>
                          <input
                            type="checkbox"
                            checked={!!editingEntity.cadastral_data.address_number_is_empty}
                            onChange={(e) =>
                              updateNested('cadastral_data', {
                                address_number_is_empty: e.target.checked,
                                address_number: e.target.checked ? 'S/N' : '',
                              })
                            }
                          />
                          Sem número
                        </label>
                      </div>
                    </RowField>
                    <RowField label="Complemento">
                      <input className="form-control" placeholder="Lote 00, Apto 000, Casa 000..." value={editingEntity.cadastral_data.address_complement || ''} onChange={(e) => updateNested('cadastral_data', { address_complement: e.target.value })} />
                    </RowField>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gap: '1rem',
                      gridTemplateColumns: 'minmax(180px, 0.85fr) minmax(140px, 0.55fr) minmax(180px, 0.8fr) minmax(150px, 0.65fr) minmax(170px, 0.8fr) minmax(260px, 1.8fr)',
                      alignItems: 'start',
                    }}
                  >
                    <RowField label="Banco">
                      <div style={{ position: 'relative', display: 'grid', gap: '0.35rem' }}>
                        <input
                          className="form-control"
                          value={bankSearch}
                          onChange={(e) => {
                            const next = e.target.value
                            setBankSearch(next)
                            setBankDropdownOpen(true)
                            updateNested('cadastral_data', { bank_code: '', bank_name: '' })
                          }}
                          onFocus={() => setBankDropdownOpen(true)}
                          onBlur={() => {
                            window.setTimeout(() => setBankDropdownOpen(false), 150)
                          }}
                          placeholder={banksLoading ? 'Carregando bancos...' : 'Digite ao menos 3 caracteres'}
                        />
                        {bankSearch.trim().length > 0 && bankSearch.trim().length < 3 ? (
                          <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>Digite pelo menos 3 caracteres para buscar.</div>
                        ) : null}
                        {filteredBanks.length > 0 ? (
                          <div
                            style={{
                              position: 'absolute',
                              top: '100%',
                              left: 0,
                              right: 0,
                              zIndex: 20,
                              marginTop: 4,
                              background: 'var(--brs-white)',
                              border: '1px solid var(--brs-gray-200)',
                              borderRadius: 12,
                              boxShadow: '0 12px 40px rgba(0, 0, 0, 0.12)',
                              maxHeight: 220,
                              overflowY: 'auto',
                            }}
                          >
                            {filteredBanks.map((bank) => {
                              const label = formatBankLabel(bank)
                              return (
                                <button
                                  key={`${bank.code}-${bank.name}`}
                                  type="button"
                                  className="btn btn-ghost"
                                  style={{ width: '100%', justifyContent: 'flex-start', borderRadius: 0, padding: '0.65rem 0.85rem' }}
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => {
                                    setBankSearch(label)
                                    setBankDropdownOpen(false)
                                    updateNested('cadastral_data', {
                                      bank_code: String(bank.code || ''),
                                      bank_name: label,
                                    })
                                  }}
                                >
                                  {label}
                                </button>
                              )
                            })}
                          </div>
                        ) : null}
                      </div>
                    </RowField>
                    <RowField label="Agência" hint="Se não houver dígito númerico, informe 0 (zero).">
                      <input className="form-control" inputMode="numeric" value={editingEntity.cadastral_data.bank_agency || ''} onChange={(e) => updateNested('cadastral_data', { bank_agency: onlyDigits(e.target.value) })} onBlur={(e) => updateNested('cadastral_data', { bank_agency: normalizeAgencyValue(e.target.value) })} placeholder="0000-0" />
                    </RowField>
                    <RowField label="Conta" hint='Se não houver dígito, o último número da conta será o dígito.'>
                      <input className="form-control" inputMode="numeric" value={editingEntity.cadastral_data.bank_account || ''} onChange={(e) => updateNested('cadastral_data', { bank_account: onlyDigits(e.target.value).slice(0, 11) })} onBlur={(e) => updateNested('cadastral_data', { bank_account: normalizeAccountValue(e.target.value) })} placeholder="0000000000-0" />
                    </RowField>
                    <RowField label="Tipo de Conta">
                      <select className="form-control" value={editingEntity.cadastral_data.bank_account_type || 'Corrente'} onChange={(e) => updateNested('cadastral_data', { bank_account_type: e.target.value })}>
                        <option value="Corrente">Corrente</option>
                        <option value="Poupanca">Poupanca</option>
                      </select>
                    </RowField>
                    <RowField label="Tipo de Chave Pix">
                      <select
                        className="form-control"
                        value={editingEntity.cadastral_data.pix_type || 'cnpj'}
                        onChange={(e) =>
                          updateNested('cadastral_data', {
                            pix_type: e.target.value,
                            pix_key:
                              e.target.value === 'cnpj'
                                ? maskCnpj(editingEntity.cpf_cnpj || '')
                                : e.target.value === 'bank'
                                  ? 'Dados Bancários cadastrados'
                                  : editingEntity.cadastral_data.pix_key || '',
                          })
                        }
                      >
                        <option value="cnpj">CNPJ</option>
                        <option value="bank">Dados Bancários</option>
                        <option value="phone">Celular</option>
                        <option value="email">E-mail</option>
                        <option value="random">Aleatória</option>
                      </select>
                    </RowField>
                    <RowField
                      label="Chave Pix"
                      hint="Quando for CNPJ ou dados bancários, a chave vem dos dados já informados."
                    >
                      {['cnpj', 'bank'].includes(String(editingEntity.cadastral_data.pix_type || 'cnpj')) ? (
                        <div className="form-control" style={{ display: 'flex', alignItems: 'center', color: 'var(--brs-gray-400)' }}>
                          {getDerivedPixKeyValue(editingEntity) || (editingEntity.cadastral_data.pix_type === 'cnpj' ? '00.000.000/0000-00' : 'Dados Bancários cadastrados')}
                        </div>
                      ) : (
                        <input
                          className="form-control"
                          type="text"
                          autoComplete={editingEntity.cadastral_data.pix_type === 'email' ? 'email' : 'off'}
                          inputMode={editingEntity.cadastral_data.pix_type === 'phone' ? 'numeric' : editingEntity.cadastral_data.pix_type === 'email' ? 'email' : 'text'}
                          value={
                            editingEntity.cadastral_data.pix_type === 'phone'
                              ? maskPhone(editingEntity.cadastral_data.pix_key || '')
                              : editingEntity.cadastral_data.pix_type === 'random'
                                ? maskUuidInput(editingEntity.cadastral_data.pix_key || '')
                                : editingEntity.cadastral_data.pix_type === 'email'
                                  ? maskEmailInput(editingEntity.cadastral_data.pix_key || '')
                                  : editingEntity.cadastral_data.pix_key || ''
                          }
                          onChange={(e) => {
                            if (editingEntity.cadastral_data.pix_type === 'phone') {
                              updateNested('cadastral_data', { pix_key: onlyDigits(e.target.value).slice(0, 11) })
                              return
                            }
                            if (editingEntity.cadastral_data.pix_type === 'random') {
                              updateNested('cadastral_data', { pix_key: maskUuidInput(e.target.value) })
                              return
                            }
                            if (editingEntity.cadastral_data.pix_type === 'email') {
                              updateNested('cadastral_data', { pix_key: maskEmailInput(e.target.value) })
                              return
                            }
                            updateNested('cadastral_data', { pix_key: e.target.value })
                          }}
                          onBlur={(e) => updateNested('cadastral_data', { pix_key: normalizePixKeyValue(e.target.value, String(editingEntity.cadastral_data.pix_type || '')) })}
                          placeholder={
                            editingEntity.cadastral_data.pix_type === 'random'
                              ? '123e4567-e89b-12d3-a456-426614174000'
                              : editingEntity.cadastral_data.pix_type === 'phone'
                                ? '(99) 99999-9999'
                                : 'nome@dominio.com'
                          }
                        />
                      )}
                    </RowField>
                  </div>
                </div>

                <div style={{ display: 'grid', gap: '1rem' }}>
                  <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'minmax(210px, 0.75fr) minmax(0, 1.35fr) minmax(220px, 1fr) minmax(120px, 0.4fr)', alignItems: 'start' }}>
                    <RowField label="CPF" hint="Se não preencher automatico Nome Completo e Data de Nascimento, preencha manualmente.">
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <input className="form-control" placeholder="000.000.000-00" value={maskCpf(editingEntity.cadastral_data.cpf || '')} onChange={(e) => updateNested('cadastral_data', { cpf: onlyDigits(e.target.value) })} />
                        <button type="button" className="btn btn-outline" onClick={fillPersonByCpf}>
                          Buscar
                        </button>
                      </div>
                    </RowField>
                    <RowField label="Nome Completo">
                      <input className="form-control" value={editingEntity.cadastral_data.full_name || ''} onChange={(e) => updateNested('cadastral_data', { full_name: e.target.value })} />
                    </RowField>
                    <RowField label="Data de Nascimento">
                      <input type="date" className="form-control" value={editingEntity.cadastral_data.birth_date || ''} onChange={(e) => updateNested('cadastral_data', { birth_date: e.target.value })} />
                    </RowField>
                    <RowField label="Sexo">
                      <select className="form-control" value={editingEntity.cadastral_data.sex || 'M'} onChange={(e) => updateNested('cadastral_data', { sex: e.target.value })}>
                        <option value="M">Masculino</option>
                        <option value="F">Feminino</option>
                      </select>
                    </RowField>
                  </div>

                  <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'minmax(170px, 0.8fr) minmax(280px, 1.55fr) minmax(220px, 1.15fr) minmax(220px, 1.15fr) minmax(72px, 0.35fr)', alignItems: 'start' }}>
                    <RowField label="CEP Residencial">
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <input className="form-control" style={{ maxWidth: 130 }} placeholder="00000-000" value={maskCep(editingEntity.cadastral_data.residential_cep || '')} onChange={(e) => updateNested('cadastral_data', { residential_cep: onlyDigits(e.target.value) })} />
                        <button type="button" className="btn btn-outline" onClick={() => fillAddressByCep('residential')}>
                          Buscar
                        </button>
                      </div>
                    </RowField>
                    <RowField label="Endereço Residencial">
                      <input className="form-control" placeholder="Rua, Avenida, Trecho, Travessa..." value={editingEntity.cadastral_data.residential_address_street || ''} onChange={(e) => updateNested('cadastral_data', { residential_address_street: e.target.value })} />
                    </RowField>
                    <RowField label="Bairro Residencial">
                      <input className="form-control" value={editingEntity.cadastral_data.residential_address_neighborhood || ''} onChange={(e) => updateNested('cadastral_data', { residential_address_neighborhood: e.target.value })} />
                    </RowField>
                    <RowField label="Cidade Residencial">
                      <input className="form-control" value={editingEntity.cadastral_data.residential_address_city || ''} onChange={(e) => updateNested('cadastral_data', { residential_address_city: e.target.value })} />
                    </RowField>
                    <RowField label="UF Residencial">
                      <select
                        className="form-control"
                        style={{ maxWidth: 92 }}
                        value={editingEntity.cadastral_data.residential_address_state || ''}
                        onChange={(e) => updateNested('cadastral_data', { residential_address_state: e.target.value })}
                      >
                        <option value="">UF</option>
                        {ufsLoading ? (
                          <option value="" disabled>
                            Carregando...
                          </option>
                        ) : null}
                        {ufs.map((uf) => (
                          <option key={uf.sigla} value={uf.sigla}>
                            {uf.sigla}
                          </option>
                        ))}
                      </select>
                    </RowField>
                  </div>

                  <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'minmax(180px, 0.6fr) minmax(0, 1.4fr) minmax(160px, 0.9fr) minmax(160px, 0.9fr)', alignItems: 'start' }}>
                    <RowField label="Número Residencial" hint='Apenas número, se não tiver número no endereço, marque a opção ao lado "Sem número".'>
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        <input
                          className="form-control"
                          style={{ maxWidth: 120 }}
                          placeholder="00"
                          inputMode="numeric"
                          maxLength={6}
                          disabled={!!editingEntity.cadastral_data.residential_address_number_is_empty}
                          value={editingEntity.cadastral_data.residential_address_number_is_empty ? 'S/N' : editingEntity.cadastral_data.residential_address_number || ''}
                          onChange={(e) =>
                            updateNested('cadastral_data', {
                              residential_address_number: onlyDigits(e.target.value).slice(0, 6),
                              residential_address_number_is_empty: false,
                            })
                          }
                          onBlur={(e) =>
                            updateNested('cadastral_data', {
                              residential_address_number: editingEntity.cadastral_data.residential_address_number_is_empty ? 'S/N' : normalizeAddressNumberValue(e.target.value).slice(0, 6),
                            })
                          }
                        />
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', color: 'var(--brs-gray-600)', whiteSpace: 'nowrap' }}>
                          <input
                            type="checkbox"
                            checked={!!editingEntity.cadastral_data.residential_address_number_is_empty}
                            onChange={(e) =>
                              updateNested('cadastral_data', {
                                residential_address_number_is_empty: e.target.checked,
                                residential_address_number: e.target.checked ? 'S/N' : '',
                              })
                            }
                          />
                          Sem número
                        </label>
                      </div>
                    </RowField>
                    <RowField label="Complemento Residencial">
                      <input className="form-control" placeholder="Lote 00, Apto 000, Casa 000..." value={editingEntity.cadastral_data.residential_address_complement || ''} onChange={(e) => updateNested('cadastral_data', { residential_address_complement: e.target.value })} />
                    </RowField>
                    <RowField label="Latitude">
                      <input className="form-control" placeholder="-23.550520" value={editingEntity.cadastral_data.latitude || ''} onChange={(e) => updateNested('cadastral_data', { latitude: e.target.value })} />
                    </RowField>
                    <RowField label="Longitude">
                      <input className="form-control" placeholder="-46.633308" value={editingEntity.cadastral_data.longitude || ''} onChange={(e) => updateNested('cadastral_data', { longitude: e.target.value })} />
                    </RowField>
                  </div>

                  <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'minmax(220px, 1fr) minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'start' }}>
                  <RowField label="WhatsApp Comercial">
                    <input className="form-control" placeholder="(00) 90000-0000" inputMode="numeric" value={maskPhone(editingEntity.cadastral_data.phone_whatsapp || editingEntity.phone_whatsapp || '')} onChange={(e) => updateNested('cadastral_data', { phone_whatsapp: onlyDigits(e.target.value).slice(0, 11) })} />
                  </RowField>
                  <RowField label="E-mail Profissional">
                    <input className="form-control" type="text" autoComplete="email" inputMode="email" placeholder="nome.sobrenome@brspromotora.com.br" value={maskEmailInput(editingEntity.cadastral_data.email_professional || editingEntity.email_comissao || '')} onChange={(e) => updateNested('cadastral_data', { email_professional: maskEmailInput(e.target.value) })} onBlur={(e) => updateNested('cadastral_data', { email_professional: normalizeEmailValue(e.target.value) })} />
                  </RowField>
                  <RowField label="E-mail Pessoal" hint="E-mail de uso pessoal sem menção profissional ou comercial, utilizado apenas para assinatura eletrônica.">
                    <input className="form-control" type="text" autoComplete="email" inputMode="email" placeholder="emailpessoal@gmail.com" value={maskEmailInput(editingEntity.cadastral_data.email_personal || '')} onChange={(e) => updateNested('cadastral_data', { email_personal: maskEmailInput(e.target.value) })} onBlur={(e) => updateNested('cadastral_data', { email_personal: normalizeEmailValue(e.target.value) })} />
                  </RowField>
                  </div>
                </div>

                <div className="form-grid form-grid-2">
                  <RowField label="Cargo Comercial">
                    <select className="form-control" value={editingEntity.role} onChange={(e) => updateDraft({ role: e.target.value as Role, parent_id: null })}>
                      <option value="gerente">Gerente Comercial</option>
                      <option value="supervisor">Supervisor Comercial</option>
                      <option value="superintendente">Superintendente Comercial</option>
                    </select>
                  </RowField>
                  <RowField label="Supervisor Vinculado">
                    {editingEntity.role === 'superintendente' ? (
                      <input className="form-control" disabled value="Sem subordinacao" />
                    ) : editingEntity.role === 'supervisor' ? (
                      <select className="form-control" value={editingEntity.parent_id || ''} onChange={(e) => updateDraft({ parent_id: e.target.value || null })}>
                        <option value="">Selecione o Superintendente...</option>
                        {superintendentes.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <select className="form-control" value={editingEntity.parent_id || ''} onChange={(e) => updateDraft({ parent_id: e.target.value || null })}>
                        <option value="">Selecione o Supervisor...</option>
                        {supervisores.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </RowField>
                </div>
              </div>
            )}

            {activeTab === 'arw' && editingEntity && (
              <div style={{ display: 'grid', gap: '1rem' }}>
                <div style={{ fontWeight: 700, color: 'var(--brs-gray-800)' }}>Parametros de Integracao com o ARW</div>
                <div className="form-grid form-grid-3">
                  <RowField label="Codigo Agente ARW CNPJ">
                    <input className="form-control" value={editingEntity.arw_data.codigo_agente_arw_cnpj || ''} onChange={(e) => updateNested('arw_data', { codigo_agente_arw_cnpj: e.target.value })} />
                  </RowField>
                  <RowField label="Codigo Agente ARW PF">
                    <input className="form-control" value={editingEntity.arw_data.codigo_agente_arw_pf || ''} onChange={(e) => updateNested('arw_data', { codigo_agente_arw_pf: e.target.value })} />
                  </RowField>
                    <RowField label="Unidade">
                      <select
                        className="form-control"
                        value={editingEntity.arw_data.unidade || ''}
                        onChange={(e) => updateNested('arw_data', { unidade: e.target.value })}
                      >
                        <option value="">Selecione...</option>
                        {companyOptions.map((company) => (
                          <option key={company.id || company.nickname} value={company.nickname}>
                            {company.nickname}
                          </option>
                        ))}
                      </select>
                    </RowField>
                  <RowField label="Nivel de Acesso ARW">
                    <select className="form-control" value={editingEntity.arw_data.nivel_acesso_arw || editingEntity.nivel_acesso || ''} onChange={(e) => updateNested('arw_data', { nivel_acesso_arw: e.target.value })}>
                      <option value="">Selecione...</option>
                      <option value="DIRETORIA">DIRETORIA</option>
                      <option value="GERENTE">GERENTE</option>
                      <option value="SUPERVISOR">SUPERVISOR</option>
                      <option value="SUPORTE">SUPORTE</option>
                    </select>
                  </RowField>
                  <RowField label="Tipo de Agente ARW">
                    <select className="form-control" value={editingEntity.arw_data.tipo_agente_arw || editingEntity.tipo_agente || ''} onChange={(e) => updateNested('arw_data', { tipo_agente_arw: e.target.value })}>
                      <option value="">Selecione...</option>
                      <option value="ADAMANTIUM">ADAMANTIUM</option>
                      <option value="BRONZE">BRONZE</option>
                      <option value="DIAMANTE">DIAMANTE</option>
                      <option value="GERENTE COMERCIAL">GERENTE COMERCIAL</option>
                      <option value="LOJA / PARCEIRO">LOJA / PARCEIRO</option>
                      <option value="OURO">OURO</option>
                      <option value="PRATA">PRATA</option>
                      <option value="RUBI">RUBI</option>
                      <option value="SUPERVISOR">SUPERVISOR</option>
                    </select>
                  </RowField>
                </div>
              </div>
            )}

            {activeTab === 'documentos' && editingEntity && (
              <div style={{ display: 'grid', gap: '1rem' }}>
                <div className="form-group" style={{ maxWidth: 640 }}>
                  <label className="form-label">Link da Pasta de Documentos no Google Drive</label>
                  <input className="form-control" value={editingEntity.documents_data.drive_url || editingEntity.google_drive_url || ''} onChange={(e) => setEditingEntity((prev) => (prev ? { ...prev, documents_data: { ...(prev.documents_data || {}), drive_url: e.target.value } } : prev))} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>Cadastro de Certificacao</div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--brs-gray-400)' }}>Cinco linhas iniciais e novas linhas com rolagem.</div>
                  </div>
                  <button type="button" className="btn btn-outline" onClick={addCertRow}>
                    <Plus size={16} />
                    Incluir linha
                  </button>
                </div>

                <div className="table-wrapper" style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--brs-gray-100)', borderRadius: 10 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Certificadora</th>
                        <th>Tipo de Certificado</th>
                        <th>Nome do Certificado</th>
                        <th>Numero</th>
                        <th>Data do Exame</th>
                        <th>Data de Validade</th>
                        <th>Situacao</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {(editingEntity.documents_data.certifications || []).map((row, index) => (
                        <tr key={row.id}>
                          <td><input className="form-control" value={row.certificadora} onChange={(e) => updateDocumentRows(editingEntity.documents_data.certifications.map((item, i) => (i === index ? { ...item, certificadora: e.target.value } : item)))} /></td>
                          <td><input className="form-control" value={row.tipo_certificado} onChange={(e) => updateDocumentRows(editingEntity.documents_data.certifications.map((item, i) => (i === index ? { ...item, tipo_certificado: e.target.value } : item)))} /></td>
                          <td><input className="form-control" value={row.nome_certificado} onChange={(e) => updateDocumentRows(editingEntity.documents_data.certifications.map((item, i) => (i === index ? { ...item, nome_certificado: e.target.value } : item)))} /></td>
                          <td><input className="form-control" value={row.numero_certificado} onChange={(e) => updateDocumentRows(editingEntity.documents_data.certifications.map((item, i) => (i === index ? { ...item, numero_certificado: e.target.value } : item)))} /></td>
                          <td><input type="date" className="form-control" value={row.data_exame} onChange={(e) => updateDocumentRows(editingEntity.documents_data.certifications.map((item, i) => (i === index ? { ...item, data_exame: e.target.value } : item)))} /></td>
                          <td><input type="date" className="form-control" value={row.data_validade} onChange={(e) => updateDocumentRows(editingEntity.documents_data.certifications.map((item, i) => (i === index ? { ...item, data_validade: e.target.value } : item)))} /></td>
                          <td><input className="form-control" value={row.situacao} onChange={(e) => updateDocumentRows(editingEntity.documents_data.certifications.map((item, i) => (i === index ? { ...item, situacao: e.target.value } : item)))} /></td>
                          <td style={{ width: 1 }}>
                            <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => updateDocumentRows(editingEntity.documents_data.certifications.filter((_, i) => i !== index))}>
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'contratos' && editingEntity && (
              <div style={{ display: 'grid', gap: '1rem' }}>
                <RowField label="Data Inicial do Contrato">
                  <input type="date" className="form-control" value={editingEntity.contract_data.data_inicial_contrato || ''} onChange={(e) => setEditingEntity((prev) => (prev ? { ...prev, contract_data: { ...(prev.contract_data || {}), data_inicial_contrato: e.target.value } } : prev))} />
                </RowField>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>Remuneracao Fixa para Custeio Operacional</div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--brs-gray-400)' }}>
                        Novo periodo encerra o anterior automaticamente ao salvar.
                      </div>
                    </div>
                    <button type="button" className="btn btn-outline" onClick={() => addPeriod('remuneracao_fixa')}>
                      <Plus size={16} />
                      Novo periodo
                    </button>
                  </div>
                  <div className="table-wrapper" style={{ border: '1px solid var(--brs-gray-100)', borderRadius: 10 }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Dia de Pagamento</th>
                          <th>Data Inicial</th>
                          <th>Data Final</th>
                          <th>Valor</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {(editingEntity.contract_data.remuneracao_fixa || []).map((row, index) => (
                          <tr key={row.id}>
                            <td><input className="form-control" type="number" min={1} max={31} value={row.dia_pagamento} onChange={(e) => updatePeriodRows('remuneracao_fixa', editingEntity.contract_data.remuneracao_fixa.map((item, i) => (i === index ? { ...item, dia_pagamento: e.target.value } : item)))} /></td>
                            <td><input className="form-control" type="date" value={row.data_inicial} onChange={(e) => updatePeriodRows('remuneracao_fixa', editingEntity.contract_data.remuneracao_fixa.map((item, i) => (i === index ? { ...item, data_inicial: e.target.value } : item)))} /></td>
                            <td><input className="form-control" type="date" value={row.data_final} disabled /></td>
                            <td><input className="form-control" value={row.valor} onChange={(e) => updatePeriodRows('remuneracao_fixa', editingEntity.contract_data.remuneracao_fixa.map((item, i) => (i === index ? { ...item, valor: e.target.value } : item)))} /></td>
                            <td><button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => updatePeriodRows('remuneracao_fixa', editingEntity.contract_data.remuneracao_fixa.filter((_, i) => i !== index))}><Trash2 size={16} /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>Diaria de Pernoite</div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--brs-gray-400)' }}>Mesmo modelo da tabela de remuneracao fixa.</div>
                    </div>
                    <button type="button" className="btn btn-outline" onClick={() => addPeriod('diaria_pernoite')}>
                      <Plus size={16} />
                      Novo periodo
                    </button>
                  </div>
                  <div className="table-wrapper" style={{ border: '1px solid var(--brs-gray-100)', borderRadius: 10 }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Dia de Pagamento</th>
                          <th>Data Inicial</th>
                          <th>Data Final</th>
                          <th>Valor</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {(editingEntity.contract_data.diaria_pernoite || []).map((row, index) => (
                          <tr key={row.id}>
                            <td><input className="form-control" type="number" min={1} max={31} value={row.dia_pagamento} onChange={(e) => updatePeriodRows('diaria_pernoite', editingEntity.contract_data.diaria_pernoite.map((item, i) => (i === index ? { ...item, dia_pagamento: e.target.value } : item)))} /></td>
                            <td><input className="form-control" type="date" value={row.data_inicial} onChange={(e) => updatePeriodRows('diaria_pernoite', editingEntity.contract_data.diaria_pernoite.map((item, i) => (i === index ? { ...item, data_inicial: e.target.value } : item)))} /></td>
                            <td><input className="form-control" type="date" value={row.data_final} disabled /></td>
                            <td><input className="form-control" value={row.valor} onChange={(e) => updatePeriodRows('diaria_pernoite', editingEntity.contract_data.diaria_pernoite.map((item, i) => (i === index ? { ...item, valor: e.target.value } : item)))} /></td>
                            <td><button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => updatePeriodRows('diaria_pernoite', editingEntity.contract_data.diaria_pernoite.filter((_, i) => i !== index))}><Trash2 size={16} /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'remuneracao' && (
              <div style={{ padding: '1rem', borderRadius: 12, border: '1px dashed var(--brs-gray-200)', color: 'var(--brs-gray-500)', background: 'var(--brs-gray-50)' }}>
                Aba reservada para Configuracoes de Remuneracao Variavel. Esta etapa fica pronta para receber a proxima fase do projeto.
              </div>
            )}

            {activeTab === 'veiculo' && editingEntity && (
              <div style={{ display: 'grid', gap: '1rem' }}>
                <div className="form-grid form-grid-3">
                  <RowField label="Tipo de Veiculo">
                    <select className="form-control" value={editingEntity.vehicle_rental_data.tipo_veiculo || 'carro'} onChange={(e) => updateNested('vehicle_rental_data', { tipo_veiculo: e.target.value })}>
                      <option value="carro">Carro</option>
                      <option value="moto">Moto</option>
                    </select>
                  </RowField>
                  <RowField label="Marca">
                    <input className="form-control" value={editingEntity.vehicle_rental_data.marca || ''} onChange={(e) => updateNested('vehicle_rental_data', { marca: e.target.value })} />
                  </RowField>
                  <RowField label="Modelo / Motorizacao">
                    <input className="form-control" value={editingEntity.vehicle_rental_data.modelo || ''} onChange={(e) => updateNested('vehicle_rental_data', { modelo: e.target.value })} />
                  </RowField>
                  <RowField label="Ano / Combustivel">
                    <input className="form-control" value={editingEntity.vehicle_rental_data.ano_combustivel || ''} onChange={(e) => updateNested('vehicle_rental_data', { ano_combustivel: e.target.value })} />
                  </RowField>
                  <RowField label="Codigo FIPE">
                    <input className="form-control" value={editingEntity.vehicle_rental_data.codigo_fipe || ''} onChange={(e) => updateNested('vehicle_rental_data', { codigo_fipe: e.target.value })} />
                  </RowField>
                  <RowField label="Placa">
                    <input className="form-control" value={editingEntity.vehicle_rental_data.placa || ''} onChange={(e) => updateNested('vehicle_rental_data', { placa: e.target.value })} />
                  </RowField>
                  <RowField label="Cor">
                    <input className="form-control" value={editingEntity.vehicle_rental_data.cor || ''} onChange={(e) => updateNested('vehicle_rental_data', { cor: e.target.value })} />
                  </RowField>
                  <RowField label="Chassi">
                    <input className="form-control" value={editingEntity.vehicle_rental_data.chassi || ''} onChange={(e) => updateNested('vehicle_rental_data', { chassi: e.target.value })} />
                  </RowField>
                  <RowField label="Renavam">
                    <input className="form-control" value={editingEntity.vehicle_rental_data.renavam || ''} onChange={(e) => updateNested('vehicle_rental_data', { renavam: e.target.value })} />
                  </RowField>
                  <RowField label="CPF/CNPJ Proprietario">
                    <input className="form-control" value={editingEntity.vehicle_rental_data.cpf_cnpj_proprietario || ''} onChange={(e) => updateNested('vehicle_rental_data', { cpf_cnpj_proprietario: onlyDigits(e.target.value) })} />
                  </RowField>
                  <RowField label="Nome ou Razao Social Proprietario">
                    <input className="form-control" value={editingEntity.vehicle_rental_data.nome_proprietario || ''} onChange={(e) => updateNested('vehicle_rental_data', { nome_proprietario: e.target.value })} />
                  </RowField>
                  <RowField label="Valor do Aluguel">
                    <input className="form-control" value={editingEntity.vehicle_rental_data.valor_aluguel || ''} onChange={(e) => updateNested('vehicle_rental_data', { valor_aluguel: e.target.value })} />
                  </RowField>
                </div>

                <div className="form-grid form-grid-3">
                  {(['foto_frontal', 'foto_lateral_direita', 'foto_lateral_esquerda', 'foto_traseira', 'foto_hodometro'] as VehiclePhotoKey[]).map((key) => (
                    <RowField key={key} label={key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}>
                      <input
                        className="form-control"
                        value={String(editingEntity.vehicle_rental_data.fotos?.[key] || '')}
                        onChange={(e) => addVehiclePhoto(key, e.target.value)}
                        placeholder="URL da foto ou caminho do arquivo"
                      />
                    </RowField>
                  ))}
                </div>

                <div style={{ padding: '1rem', borderRadius: 12, border: '1px dashed var(--brs-gray-200)', background: 'var(--brs-gray-50)', color: 'var(--brs-gray-500)' }}>
                  A tabela de locacao de veiculo fica no submenu proprio e alimenta este valor por ano, tipo e condicao de fabricacao.
                </div>
              </div>
            )}

            {activeTab === 'cartao' && editingEntity && (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(360px, 1.35fr)', gap: '1rem', alignItems: 'start' }}>
                <div style={{ display: 'grid', gap: '1rem' }}>
                  <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.85rem' }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>Configurações do Cartão Virtual</div>
                        <div style={{ fontSize: '0.875rem', color: 'var(--brs-gray-400)' }}>Liberação por flag e slug público.</div>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                        <input type="checkbox" checked={!!editingEntity.card_enabled} onChange={(e) => updateDraft({ card_enabled: e.target.checked })} />
                        Habilitar
                      </label>
                    </div>
                    <div className="form-grid form-grid-2">
                      <RowField label="Slug para copiar o link" hint="Ex: maria.brspromotora.com.br">
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <input className="form-control" value={editingEntity.commercial_slug || ''} onChange={(e) => updateDraft({ commercial_slug: normalizeSlug(e.target.value) })} />
                          <button type="button" className="btn btn-outline" onClick={() => copyText(`${window.location.protocol}//${editingEntity.commercial_slug}.brspromotora.com.br`)}>
                            <Copy size={16} />
                          </button>
                        </div>
                      </RowField>
                      <RowField label="Cargo">
                        <input className="form-control" value={buildCardRole(editingEntity)} disabled />
                      </RowField>
                    </div>
                  </div>

                  <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)' }}>
                    <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>Redes sociais do cartão</div>
                    <div className="form-grid form-grid-2">
                      {CARD_SOCIAL_FIELDS.map(({ key, label, flag }) => (
                        <div key={key} className="form-group">
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.35rem' }}>
                            <label className="form-label" style={{ marginBottom: 0 }}>
                              {label}
                            </label>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 700, color: 'var(--brs-gray-500)' }}>
                              <input
                                type="checkbox"
                                checked={!!(editingEntity.card_data as any)?.[flag]}
                                onChange={(e) => updateNested('card_data', { [flag]: e.target.checked })}
                              />
                              Habilitar
                            </label>
                          </div>
                          <input
                            className="form-control"
                            value={(editingEntity.card_data as any)?.[key] || ''}
                            onChange={(e) => updateNested('card_data', { [key]: e.target.value })}
                            disabled={!isCardSocialEnabled(editingEntity.card_data, flag)}
                            style={!isCardSocialEnabled(editingEntity.card_data, flag) ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)' }}>
                    <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Links da BRS Promotora no preview</div>
                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                      {companyPreviewLinks.map(({ label, value, href }) => {
                        const displayValue = value || 'Sem vínculo'
                        return (
                          <div
                            key={label}
                            style={{
                              padding: '0.75rem 0.85rem',
                              borderRadius: 12,
                              border: '1px solid var(--brs-gray-100)',
                              background: '#fff',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: '0.75rem',
                            }}
                          >
                            <span>{label}</span>
                            {href ? (
                              <a
                                href={href}
                                target={href.startsWith('/') ? undefined : '_blank'}
                                rel={href.startsWith('/') ? undefined : 'noopener noreferrer'}
                                style={{ color: 'var(--brs-navy)', textDecoration: 'none', textAlign: 'right' }}
                              >
                                {displayValue}
                              </a>
                            ) : (
                              <span style={{ color: 'var(--brs-gray-300)' }}>{displayValue}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                <div style={{ position: 'sticky', top: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem', gap: '0.5rem' }}>
                    <button type="button" className={`btn ${previewMode === 'mobile' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setPreviewMode('mobile')}>
                      <Eye size={16} />
                      Iphone
                    </button>
                  <button type="button" className={`btn ${previewMode === 'desktop' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setPreviewMode('desktop')}>
                    <EyeOff size={16} />
                    Computador
                  </button>
                </div>
                <CardPreview
                    data={previewCardData}
                    viewport={previewMode}
                  />
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
            <button type="button" className="btn btn-outline" onClick={() => setView('list')}>
              Voltar para lista
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
              Salvar Cadastro
            </button>
          </div>
        </form>
      )}
    </div>
  )
}


