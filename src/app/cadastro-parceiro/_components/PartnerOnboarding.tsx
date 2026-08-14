/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState, useEffect } from 'react'
import { getActiveForm, getFormBySlug, getPublicProcessBySlug, uploadPartnerFile, submitPartnerRegistration } from '../actions'
import { 
  CheckCircle, AlertCircle, Upload, Search, Building2, User, 
  FileText, Lock, ArrowRight, MapPin, CreditCard, Loader2, Check 
} from 'lucide-react'

type Props = { slug?: string }

export default function PartnerOnboarding({ slug }: Props) {
  const [step, setStep] = useState<'lgpd' | 'form' | 'success'>('lgpd')
  const [onboardingToken, setOnboardingToken] = useState('')
  const [formSchema, setFormSchema] = useState<any[]>([])
  const [formId, setFormId] = useState<string>('')
  const [formConfig, setFormConfig] = useState<any>({})
  
  // Loading states
  const [loadingSchema, setLoadingSchema] = useState(true)
  const [searchingCNPJ, setSearchingCNPJ] = useState(false)
  const [searchingCEP, setSearchingCEP] = useState(false)
  const [searchingCPF, setSearchingCPF] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState<{ [key: string]: boolean }>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Form states
  const [personType, setPersonType] = useState<'PF' | 'PJ'>('PJ')
  const [cpfCnpj, setCpfCnpj] = useState('')
  const [name, setName] = useState('')
  const [fantasyName, setFantasyName] = useState('')
  const [representanteLegal, setRepresentanteLegal] = useState('')
  const [rg, setRg] = useState('')
  const [rgExpeditionDate, setRgExpeditionDate] = useState('')
  const [rgIssuer, setRgIssuer] = useState('')
  const [rgState, setRgState] = useState('')
  const [birthDate, setBirthDate] = useState('')
  
  // Address
  const [cep, setCep] = useState('')
  const [addressStreet, setAddressStreet] = useState('')
  const [addressNumber, setAddressNumber] = useState('')
  const [addressComplement, setAddressComplement] = useState('')
  const [addressNeighborhood, setAddressNeighborhood] = useState('')
  const [addressCity, setAddressCity] = useState('')
  const [addressState, setAddressState] = useState('')

  // Contacts
  const [phoneWhatsapp, setPhoneWhatsapp] = useState('')
  const [phoneWhatsappFinanceiro, setPhoneWhatsappFinanceiro] = useState('')
  const [phoneCommercial, setPhoneCommercial] = useState('')
  const [phoneResidential, setPhoneResidential] = useState('')
  const [phoneSupport, setPhoneSupport] = useState('')
  const [emailComissao, setEmailComissao] = useState('')
  const [emailInforme, setEmailInforme] = useState('')
  const [emailFormalizacao, setEmailFormalizacao] = useState('')
  const [emailProposta, setEmailProposta] = useState('')
  const [emailMesaLiberacao, setEmailMesaLiberacao] = useState('')
  const [emailJuridico, setEmailJuridico] = useState('')
  const [emailProprioCunho, setEmailProprioCunho] = useState('')

  // Bank Info
  const [commissionReceiveType, setCommissionReceiveType] = useState('PIX')
  const [bankCode, setBankCode] = useState('')
  const [bankName, setBankName] = useState('')
  const [bankAgency, setBankAgency] = useState('')
  const [bankAccount, setBankAccount] = useState('')
  const [bankAccountType, setBankAccountType] = useState('Corrente')
  const [pixType, setPixType] = useState('CPF')
  const [pixKey, setPixKey] = useState('')
  const [bankSearch, setBankSearch] = useState('')
  const [showBankDropdown, setShowBankDropdown] = useState(false)
  const [bankSearchByKey, setBankSearchByKey] = useState<Record<string, string>>({})
  const [bankDropdownKey, setBankDropdownKey] = useState<string | null>(null)

  // Dynamic answers
  const [dynamicAnswers, setDynamicAnswers] = useState<{ [key: string]: any }>({})
  const [banks, setBanks] = useState<any[]>([])
  const [ufs, setUfs] = useState<any[]>([])

  // Raw digit sequences to support special bank masks while typing
  const [bankAgencySeq, setBankAgencySeq] = useState('')
  const [bankAccountSeq, setBankAccountSeq] = useState('')
  const [bankFieldSeqByKey, setBankFieldSeqByKey] = useState<Record<string, string>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
  const ALLOWED_UPLOAD_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png'])

  const primaryColor = formConfig?.branding?.primary_color || '#8A2BE2'
  const accentColor = formConfig?.branding?.accent_color || '#FF2D6D'
  const introTitle = formConfig?.intro?.title || 'Portal de Cadastro'
  const introText = formConfig?.intro?.text || 'Seja bem-vindo ao nosso onboarding de novos agentes parceiros.'
  const introStartLabel = formConfig?.intro?.start_label || 'Iniciar'
  const finishLabel = formConfig?.submit?.finish_label || 'Finalizar e Enviar'
  const logoUrl = formConfig?.branding?.logo_url || ''
  const closingTitle = formConfig?.closing?.title || 'Cadastro Recebido!'
  const closingLead = formConfig?.closing?.lead || 'BRS Promotora agradece seu envio.'
  const closingText =
    formConfig?.closing?.text ||
    'Seus dados cadastrais e documentos foram salvos com sucesso no sistema. Nossa equipe comercial fará a análise técnica e o vínculo na hierarquia em breve.\n\nVocê receberá as notificações de aprovação de conta, contrato para assinatura no WhatsApp e e-mail cadastrados. Fique atento!'
  const closingButtonLabel = formConfig?.closing?.button_label || 'Ir para o site da BRS'
  const closingButtonUrl = formConfig?.closing?.button_url || 'https://brspromotora.com.br'
  const closingParagraphs = String(closingText || '')
    .split(/\r?\n\r?\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const schemaVersion = Number(formConfig?.schema_version || 1)
  const isSchemaV2 = schemaVersion === 2

  // Fetch schema & Banks list
  useEffect(() => {
    async function loadSchema() {
      setLoadingSchema(true)
      let res: any
      if (slug) {
        const procRes = await getPublicProcessBySlug(slug)
        if (procRes.success && procRes.process && procRes.form) {
          res = { success: true, form: procRes.form, onboardingToken: (procRes as any).onboardingToken }
        } else {
          res = await getFormBySlug(slug)
        }
      } else {
        res = await getActiveForm()
      }
      if (res.success && res.form) {
        setFormSchema(res.form.schema || [])
        setFormId(res.form.id)
        setFormConfig(res.form.config || {})
        if ((res as any).onboardingToken) setOnboardingToken((res as any).onboardingToken)
      }
      setLoadingSchema(false)
    }
    async function loadBanks() {
      try {
        const response = await fetch('/api/lookups/banks')
        if (!response.ok) return
        const data = await response.json()
        setBanks(Array.isArray(data?.banks) ? data.banks : [])
      } catch (err) {
        console.error('Erro ao buscar bancos da Brasil API:', err)
      }
    }
    async function loadUFs() {
      try {
        const response = await fetch('/api/lookups/ufs')
        if (!response.ok) return
        const data = await response.json()
        setUfs(Array.isArray(data?.ufs) ? data.ufs : [])
      } catch (err) {
        console.error('Erro ao buscar UFs:', err)
      }
    }
    loadSchema()
    loadBanks()
    loadUFs()
  }, [slug])

  useEffect(() => {
    try {
      document.documentElement.style.setProperty('--onb-accent', accentColor)
      document.documentElement.style.setProperty('--onb-primary', primaryColor)
    } catch {
      // ignore
    }
  }, [accentColor, primaryColor])

  type SchemaField = {
    key?: string
    id?: string
    label?: string
    description?: string
    type?: 'text' | 'select' | 'checkbox' | 'file'
    required?: boolean
    hidden?: boolean
    mask?: string
    system_key?: string
    options?: string[]
    options_source?: 'banks' | 'ufs'
    conditional?: { field_id?: string; value?: string }
    placeholder?: string
  }

  function getFieldKey(field: SchemaField): string {
    return String(field?.key || field?.id || '')
  }

  function shouldShowField(field: SchemaField): boolean {
    if (field?.hidden) return false
    const cond = field?.conditional
    if (!cond?.field_id) return true
    const current = dynamicAnswers[cond.field_id]
    return String(current ?? '') === String(cond.value ?? '')
  }

  function setFieldAnswer(field: SchemaField, value: any) {
    const key = getFieldKey(field)
    if (!key) return

    const nextValue =
      field.type !== 'checkbox' && field.type !== 'select' && field.type !== 'file'
        ? applyMask(field.mask, value)
        : value

    setDynamicAnswers((prev) => ({ ...prev, [key]: nextValue }))

    // Gatilhos de API baseados em system_key/máscara
    if (field.system_key === 'cpf_cnpj' && String(field.mask) === 'cnpj') {
      const raw = String(nextValue || '')
      searchCNPJ(raw)
    }
    if (field.system_key === 'cpf_cnpj' && String(field.mask) === 'cpf') {
      const raw = String(nextValue || '')
      searchCPF(raw, { targetSystemKey: 'cpf_cnpj' })
    }
    if (field.system_key === 'cep' && String(field.mask) === 'cep') {
      const raw = String(nextValue || '')
      searchCEP(raw, { targetSystemKey: 'cep', force: true })
    }
    if (field.system_key === 'partner_1_cep' && String(field.mask) === 'cep') {
      const raw = String(nextValue || '')
      searchCEP(raw, { targetSystemKey: 'partner_1_cep', force: true })
    }
    if (field.system_key === 'partner_1_cpf' && String(field.mask) === 'cpf') {
      const raw = String(nextValue || '')
      searchCPF(raw, { targetSystemKey: 'partner_1_cpf' })
    }
    if (field.system_key === 'partner_2_cpf' && String(field.mask) === 'cpf') {
      const raw = String(nextValue || '')
      searchCPF(raw, { targetSystemKey: 'partner_2_cpf' })
    }
  }

  function setAnswersBySystemKey(systemKey: string, value: any, opts?: { onlyIfEmpty?: boolean }) {
    if (!systemKey) return
    setDynamicAnswers((prev) => {
      const next = { ...prev }
      for (const f of (Array.isArray(formSchema) ? (formSchema as SchemaField[]) : [])) {
        if (String(f?.system_key || '') !== systemKey) continue
        const k = getFieldKey(f)
        if (!k) continue
        if (opts?.onlyIfEmpty && next[k]) continue
        next[k] = value
      }
      return next
    })
  }

  function getFirstValueBySystemKey(systemKey: string): any {
    if (!systemKey) return undefined
    for (const f of (Array.isArray(formSchema) ? (formSchema as SchemaField[]) : [])) {
      if (String(f?.system_key || '') !== systemKey) continue
      const k = getFieldKey(f)
      if (!k) continue
      const v = dynamicAnswers[k]
      if (v !== undefined && v !== null && String(v).trim() !== '') return v
    }
    return undefined
  }

  function normalizePersonType(value: any): 'PF' | 'PJ' | undefined {
    const raw = String(value ?? '').trim().toUpperCase()
    if (!raw) return undefined
    if (raw === 'PF' || raw === 'PESSOA FÍSICA' || raw === 'PESSOA FISICA') return 'PF'
    if (raw === 'PJ' || raw === 'PESSOA JURÍDICA' || raw === 'PESSOA JURIDICA') return 'PJ'
    if (raw.includes('CPF') || raw.includes('FISIC') || raw.includes('FÍSIC')) return 'PF'
    if (raw.includes('CNPJ') || raw.includes('JURID') || raw.includes('JURÍD')) return 'PJ'
    return undefined
  }

  function normalizeDateToDb(value: any): string | undefined {
    const raw = String(value ?? '').trim()
    if (!raw) return undefined
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
    const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    if (!m) return raw
    const dd = m[1]
    const mm = m[2]
    const yyyy = m[3]
    return `${yyyy}-${mm}-${dd}`
  }

  function getPlaceholderForField(field: SchemaField): string {
    if (field.placeholder) return field.placeholder
    switch (field.mask) {
      case 'cep':
        return '00000-000'
      case 'phone_mobile':
        return '(00) 90000-0000'
      case 'phone_landline':
        return '(00) 0000-0000'
      case 'cpf':
        return '000.000.000-00'
      case 'cnpj':
        return '00.000.000/0000-00'
      case 'date':
        return 'dd/mm/aaaa'
      case 'pix_uuid':
        return '00000000-0000-0000-0000-000000000000'
      case 'bank_account':
        return '0000000000-0'
      case 'bank_agency_with_digit':
        return '0000-0'
      case 'bank_agency_without_digit':
        return '0000'
      case 'email':
        return 'seuemail@provedor.com'
      default:
        return ''
    }
  }

  function formatDateIsoToBr(iso: string): string {
    const raw = String(iso || '').trim()
    if (!raw) return ''
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) return raw
    return `${m[3]}/${m[2]}/${m[1]}`
  }

  function formatBRLCurrency(value: any): string {
    const raw = String(value ?? '').trim()
    if (!raw) return ''

    // Suporta entradas como "30.000,00", "30000,00", "30000.00" e "30000"
    const cleaned = raw.replace(/\s/g, '').replace(/[Rr]\$/g, '')
    const hasComma = cleaned.includes(',')
    const hasDot = cleaned.includes('.')

    const normalized = (() => {
      if (hasComma) {
        // pt-BR: "." milhar, "," decimal
        return cleaned.replace(/\./g, '').replace(',', '.')
      }

      if (hasDot) {
        // Se houver apenas 1 ".", decide se é decimal (2 casas) ou milhar
        const parts = cleaned.split('.')
        if (parts.length === 2 && parts[1].length === 2) return cleaned
        return cleaned.replace(/\./g, '')
      }

      return cleaned
    })()

    const n = Number(normalized)
    if (!Number.isFinite(n)) return raw
    try {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
    } catch {
      // Fallback simples se Intl falhar
      return `R$ ${n.toFixed(2).replace('.', ',')}`
    }
  }

  function validateMaskedValue(mask: SchemaField['mask'], rawValue: any): { ok: boolean; reason?: string } {
    const value = String(rawValue ?? '').trim()
    const digits = value.replace(/\D/g, '')

    if (!mask || mask === 'none') return { ok: true }

    switch (mask) {
      case 'cpf':
        return digits.length === 11 ? { ok: true } : { ok: false, reason: 'CPF incompleto' }
      case 'cnpj':
        return digits.length === 14 ? { ok: true } : { ok: false, reason: 'CNPJ incompleto' }
      case 'cep':
        return digits.length === 8 ? { ok: true } : { ok: false, reason: 'CEP incompleto' }
      case 'phone_mobile':
        return digits.length === 11 ? { ok: true } : { ok: false, reason: 'Celular incompleto' }
      case 'phone_landline':
        return digits.length === 10 ? { ok: true } : { ok: false, reason: 'Telefone incompleto' }
      case 'email': {
        // validação simples (deixa validações mais rígidas para backend)
        const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
        return ok ? { ok: true } : { ok: false, reason: 'E-mail inválido' }
      }
      case 'date': {
        // Espera dd/mm/aaaa (8 dígitos). Não valida calendário aqui.
        return digits.length === 8 ? { ok: true } : { ok: false, reason: 'Data incompleta' }
      }
      case 'pix_uuid': {
        const hex = value.replace(/[^0-9a-fA-F]/g, '')
        return hex.length === 32 ? { ok: true } : { ok: false, reason: 'Chave UUID incompleta' }
      }
      case 'bank_account':
        return digits.length === 11 ? { ok: true } : { ok: false, reason: 'Conta incompleta' }
      case 'bank_agency_with_digit':
        return digits.length === 5 ? { ok: true } : { ok: false, reason: 'Agência incompleta' }
      case 'bank_agency_without_digit':
        return digits.length === 4 ? { ok: true } : { ok: false, reason: 'Agência incompleta' }
      default:
        return { ok: true }
    }
  }

  function applyMask(mask: SchemaField['mask'], value: any): string {
    const input = String(value ?? '')
    if (!mask || mask === 'none') return input

    const digits = input.replace(/\D/g, '')

    switch (mask) {
      case 'cpf': {
        const d = digits.slice(0, 11)
        if (d.length <= 3) return d
        if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
        if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
        return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
      }
      case 'cnpj': {
        const d = digits.slice(0, 14)
        if (d.length <= 2) return d
        if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`
        if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`
        if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`
        return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
      }
      case 'cep': {
        const d = digits.slice(0, 8)
        if (d.length <= 5) return d
        return `${d.slice(0, 5)}-${d.slice(5)}`
      }
      case 'phone_landline': {
        const d = digits.slice(0, 10)
        if (d.length <= 2) return d
        if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
        return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
      }
      case 'phone_mobile': {
        const d = digits.slice(0, 11)
        if (d.length <= 2) return d
        if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
        if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
        return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
      }
      case 'date': {
        // exibimos no padrão BR; se vier ISO, converte
        if (/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) return formatDateIsoToBr(input)
        const d = digits.slice(0, 8)
        if (d.length <= 2) return d
        if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`
        return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
      }
      case 'pix_uuid': {
        // aceita hex + '-' e normaliza em 8-4-4-4-12 quando possível
        const hex = input.replace(/[^0-9a-fA-F]/g, '').slice(0, 32)
        if (hex.length <= 8) return hex
        if (hex.length <= 12) return `${hex.slice(0, 8)}-${hex.slice(8)}`
        if (hex.length <= 16) return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12)}`
        if (hex.length <= 20) return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16)}`
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
      }
      case 'bank_account': {
        // Exibição em formato 0000000000-0 (preenchendo da direita para a esquerda)
        const d = digits.slice(-11)
        if (!d) return ''
        const dv = d.slice(-1)
        const core = d.slice(0, -1).slice(-10).padStart(10, '0')
        return `${core}-${dv}`
      }
      case 'bank_agency_with_digit': {
        const d = digits.slice(0, 5)
        if (d.length <= 4) return d
        return `${d.slice(0, 4)}-${d.slice(4)}`
      }
      case 'bank_agency_without_digit': {
        return digits.slice(0, 4)
      }
      default:
        return input
    }
  }

  function inferAppendOnlySequence(prevSeq: string, nextInputValue: string, maxDigits: number): string {
    const typedDigits = String(nextInputValue || '').replace(/\D/g, '')
    if (!typedDigits) return ''

    // Detect backspace by length shrink (best-effort)
    if (typedDigits.length < prevSeq.length) {
      return prevSeq.slice(0, typedDigits.length)
    }

    // Paste/replace: entrou muita coisa de uma vez
    if (typedDigits.length - prevSeq.length > 1) {
      return typedDigits.slice(0, maxDigits)
    }

    // Appending: pega o último dígito digitado e adiciona na sequência
    const lastDigit = typedDigits.slice(-1)
    const nextSeq = `${prevSeq}${lastDigit}`.slice(0, maxDigits)
    return nextSeq
  }

  function formatBankAgencyWithDigitFromSeq(seq: string): string {
    const d = String(seq || '').replace(/\D/g, '').slice(0, 5)
    if (!d) return ''

    // Sempre exibe como 0000-0 (BRB pode ter 3 dígitos; preenche com zeros à esquerda)
    if (d.length <= 4) {
      const core = d.padStart(4, '0')
      return `${core}-0`
    }

    return `${d.slice(0, 4)}-${d.slice(4)}`
  }

  function formatBankAccountFromSeq(seq: string): string {
    const d = String(seq || '').replace(/\D/g, '').slice(-11)
    if (!d) return ''
    const dv = d.slice(-1)
    const core = d.slice(0, -1).slice(-10).padStart(10, '0')
    return `${core}-${dv}`
  }

  function isAllZeros(digits: string): boolean {
    const d = String(digits || '').replace(/\D/g, '')
    return !!d && /^0+$/.test(d)
  }

  function seedBankSeqFromValue(mask: SchemaField['mask'], rawValue: any, maxDigits: number): string {
    const digits = String(rawValue ?? '').replace(/\D/g, '').slice(0, maxDigits)
    if (!digits) return ''

    // Se for apenas zeros (ex: "00000"), considera vazio para não travar digitação
    if (isAllZeros(digits)) return ''

    return digits
  }

  function handleDigitSequenceKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    prevSeq: string,
    setSeq: (next: string) => void,
    maxDigits: number,
  ) {
    const key = e.key
    const digitFromCode = (() => {
      const code = String(e.code || '')
      const m = code.match(/^Numpad([0-9])$/)
      return m ? m[1] : null
    })()

    if (key === 'Backspace') {
      e.preventDefault()
      setSeq(prevSeq.slice(0, -1))
      return
    }

    if (key === 'Delete') {
      e.preventDefault()
      setSeq('')
      return
    }

    // Allow navigation keys
    if (key === 'Tab' || key.startsWith('Arrow') || key === 'Home' || key === 'End') return

    // Only allow digits; block '-' and any other chars
    const digit = /^\d$/.test(key) ? key : digitFromCode
    if (digit) {
      e.preventDefault()
      if (prevSeq.length >= maxDigits) return
      setSeq((prevSeq + digit).slice(0, maxDigits))
      return
    }

    // Block everything else (including minus)
    if (key.length === 1) {
      e.preventDefault()
    }
  }

  function handleDigitSequencePaste(
    e: React.ClipboardEvent<HTMLInputElement>,
    prevSeq: string,
    setSeq: (next: string) => void,
    maxDigits: number,
  ) {
    const txt = e.clipboardData.getData('text') || ''
    const digits = txt.replace(/\D/g, '')
    if (!digits) return
    e.preventDefault()
    const next = (prevSeq + digits).slice(0, maxDigits)
    setSeq(next)
  }

  function handleDigitSequenceChange(
    e: React.ChangeEvent<HTMLInputElement>,
    prevSeq: string,
    setSeq: (next: string) => void,
    maxDigits: number,
  ) {
    const native = e.nativeEvent as unknown as { data?: string | null; inputType?: string }
    const inputType = String(native?.inputType || '')
    const dataDigits = String(native?.data ?? '').replace(/\D/g, '')

    if (inputType.startsWith('delete')) {
      setSeq(prevSeq.slice(0, -1))
      return
    }

    if (dataDigits) {
      setSeq((prevSeq + dataDigits).slice(0, maxDigits))
      return
    }

    setSeq(inferAppendOnlySequence(prevSeq, e.target.value, maxDigits))
  }

  function getBankCode3(code: any): string {
    const raw = String(code ?? '').replace(/\D/g, '')
    if (!raw) return ''
    return raw.slice(0, 3).padStart(3, '0')
  }

  function getFilteredBanks(query: string) {
    const q = String(query ?? '').trim().toLowerCase()
    if (!q) return banks

    const qDigits = q.replace(/\D/g, '')
    const qDigits3 = qDigits ? qDigits.slice(0, 3).padStart(3, '0') : ''

    return banks.filter((b) => {
      const code3 = getBankCode3(b?.code ?? b?.ispb ?? '')
      const name = String(b?.name ?? '').toLowerCase()
      if (!qDigits) return name.includes(q)
      return code3.startsWith(qDigits) || code3.startsWith(qDigits3) || name.includes(q)
    })
  }

  // Auto Search CNPJ via publica.cnpj.ws
  async function searchCNPJ(value: string) {
    const cleanCNPJ = value.replace(/\D/g, '')
    if (cleanCNPJ.length !== 14) return

    setSearchingCNPJ(true)
    try {
      const response = await fetch(`https://publica.cnpj.ws/cnpj/${cleanCNPJ}`)
      if (!response.ok) throw new Error('CNPJ não encontrado')
      const data = await response.json()
      
      setName(data.razao_social || '')
      setFantasyName(data.estabelecimento?.nome_fantasia || '')
      
      // Busca sócio principal
      if (data.socios && data.socios.length > 0) {
        setRepresentanteLegal(data.socios[0].nome_socio || '')
      }

      // Endereço
      if (data.estabelecimento) {
        const est = data.estabelecimento
        const fullStreet = `${est.tipo_logradouro || ''} ${est.logradouro || ''}`.trim()
        setCep(est.cep || '')
        setAddressStreet(fullStreet)
        setAddressNumber(est.numero || '')
        setAddressComplement(est.complemento || '')
        setAddressNeighborhood(est.bairro || '')
        setAddressCity(est.cidade?.nome || '')
        setAddressState(est.estado?.sigla || '')

        // Também preenche campos do schema (se existirem)
        setAnswersBySystemKey('cep', applyMask('cep', est.cep || ''), { onlyIfEmpty: true })
        setAnswersBySystemKey('address_street', fullStreet, { onlyIfEmpty: true })
        setAnswersBySystemKey('address_number', est.numero || '', { onlyIfEmpty: true })
        setAnswersBySystemKey('address_complement', est.complemento || '', { onlyIfEmpty: true })
        setAnswersBySystemKey('address_neighborhood', est.bairro || '', { onlyIfEmpty: true })
        setAnswersBySystemKey('address_city', est.cidade?.nome || '', { onlyIfEmpty: true })
        setAnswersBySystemKey('address_state', est.estado?.sigla || '', { onlyIfEmpty: true })
        
        // Contatos
        const ddd = est.ddd1 || ''
        const tel = est.telefone1 || ''
        if (ddd && tel) {
          setPhoneWhatsapp(`${ddd}${tel}`.replace(/\D/g, ''))
          setAnswersBySystemKey('phone_whatsapp', applyMask('phone_mobile', `${ddd}${tel}`), { onlyIfEmpty: true })
        }
        setEmailComissao(est.email || '')
        setAnswersBySystemKey('email_comissao', est.email || '', { onlyIfEmpty: true })
      }

      setAnswersBySystemKey('cpf_cnpj', cleanCNPJ, { onlyIfEmpty: true })
      setAnswersBySystemKey('name', data.razao_social || '', { onlyIfEmpty: true })
      setAnswersBySystemKey('fantasy_name', data.estabelecimento?.nome_fantasia || '', { onlyIfEmpty: true })
      setAnswersBySystemKey('representante_legal', (data.socios && data.socios[0]?.nome_socio) ? data.socios[0].nome_socio : '', { onlyIfEmpty: true })

      // Salva dados ricos do CNPJ
      setDynamicAnswers(prev => ({
        ...prev,
        cnpj_rich_info: {
          situacao_cadastral: data.estabelecimento?.situacao_cadastral || 'Ativa',
          data_abertura: data.estabelecimento?.data_inicio_atividade || '',
          capital_social: data.capital_social || '',
          natureza_juridica: data.natureza_juridica?.descricao || '',
          cnae_principal: data.estabelecimento?.atividade_principal?.descricao || '',
          socios: data.socios?.map((s: any) => ({
            nome: s.nome_socio || s.nome,
            cargo: s.qualificacao_socio?.descricao || ''
          })) || []
        }
      }))

      // Campos extras do bloco Empresa (se existirem)
      setAnswersBySystemKey('company_registration_status', data.estabelecimento?.situacao_cadastral || '', { onlyIfEmpty: true })
      setAnswersBySystemKey('company_opening_date', applyMask('date', data.estabelecimento?.data_inicio_atividade || ''), { onlyIfEmpty: true })
      setAnswersBySystemKey('company_capital_social', formatBRLCurrency(data.capital_social || ''), { onlyIfEmpty: true })
      setAnswersBySystemKey('company_legal_nature', data.natureza_juridica?.descricao || '', { onlyIfEmpty: true })
      setAnswersBySystemKey('company_size', (data.estabelecimento?.porte?.descricao || data.porte?.descricao || data.estabelecimento?.porte || data.porte || ''), { onlyIfEmpty: true })
      setAnswersBySystemKey('company_country', (data.estabelecimento?.pais?.nome || data.estabelecimento?.pais?.descricao || data.pais?.nome || data.pais?.descricao || 'Brasil'), { onlyIfEmpty: true })
    } catch (err) {
      console.error('Erro ao buscar CNPJ:', err)
    } finally {
      setSearchingCNPJ(false)
    }
  }

  // Auto Search CEP via BrasilAPI
  async function searchCEP(value: string, opts?: { targetSystemKey?: 'cep' | 'partner_1_cep'; force?: boolean }) {
    const cleanCEP = value.replace(/\D/g, '')
    if (cleanCEP.length !== 8) return

    setSearchingCEP(true)
    try {
      const response = await fetch(`https://brasilapi.com.br/api/cep/v1/${cleanCEP}`)
      if (!response.ok) return
      const data = await response.json()
      const target = opts?.targetSystemKey || 'cep'
      const onlyIfEmpty = !opts?.force

      // Endereço comercial (estado local + system_keys padrão)
      if (target === 'cep') {
        setAddressStreet(data.street || '')
        setAddressNeighborhood(data.neighborhood || '')
        setAddressCity(data.city || '')
        setAddressState(data.state || '')

        setAnswersBySystemKey('cep', applyMask('cep', cleanCEP), { onlyIfEmpty })
        setAnswersBySystemKey('address_street', data.street || '', { onlyIfEmpty })
        setAnswersBySystemKey('address_neighborhood', data.neighborhood || '', { onlyIfEmpty })
        setAnswersBySystemKey('address_city', data.city || '', { onlyIfEmpty })
        setAnswersBySystemKey('address_state', data.state || '', { onlyIfEmpty })
      }

      // Endereço do sócio principal (apenas via schema dinâmico)
      if (target === 'partner_1_cep') {
        setAnswersBySystemKey('partner_1_cep', applyMask('cep', cleanCEP), { onlyIfEmpty })
        setAnswersBySystemKey('partner_1_address_street', data.street || '', { onlyIfEmpty })
        setAnswersBySystemKey('partner_1_address_neighborhood', data.neighborhood || '', { onlyIfEmpty })
        setAnswersBySystemKey('partner_1_address_city', data.city || '', { onlyIfEmpty })
        setAnswersBySystemKey('partner_1_address_state', data.state || '', { onlyIfEmpty })
      }
    } catch (err) {
      console.error('Erro ao buscar CEP:', err)
    } finally {
      setSearchingCEP(false)
    }
  }

  function extractFirstString(input: any, paths: string[]): string | undefined {
    for (const path of paths) {
      const parts = path.split('.').filter(Boolean)
      let cur: any = input
      for (const p of parts) {
        if (cur && typeof cur === 'object' && p in cur) cur = cur[p]
        else {
          cur = undefined
          break
        }
      }
      if (cur === undefined || cur === null) continue
      const v = String(cur).trim()
      if (v) return v
    }
    return undefined
  }

  function normalizeCpfBirthDate(value: any): string | undefined {
    const raw = String(value ?? '').trim()
    if (!raw) return undefined
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
    const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    if (m) return `${m[3]}-${m[2]}-${m[1]}`
    return raw
  }

  async function searchCPF(value: string, opts?: { targetSystemKey?: 'cpf_cnpj' | 'partner_1_cpf' | 'partner_2_cpf' }) {
    const cleanCPF = value.replace(/\D/g, '')
    if (cleanCPF.length !== 11) return

    setSearchingCPF(true)
    try {
      const res = await fetch(`/api/cpfhub/cpf/${cleanCPF}`, {
        cache: 'no-store',
        headers: onboardingToken ? { 'x-onboarding-token': onboardingToken } : {},
      })
      if (!res.ok) return
      const data = await res.json()

      const nameFromApi = extractFirstString(data, ['data.name', 'name', 'nome', 'pessoa.nome', 'data.nome'])
      const birthFromApi = extractFirstString(data, [
        'data.birthDate',
        'data_nascimento',
        'nascimento',
        'birth_date',
        'birthDate',
        'pessoa.data_nascimento',
        'pessoa.nascimento',
      ])
      const genderFromApi = extractFirstString(data, ['data.gender', 'gender', 'genero', 'gênero'])

      const birthDateIso = normalizeCpfBirthDate(birthFromApi)

      if (opts?.targetSystemKey === 'partner_1_cpf') {
        setDynamicAnswers((prev) => ({
          ...prev,
          partner_1_cpf_rich_info: {
            cpf: cleanCPF,
            name: nameFromApi || '',
            gender: genderFromApi || '',
            birth_date: birthDateIso || '',
          },
        }))
        if (nameFromApi) setAnswersBySystemKey('partner_1_name', nameFromApi, { onlyIfEmpty: true })
        if (birthDateIso) {
          setAnswersBySystemKey('partner_1_birth_date', applyMask('date', birthDateIso), { onlyIfEmpty: true })
        }
        return
      }

      if (opts?.targetSystemKey === 'partner_2_cpf') {
        setDynamicAnswers((prev) => ({
          ...prev,
          partner_2_cpf_rich_info: {
            cpf: cleanCPF,
            name: nameFromApi || '',
            gender: genderFromApi || '',
            birth_date: birthDateIso || '',
          },
        }))
        if (nameFromApi) setAnswersBySystemKey('partner_2_name', nameFromApi, { onlyIfEmpty: true })
        if (birthDateIso) {
          setAnswersBySystemKey('partner_2_birth_date', applyMask('date', birthDateIso), { onlyIfEmpty: true })
        }
        return
      }

      setDynamicAnswers((prev) => ({
        ...prev,
        cpf_rich_info: {
          cpf: cleanCPF,
          name: nameFromApi || '',
          gender: genderFromApi || '',
          birth_date: birthDateIso || '',
        },
      }))

      if (nameFromApi) {
        setName((prev) => prev || nameFromApi)
        setAnswersBySystemKey('name', nameFromApi, { onlyIfEmpty: true })
      }
      if (birthDateIso) {
        const br = applyMask('date', birthDateIso)
        setBirthDate((prev) => prev || br)
        setAnswersBySystemKey('birth_date', br, { onlyIfEmpty: true })
      }
    } catch (err) {
      console.error('Erro ao consultar CPF:', err)
    } finally {
      setSearchingCPF(false)
    }
  }

  // File Upload to base64 and server action
  async function handleFileUpload(fieldKey: string, file: File) {
    setFieldErrors((prev) => ({ ...prev, [fieldKey]: '' }))
    const ext = String(file.name.split('.').pop() || '').toLowerCase()
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
      setFieldErrors((prev) => ({ ...prev, [fieldKey]: 'Formato inválido. Envie PDF, JPG ou PNG.' }))
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setFieldErrors((prev) => ({ ...prev, [fieldKey]: 'Arquivo excede o tamanho máximo de 5MB.' }))
      return
    }

    setUploadingFiles(prev => ({ ...prev, [fieldKey]: true }))
    try {
      const cpfCnpjForUpload = (() => {
        const fromSchema = isSchemaV2 ? String(getFirstValueBySystemKey('cpf_cnpj') || '') : ''
        const raw = (fromSchema || cpfCnpj || 'temp').replace(/\D/g, '')
        return raw || 'temp'
      })()

      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (e) => {
          const result = String((e.target?.result as string) || '')
          const [, data] = result.split(',')
          if (!data) return reject(new Error('Arquivo inválido'))
          resolve(data)
        }
        reader.onerror = () => reject(new Error('Falha ao ler arquivo'))
        reader.readAsDataURL(file)
      })

      const res = await uploadPartnerFile(cpfCnpjForUpload, file.name, base64Data)
      if (res.success && res.publicUrl) {
        setDynamicAnswers(prev => ({ ...prev, [fieldKey]: res.publicUrl }))
        setFieldErrors((prev) => ({ ...prev, [fieldKey]: '' }))
        return
      }
      setFieldErrors((prev) => ({ ...prev, [fieldKey]: res?.error || 'Erro ao enviar arquivo.' }))
    } catch (err) {
      console.error('Erro no upload:', err)
      setFieldErrors((prev) => ({ ...prev, [fieldKey]: 'Erro ao enviar arquivo.' }))
    } finally {
      setUploadingFiles(prev => ({ ...prev, [fieldKey]: false }))
    }
  }

  // PIX validation check
  const isPixDivergent = (() => {
    const pixTypeValue = isSchemaV2 ? String(getFirstValueBySystemKey('pix_type') || '') : pixType
    const pixKeyValue = isSchemaV2 ? String(getFirstValueBySystemKey('pix_key') || '') : pixKey
    const idValue = isSchemaV2 ? String(getFirstValueBySystemKey('cpf_cnpj') || '') : cpfCnpj
    if (!pixKeyValue || !idValue) return false
    const cleanPix = pixKeyValue.replace(/\D/g, '')
    const cleanId = idValue.replace(/\D/g, '')
    if (String(pixTypeValue).toUpperCase() === 'CPF' && cleanPix !== cleanId) return true
    if (String(pixTypeValue).toUpperCase() === 'CNPJ' && cleanPix !== cleanId) return true
    return false
  })()

  // Form submit
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setSubmitError(null)

    try {
      const payload = (() => {
        if (!isSchemaV2) {
          return {
            form_id: formId || undefined,
            person_type: personType,
            cpf_cnpj: cpfCnpj.replace(/\D/g, ''),
            name,
            fantasy_name: personType === 'PJ' ? fantasyName : undefined,
            representante_legal: personType === 'PJ' ? representanteLegal : undefined,
            rg: personType === 'PF' ? rg : undefined,
            rg_expedition_date: personType === 'PF' && rgExpeditionDate ? rgExpeditionDate : undefined,
            rg_issuer: personType === 'PF' ? rgIssuer : undefined,
            rg_state: personType === 'PF' ? rgState : undefined,
            birth_date: birthDate || undefined,
            
            cep: cep.replace(/\D/g, ''),
            address_street: addressStreet,
            address_number: addressNumber,
            address_complement: addressComplement,
            address_neighborhood: addressNeighborhood,
            address_city: addressCity,
            address_state: addressState,
            
            phone_whatsapp: phoneWhatsapp.replace(/\D/g, ''),
            phone_whatsapp_financeiro: phoneWhatsappFinanceiro.replace(/\D/g, '') || undefined,
            phone_commercial: phoneCommercial.replace(/\D/g, '') || undefined,
            phone_residential: phoneResidential.replace(/\D/g, '') || undefined,
            phone_support: phoneSupport.replace(/\D/g, '') || undefined,
            
            email_comissao: emailComissao,
            email_informe: emailInforme || undefined,
            email_formalizacao: emailFormalizacao || undefined,
            email_proposta: emailProposta || undefined,
            email_mesa_liberacao: emailMesaLiberacao || undefined,
            email_juridico: emailJuridico || undefined,
            email_proprio_cunho: emailProprioCunho || undefined,
            
            commission_receive_type: commissionReceiveType,
            bank_code: bankCode || undefined,
            bank_name: bankName || undefined,
            bank_agency: bankAgency || undefined,
            bank_account: bankAccount || undefined,
            bank_account_type: bankAccountType || undefined,
            pix_type: pixType || undefined,
            pix_key: pixKey || undefined,
            
            additional_data: dynamicAnswers
          }
        }

        const personTypeFromSchema = normalizePersonType(getFirstValueBySystemKey('person_type'))
        const cpfCnpjFromSchema = String(getFirstValueBySystemKey('cpf_cnpj') || '').replace(/\D/g, '')
        const nameFromSchema = String(getFirstValueBySystemKey('name') || '')
        const phoneWhatsappFromSchema = String(getFirstValueBySystemKey('phone_whatsapp') || '').replace(/\D/g, '')
        const emailComissaoFromSchema = String(getFirstValueBySystemKey('email_comissao') || '')

        if (!formId) throw new Error('Formulário inválido: id não encontrado.')
        if (!personTypeFromSchema) throw new Error('Selecione o Tipo de Pessoa.')
        if (!cpfCnpjFromSchema) throw new Error('Informe CPF/CNPJ.')
        if (!nameFromSchema) throw new Error('Informe o nome/razão social.')
        if (!phoneWhatsappFromSchema) throw new Error('Informe o WhatsApp principal.')
        if (!emailComissaoFromSchema) throw new Error('Informe o e-mail principal.')

        const bankSelection = String(getFirstValueBySystemKey('bank_name') || '')
        const bankParts = bankSelection.includes('|') ? bankSelection.split('|') : []
        const bankCodeFromSchema = bankParts.length >= 2 ? String(bankParts[0] || '').trim() : undefined
        const bankNameFromSchema = bankParts.length >= 2 ? String(bankParts.slice(1).join('|') || '').trim() : (bankSelection || undefined)

        return {
          form_id: formId,
          person_type: personTypeFromSchema,
          cpf_cnpj: cpfCnpjFromSchema,
          name: nameFromSchema,

          fantasy_name: personTypeFromSchema === 'PJ' ? String(getFirstValueBySystemKey('fantasy_name') || '') || undefined : undefined,
          representante_legal: personTypeFromSchema === 'PJ' ? String(getFirstValueBySystemKey('representante_legal') || '') || undefined : undefined,

          rg: personTypeFromSchema === 'PF' ? String(getFirstValueBySystemKey('rg') || '') || undefined : undefined,
          rg_expedition_date: personTypeFromSchema === 'PF' ? normalizeDateToDb(getFirstValueBySystemKey('rg_expedition_date')) : undefined,
          rg_issuer: personTypeFromSchema === 'PF' ? String(getFirstValueBySystemKey('rg_issuer') || '') || undefined : undefined,
          rg_state: personTypeFromSchema === 'PF' ? String(getFirstValueBySystemKey('rg_state') || '') || undefined : undefined,
          birth_date: normalizeDateToDb(getFirstValueBySystemKey('birth_date')),

          cep: String(getFirstValueBySystemKey('cep') || '').replace(/\D/g, '') || undefined,
          address_street: String(getFirstValueBySystemKey('address_street') || '') || undefined,
          address_number: String(getFirstValueBySystemKey('address_number') || '') || undefined,
          address_complement: String(getFirstValueBySystemKey('address_complement') || '') || undefined,
          address_neighborhood: String(getFirstValueBySystemKey('address_neighborhood') || '') || undefined,
          address_city: String(getFirstValueBySystemKey('address_city') || '') || undefined,
          address_state: String(getFirstValueBySystemKey('address_state') || '') || undefined,

          phone_whatsapp: phoneWhatsappFromSchema,
          phone_whatsapp_financeiro: String(getFirstValueBySystemKey('phone_whatsapp_financeiro') || '').replace(/\D/g, '') || undefined,
          phone_commercial: String(getFirstValueBySystemKey('phone_commercial') || '').replace(/\D/g, '') || undefined,
          phone_support: String(getFirstValueBySystemKey('phone_support') || '').replace(/\D/g, '') || undefined,

          email_comissao: emailComissaoFromSchema,
          email_formalizacao: String(getFirstValueBySystemKey('email_formalizacao') || '') || undefined,
          email_juridico: String(getFirstValueBySystemKey('email_juridico') || '') || undefined,
          email_informe: String(getFirstValueBySystemKey('email_informe') || '') || undefined,

          commission_receive_type: String(getFirstValueBySystemKey('commission_receive_type') || '') || undefined,
          bank_code: bankCodeFromSchema || undefined,
          bank_name: bankNameFromSchema || undefined,
          bank_agency: String(getFirstValueBySystemKey('bank_agency') || '') || undefined,
          bank_account: String(getFirstValueBySystemKey('bank_account') || '') || undefined,
          bank_account_type: String(getFirstValueBySystemKey('bank_account_type') || '') || undefined,
          pix_type: String(getFirstValueBySystemKey('pix_type') || '') || undefined,
          pix_key: String(getFirstValueBySystemKey('pix_key') || '') || undefined,

          additional_data: dynamicAnswers,
        }
      })()

      const res = await submitPartnerRegistration({ ...(payload as any), process_slug: slug } as any)
      if (res.success) {
        setStep('success')
      } else {
        throw new Error(res.error || 'Erro desconhecido ao enviar cadastro.')
      }
    } catch (err: any) {
      setSubmitError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  function renderSchemaV2Fields() {
    const fields = (Array.isArray(formSchema) ? (formSchema as SchemaField[]) : []).filter(shouldShowField)

    return (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {fields.map((field) => {
            const isRequired = !!field.required
            const fieldKey = getFieldKey(field)
            if (!fieldKey) return null

            const label = String(field.label || '')
            const description = String(field.description || '').trim()
            const value = dynamicAnswers[fieldKey]

            if (field.type === 'checkbox') {
              return (
                <div key={fieldKey} className="form-group">
                  <label className="onboarding-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={!!value}
                      onChange={(e) => setFieldAnswer(field, e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ fontWeight: 800, color: '#fff' }}>
                      {label} {isRequired && <span style={{ color: accentColor }}>*</span>}
                    </span>
                  </label>
                  {description && (
                    <div style={{ marginTop: '-0.25rem', color: '#9ca3af', fontStyle: 'italic', fontSize: '0.78rem' }}>
                      {description}
                    </div>
                  )}
                </div>
              )
            }

            if (field.type === 'select') {
              const selectValue = String(value ?? '')

              if (field.options_source === 'banks') {
                const search = String(bankSearchByKey[fieldKey] || '')
                const parts = selectValue.includes('|') ? selectValue.split('|') : []
                const selectedCode = parts.length >= 2 ? String(parts[0] || '').trim() : ''
                const selectedName = parts.length >= 2 ? String(parts.slice(1).join('|') || '').trim() : ''
                const selectedLabel = selectedCode
                  ? `${String(selectedCode).padStart(3, '0')} - ${selectedName}`
                  : ''

                const filtered = getFilteredBanks(search)

                return (
                  <div key={fieldKey} className="form-group">
                    <label className="onboarding-label" style={{ fontWeight: 800, color: '#fff' }}>
                      {label} {isRequired && <span style={{ color: accentColor }}>*</span>}
                    </label>
                    {description && (
                      <div style={{ marginTop: '-0.15rem', marginBottom: '0.5rem', color: '#9ca3af', fontStyle: 'italic', fontSize: '0.78rem' }}>
                        {description}
                      </div>
                    )}

                    <div style={{ position: 'relative' }}>
                      <input
                        type="text"
                        className="onboarding-input"
                        required={isRequired}
                        placeholder="Digite o código do banco, parte do nome ou escolha uma opção na lista."
                        value={search !== '' ? search : selectedLabel}
                        onChange={(e) => {
                          const val = e.target.value
                          setFieldErrors((prev) => ({ ...prev, [fieldKey]: '' }))
                          setBankSearchByKey((prev) => ({ ...prev, [fieldKey]: val }))
                          setBankDropdownKey(fieldKey)

                          if (!val.trim()) {
                            setDynamicAnswers((prev) => ({ ...prev, [fieldKey]: '' }))
                            return
                          }

                          const digits = val.replace(/\D/g, '')
                          if (digits.length >= 2) {
                            const code3 = digits.slice(0, 3).padStart(3, '0')
                            const exact = banks.find((b) => getBankCode3(b?.code ?? b?.ispb ?? '') === code3)
                            if (exact) {
                              setDynamicAnswers((prev) => ({ ...prev, [fieldKey]: `${code3}|${String(exact.name || '')}` }))
                            }
                          }
                        }}
                        onFocus={() => {
                          setFieldErrors((prev) => ({ ...prev, [fieldKey]: '' }))
                          setBankSearchByKey((prev) => ({ ...prev, [fieldKey]: prev[fieldKey] ?? selectedLabel }))
                          setBankDropdownKey(fieldKey)
                        }}
                        onBlur={() => {
                          setTimeout(() => setBankDropdownKey((cur) => (cur === fieldKey ? null : cur)), 150)

                          const current = String(bankSearchByKey[fieldKey] || '').trim()
                          if (!current) {
                            setFieldErrors((prev) => ({ ...prev, [fieldKey]: '' }))
                            return
                          }

                          // Exige seleção válida (code|name) ao sair do campo
                          const v = String((dynamicAnswers as any)[fieldKey] ?? '').trim()
                          const parts = v.includes('|') ? v.split('|') : []
                          const code = parts.length >= 2 ? String(parts[0] || '').trim() : ''
                          const name = parts.length >= 2 ? String(parts.slice(1).join('|') || '').trim() : ''
                          const isValid = code.length === 3 && !!name
                          if (!isValid) {
                            setDynamicAnswers((prev) => ({ ...prev, [fieldKey]: '' }))
                            setBankSearchByKey((prev) => ({ ...prev, [fieldKey]: '' }))
                            setFieldErrors((prev) => ({ ...prev, [fieldKey]: 'Selecione um banco na lista.' }))
                          } else {
                            setBankSearchByKey((prev) => ({ ...prev, [fieldKey]: '' }))
                          }
                        }}
                      />

                      {bankDropdownKey === fieldKey && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 'calc(100% + 6px)',
                            left: 0,
                            right: 0,
                            zIndex: 50,
                            background: '#0b1220',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: 10,
                            maxHeight: 260,
                            overflowY: 'auto',
                            boxShadow: '0 18px 40px rgba(0,0,0,0.55)',
                          }}
                        >
                          {filtered.slice(0, 30).map((b, idx) => {
                            const code3 = getBankCode3(b?.code ?? b?.ispb ?? '')
                            const labelOpt = `${code3} - ${String(b?.name || '')}`
                            return (
                              <button
                                key={`${fieldKey}_${code3}_${String(b?.ispb ?? '')}_${String(b?.name ?? '')}_${idx}`}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setDynamicAnswers((prev) => ({ ...prev, [fieldKey]: `${code3}|${String(b?.name || '')}` }))
                                  setBankSearchByKey((prev) => ({ ...prev, [fieldKey]: '' }))
                                  setBankDropdownKey(null)
                                  setFieldErrors((prev) => ({ ...prev, [fieldKey]: '' }))
                                }}
                                style={{
                                  width: '100%',
                                  textAlign: 'left',
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#e5e7eb',
                                  padding: '10px 12px',
                                  fontSize: '0.9rem',
                                  cursor: 'pointer',
                                }}
                              >
                                {labelOpt}
                              </button>
                            )
                          })}
                          {filtered.length === 0 && (
                            <div style={{ padding: '10px 12px', color: '#9ca3af', fontSize: '0.85rem' }}>
                              Nenhum banco encontrado.
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {!!fieldErrors[fieldKey] && (
                      <div style={{ marginTop: '0.4rem', color: '#f87171', fontSize: '0.78rem', fontWeight: 600 }}>
                        {fieldErrors[fieldKey]}
                      </div>
                    )}
                  </div>
                )
              }

              const options =
                field.options_source === 'ufs'
                    ? ufs.map((u) => ({
                        value: String(u.sigla || ''),
                        label: `${u.sigla}${u.nome ? ` - ${u.nome}` : ''}`,
                      }))
                    : (field.options || []).map((opt) => ({ value: opt, label: opt }))

              return (
                <div key={fieldKey} className="form-group">
                  <label className="onboarding-label" style={{ fontWeight: 800, color: '#fff' }}>
                    {label} {isRequired && <span style={{ color: accentColor }}>*</span>}
                  </label>
                  {description && (
                    <div style={{ marginTop: '-0.15rem', marginBottom: '0.5rem', color: '#9ca3af', fontStyle: 'italic', fontSize: '0.78rem' }}>
                      {description}
                    </div>
                  )}
                  <select
                    className="onboarding-input"
                    style={{ appearance: 'none', cursor: 'pointer' }}
                    required={isRequired}
                    value={selectValue}
                    onChange={(e) => setFieldAnswer(field, e.target.value)}
                  >
                    <option value="">Selecione uma opção...</option>
                    {options.map((opt) => (
                      <option key={`${fieldKey}_${opt.value}`} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )
            }

            if (field.type === 'file') {
              const uploadedUrl = dynamicAnswers[fieldKey]
              const isUploading = uploadingFiles[fieldKey]

              return (
                <div key={fieldKey} className="form-group" style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '12px', border: '1px dashed rgba(255,255,255,0.1)' }}>
                  <label className="onboarding-label" style={{ marginBottom: '0.35rem', color: '#fff', fontWeight: 800 }}>
                    {label} {isRequired && <span style={{ color: accentColor }}>*</span>}
                  </label>
                  {description && (
                    <div style={{ marginTop: '-0.15rem', marginBottom: '0.75rem', color: '#9ca3af', fontStyle: 'italic', fontSize: '0.78rem' }}>
                      {description}
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <label style={{ 
                      background: isUploading ? 'rgba(255,255,255,0.05)' : 'rgba(138, 43, 226, 0.1)',
                      border: '1px solid rgba(138, 43, 226, 0.3)',
                      color: isUploading ? '#9ca3af' : '#a855f7',
                      padding: '6px 16px',
                      borderRadius: '6px',
                      cursor: isUploading ? 'not-allowed' : 'pointer',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem'
                    }}>
                      {isUploading ? (
                        <>
                          <Loader2 size={14} className="spinner" />
                          Enviando...
                        </>
                      ) : (
                        <>
                          <Upload size={14} />
                          Escolher Arquivo
                        </>
                      )}
                      <input 
                        type="file" 
                        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                        style={{ display: 'none' }} 
                        disabled={isUploading}
                        onChange={e => {
                          const file = e.target.files?.[0]
                          if (file) handleFileUpload(fieldKey, file)
                          e.currentTarget.value = ''
                        }}
                      />
                    </label>

                    {uploadedUrl ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#10b981', fontSize: '0.8rem', fontWeight: 600 }}>
                        <CheckCircle size={14} />
                        <span>Documento anexado</span>
                      </div>
                    ) : (
                      <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Nenhum arquivo enviado (PDF, JPG ou PNG), máximo de 5MB.</span>
                    )}
                  </div>
                  {!!fieldErrors[fieldKey] && (
                    <div style={{ marginTop: '0.5rem', color: '#f87171', fontSize: '0.78rem', fontWeight: 600 }}>
                      {fieldErrors[fieldKey]}
                    </div>
                  )}
                </div>
              )
            }

            // default: text
            if (field.mask === 'bank_agency_with_digit' || field.mask === 'bank_account') {
              const maxDigits = field.mask === 'bank_agency_with_digit' ? 5 : 11
              const seq = String(bankFieldSeqByKey[fieldKey] || '').replace(/\D/g, '').slice(0, maxDigits)
              const formatted =
                field.mask === 'bank_agency_with_digit' ? formatBankAgencyWithDigitFromSeq(seq) : formatBankAccountFromSeq(seq)

              return (
                <div key={fieldKey} className="form-group" style={{ position: 'relative' }}>
                  <label className="onboarding-label" style={{ fontWeight: 800, color: '#fff' }}>
                    {label} {isRequired && <span style={{ color: accentColor }}>*</span>}
                  </label>
                  {description && (
                    <div style={{ marginTop: '-0.15rem', marginBottom: '0.5rem', color: '#9ca3af', fontStyle: 'italic', fontSize: '0.78rem' }}>
                      {description}
                    </div>
                  )}
                  <input
                    type="text"
                    className="onboarding-input"
                    required={isRequired}
                    placeholder={getPlaceholderForField(field)}
                  value={formatted}
                  inputMode="numeric"
                  style={fieldErrors[fieldKey] ? { borderColor: '#ef4444' } : undefined}
                  onChange={(e) => {
                    setFieldErrors((prev) => ({ ...prev, [fieldKey]: '' }))
                    const prevSeq = String(bankFieldSeqByKey[fieldKey] || '').replace(/\D/g, '').slice(0, maxDigits)
                    handleDigitSequenceChange(e, prevSeq, (nextSeq) => {
                      const cleaned = nextSeq.replace(/\D/g, '').slice(0, maxDigits)
                      setBankFieldSeqByKey((prev) => ({ ...prev, [fieldKey]: cleaned }))
                      setDynamicAnswers((answersPrev) => ({
                        ...answersPrev,
                        [fieldKey]:
                          field.mask === 'bank_agency_with_digit'
                            ? formatBankAgencyWithDigitFromSeq(cleaned)
                            : formatBankAccountFromSeq(cleaned),
                      }))
                    }, maxDigits)
                  }}
                  onFocus={() => {
                    setFieldErrors((prev) => ({ ...prev, [fieldKey]: '' }))
                    setBankFieldSeqByKey((prev) => {
                      const current = String(prev[fieldKey] || '').replace(/\D/g, '').slice(0, maxDigits)
                        if (current) return prev
                        const seeded = seedBankSeqFromValue(field.mask, value, maxDigits)
                        if (!seeded) return prev
                        return { ...prev, [fieldKey]: seeded }
                      })
                    }}
                    onKeyDown={(e) => {
                      setFieldErrors((prev) => ({ ...prev, [fieldKey]: '' }))
                      const prevSeq = String(bankFieldSeqByKey[fieldKey] || '').replace(/\D/g, '').slice(0, maxDigits)
                      handleDigitSequenceKeyDown(e, prevSeq, (nextSeq) => {
                        setBankFieldSeqByKey((prev) => ({ ...prev, [fieldKey]: nextSeq }))
                        setDynamicAnswers((answersPrev) => ({
                          ...answersPrev,
                          [fieldKey]:
                            field.mask === 'bank_agency_with_digit' ? formatBankAgencyWithDigitFromSeq(nextSeq) : formatBankAccountFromSeq(nextSeq),
                        }))
                      }, maxDigits)
                    }}
                    onPaste={(e) => {
                      setFieldErrors((prev) => ({ ...prev, [fieldKey]: '' }))
                      const prevSeq = String(bankFieldSeqByKey[fieldKey] || '').replace(/\D/g, '').slice(0, maxDigits)
                      handleDigitSequencePaste(e, prevSeq, (nextSeq) => {
                        setBankFieldSeqByKey((prev) => ({ ...prev, [fieldKey]: nextSeq }))
                        setDynamicAnswers((answersPrev) => ({
                          ...answersPrev,
                          [fieldKey]:
                            field.mask === 'bank_agency_with_digit' ? formatBankAgencyWithDigitFromSeq(nextSeq) : formatBankAccountFromSeq(nextSeq),
                        }))
                      }, maxDigits)
                    }}
                    onBlur={() => {
                      const check = validateMaskedValue(field.mask, formatted)
                      if (!check.ok) {
                        setDynamicAnswers((prev) => ({ ...prev, [fieldKey]: '' }))
                        setBankFieldSeqByKey((prev) => ({ ...prev, [fieldKey]: '' }))
                        setFieldErrors((prev) => ({ ...prev, [fieldKey]: check.reason || 'Valor inválido' }))
                      }
                    }}
                  />
                  {!!fieldErrors[fieldKey] && (
                    <div style={{ marginTop: '0.4rem', color: '#f87171', fontSize: '0.78rem', fontWeight: 600 }}>
                      {fieldErrors[fieldKey]}
                    </div>
                  )}
                </div>
              )
            }

            return (
              <div key={fieldKey} className="form-group" style={{ position: 'relative' }}>
                <label className="onboarding-label" style={{ fontWeight: 800, color: '#fff' }}>
                  {label} {isRequired && <span style={{ color: accentColor }}>*</span>}
                </label>
                {description && (
                  <div style={{ marginTop: '-0.15rem', marginBottom: '0.5rem', color: '#9ca3af', fontStyle: 'italic', fontSize: '0.78rem' }}>
                    {description}
                  </div>
                )}
                <input
                  type={field.mask === 'email' ? 'email' : 'text'}
                  className="onboarding-input"
                  required={isRequired}
                  placeholder={getPlaceholderForField(field)}
                  value={applyMask(field.mask, value)}
                  onChange={(e) => setFieldAnswer(field, e.target.value)}
                  onFocus={() => setFieldErrors((prev) => ({ ...prev, [fieldKey]: '' }))}
                  onBlur={() => {
                    // Auto-completa agência sem dígito com "0" no final (0000-0)
                    if (field.mask === 'bank_agency_with_digit') {
                      setBankFieldSeqByKey((prev) => {
                        const seq = String(prev[fieldKey] || '').replace(/\D/g, '').slice(0, 5)
                        if (seq.length === 4) {
                          const nextSeq = `${seq}0`
                          setDynamicAnswers((answersPrev) => ({ ...answersPrev, [fieldKey]: formatBankAgencyWithDigitFromSeq(nextSeq) }))
                          return { ...prev, [fieldKey]: nextSeq }
                        }
                        return prev
                      })
                    }

                    // Valida máscaras: não permite valor parcial
                    if (field.mask && String(field.mask) !== 'none') {
                      const masked = applyMask(field.mask, value)
                      const hasSomething = String(masked || '').trim() !== ''
                      if (hasSomething) {
                        const check = validateMaskedValue(field.mask, masked)
                        if (!check.ok) {
                          setDynamicAnswers((prev) => ({ ...prev, [fieldKey]: '' }))
                          setFieldErrors((prev) => ({ ...prev, [fieldKey]: check.reason || 'Valor inválido' }))
                        }
                      }
                    }
                  }}
                  style={fieldErrors[fieldKey] ? { borderColor: '#ef4444' } : undefined}
                />
                {!!fieldErrors[fieldKey] && field.mask !== 'bank_agency_with_digit' && field.mask !== 'bank_account' && (
                  <div style={{ marginTop: '0.4rem', color: '#f87171', fontSize: '0.78rem', fontWeight: 600 }}>
                    {fieldErrors[fieldKey]}
                  </div>
                )}
                {field.system_key === 'cpf_cnpj' && String(field.mask) === 'cnpj' && searchingCNPJ && (
                  <Loader2 size={16} className="spinner" style={{ position: 'absolute', right: '12px', bottom: '12px', color: primaryColor }} />
                )}
                {((field.system_key === 'cpf_cnpj' && String(field.mask) === 'cpf') || (field.system_key === 'partner_1_cpf' && String(field.mask) === 'cpf') || (field.system_key === 'partner_2_cpf' && String(field.mask) === 'cpf')) && searchingCPF && (
                  <Loader2 size={16} className="spinner" style={{ position: 'absolute', right: '12px', bottom: '12px', color: primaryColor }} />
                )}
                {field.system_key === 'cep' && String(field.mask) === 'cep' && searchingCEP && (
                  <Loader2 size={16} className="spinner" style={{ position: 'absolute', right: '12px', bottom: '12px', color: primaryColor }} />
                )}
              </div>
            )
          })}
        </div>

        {isPixDivergent && (
          <div style={{ marginTop: '1rem', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', color: '#fbbf24', padding: '0.75rem 1rem', borderRadius: '8px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertCircle size={16} />
            <span><strong>Atenção:</strong> A chave PIX informada é diferente do CPF/CNPJ de cadastro. Verifique antes de submeter!</span>
          </div>
        )}
      </>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(circle at 10% 20%, #1e1b4b 0%, #090514 100%)',
      fontFamily: "'Montserrat', sans-serif",
      color: '#f3f4f6',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem 1rem'
    }}>
      {/* Import Montserrat dynamically */}
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap');
        
        .onboarding-card {
          background: rgba(255, 255, 255, 0.03);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.07);
          border-radius: 20px;
          padding: 2.5rem;
          width: 100%;
          max-width: 900px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        }
        .gradient-text {
          background: linear-gradient(135deg, var(--onb-accent, #FF2D6D) 0%, var(--onb-primary, #8A2BE2) 50%, #2D7CFF 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .onboarding-btn {
          background: linear-gradient(135deg, var(--onb-accent, #FF2D6D) 0%, var(--onb-primary, #8A2BE2) 100%);
          color: white;
          border: none;
          padding: 0.85rem 2rem;
          border-radius: 50px;
          font-weight: 700;
          font-size: 0.95rem;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          alignItems: center;
          gap: 0.5rem;
          box-shadow: 0 4px 15px rgba(255, 45, 109, 0.3);
        }
        .onboarding-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(255, 45, 109, 0.5);
        }
        .onboarding-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }
        .form-section-title {
          font-size: 1.1rem;
          font-weight: 700;
          color: #fff;
          border-bottom: 2px solid rgba(255, 255, 255, 0.05);
          padding-bottom: 0.5rem;
          margin: 2rem 0 1rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .onboarding-input {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: white;
          padding: 0.75rem 1rem;
          width: 100%;
          font-size: 0.9rem;
          outline: none;
          transition: all 0.2s ease;
        }
        .onboarding-input option {
          background: #111827;
          color: #ffffff;
        }
        .onboarding-input:focus {
          border-color: var(--onb-primary, #8A2BE2);
          background: rgba(255, 255, 255, 0.08);
          box-shadow: 0 0 0 3px rgba(138, 43, 226, 0.2);
        }
        .onboarding-label {
          display: block;
          font-size: 0.8rem;
          font-weight: 600;
          color: #9ca3af;
          margin-bottom: 0.4rem;
        }
        .onboarding-card p {
          text-align: justify;
          text-justify: inter-word;
        }
        .grid-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.25rem;
        }
        .grid-3 {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 1.25rem;
        }
        @media (max-width: 640px) {
          .grid-2, .grid-3 {
            grid-template-columns: 1fr;
          }
        }
      `}} />

      {/* STEP 1: LGPD TERM */}
      {step === 'lgpd' && (
        <div className="onboarding-card" style={{ maxWidth: '600px', textAlign: 'center' }}>
          {logoUrl && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrl} alt="Logo" style={{ maxHeight: 56, maxWidth: 220, objectFit: 'contain' }} />
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
            <div style={{ 
              background: `linear-gradient(135deg, ${accentColor} 0%, ${primaryColor} 100%)`, 
              padding: '1.25rem', 
              borderRadius: '50%',
              boxShadow: '0 8px 24px rgba(255, 45, 109, 0.3)'
            }}>
              <Lock size={36} color="white" />
            </div>
          </div>

          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: '0 0 0.75rem 0' }}>
            {introTitle}
          </h2>
          <p style={{ color: '#9ca3af', fontSize: '0.9rem', lineHeight: '1.6', margin: '0 0 2rem 0' }}>
            {introText}
          </p>

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button
              className="onboarding-btn"
              onClick={() => setStep('form')}
              style={{ background: `linear-gradient(135deg, ${accentColor} 0%, ${primaryColor} 100%)` }}
            >
              {introStartLabel}
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: FORM */}
      {step === 'form' && (
        <div className="onboarding-card">
          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '1.5rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>
                <span className="gradient-text">{introTitle}</span>
              </h2>
              <p style={{ color: '#9ca3af', fontSize: '0.85rem', margin: '0.25rem 0 0 0' }}>
                Preencha todos os campos para envio dos dados comerciais e bancários
              </p>
            </div>
            
            {/* Person Type Switch */}
            {!isSchemaV2 && (
              <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '30px', padding: '4px' }}>
                <button 
                  type="button"
                  onClick={() => { setPersonType('PJ'); setCpfCnpj('') }}
                  style={{ 
                    border: 'none', 
                    background: personType === 'PJ' ? `linear-gradient(135deg, ${accentColor} 0%, ${primaryColor} 100%)` : 'transparent',
                    color: 'white',
                    fontWeight: 600,
                    fontSize: '0.8rem',
                    padding: '6px 16px',
                    borderRadius: '20px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                >
                  Pessoa Jurídica (PJ)
                </button>
                <button 
                  type="button"
                  onClick={() => { setPersonType('PF'); setCpfCnpj('') }}
                  style={{ 
                    border: 'none', 
                    background: personType === 'PF' ? `linear-gradient(135deg, ${accentColor} 0%, ${primaryColor} 100%)` : 'transparent',
                    color: 'white',
                    fontWeight: 600,
                    fontSize: '0.8rem',
                    padding: '6px 16px',
                    borderRadius: '20px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                >
                  Pessoa Física (PF)
                </button>
              </div>
            )}
          </div>

          {submitError && (
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#f87171', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertCircle size={16} />
              <span>{submitError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {isSchemaV2 ? (
              renderSchemaV2Fields()
            ) : (
              <>

            {/* 1. DADOS DE IDENTIFICAÇÃO */}
            <div className="form-section-title">
              <User size={18} className="gradient-text" />
              1. Identificação do Parceiro
            </div>

            <div className="grid-2">
              <div className="form-group" style={{ position: 'relative' }}>
                <label className="onboarding-label">{personType === 'PJ' ? 'CNPJ' : 'CPF'}</label>
                <input 
                  type="text" 
                  className="onboarding-input" 
                  required
                  placeholder={personType === 'PJ' ? '00.000.000/0000-00' : '000.000.000-00'}
                  value={cpfCnpj}
                  onChange={e => {
                    const val = e.target.value
                    setCpfCnpj(val)
                    if (personType === 'PJ') searchCNPJ(val)
                    if (personType === 'PF') searchCPF(val, { targetSystemKey: 'cpf_cnpj' })
                  }}
                />
                {(searchingCNPJ || (personType === 'PF' && searchingCPF)) && (
                  <Loader2 size={16} className="spinner" style={{ position: 'absolute', right: '12px', bottom: '12px', color: primaryColor }} />
                )}
              </div>

              <div className="form-group">
                <label className="onboarding-label">{personType === 'PJ' ? 'Razão Social' : 'Nome Completo'}</label>
                <input 
                  type="text" 
                  className="onboarding-input" 
                  required
                  placeholder="Nome do parceiro comercial"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>
            </div>

            {personType === 'PJ' && (
              <div className="grid-2" style={{ marginTop: '1.25rem' }}>
                <div className="form-group">
                  <label className="onboarding-label">Nome Fantasia</label>
                  <input 
                    type="text" 
                    className="onboarding-input" 
                    placeholder="Nome da marca ou comercial"
                    value={fantasyName}
                    onChange={e => setFantasyName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="onboarding-label">Representante Legal (Sócio Administrador)</label>
                  <input 
                    type="text" 
                    className="onboarding-input" 
                    placeholder="Nome do representante legal"
                    value={representanteLegal}
                    onChange={e => setRepresentanteLegal(e.target.value)}
                  />
                </div>
              </div>
            )}

            {personType === 'PF' && (
              <div className="grid-2" style={{ marginTop: '1.25rem' }}>
                <div className="form-group">
                  <label className="onboarding-label">RG</label>
                  <input 
                    type="text" 
                    className="onboarding-input" 
                    placeholder="Número do documento"
                    value={rg}
                    onChange={e => setRg(e.target.value)}
                  />
                </div>
                <div className="grid-3">
                  <div className="form-group">
                    <label className="onboarding-label">Data Expedição</label>
                    <input 
                      type="date" 
                      className="onboarding-input" 
                      value={rgExpeditionDate}
                      onChange={e => setRgExpeditionDate(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="onboarding-label">Órgão Emissor</label>
                    <input 
                      type="text" 
                      className="onboarding-input" 
                      placeholder="SSP"
                      value={rgIssuer}
                      onChange={e => setRgIssuer(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="onboarding-label">UF Emissão</label>
                    <input 
                      type="text" 
                      className="onboarding-input" 
                      maxLength={2}
                      placeholder="SP"
                      value={rgState}
                      onChange={e => setRgState(e.target.value.toUpperCase())}
                    />
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginTop: '1.25rem' }}>
              <div className="form-group" style={{ maxWidth: '50%' }}>
                <label className="onboarding-label">Data de Nascimento</label>
                <input 
                  type="date" 
                  className="onboarding-input" 
                  required
                  value={birthDate}
                  onChange={e => setBirthDate(e.target.value)}
                />
              </div>
            </div>

            {/* 2. CONTATOS E E-MAILS */}
            <div className="form-section-title">
              <Building2 size={18} className="gradient-text" />
              2. Canais de Contato
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="onboarding-label">WhatsApp Celular (Principal)</label>
                <input 
                  type="text" 
                  className="onboarding-input" 
                  required
                  placeholder="DDD + Número"
                  value={phoneWhatsapp}
                  onChange={e => setPhoneWhatsapp(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="onboarding-label">E-mail para Recebimento de Comissões</label>
                <input 
                  type="email" 
                  className="onboarding-input" 
                  required
                  placeholder="seuemail@provedor.com"
                  value={emailComissao}
                  onChange={e => setEmailComissao(e.target.value)}
                />
              </div>
            </div>

            <div className="grid-2" style={{ marginTop: '1.25rem' }}>
              <div className="form-group">
                <label className="onboarding-label">E-mail para Formalização</label>
                <input 
                  type="email" 
                  className="onboarding-input" 
                  placeholder="formalizacao@empresa.com"
                  value={emailFormalizacao}
                  onChange={e => setEmailFormalizacao(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="onboarding-label">WhatsApp Financeiro (Opcional)</label>
                <input 
                  type="text" 
                  className="onboarding-input" 
                  placeholder="DDD + Número"
                  value={phoneWhatsappFinanceiro}
                  onChange={e => setPhoneWhatsappFinanceiro(e.target.value)}
                />
              </div>
            </div>

            {/* 3. ENDEREÇO */}
            <div className="form-section-title">
              <MapPin size={18} className="gradient-text" />
              3. Endereço Comercial
            </div>

            <div className="grid-3">
              <div className="form-group" style={{ position: 'relative' }}>
                <label className="onboarding-label">CEP</label>
                <input 
                  type="text" 
                  className="onboarding-input" 
                  required
                  placeholder="00000-000"
                  value={cep}
                  onChange={e => {
                    const val = e.target.value
                    setCep(val)
                    searchCEP(val, { targetSystemKey: 'cep', force: true })
                  }}
                />
                {searchingCEP && (
                  <Loader2 size={16} className="spinner" style={{ position: 'absolute', right: '12px', bottom: '12px', color: primaryColor }} />
                )}
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="onboarding-label">Rua / Avenida</label>
                <input 
                  type="text" 
                  className="onboarding-input" 
                  required
                  value={addressStreet}
                  onChange={e => setAddressStreet(e.target.value)}
                />
              </div>
            </div>

            <div className="grid-3" style={{ marginTop: '1.25rem' }}>
              <div className="form-group">
                <label className="onboarding-label">Número</label>
                <input 
                  type="text" 
                  className="onboarding-input" 
                  required
                  value={addressNumber}
                  onChange={e => setAddressNumber(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="onboarding-label">Complemento</label>
                <input 
                  type="text" 
                  className="onboarding-input" 
                  value={addressComplement}
                  onChange={e => setAddressComplement(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="onboarding-label">Bairro</label>
                <input 
                  type="text" 
                  className="onboarding-input" 
                  required
                  value={addressNeighborhood}
                  onChange={e => setAddressNeighborhood(e.target.value)}
                />
              </div>
            </div>

            <div className="grid-2" style={{ marginTop: '1.25rem' }}>
              <div className="form-group">
                <label className="onboarding-label">Cidade</label>
                <input 
                  type="text" 
                  className="onboarding-input" 
                  required
                  value={addressCity}
                  onChange={e => setAddressCity(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="onboarding-label">Estado (UF)</label>
                <select
                  className="onboarding-input"
                  style={{ appearance: 'none', cursor: 'pointer' }}
                  required
                  value={addressState}
                  onChange={e => setAddressState(e.target.value)}
                >
                  <option value="">Selecione...</option>
                  {ufs.map((u) => (
                    <option key={u.sigla} value={u.sigla}>
                      {u.sigla}{u.nome ? ` - ${u.nome}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 4. DADOS BANCÁRIOS */}
            <div className="form-section-title">
              <CreditCard size={18} className="gradient-text" />
              4. Dados de Pagamento (Comissões)
            </div>

            <div className="grid-3">
              <div className="form-group">
                <label className="onboarding-label">Tipo de Recebimento</label>
                <select 
                  className="onboarding-input"
                  style={{ appearance: 'none', cursor: 'pointer' }}
                  value={commissionReceiveType}
                  onChange={e => setCommissionReceiveType(e.target.value)}
                >
                  <option value="PIX">PIX</option>
                  <option value="TED">Conta Bancária (TED/Doc)</option>
                </select>
              </div>
               <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="onboarding-label">Banco</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    className="onboarding-input"
                    required
                    placeholder="Digite o código do banco, parte do nome ou escolha uma opção na lista."
                    value={bankSearch || (bankCode ? `${String(bankCode).padStart(3, '0')} - ${bankName}` : '')}
                    onChange={(e) => {
                      const val = e.target.value
                      setBankSearch(val)
                      setShowBankDropdown(true)

                      const digits = val.replace(/\D/g, '')
                      if (digits) {
                        const code3 = digits.slice(0, 3).padStart(3, '0')
                        const exact = banks.find((b) => getBankCode3(b?.code ?? b?.ispb ?? '') === code3)
                        if (exact) {
                          setBankCode(code3)
                          setBankName(String(exact.name || ''))
                        }
                      }
                    }}
                    onFocus={() => setShowBankDropdown(true)}
                    onBlur={() => setTimeout(() => setShowBankDropdown(false), 150)}
                  />

                  {showBankDropdown && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        left: 0,
                        right: 0,
                        zIndex: 50,
                        background: '#0b1220',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 10,
                        maxHeight: 260,
                        overflowY: 'auto',
                        boxShadow: '0 18px 40px rgba(0,0,0,0.55)',
                      }}
                    >
                      {getFilteredBanks(bankSearch).slice(0, 30).map((b) => {
                        const code3 = getBankCode3(b?.code ?? b?.ispb ?? '')
                        const label = `${code3} - ${String(b?.name || '')}`
                        return (
                          <button
                            key={String(b?.code ?? b?.ispb ?? label)}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setBankCode(code3)
                              setBankName(String(b?.name || ''))
                              setBankSearch('')
                              setShowBankDropdown(false)
                            }}
                            style={{
                              width: '100%',
                              textAlign: 'left',
                              background: 'transparent',
                              border: 'none',
                              color: '#e5e7eb',
                              padding: '10px 12px',
                              fontSize: '0.9rem',
                              cursor: 'pointer',
                            }}
                          >
                            {label}
                          </button>
                        )
                      })}
                      {getFilteredBanks(bankSearch).length === 0 && (
                        <div style={{ padding: '10px 12px', color: '#9ca3af', fontSize: '0.85rem' }}>
                          Nenhum banco encontrado.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid-3" style={{ marginTop: '1.25rem' }}>
              <div className="form-group">
                <label className="onboarding-label">Agência</label>
                <input 
                  type="text" 
                  className="onboarding-input" 
                  placeholder="1234-5"
                  value={formatBankAgencyWithDigitFromSeq(bankAgencySeq)}
                  inputMode="numeric"
                  onChange={(e) => {
                    handleDigitSequenceChange(e, bankAgencySeq, (nextSeq) => {
                      const seq = nextSeq.replace(/\D/g, '').slice(0, 5)
                      setBankAgencySeq(seq)
                      setBankAgency(formatBankAgencyWithDigitFromSeq(seq))
                    }, 5)
                  }}
                  onKeyDown={(e) => {
                    handleDigitSequenceKeyDown(e, bankAgencySeq, (nextSeq) => {
                      const seq = nextSeq.replace(/\D/g, '').slice(0, 5)
                      setBankAgencySeq(seq)
                      setBankAgency(formatBankAgencyWithDigitFromSeq(seq))
                    }, 5)
                  }}
                  onPaste={(e) => {
                    handleDigitSequencePaste(e, bankAgencySeq, (nextSeq) => {
                      const seq = nextSeq.replace(/\D/g, '').slice(0, 5)
                      setBankAgencySeq(seq)
                      setBankAgency(formatBankAgencyWithDigitFromSeq(seq))
                    }, 5)
                  }}
                />
              </div>
              <div className="form-group">
                <label className="onboarding-label">Conta com Dígito</label>
                <input 
                  type="text" 
                  className="onboarding-input" 
                  placeholder="12345-6"
                  value={formatBankAccountFromSeq(bankAccountSeq)}
                  inputMode="numeric"
                  onChange={(e) => {
                    handleDigitSequenceChange(e, bankAccountSeq, (nextSeq) => {
                      const seq = nextSeq.replace(/\D/g, '').slice(0, 11)
                      setBankAccountSeq(seq)
                      setBankAccount(formatBankAccountFromSeq(seq))
                    }, 11)
                  }}
                  onKeyDown={(e) => {
                    handleDigitSequenceKeyDown(e, bankAccountSeq, (nextSeq) => {
                      const seq = nextSeq.replace(/\D/g, '').slice(0, 11)
                      setBankAccountSeq(seq)
                      setBankAccount(formatBankAccountFromSeq(seq))
                    }, 11)
                  }}
                  onPaste={(e) => {
                    handleDigitSequencePaste(e, bankAccountSeq, (nextSeq) => {
                      const seq = nextSeq.replace(/\D/g, '').slice(0, 11)
                      setBankAccountSeq(seq)
                      setBankAccount(formatBankAccountFromSeq(seq))
                    }, 11)
                  }}
                />
              </div>
              <div className="form-group">
                <label className="onboarding-label">Tipo de Conta</label>
                <select 
                  className="onboarding-input"
                  style={{ appearance: 'none', cursor: 'pointer' }}
                  value={bankAccountType}
                  onChange={e => setBankAccountType(e.target.value)}
                >
                  <option value="Corrente">Conta Corrente</option>
                  <option value="Poupança">Conta Poupança</option>
                </select>
              </div>
            </div>

            {commissionReceiveType === 'PIX' && (
              <div className="grid-2" style={{ marginTop: '1.25rem', alignItems: 'end' }}>
                <div className="form-group">
                  <label className="onboarding-label">Tipo de Chave PIX</label>
                  <select 
                    className="onboarding-input"
                    style={{ appearance: 'none', cursor: 'pointer' }}
                    value={pixType}
                    onChange={e => setPixType(e.target.value)}
                  >
                    <option value="CPF">CPF</option>
                    <option value="CNPJ">CNPJ</option>
                    <option value="EMAIL">E-mail</option>
                    <option value="CELULAR">WhatsApp/Celular</option>
                    <option value="CHAVE_ALEATORIA">Chave Aleatória</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="onboarding-label">Chave PIX</label>
                  <input 
                    type="text" 
                    className="onboarding-input" 
                    required
                    placeholder="Digite a chave pix"
                    value={pixKey}
                    onChange={e => setPixKey(e.target.value)}
                  />
                </div>
              </div>
            )}

            {isPixDivergent && (
              <div style={{ marginTop: '1rem', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', color: '#fbbf24', padding: '0.75rem 1rem', borderRadius: '8px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <AlertCircle size={16} />
                <span><strong>Atenção:</strong> A chave PIX informada é diferente do CPF/CNPJ de cadastro. Verifique antes de submeter!</span>
              </div>
            )}

            {/* 5. CAMPOS DINÂMICOS DO CONSTRUTOR DE FORMULÁRIO */}
            {formSchema.length > 0 && (
              <>
                <div className="form-section-title">
                  <FileText size={18} className="gradient-text" />
                  5. Informações e Anexos Adicionais
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {formSchema.map((field) => {
                    const isRequired = field.required
                    const fieldKey = field.key || field.id

                    if (field.type === 'text') {
                      return (
                        <div key={fieldKey} className="form-group">
                          <label className="onboarding-label">
                            {field.label} {isRequired && <span style={{ color: accentColor }}>*</span>}
                          </label>
                          <input 
                            type="text" 
                            className="onboarding-input" 
                            required={isRequired}
                            placeholder={field.placeholder || ''}
                            value={dynamicAnswers[fieldKey] || ''}
                            onChange={e => setDynamicAnswers({ ...dynamicAnswers, [fieldKey]: e.target.value })}
                          />
                        </div>
                      )
                    }

                    if (field.type === 'select') {
                      return (
                        <div key={fieldKey} className="form-group">
                          <label className="onboarding-label">
                            {field.label} {isRequired && <span style={{ color: accentColor }}>*</span>}
                          </label>
                          <select 
                            className="onboarding-input"
                            style={{ appearance: 'none', cursor: 'pointer' }}
                            required={isRequired}
                            value={dynamicAnswers[fieldKey] || ''}
                            onChange={e => setDynamicAnswers({ ...dynamicAnswers, [fieldKey]: e.target.value })}
                          >
                            <option value="">Selecione uma opção...</option>
                            {field.options?.map((opt: string) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </div>
                      )
                    }

                    if (field.type === 'file') {
                      const uploadedUrl = dynamicAnswers[fieldKey]
                      const isUploading = uploadingFiles[fieldKey]

                      return (
                        <div key={fieldKey} className="form-group" style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '12px', border: '1px dashed rgba(255,255,255,0.1)' }}>
                          <label className="onboarding-label" style={{ marginBottom: '0.5rem', color: '#fff' }}>
                            {field.label} {isRequired && <span style={{ color: accentColor }}>*</span>}
                          </label>
                          
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <label style={{ 
                              background: isUploading ? 'rgba(255,255,255,0.05)' : 'rgba(138, 43, 226, 0.1)',
                              border: '1px solid rgba(138, 43, 226, 0.3)',
                              color: isUploading ? '#9ca3af' : '#a855f7',
                              padding: '6px 16px',
                              borderRadius: '6px',
                              cursor: isUploading ? 'not-allowed' : 'pointer',
                              fontSize: '0.85rem',
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.35rem'
                            }}>
                              {isUploading ? (
                                <>
                                  <Loader2 size={14} className="spinner" />
                                  Enviando...
                                </>
                              ) : (
                                <>
                                  <Upload size={14} />
                                  Escolher Arquivo
                                </>
                              )}
                              <input 
                                type="file" 
                                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                                style={{ display: 'none' }} 
                                disabled={isUploading}
                                onChange={e => {
                                  const file = e.target.files?.[0]
                                  if (file) handleFileUpload(fieldKey, file)
                                  e.currentTarget.value = ''
                                }}
                              />
                            </label>

                            {uploadedUrl ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#10b981', fontSize: '0.8rem', fontWeight: 600 }}>
                                <CheckCircle size={14} />
                                <span>Documento anexado</span>
                              </div>
                            ) : (
                              <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Nenhum arquivo enviado (PDF, JPG ou PNG), máximo de 5MB.</span>
                            )}
                          </div>
                          {!!fieldErrors[fieldKey] && (
                            <div style={{ marginTop: '0.5rem', color: '#f87171', fontSize: '0.78rem', fontWeight: 600 }}>
                              {fieldErrors[fieldKey]}
                            </div>
                          )}
                        </div>
                      )
                    }

                    return null
                  })}
                </div>
              </>
            )}

              </>
            )}

            {/* SUBMIT BUTTON */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2.5rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1.5rem' }}>
              <button 
                type="submit" 
                className="onboarding-btn" 
                disabled={submitting || Object.values(uploadingFiles).some(Boolean)}
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="spinner" />
                    Enviando Cadastro...
                  </>
                ) : (
                  <>
                    <Check size={16} />
                    {finishLabel}
                  </>
                )}
              </button>
            </div>

          </form>
        </div>
      )}

      {/* STEP 3: SUCCESS */}
      {step === 'success' && (
        <div className="onboarding-card" style={{ maxWidth: '550px', textAlign: 'center', padding: '3.5rem 2.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
            <div style={{ 
              background: '#10b981', 
              padding: '1.25rem', 
              borderRadius: '50%',
              boxShadow: '0 8px 24px rgba(16, 185, 129, 0.3)',
              animation: 'scaleUp 0.3s ease-out'
            }}>
              <Check size={40} color="white" strokeWidth={3} />
            </div>
          </div>

          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: '0 0 0.75rem 0', color: 'white' }}>
            {closingTitle}
          </h2>
          <p style={{ color: '#10B981', fontWeight: 600, fontSize: '0.95rem', marginBottom: '1.5rem' }}>
            {closingLead}
          </p>

          <p style={{ color: '#9ca3af', fontSize: '0.9rem', lineHeight: '1.6', margin: '0 0 2.5rem 0' }}>
            {closingParagraphs.length > 0 ? (
              closingParagraphs.map((paragraph, idx) => (
                <span key={idx}>
                  {paragraph}
                  {idx < closingParagraphs.length - 1 && (
                    <>
                      <br />
                      <br />
                    </>
                  )}
                </span>
              ))
            ) : (
              <span />
            )}
          </p>

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <a 
              href={closingButtonUrl} 
              style={{ 
                textDecoration: 'none',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#fff',
                padding: '0.75rem 2rem',
                borderRadius: '50px',
                fontWeight: 700,
                fontSize: '0.9rem',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
              onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
            >
              {closingButtonLabel}
            </a>
          </div>
        </div>
      )}

    </div>
  )
}
