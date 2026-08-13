import { siMercadopago, siNeon, siNubank, siPicpay } from 'simple-icons'

export type BankLookup = {
  code?: number | string
  name?: string
  fullName?: string
  ispb?: string
}

export type BankAccountType = 'Corrente' | 'Poupança'
export type PixKeyType = 'cnpj' | 'phone' | 'email' | 'bank' | 'random'

export type CompanyBankAccount = {
  id: string
  name: string
  bank_code: string
  bank_name: string
  bank_ispb: string
  bank_full_name: string
  bank_logo_data_url: string
  bank_agency: string
  bank_account: string
  bank_account_type: BankAccountType
  pix_type: PixKeyType
  pix_key: string
  is_principal: boolean
}

export type CompanyDataWithBankAccounts = Record<string, any> & {
  bank_accounts?: Array<Partial<CompanyBankAccount> & Record<string, any>> | null
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `bank-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function onlyDigits(value: string) {
  return String(value || '').replace(/\D/g, '')
}

export function maskCnpj(value: string) {
  const v = onlyDigits(value).slice(0, 14)
  return v
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

export function maskCpf(value: string) {
  const v = onlyDigits(value).slice(0, 11)
  return v
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2')
}

export function maskCep(value: string) {
  const v = onlyDigits(value).slice(0, 8)
  return v.replace(/^(\d{5})(\d)/, '$1-$2')
}

export function maskPhone(value: string) {
  const v = onlyDigits(value).slice(0, 11)
  if (v.length <= 10) return v.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
  return v.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2')
}

export function maskEmailInput(value: string) {
  const raw = String(value || '').toLowerCase().replace(/\s+/g, '')
  return raw
}

export function formatUuidValue(value: string) {
  const hex = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase().slice(0, 32)
  if (!hex) return ''
  if (hex.length <= 8) return hex
  if (hex.length <= 12) return `${hex.slice(0, 8)}-${hex.slice(8)}`
  if (hex.length <= 16) return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12)}`
  if (hex.length <= 20) return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16)}`
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function maskUuidInput(value: string) {
  const raw = String(value || '').toUpperCase().replace(/[^0-9A-F-]/g, '')
  const withoutHyphens = raw.replace(/-/g, '')
  return formatUuidValue(withoutHyphens)
}

export function normalizePixKeyValue(value: string, type: string, companyCnpj = '') {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (type === 'cnpj') return maskCnpj(companyCnpj || raw)
  if (type === 'bank') return 'Dados Bancários cadastrados'
  if (type === 'phone') return maskPhone(raw)
  if (type === 'random') return formatUuidValue(raw)
  if (type === 'email') return maskEmailInput(raw)
  return raw
}

export function normalizeAgencyValue(value: string) {
  const digits = onlyDigits(value).slice(0, 5).padStart(5, '0')
  return `${digits.slice(0, 4)}-${digits.slice(4)}`
}

export function normalizeAccountValue(value: string) {
  const digits = onlyDigits(value).slice(0, 11).padStart(11, '0')
  return `${digits.slice(0, 10)}-${digits.slice(10)}`
}

export function formatBankAgencyWithDigitFromSeq(seq: string): string {
  const d = String(seq || '').replace(/\D/g, '').slice(0, 5)
  if (!d) return ''
  if (d.length <= 4) {
    const core = d.padStart(4, '0')
    return `${core}-0`
  }
  return `${d.slice(0, 4)}-${d.slice(4)}`
}

export function formatBankAccountFromSeq(seq: string): string {
  const d = String(seq || '').replace(/\D/g, '').slice(-11)
  if (!d) return ''
  const dv = d.slice(-1)
  const core = d.slice(0, -1).slice(-10).padStart(10, '0')
  return `${core}-${dv}`
}

export function parseBankAgencySeq(value: string) {
  // Keep only the meaningful digits so masked placeholders like 0000-0 do not
  // make the field start "full" and block further typing.
  const digits = onlyDigits(value).slice(0, 5)
  return digits.replace(/^0+/, '')
}

export function parseBankAccountSeq(value: string) {
  // Same rule for account numbers: return the editable sequence, not the
  // fully padded display string.
  const digits = onlyDigits(value).slice(0, 11)
  return digits.replace(/^0+/, '')
}

export function getBankCode3(code: any): string {
  const raw = String(code ?? '').replace(/\D/g, '')
  if (!raw) return ''
  return raw.slice(0, 3).padStart(3, '0')
}

export function formatBankLabel(bank: BankLookup) {
  const code = getBankCode3(bank.code)
  const name = String(bank.name || bank.fullName || '').trim()

  if (!code && !name) return ''
  if (code && name) return `${code} - ${name}`
  return code || name
}

export function getBankBrandIcon(bankCode?: string, bankName?: string) {
  const code = String(bankCode || '').trim()
  const name = String(bankName || '').trim().toLowerCase()
  const slug = `${code} ${name}`

  if (/(260|nubank)/.test(slug)) return siNubank
  if (/(735|neon)/.test(slug)) return siNeon
  if (/(380|pic\s?pay)/.test(slug)) return siPicpay
  if (/(323|mercado\s*pago|mercadopago)/.test(slug)) return siMercadopago

  return null
}

export function normalizeBankAccount(input: Partial<CompanyBankAccount> & Record<string, any>, index = 0): CompanyBankAccount {
  const agency = parseBankAgencySeq(String(input.bank_agency ?? input.agency_seq ?? ''))
  const account = parseBankAccountSeq(String(input.bank_account ?? input.account_seq ?? ''))
  const pixTypeRaw = String(input.pix_type || '').toLowerCase()
  const pixType: PixKeyType =
    pixTypeRaw === 'phone' || pixTypeRaw === 'celular'
      ? 'phone'
      : pixTypeRaw === 'email'
        ? 'email'
        : pixTypeRaw === 'bank' || pixTypeRaw === 'dados_bancarios' || pixTypeRaw === 'dados bancarios'
          ? 'bank'
          : pixTypeRaw === 'random' || pixTypeRaw === 'aleatoria' || pixTypeRaw === 'uuid'
            ? 'random'
            : 'cnpj'

  const logo = String(input.bank_logo_data_url || input.bank_logo_url || '').trim()

  return {
    id: String(input.id || createId() || `bank-${index}`),
    name: String(input.name || ''),
    bank_code: String(input.bank_code || '').trim(),
    bank_name: String(input.bank_name || '').trim(),
    bank_ispb: String(input.bank_ispb || '').trim(),
    bank_full_name: String(input.bank_full_name || '').trim(),
    bank_logo_data_url: logo,
    bank_agency: agency,
    bank_account: account,
    bank_account_type: String(input.bank_account_type || 'Corrente') === 'Poupança' ? 'Poupança' : 'Corrente',
    pix_type: pixType,
    pix_key: String(input.pix_key || '').trim(),
    is_principal: !!input.is_principal,
  }
}

export function createEmptyBankAccount(partial?: Partial<CompanyBankAccount>): CompanyBankAccount {
  return normalizeBankAccount(
    {
      id: partial?.id || createId(),
      name: '',
      bank_code: '',
      bank_name: '',
      bank_ispb: '',
      bank_full_name: '',
      bank_logo_data_url: '',
      bank_agency: '',
      bank_account: '',
      bank_account_type: 'Corrente',
      pix_type: 'cnpj',
      pix_key: '',
      is_principal: false,
      ...partial,
    },
    0,
  )
}

export function normalizeCompanyBankAccounts(companyData: CompanyDataWithBankAccounts, companyCnpj = '') {
  const data: Record<string, any> = { ...(companyData || {}) }
  const rawAccounts = Array.isArray(data.bank_accounts) ? data.bank_accounts : []
  const normalized = rawAccounts.map((account, index) => normalizeBankAccount(account, index)).filter((account) => account.id)

  const hasLegacyBankData =
    String(data.bank_name || '').trim() ||
    String(data.bank_agency || '').trim() ||
    String(data.bank_account || '').trim() ||
    String(data.pix_type || '').trim() ||
    String(data.pix_key || '').trim()

  const accounts =
    normalized.length > 0
      ? normalized
      : hasLegacyBankData
        ? [
            normalizeBankAccount(
              {
                id: createId(),
                name: String(data.bank_name || 'Conta Principal').trim() || 'Conta Principal',
                bank_code: String(data.bank_code || '').trim(),
                bank_name: String(data.bank_name || '').trim(),
                bank_ispb: String(data.bank_ispb || '').trim(),
                bank_full_name: String(data.bank_full_name || '').trim(),
                bank_logo_data_url: String(data.bank_logo_data_url || '').trim(),
                bank_agency: String(data.bank_agency || '').trim(),
                bank_account: String(data.bank_account || '').trim(),
                bank_account_type: String(data.bank_account_type || 'Corrente') === 'Poupança' ? 'Poupança' : 'Corrente',
                pix_type:
                  String(data.pix_type || 'cnpj').toLowerCase() === 'phone'
                    ? 'phone'
                    : String(data.pix_type || 'cnpj').toLowerCase() === 'email'
                      ? 'email'
                      : String(data.pix_type || 'cnpj').toLowerCase() === 'bank'
                        ? 'bank'
                        : String(data.pix_type || 'cnpj').toLowerCase() === 'random'
                          ? 'random'
                          : 'cnpj',
                pix_key: String(data.pix_key || '').trim(),
                is_principal: true,
              },
              0,
            ),
          ]
        : [createEmptyBankAccount({ is_principal: true })]

  const principalIndex = Math.max(
    0,
    accounts.findIndex((account) => account.is_principal),
  )
  const principal = accounts[principalIndex] || accounts[0] || createEmptyBankAccount({ is_principal: true })

  const fixedAccounts = accounts.map((account, index) => ({
    ...account,
    is_principal: index === principalIndex,
    bank_logo_data_url: String(account.bank_logo_data_url || '').trim(),
    pix_key: normalizePixKeyValue(account.pix_key, account.pix_type, companyCnpj),
    bank_agency: parseBankAgencySeq(account.bank_agency),
    bank_account: parseBankAccountSeq(account.bank_account),
  }))

  data.bank_accounts = fixedAccounts
  data.bank_code = principal.bank_code || data.bank_code || ''
  data.bank_name = principal.bank_name || data.bank_name || ''
  data.bank_ispb = principal.bank_ispb || data.bank_ispb || ''
  data.bank_full_name = principal.bank_full_name || data.bank_full_name || ''
  data.bank_logo_data_url = principal.bank_logo_data_url || data.bank_logo_data_url || ''
  data.bank_agency = formatBankAgencyWithDigitFromSeq(principal.bank_agency)
  data.bank_account = formatBankAccountFromSeq(principal.bank_account)
  data.bank_account_type = principal.bank_account_type || data.bank_account_type || 'Corrente'
  data.pix_type = principal.pix_type || data.pix_type || 'cnpj'
  data.pix_key = normalizePixKeyValue(principal.pix_key || data.pix_key || '', principal.pix_type || data.pix_type || 'cnpj', companyCnpj)

  return data
}

export function normalizePrincipalBankAccount(companyData: CompanyDataWithBankAccounts, companyCnpj = '') {
  const normalized = normalizeCompanyBankAccounts(companyData, companyCnpj)
  const principal = Array.isArray(normalized.bank_accounts) ? normalized.bank_accounts.find((account) => account.is_principal) || normalized.bank_accounts[0] : null

  return {
    bank_accounts: normalized.bank_accounts || [],
    bank_code: String(principal?.bank_code || normalized.bank_code || ''),
    bank_name: String(principal?.bank_name || normalized.bank_name || ''),
    bank_ispb: String(principal?.bank_ispb || normalized.bank_ispb || ''),
    bank_full_name: String(principal?.bank_full_name || normalized.bank_full_name || ''),
    bank_logo_data_url: String(principal?.bank_logo_data_url || normalized.bank_logo_data_url || ''),
    bank_agency: String(normalizeAgencyValue(String(principal?.bank_agency || normalized.bank_agency || ''))),
    bank_account: String(normalizeAccountValue(String(principal?.bank_account || normalized.bank_account || ''))),
    bank_account_type: String(principal?.bank_account_type || normalized.bank_account_type || 'Corrente'),
    pix_type: String(principal?.pix_type || normalized.pix_type || 'cnpj'),
    pix_key: String(normalizePixKeyValue(String(principal?.pix_key || normalized.pix_key || ''), String(principal?.pix_type || normalized.pix_type || 'cnpj'), companyCnpj)),
  }
}

