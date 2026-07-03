import {
  formatBankAccountFromSeq,
  formatBankAgencyWithDigitFromSeq,
  formatBankLabel,
  maskCep,
  maskCnpj,
  maskCpf,
  maskEmailInput,
  maskPhone,
  maskUuidInput,
  onlyDigits,
  parseBankAccountSeq,
  parseBankAgencySeq,
  type BankLookup,
} from '@/lib/company-bank-accounts'

export const AGENTE_CORBAN_STATUSES = [
  'novo',
  'aguarda_assinatura',
  'assinatura_realizada',
  'validacao_final',
  'ativo',
  'inativo',
] as const

export type AgenteCorbanStatus = (typeof AGENTE_CORBAN_STATUSES)[number]

export const AGENTE_CORBAN_STATUS_LABELS: Record<AgenteCorbanStatus, string> = {
  novo: 'Novo',
  aguarda_assinatura: 'Aguardando assinatura',
  assinatura_realizada: 'Assinatura realizada',
  validacao_final: 'Validação final',
  ativo: 'Ativo',
  inativo: 'Inativo',
}

export const AGENTE_CORBAN_PIX_TYPES = ['cnpj', 'cpf', 'phone', 'email', 'bank', 'random'] as const
export type AgenteCorbanPixType = (typeof AGENTE_CORBAN_PIX_TYPES)[number]

export const AGENTE_CORBAN_BANK_ACCOUNT_TYPES = ['Corrente', 'Poupança'] as const
export type AgenteCorbanBankAccountType = (typeof AGENTE_CORBAN_BANK_ACCOUNT_TYPES)[number]

export type AgenteCorbanPersonType = 'PF' | 'PJ'

export const AGENTE_CORBAN_PERSON_TYPE_LABELS: Record<AgenteCorbanPersonType, string> = {
  PF: 'Pessoa Física',
  PJ: 'Pessoa Jurídica',
}

export const AGENTE_CORBAN_CATALOGS = [
  {
    resource: 'agente-corban-niveis-acesso',
    label: 'Nível de Acesso',
    route: '/agente-corban/niveis-acesso',
    table: 'agente_corban_niveis_acesso',
  },
  {
    resource: 'agente-corban-tipos-agente',
    label: 'Tipo de Agente',
    route: '/agente-corban/tipos-agente',
    table: 'agente_corban_tipos_agente',
  },
  {
    resource: 'agente-corban-regras-fisico',
    label: 'Regra de Físico',
    route: '/agente-corban/regras-fisico',
    table: 'agente_corban_regras_fisico',
  },
] as const

export type AgenteCorbanCatalogResource = (typeof AGENTE_CORBAN_CATALOGS)[number]['resource']

export type AgenteCorbanSocio = {
  id: string
  is_principal: boolean
  cpf: string
  name: string
  birth_date: string
  gender: string
  rg: string
  rg_expedition_date: string
  rg_issuer: string
  rg_state: string
  phone: string
  email: string
  residential_cep: string
  residential_address_street: string
  residential_address_number: string
  residential_address_complement: string
  residential_address_neighborhood: string
  residential_address_city: string
  residential_address_state: string
}

export type AgenteCorbanCorbanData = {
  master: Record<string, any>
  contacts: Record<string, any>
  socios: AgenteCorbanSocio[]
  address: Record<string, any>
  access: Record<string, any>
  bank: Record<string, any>
  documents: Record<string, any>
  integrations: Record<string, any>
  [key: string]: any
}

export type AgenteCorbanDraft = {
  id?: string
  form_id?: string | null
  status: AgenteCorbanStatus
  person_type: AgenteCorbanPersonType
  cpf_cnpj: string
  name: string
  fantasy_name: string
  data_abertura: string
  situacao_cadastral: string
  porte_empresa: string
  capital_social: string
  natureza_juridica: string
  representante_legal: string
  rg: string
  rg_expedition_date: string
  rg_issuer: string
  rg_state: string
  birth_date: string
  gender: string
  cep: string
  address_street: string
  address_number: string
  address_complement: string
  address_neighborhood: string
  address_city: string
  address_state: string
  phone_whatsapp: string
  phone_whatsapp_financeiro: string
  phone_commercial: string
  phone_residential: string
  phone_support: string
  email_comissao: string
  email_informe: string
  email_formalizacao: string
  email_proposta: string
  email_mesa_liberacao: string
  email_juridico: string
  email_proprio_cunho: string
  filial: string
  nivel_acesso: string
  tipo_agente: string
  regra_fisico: string
  arw_code: string
  temporary_password: string
  superintendente_id: string | null
  supervisor_id: string | null
  gerente_id: string | null
  commission_receive_type: string
  commission_loja_percent: string
  bank_code: string
  bank_name: string
  bank_agency: string
  bank_account: string
  bank_account_type: AgenteCorbanBankAccountType
  pix_type: AgenteCorbanPixType
  pix_key: string
  payment_period: string
  google_drive_url: string
  assinafy_document_id: string
  assinafy_signature_url: string
  contract_pdf_url: string
  official_document_url: string
  bank_proof_url: string
  address_proof_url: string
  primary_socio_document_url: string
  secondary_socio_document_url: string
  front_photo_url: string
  internal_photo_url: string
  socios: AgenteCorbanSocio[]
  corban_data: Record<string, any>
  additional_data: Record<string, any>
}

export type AgenteCorbanLegacyRegistrationPayload = {
  form_id: string
  person_type: AgenteCorbanPersonType
  cpf_cnpj: string
  name: string
  fantasy_name?: string
  data_abertura?: string
  situacao_cadastral?: string
  porte_empresa?: string
  capital_social?: string
  natureza_juridica?: string
  representante_legal?: string
  rg?: string
  rg_expedition_date?: string
  rg_issuer?: string
  rg_state?: string
  birth_date?: string
  gender?: string
  cep?: string
  address_street?: string
  address_number?: string
  address_complement?: string
  address_neighborhood?: string
  address_city?: string
  address_state?: string
  phone_whatsapp: string
  phone_whatsapp_financeiro?: string
  phone_commercial?: string
  phone_residential?: string
  phone_support?: string
  email_comissao: string
  email_informe?: string
  email_formalizacao?: string
  email_proposta?: string
  email_mesa_liberacao?: string
  email_juridico?: string
  email_proprio_cunho?: string
  commission_receive_type?: string
  payment_period?: string
  bank_code?: string
  bank_name?: string
  bank_agency?: string
  bank_account?: string
  bank_account_type?: string
  pix_type?: string
  pix_key?: string
  official_document_url?: string
  bank_proof_url?: string
  address_proof_url?: string
  primary_socio_document_url?: string
  secondary_socio_document_url?: string
  front_photo_url?: string
  internal_photo_url?: string
  additional_data?: Record<string, any>
}

function createId(prefix = 'corban') {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function normalizeText(value: any) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeEmailValue(value: any) {
  return maskEmailInput(String(value ?? ''))
}

export function normalizeUrlValue(value: any) {
  return normalizeText(value)
}

export function normalizeDateInputValue(value: any) {
  const raw = normalizeText(value)
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 8) {
    const yearPrefix = Number(digits.slice(0, 4))
    if (yearPrefix >= 1900 && yearPrefix <= 2100) {
      return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
    }
    return `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`
  }
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (match) return `${match[3]}-${match[2]}-${match[1]}`
  return raw
}

export function formatDateDisplay(value: any) {
  const raw = normalizeText(value)
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-')
    return `${day}/${month}/${year}`
  }
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (!digits) return raw
  if (digits.length === 8) {
    const yearPrefix = Number(digits.slice(0, 4))
    if (yearPrefix >= 1900 && yearPrefix <= 2100) {
      return `${digits.slice(6, 8)}/${digits.slice(4, 6)}/${digits.slice(0, 4)}`
    }
  }
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

export function formatCurrencyDisplay(value: any) {
  const raw = normalizeText(value)
  if (!raw) return ''

  const digits = raw.replace(/\D/g, '')
  if (!digits) return raw

  const cents = Number(digits)
  if (!Number.isFinite(cents)) return raw

  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
  } catch {
    const reais = (cents / 100).toFixed(2).replace('.', ',')
    return `R$ ${reais}`
  }
}

export function normalizeShortNumberValue(value: any) {
  return onlyDigits(String(value ?? '')).slice(0, 5)
}

export function normalizeArwCodeValue(value: any, uf: any = '') {
  const raw = normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!raw) return ''

  const ufPrefix = normalizeText(uf).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)
  const letters = raw.replace(/[^A-Z]/g, '').slice(0, 2)
  const digits = raw.replace(/\D/g, '')
  const prefix = ufPrefix || letters

  if (!prefix) return digits
  return `${prefix}${digits}`
}

export function normalizePersonType(value: any): AgenteCorbanPersonType {
  const raw = String(value ?? '').trim().toUpperCase()
  if (raw === 'PF' || raw.includes('CPF') || raw.includes('FISIC')) return 'PF'
  return 'PJ'
}

export function normalizeStatus(value: any): AgenteCorbanStatus {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'finalizado') return 'ativo'
  return (AGENTE_CORBAN_STATUSES as readonly string[]).includes(raw) ? (raw as AgenteCorbanStatus) : 'novo'
}

export function normalizeGenderValue(value: any) {
  const raw = normalizeText(value)
  if (!raw) return ''
  const lowered = raw.toLowerCase()
  if (['m', 'masc', 'masculino', 'male', 'man'].includes(lowered)) return 'Masculino'
  if (['f', 'fem', 'feminino', 'female', 'woman'].includes(lowered)) return 'Feminino'
  if (lowered.includes('outro')) return 'Outro'
  return raw
}

export function normalizePixType(value: any, personType: AgenteCorbanPersonType): AgenteCorbanPixType {
  const raw = String(value ?? '').trim().toLowerCase()
  if ((AGENTE_CORBAN_PIX_TYPES as readonly string[]).includes(raw)) return raw as AgenteCorbanPixType
  if (raw === 'uuid' || raw === 'aleatoria') return 'random'
  return personType === 'PF' ? 'cpf' : 'cnpj'
}

export function normalizeBankAccountType(value: any): AgenteCorbanBankAccountType {
  return String(value ?? '').trim() === 'Poupança' ? 'Poupança' : 'Corrente'
}

export function normalizePercentDigits(value: any) {
  return onlyDigits(String(value ?? '')).slice(0, 4)
}

export function formatPercentValue(value: any) {
  const digits = normalizePercentDigits(value)
  if (!digits) return ''

  const cents = digits.slice(-2).padStart(2, '0')
  const whole = digits.slice(0, -2) || '0'
  const formattedWhole = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${formattedWhole},${cents}%`
}

export function normalizePhoneValue(value: any) {
  return onlyDigits(String(value ?? ''))
}

export function normalizeCpfOrCnpjValue(value: any) {
  return onlyDigits(String(value ?? ''))
}

export function normalizeCepValue(value: any) {
  return onlyDigits(String(value ?? ''))
}

export function formatCpfOrCnpjDisplay(value: any) {
  const digits = normalizeCpfOrCnpjValue(value)
  if (digits.length <= 11) return maskCpf(digits)
  return maskCnpj(digits)
}

export function formatPixKeyDisplay(value: any, pixType: AgenteCorbanPixType, personType: AgenteCorbanPersonType) {
  const raw = normalizeText(value)
  if (!raw && (pixType === 'cpf' || pixType === 'cnpj')) {
    return personType === 'PF' ? maskCpf('') : maskCnpj('')
  }
  if (pixType === 'cpf') return maskCpf(raw)
  if (pixType === 'cnpj') return maskCnpj(raw)
  if (pixType === 'phone') return maskPhone(raw)
  if (pixType === 'email') return normalizeEmailValue(raw)
  if (pixType === 'random') return maskUuidInput(raw)
  if (pixType === 'bank') return 'Dados Bancários cadastrados'
  return raw
}

export function normalizePixKeyValue(value: any, pixType: AgenteCorbanPixType, personType: AgenteCorbanPersonType, documentValue = '') {
  const raw = normalizeText(value)
  if (pixType === 'bank') return 'Dados Bancários cadastrados'
  if (pixType === 'cpf') return normalizeCpfOrCnpjValue(documentValue || raw)
  if (pixType === 'cnpj') return normalizeCpfOrCnpjValue(documentValue || raw)
  if (pixType === 'phone') return normalizePhoneValue(raw)
  if (pixType === 'email') return normalizeEmailValue(raw)
  if (pixType === 'random') return maskUuidInput(raw)
  return personType === 'PF' ? normalizeCpfOrCnpjValue(raw || documentValue) : normalizeCpfOrCnpjValue(raw || documentValue)
}

export function createEmptySocio(partial?: Partial<AgenteCorbanSocio>): AgenteCorbanSocio {
  return {
    id: partial?.id || createId('socio'),
    is_principal: partial?.is_principal ?? false,
    cpf: normalizeCpfOrCnpjValue(partial?.cpf),
    name: normalizeText(partial?.name),
    birth_date: formatDateDisplay(partial?.birth_date),
    gender: normalizeGenderValue(partial?.gender),
    rg: normalizeText(partial?.rg),
    rg_expedition_date: formatDateDisplay(partial?.rg_expedition_date),
    rg_issuer: normalizeText(partial?.rg_issuer),
    rg_state: normalizeText(partial?.rg_state).toUpperCase().slice(0, 2),
    phone: normalizePhoneValue(partial?.phone),
    email: normalizeEmailValue(partial?.email),
    residential_cep: normalizeCepValue(partial?.residential_cep),
    residential_address_street: normalizeText(partial?.residential_address_street),
    residential_address_number: normalizeShortNumberValue(partial?.residential_address_number),
    residential_address_complement: normalizeText(partial?.residential_address_complement),
    residential_address_neighborhood: normalizeText(partial?.residential_address_neighborhood),
    residential_address_city: normalizeText(partial?.residential_address_city),
    residential_address_state: normalizeText(partial?.residential_address_state).toUpperCase().slice(0, 2),
  }
}

function isSocioBlank(row: Partial<AgenteCorbanSocio>) {
  return ![
    row.cpf,
    row.name,
    row.birth_date,
    row.gender,
    row.rg,
    row.rg_expedition_date,
    row.rg_issuer,
    row.rg_state,
    row.phone,
    row.email,
    row.residential_cep,
    row.residential_address_street,
    row.residential_address_number,
    row.residential_address_complement,
    row.residential_address_neighborhood,
    row.residential_address_city,
    row.residential_address_state,
  ].some((value) => normalizeText(value))
}

function normalizeSocioForSave(row: Partial<AgenteCorbanSocio>, index: number) {
  const socio = createEmptySocio({
    ...row,
    id: row.id || createId(`socio-${index}`),
  })

  if (isSocioBlank(socio)) return null
  return {
    ...socio,
    birth_date: normalizeDateInputValue(socio.birth_date),
    rg_expedition_date: normalizeDateInputValue(socio.rg_expedition_date),
    residential_address_number: normalizeShortNumberValue(socio.residential_address_number),
  }
}

function normalizeCorbanSociosFromRow(value: any): AgenteCorbanSocio[] {
  const rows = Array.isArray(value) ? value : []
  return rows
    .map((row, index) =>
      createEmptySocio({
        id: row?.id || createId(`socio-${index}`),
        is_principal: !!row?.is_principal,
        cpf: row?.cpf,
        name: row?.name,
        birth_date: row?.birth_date,
        gender: row?.gender,
        rg: row?.rg,
        rg_expedition_date: row?.rg_expedition_date,
        rg_issuer: row?.rg_issuer,
        rg_state: row?.rg_state,
        phone: row?.phone,
        email: row?.email,
        residential_cep: row?.residential_cep,
        residential_address_street: row?.residential_address_street,
        residential_address_number: row?.residential_address_number,
        residential_address_complement: row?.residential_address_complement,
        residential_address_neighborhood: row?.residential_address_neighborhood,
        residential_address_city: row?.residential_address_city,
        residential_address_state: row?.residential_address_state,
      }),
    )
    .filter((row) => !isSocioBlank(row))
}

function pickText(...values: any[]) {
  for (const value of values) {
    const text = normalizeText(value)
    if (text) return text
  }
  return ''
}

function pickDigits(...values: any[]) {
  for (const value of values) {
    const digits = normalizeCpfOrCnpjValue(value)
    if (digits) return digits
  }
  return ''
}

function pickDate(...values: any[]) {
  for (const value of values) {
    const date = normalizeDateInputValue(value)
    if (date) return date
  }
  return ''
}

function mergeSection(existing: Record<string, any> | undefined, next: Record<string, any>) {
  return {
    ...(existing || {}),
    ...next,
  }
}

export function buildAgenteCorbanCorbanData(draft: Partial<AgenteCorbanDraft>, existing: Record<string, any> = {}): AgenteCorbanCorbanData {
  const personType = normalizePersonType(draft.person_type)
  const masterSource = (existing.master || {}) as Record<string, any>
  const contactsSource = (existing.contacts || {}) as Record<string, any>
  const addressSource = (existing.address || {}) as Record<string, any>
  const accessSource = (existing.access || {}) as Record<string, any>
  const bankSource = (existing.bank || {}) as Record<string, any>
  const documentsSource = (existing.documents || {}) as Record<string, any>
  const integrationsSource = (existing.integrations || {}) as Record<string, any>

  const master = mergeSection(masterSource, {
    status: normalizeStatus(draft.status ?? masterSource.status),
    person_type: personType,
    cpf_cnpj: normalizeCpfOrCnpjValue(draft.cpf_cnpj ?? masterSource.cpf_cnpj),
    name: pickText(draft.name, masterSource.name),
    fantasy_name: pickText(draft.fantasy_name, masterSource.fantasy_name),
    data_abertura: pickDate(draft.data_abertura, masterSource.data_abertura),
    situacao_cadastral: pickText(draft.situacao_cadastral, masterSource.situacao_cadastral),
    porte_empresa: pickText(draft.porte_empresa, masterSource.porte_empresa),
    capital_social: pickText(draft.capital_social, masterSource.capital_social),
    natureza_juridica: pickText(draft.natureza_juridica, masterSource.natureza_juridica),
    representante_legal: pickText(draft.representante_legal, masterSource.representante_legal),
    rg: pickText(draft.rg, masterSource.rg),
    rg_expedition_date: pickDate(draft.rg_expedition_date, masterSource.rg_expedition_date),
    rg_issuer: pickText(draft.rg_issuer, masterSource.rg_issuer),
    rg_state: pickText(draft.rg_state, masterSource.rg_state).toUpperCase().slice(0, 2),
    birth_date: pickDate(draft.birth_date, masterSource.birth_date),
    gender: normalizeGenderValue(draft.gender ?? masterSource.gender),
  })

  const contacts = mergeSection(contactsSource, {
    phone_whatsapp: normalizePhoneValue(draft.phone_whatsapp ?? contactsSource.phone_whatsapp),
    phone_whatsapp_financeiro: normalizePhoneValue(draft.phone_whatsapp_financeiro ?? contactsSource.phone_whatsapp_financeiro),
    phone_commercial: normalizePhoneValue(draft.phone_commercial ?? contactsSource.phone_commercial),
    phone_residential: normalizePhoneValue(draft.phone_residential ?? contactsSource.phone_residential),
    phone_support: normalizePhoneValue(draft.phone_support ?? contactsSource.phone_support),
    email_comissao: normalizeEmailValue(draft.email_comissao ?? contactsSource.email_comissao),
    email_informe: normalizeEmailValue(draft.email_informe ?? contactsSource.email_informe),
    email_formalizacao: normalizeEmailValue(draft.email_formalizacao ?? contactsSource.email_formalizacao),
    email_proposta: normalizeEmailValue(draft.email_proposta ?? contactsSource.email_proposta),
    email_mesa_liberacao: normalizeEmailValue(draft.email_mesa_liberacao ?? contactsSource.email_mesa_liberacao),
    email_juridico: normalizeEmailValue(draft.email_juridico ?? contactsSource.email_juridico),
    email_proprio_cunho: normalizeEmailValue(draft.email_proprio_cunho ?? contactsSource.email_proprio_cunho),
  })

  const draftSocios = draft.socios
  const socios = draftSocios === undefined
    ? normalizeCorbanSociosFromRow(existing.socios)
    : (Array.isArray(draftSocios) ? draftSocios : [])
        .map((row, index) => normalizeSocioForSave(row, index))
        .filter(Boolean) as AgenteCorbanSocio[]

  const address = mergeSection(addressSource, {
    cep: normalizeCepValue(draft.cep ?? addressSource.cep),
    address_street: pickText(draft.address_street, addressSource.address_street),
    address_number: normalizeShortNumberValue(pickText(draft.address_number, addressSource.address_number)),
    address_complement: pickText(draft.address_complement, addressSource.address_complement),
    address_neighborhood: pickText(draft.address_neighborhood, addressSource.address_neighborhood),
    address_city: pickText(draft.address_city, addressSource.address_city),
    address_state: pickText(draft.address_state, addressSource.address_state).toUpperCase().slice(0, 2),
  })

  const access = mergeSection(accessSource, {
    filial: pickText(draft.filial, accessSource.filial),
    nivel_acesso: pickText(draft.nivel_acesso, accessSource.nivel_acesso),
    tipo_agente: pickText(draft.tipo_agente, accessSource.tipo_agente),
    regra_fisico: pickText(draft.regra_fisico, accessSource.regra_fisico),
    arw_code: normalizeArwCodeValue(pickText(draft.arw_code, accessSource.arw_code), draft.address_state ?? addressSource.address_state ?? accessSource.address_state),
    temporary_password: pickText(draft.temporary_password, accessSource.temporary_password),
    superintendente_id: draft.superintendente_id === undefined ? accessSource.superintendente_id ?? null : draft.superintendente_id || null,
    supervisor_id: draft.supervisor_id === undefined ? accessSource.supervisor_id ?? null : draft.supervisor_id || null,
    gerente_id: draft.gerente_id === undefined ? accessSource.gerente_id ?? null : draft.gerente_id || null,
  })

  const bank = mergeSection(bankSource, {
    commission_receive_type: pickText(draft.commission_receive_type, bankSource.commission_receive_type),
    bank_code: pickText(draft.bank_code, bankSource.bank_code),
    bank_name: pickText(draft.bank_name, bankSource.bank_name),
    bank_agency: parseBankAgencySeq(pickText(draft.bank_agency, bankSource.bank_agency)),
    bank_account: parseBankAccountSeq(pickText(draft.bank_account, bankSource.bank_account)),
    bank_account_type: normalizeBankAccountType(draft.bank_account_type ?? bankSource.bank_account_type),
    pix_type: normalizePixType(draft.pix_type ?? bankSource.pix_type, personType),
    pix_key: normalizePixKeyValue(
      draft.pix_key ?? bankSource.pix_key,
      normalizePixType(draft.pix_type ?? bankSource.pix_type, personType),
      personType,
      draft.cpf_cnpj ?? masterSource.cpf_cnpj,
    ),
    payment_period: pickText(draft.payment_period, bankSource.payment_period),
  })

  const documents = mergeSection(documentsSource, {
    google_drive_url: normalizeUrlValue(draft.google_drive_url ?? documentsSource.google_drive_url),
    assinafy_document_id: pickText(draft.assinafy_document_id, documentsSource.assinafy_document_id),
    assinafy_signature_url: normalizeUrlValue(draft.assinafy_signature_url ?? documentsSource.assinafy_signature_url),
    contract_pdf_url: normalizeUrlValue(draft.contract_pdf_url ?? documentsSource.contract_pdf_url),
    official_document_url: normalizeUrlValue(draft.official_document_url ?? documentsSource.official_document_url),
    bank_proof_url: normalizeUrlValue(draft.bank_proof_url ?? documentsSource.bank_proof_url),
    address_proof_url: normalizeUrlValue(draft.address_proof_url ?? documentsSource.address_proof_url),
    primary_socio_document_url: normalizeUrlValue(draft.primary_socio_document_url ?? documentsSource.primary_socio_document_url),
    secondary_socio_document_url: normalizeUrlValue(draft.secondary_socio_document_url ?? documentsSource.secondary_socio_document_url),
    front_photo_url: normalizeUrlValue(draft.front_photo_url ?? documentsSource.front_photo_url),
    internal_photo_url: normalizeUrlValue(draft.internal_photo_url ?? documentsSource.internal_photo_url),
  })

  const integrations = mergeSection(integrationsSource, {
    google_drive_url: normalizeUrlValue(draft.google_drive_url ?? integrationsSource.google_drive_url),
    assinafy: {
      document_id: pickText(draft.assinafy_document_id, integrationsSource.assinafy?.document_id),
      signature_url: normalizeUrlValue(draft.assinafy_signature_url ?? integrationsSource.assinafy?.signature_url),
    },
    contract_pdf_url: normalizeUrlValue(draft.contract_pdf_url ?? integrationsSource.contract_pdf_url),
  })

  return {
    ...existing,
    master,
    contacts,
    socios,
    address,
    access,
    bank,
    documents,
    integrations,
  }
}

export function createEmptyAgenteCorbanDraft(): AgenteCorbanDraft {
  return {
    status: 'novo',
    person_type: 'PJ',
    cpf_cnpj: '',
    name: '',
    fantasy_name: '',
    data_abertura: '',
    situacao_cadastral: '',
    porte_empresa: '',
    capital_social: '',
    natureza_juridica: '',
    representante_legal: '',
    rg: '',
    rg_expedition_date: '',
    rg_issuer: '',
    rg_state: '',
    birth_date: '',
    gender: '',
    cep: '',
    address_street: '',
    address_number: '',
    address_complement: '',
    address_neighborhood: '',
    address_city: '',
    address_state: '',
    phone_whatsapp: '',
    phone_whatsapp_financeiro: '',
    phone_commercial: '',
    phone_residential: '',
    phone_support: '',
    email_comissao: '',
    email_informe: '',
    email_formalizacao: '',
    email_proposta: '',
    email_mesa_liberacao: '',
    email_juridico: '',
    email_proprio_cunho: '',
    filial: '',
    nivel_acesso: '',
    tipo_agente: '',
    regra_fisico: '',
    arw_code: '',
    temporary_password: '',
    superintendente_id: null,
    supervisor_id: null,
    gerente_id: null,
    commission_receive_type: '',
    commission_loja_percent: '',
    bank_code: '',
    bank_name: '',
    bank_agency: '',
    bank_account: '',
    bank_account_type: 'Corrente',
    pix_type: 'cnpj',
    pix_key: '',
    payment_period: '',
    google_drive_url: '',
    assinafy_document_id: '',
    assinafy_signature_url: '',
    contract_pdf_url: '',
    official_document_url: '',
    bank_proof_url: '',
    address_proof_url: '',
    primary_socio_document_url: '',
    secondary_socio_document_url: '',
    front_photo_url: '',
    internal_photo_url: '',
    socios: [createEmptySocio({ is_principal: true })],
    corban_data: {},
    additional_data: {},
  }
}

export function normalizeAgenteCorbanDraftFromRow(raw: Partial<Record<string, any>> & { corban_data?: Record<string, any> }): AgenteCorbanDraft {
  const corbanData = raw?.corban_data && typeof raw.corban_data === 'object' ? raw.corban_data : {}
  const master = (corbanData.master || {}) as Record<string, any>
  const contacts = (corbanData.contacts || {}) as Record<string, any>
  const address = (corbanData.address || {}) as Record<string, any>
  const access = (corbanData.access || {}) as Record<string, any>
  const bank = (corbanData.bank || {}) as Record<string, any>
  const documents = (corbanData.documents || {}) as Record<string, any>
  const integrations = (corbanData.integrations || {}) as Record<string, any>
  const socios = normalizeCorbanSociosFromRow(corbanData.socios)

  const personType = normalizePersonType(raw?.person_type ?? master.person_type)
  const pixType = normalizePixType(raw?.pix_type ?? bank.pix_type, personType)
  const cpfCnpj = normalizeCpfOrCnpjValue(raw?.cpf_cnpj ?? master.cpf_cnpj)

  const draft: AgenteCorbanDraft = {
    id: raw?.id || undefined,
    form_id: raw?.form_id ?? master.form_id ?? null,
    status: normalizeStatus(raw?.status ?? master.status),
    person_type: personType,
    cpf_cnpj: cpfCnpj,
    name: pickText(raw?.name ?? master.name),
    fantasy_name: pickText(raw?.fantasy_name ?? master.fantasy_name),
    data_abertura: formatDateDisplay(raw?.data_abertura ?? master.data_abertura),
    situacao_cadastral: pickText(raw?.situacao_cadastral ?? master.situacao_cadastral),
    porte_empresa: pickText(raw?.porte_empresa ?? master.porte_empresa),
    capital_social: formatCurrencyDisplay(raw?.capital_social ?? master.capital_social),
    natureza_juridica: pickText(raw?.natureza_juridica ?? master.natureza_juridica),
    representante_legal: pickText(raw?.representante_legal ?? master.representante_legal),
    rg: pickText(raw?.rg ?? master.rg),
    rg_expedition_date: formatDateDisplay(raw?.rg_expedition_date ?? master.rg_expedition_date),
    rg_issuer: pickText(raw?.rg_issuer ?? master.rg_issuer),
    rg_state: pickText(raw?.rg_state ?? master.rg_state).toUpperCase().slice(0, 2),
    birth_date: formatDateDisplay(raw?.birth_date ?? master.birth_date),
    gender: normalizeGenderValue(raw?.gender ?? master.gender),
    cep: normalizeCepValue(raw?.cep ?? address.cep),
    address_street: pickText(raw?.address_street ?? address.address_street),
    address_number: normalizeShortNumberValue(raw?.address_number ?? address.address_number),
    address_complement: pickText(raw?.address_complement ?? address.address_complement),
    address_neighborhood: pickText(raw?.address_neighborhood ?? address.address_neighborhood),
    address_city: pickText(raw?.address_city ?? address.address_city),
    address_state: pickText(raw?.address_state ?? address.address_state).toUpperCase().slice(0, 2),
    phone_whatsapp: normalizePhoneValue(raw?.phone_whatsapp ?? contacts.phone_whatsapp),
    phone_whatsapp_financeiro: normalizePhoneValue(raw?.phone_whatsapp_financeiro ?? contacts.phone_whatsapp_financeiro),
    phone_commercial: normalizePhoneValue(raw?.phone_commercial ?? contacts.phone_commercial),
    phone_residential: normalizePhoneValue(raw?.phone_residential ?? contacts.phone_residential),
    phone_support: normalizePhoneValue(raw?.phone_support ?? contacts.phone_support),
    email_comissao: normalizeEmailValue(raw?.email_comissao ?? contacts.email_comissao),
    email_informe: normalizeEmailValue(raw?.email_informe ?? contacts.email_informe),
    email_formalizacao: normalizeEmailValue(raw?.email_formalizacao ?? contacts.email_formalizacao),
    email_proposta: normalizeEmailValue(raw?.email_proposta ?? contacts.email_proposta),
    email_mesa_liberacao: normalizeEmailValue(raw?.email_mesa_liberacao ?? contacts.email_mesa_liberacao),
    email_juridico: normalizeEmailValue(raw?.email_juridico ?? contacts.email_juridico),
    email_proprio_cunho: normalizeEmailValue(raw?.email_proprio_cunho ?? contacts.email_proprio_cunho),
    filial: pickText(raw?.filial ?? access.filial),
    nivel_acesso: pickText(raw?.nivel_acesso ?? access.nivel_acesso),
    tipo_agente: pickText(raw?.tipo_agente ?? access.tipo_agente),
    regra_fisico: pickText(raw?.regra_fisico ?? access.regra_fisico),
    arw_code: normalizeArwCodeValue(raw?.arw_code ?? access.arw_code, raw?.address_state ?? address.address_state ?? master.address_state),
    temporary_password: pickText(raw?.temporary_password ?? access.temporary_password),
    superintendente_id: raw?.superintendente_id ?? access.superintendente_id ?? null,
    supervisor_id: raw?.supervisor_id ?? access.supervisor_id ?? null,
    gerente_id: raw?.gerente_id ?? access.gerente_id ?? null,
    commission_receive_type: pickText(raw?.commission_receive_type ?? bank.commission_receive_type),
    commission_loja_percent: normalizePercentDigits(raw?.commission_loja_percent ?? access.commission_loja_percent),
    bank_code: pickText(raw?.bank_code ?? bank.bank_code),
    bank_name: pickText(raw?.bank_name ?? bank.bank_name),
    bank_agency: formatBankAgencyWithDigitFromSeq(pickText(raw?.bank_agency ?? bank.bank_agency)),
    bank_account: formatBankAccountFromSeq(pickText(raw?.bank_account ?? bank.bank_account)),
    bank_account_type: normalizeBankAccountType(raw?.bank_account_type ?? bank.bank_account_type),
    pix_type: pixType,
    pix_key: normalizePixKeyValue(raw?.pix_key ?? bank.pix_key, pixType, personType, cpfCnpj),
    payment_period: pickText(raw?.payment_period ?? bank.payment_period),
    google_drive_url: normalizeUrlValue(raw?.google_drive_url ?? documents.google_drive_url ?? integrations.google_drive_url),
    assinafy_document_id: pickText(raw?.assinafy_document_id ?? documents.assinafy_document_id ?? integrations.assinafy?.document_id),
    assinafy_signature_url: normalizeUrlValue(raw?.assinafy_signature_url ?? documents.assinafy_signature_url ?? integrations.assinafy?.signature_url),
    contract_pdf_url: normalizeUrlValue(raw?.contract_pdf_url ?? documents.contract_pdf_url ?? integrations.contract_pdf_url),
    official_document_url: normalizeUrlValue(raw?.official_document_url ?? documents.official_document_url),
    bank_proof_url: normalizeUrlValue(raw?.bank_proof_url ?? documents.bank_proof_url),
    address_proof_url: normalizeUrlValue(raw?.address_proof_url ?? documents.address_proof_url),
    primary_socio_document_url: normalizeUrlValue(raw?.primary_socio_document_url ?? documents.primary_socio_document_url),
    secondary_socio_document_url: normalizeUrlValue(raw?.secondary_socio_document_url ?? documents.secondary_socio_document_url),
    front_photo_url: normalizeUrlValue(raw?.front_photo_url ?? documents.front_photo_url),
    internal_photo_url: normalizeUrlValue(raw?.internal_photo_url ?? documents.internal_photo_url),
    socios,
    corban_data: corbanData,
    additional_data: (raw?.additional_data && typeof raw.additional_data === 'object' ? raw.additional_data : {}) || {},
  }

  return draft
}

export function buildAgentesParceirosPersistenceRow(draft: Partial<AgenteCorbanDraft>) {
  const normalized = normalizeAgenteCorbanDraftFromRow({
    ...createEmptyAgenteCorbanDraft(),
    ...(draft as Record<string, any>),
  })
  const corbanData = buildAgenteCorbanCorbanData(normalized, normalized.corban_data)

  return {
    form_id: normalized.form_id || null,
    status: normalized.status,
    person_type: normalized.person_type,
    cpf_cnpj: normalized.cpf_cnpj,
    name: normalized.name,
    fantasy_name: normalized.fantasy_name || null,
    representante_legal: normalized.representante_legal || null,
    rg: normalized.rg || null,
    rg_expedition_date: normalizeDateInputValue(normalized.rg_expedition_date) || null,
    rg_issuer: normalized.rg_issuer || null,
    rg_state: normalized.rg_state || null,
    birth_date: normalizeDateInputValue(normalized.birth_date) || null,
    cep: normalized.cep || null,
    address_street: normalized.address_street || null,
    address_number: normalized.address_number || null,
    address_complement: normalized.address_complement || null,
    address_neighborhood: normalized.address_neighborhood || null,
    address_city: normalized.address_city || null,
    address_state: normalized.address_state || null,
    phone_whatsapp: normalized.phone_whatsapp || null,
    phone_whatsapp_financeiro: normalized.phone_whatsapp_financeiro || null,
    phone_commercial: normalized.phone_commercial || null,
    phone_residential: normalized.phone_residential || null,
    phone_support: normalized.phone_support || null,
    email_comissao: normalized.email_comissao || null,
    email_informe: normalized.email_informe || null,
    email_formalizacao: normalized.email_formalizacao || null,
    email_proposta: normalized.email_proposta || null,
    email_mesa_liberacao: normalized.email_mesa_liberacao || null,
    email_juridico: normalized.email_juridico || null,
    email_proprio_cunho: normalized.email_proprio_cunho || null,
    commission_receive_type: normalized.commission_receive_type || null,
    commission_loja_percent: normalized.commission_loja_percent || null,
    bank_code: normalized.bank_code || null,
    bank_name: normalized.bank_name || null,
    bank_agency: normalized.bank_agency || null,
    bank_account: normalized.bank_account || null,
    bank_account_type: normalized.bank_account_type || null,
    pix_type: normalized.pix_type || null,
    pix_key: normalized.pix_key || null,
    filial: normalized.filial || null,
    nivel_acesso: normalized.nivel_acesso || null,
    tipo_agente: normalized.tipo_agente || null,
    regra_fisico: normalized.regra_fisico || null,
    arw_code: normalized.arw_code || null,
    temporary_password: normalized.temporary_password || null,
    google_drive_url: normalized.google_drive_url || null,
    additional_data: normalized.additional_data || {},
    superintendente_id: normalized.superintendente_id || null,
    supervisor_id: normalized.supervisor_id || null,
    gerente_id: normalized.gerente_id || null,
    assinafy_document_id: normalized.assinafy_document_id || null,
    assinafy_signature_url: normalized.assinafy_signature_url || null,
    contract_pdf_url: normalized.contract_pdf_url || null,
    corban_data: corbanData,
    updated_at: new Date().toISOString(),
  }
}

export function buildAgenteCorbanLegacyPersistenceRow(payload: AgenteCorbanLegacyRegistrationPayload, existingCorbanData: Record<string, any> = {}) {
  const normalized = normalizeAgenteCorbanDraftFromRow({
    form_id: payload.form_id,
    status: 'novo',
    person_type: payload.person_type,
    cpf_cnpj: payload.cpf_cnpj,
    name: payload.name,
    fantasy_name: payload.fantasy_name,
    data_abertura: payload.data_abertura,
    situacao_cadastral: payload.situacao_cadastral,
    porte_empresa: payload.porte_empresa,
    capital_social: payload.capital_social,
    natureza_juridica: payload.natureza_juridica,
    representante_legal: payload.representante_legal,
    rg: payload.rg,
    rg_expedition_date: payload.rg_expedition_date,
    rg_issuer: payload.rg_issuer,
    rg_state: payload.rg_state,
    birth_date: payload.birth_date,
    gender: payload.gender,
    cep: payload.cep,
    address_street: payload.address_street,
    address_number: payload.address_number,
    address_complement: payload.address_complement,
    address_neighborhood: payload.address_neighborhood,
    address_city: payload.address_city,
    address_state: payload.address_state,
    phone_whatsapp: payload.phone_whatsapp,
    phone_whatsapp_financeiro: payload.phone_whatsapp_financeiro,
    phone_commercial: payload.phone_commercial,
    phone_residential: payload.phone_residential,
    phone_support: payload.phone_support,
    email_comissao: payload.email_comissao,
    email_informe: payload.email_informe,
    email_formalizacao: payload.email_formalizacao,
    email_proposta: payload.email_proposta,
    email_mesa_liberacao: payload.email_mesa_liberacao,
    email_juridico: payload.email_juridico,
    email_proprio_cunho: payload.email_proprio_cunho,
    commission_receive_type: payload.commission_receive_type,
    payment_period: payload.payment_period,
    bank_code: payload.bank_code,
    bank_name: payload.bank_name,
    bank_agency: payload.bank_agency,
    bank_account: payload.bank_account,
    bank_account_type: payload.bank_account_type,
    pix_type: payload.pix_type,
    pix_key: payload.pix_key,
    official_document_url: payload.official_document_url,
    bank_proof_url: payload.bank_proof_url,
    address_proof_url: payload.address_proof_url,
    primary_socio_document_url: payload.primary_socio_document_url,
    secondary_socio_document_url: payload.secondary_socio_document_url,
    front_photo_url: payload.front_photo_url,
    internal_photo_url: payload.internal_photo_url,
    additional_data: payload.additional_data ?? {},
    corban_data: existingCorbanData,
  })

  return buildAgentesParceirosPersistenceRow(normalized)
}

export function formatAgenteCorbanLabel(row: Partial<Record<string, any>>) {
  const name = normalizeText(row?.name)
  const cpfCnpj = normalizeCpfOrCnpjValue(row?.cpf_cnpj)
  return name || cpfCnpj || 'Sem identificação'
}

export function formatAgenteCorbanSearchText(row: Partial<Record<string, any>>) {
  const corbanData = row?.corban_data && typeof row.corban_data === 'object' ? row.corban_data : {}
  const master = (corbanData.master || {}) as Record<string, any>
  return [
    normalizeText(row?.name),
    normalizeCpfOrCnpjValue(row?.cpf_cnpj),
    normalizeText(row?.arw_code),
    normalizeText(row?.filial),
    normalizeText(row?.nivel_acesso),
    normalizeText(row?.tipo_agente),
    normalizeText(row?.regra_fisico),
    normalizeText(row?.person_type),
    normalizeStatus(row?.status || master.status),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function formatAgenteCorbanStatusLabel(value: any) {
  const status = normalizeStatus(value)
  return AGENTE_CORBAN_STATUS_LABELS[status]
}

export function formatAgenteCorbanPersonTypeLabel(value: any) {
  const type = normalizePersonType(value)
  return AGENTE_CORBAN_PERSON_TYPE_LABELS[type]
}

export type CorbanBankLookup = BankLookup
export type { BankLookup } from '@/lib/company-bank-accounts'
export {
  formatBankLabel,
  maskCep,
  maskCnpj,
  maskCpf,
  maskEmailInput,
  maskPhone,
  maskUuidInput,
  onlyDigits,
  parseBankAccountSeq,
  parseBankAgencySeq,
  formatBankAccountFromSeq,
  formatBankAgencyWithDigitFromSeq,
}
