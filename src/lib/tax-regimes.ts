import { onlyDigits } from './company-bank-accounts.ts'

export type TaxRateField = {
  enabled: boolean
  value: string
}

export type TaxRegimeSection1 = {
  simples_nacional: TaxRateField
  iss: TaxRateField
}

export type TaxRegimeSection2 = {
  pis: TaxRateField
  cofins: TaxRateField
  accepts_credit: boolean
}

export type TaxRegimeSection3 = {
  ibs: TaxRateField
  cbs: TaxRateField
}

export type TaxRegimeSection4 = {
  irpj: TaxRateField
  csll: TaxRateField
  pis: TaxRateField
  cofins: TaxRateField
  ibs: TaxRateField
  cbs: TaxRateField
}

export type TaxRegimeConfiguration = {
  section_1: TaxRegimeSection1
  section_2: TaxRegimeSection2
  section_3: TaxRegimeSection3
  section_4: TaxRegimeSection4
}

export type TaxRegimeVersionRecord = {
  id?: string
  tax_regime_id?: string
  effective_from: string
  effective_to: string | null
  locked_at?: string | null
  config: TaxRegimeConfiguration
  created_at?: string
  updated_at?: string
}

export type TaxRegimeRecord = {
  id?: string
  name: string
  created_at?: string
  updated_at?: string
  versions?: TaxRegimeVersionRecord[]
  current_version?: TaxRegimeVersionRecord | null
}

export type TaxRegimeTotals = {
  section_2: string
  section_3: string
  section_4: string
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `tax-regime-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizePercentDigits(value: string) {
  return onlyDigits(String(value || '')).slice(0, 4)
}

export function formatPercentSequence(value: string) {
  const digits = normalizePercentDigits(value).padStart(4, '0')
  return `${digits.slice(0, 2)},${digits.slice(2)}`
}

export function percentSequenceToNumber(value: string) {
  const digits = normalizePercentDigits(value).padStart(4, '0')
  return Number(`${digits.slice(0, 2)}.${digits.slice(2)}`) || 0
}

export function formatPercentTotal(value: number) {
  const fixed = Number(value || 0).toFixed(2)
  const [whole = '0', decimal = '00'] = fixed.split('.')
  return `${whole.padStart(2, '0')},${decimal}`
}

export function normalizeTaxRateField(raw: unknown): TaxRateField {
  const record = isRecord(raw) ? raw : {}
  const enabled = !!record.enabled || !!record.is_enabled || !!record.active
  return {
    enabled,
    value: normalizePercentDigits(String(record.value ?? record.amount ?? record.rate ?? '')),
  }
}

export function createEmptyTaxRateField(enabled = false): TaxRateField {
  return {
    enabled,
    value: '',
  }
}

export function createEmptyTaxRegimeConfiguration(): TaxRegimeConfiguration {
  return {
    section_1: {
      simples_nacional: createEmptyTaxRateField(),
      iss: createEmptyTaxRateField(),
    },
    section_2: {
      pis: createEmptyTaxRateField(),
      cofins: createEmptyTaxRateField(),
      accepts_credit: false,
    },
    section_3: {
      ibs: createEmptyTaxRateField(),
      cbs: createEmptyTaxRateField(),
    },
    section_4: {
      irpj: createEmptyTaxRateField(),
      csll: createEmptyTaxRateField(),
      pis: createEmptyTaxRateField(),
      cofins: createEmptyTaxRateField(),
      ibs: createEmptyTaxRateField(),
      cbs: createEmptyTaxRateField(),
    },
  }
}

export function createEmptyTaxRegimeVersion(): TaxRegimeVersionRecord {
  return {
    id: createId(),
    effective_from: '',
    effective_to: null,
    locked_at: null,
    config: createEmptyTaxRegimeConfiguration(),
  }
}

export function createEmptyTaxRegime(): TaxRegimeRecord {
  return {
    name: '',
    versions: [createEmptyTaxRegimeVersion()],
  }
}

function normalizeSection1(raw: unknown): TaxRegimeSection1 {
  const record = isRecord(raw) ? raw : {}
  return {
    simples_nacional: normalizeTaxRateField(record.simples_nacional ?? record.simples ?? record.sn),
    iss: normalizeTaxRateField(record.iss),
  }
}

function normalizeSection2(raw: unknown): TaxRegimeSection2 {
  const record = isRecord(raw) ? raw : {}
  return {
    pis: normalizeTaxRateField(record.pis),
    cofins: normalizeTaxRateField(record.cofins),
    accepts_credit: !!record.accepts_credit || !!record.acceptsCredit || !!record.credit_allowed || !!record.credito_aceito,
  }
}

function normalizeSection3(raw: unknown): TaxRegimeSection3 {
  const record = isRecord(raw) ? raw : {}
  return {
    ibs: normalizeTaxRateField(record.ibs),
    cbs: normalizeTaxRateField(record.cbs),
  }
}

function normalizeSection4(raw: unknown): TaxRegimeSection4 {
  const record = isRecord(raw) ? raw : {}
  return {
    irpj: normalizeTaxRateField(record.irpj),
    csll: normalizeTaxRateField(record.csll),
    pis: normalizeTaxRateField(record.pis),
    cofins: normalizeTaxRateField(record.cofins),
    ibs: normalizeTaxRateField(record.ibs),
    cbs: normalizeTaxRateField(record.cbs),
  }
}

function normalizeTaxRegimeConfigFromRecord(raw: unknown): TaxRegimeConfiguration {
  const record = isRecord(raw) ? raw : {}
  const section1Source = record.section_1 ?? record.section1 ?? record.nfse_fixed ?? record.fixed_nfse ?? record.nfse_without_credit
  const section2Source = record.section_2 ?? record.section2 ?? record.nfse_federal ?? record.federal_nfse
  const section3Source = record.section_3 ?? record.section3 ?? record.credit_pleno ?? record.credit_full
  const section4Source = record.section_4 ?? record.section4 ?? record.withholding ?? record.retention

  return {
    section_1: normalizeSection1(section1Source),
    section_2: normalizeSection2(section2Source),
    section_3: normalizeSection3(section3Source),
    section_4: normalizeSection4(section4Source),
  }
}

export function normalizeTaxRegimeConfig(input: unknown): TaxRegimeConfiguration {
  return normalizeTaxRegimeConfigFromRecord(input)
}

export function normalizeTaxRegimeVersion(input: unknown): TaxRegimeVersionRecord {
  const record = isRecord(input) ? input : {}
  const configSource = record.config ?? record.data ?? record.configuration ?? record.version_data
  const effectiveTo = record.effective_to ?? record.vigencia_fim ?? record.end_date
  const lockedAt = record.locked_at ?? record.lockedAt
  return {
    id: String(record.id || createId()),
    tax_regime_id: record.tax_regime_id ? String(record.tax_regime_id) : undefined,
    effective_from: String(record.effective_from ?? record.vigencia_inicio ?? record.start_date ?? ''),
    effective_to: typeof effectiveTo === 'string' ? effectiveTo : effectiveTo ? String(effectiveTo) : null,
    locked_at: typeof lockedAt === 'string' ? lockedAt : lockedAt ? String(lockedAt) : null,
    config: normalizeTaxRegimeConfig(configSource),
    created_at: record.created_at ? String(record.created_at) : undefined,
    updated_at: record.updated_at ? String(record.updated_at) : undefined,
  }
}

export function normalizeTaxRegimeRecord(input: unknown): TaxRegimeRecord {
  const record = isRecord(input) ? input : {}
  const versionsRaw = Array.isArray(record.versions) ? record.versions : Array.isArray(record.tax_regime_versions) ? record.tax_regime_versions : []
  const versions = versionsRaw.map((item) => normalizeTaxRegimeVersion(item))
  const currentVersionRaw =
    record.current_version ??
    versions.find((version) => version.effective_to === null) ??
    versions[0] ??
    null

  return {
    id: record.id ? String(record.id) : undefined,
    name: String(record.name || '').trim(),
    created_at: record.created_at ? String(record.created_at) : undefined,
    updated_at: record.updated_at ? String(record.updated_at) : undefined,
    versions,
    current_version: currentVersionRaw ? normalizeTaxRegimeVersion(currentVersionRaw) : null,
  }
}

export function isTaxRegimeVersionActive(version: TaxRegimeVersionRecord) {
  return version.effective_to === null
}

function sumEnabledRates(fields: TaxRateField[]) {
  return fields.reduce((total, field) => (field.enabled ? total + percentSequenceToNumber(field.value) : total), 0)
}

export function getTaxRegimeTotals(config: TaxRegimeConfiguration): TaxRegimeTotals {
  return {
    section_2: formatPercentTotal(sumEnabledRates([config.section_2.pis, config.section_2.cofins])),
    section_3: formatPercentTotal(sumEnabledRates([config.section_3.ibs, config.section_3.cbs])),
    section_4: formatPercentTotal(sumEnabledRates([config.section_4.irpj, config.section_4.csll, config.section_4.pis, config.section_4.cofins, config.section_4.ibs, config.section_4.cbs])),
  }
}

export function getEnabledRateSummary(
  fieldMap: Array<{ key: string; label: string; field: TaxRateField }>,
) {
  return fieldMap
    .filter((item) => item.field.enabled)
    .map((item) => `${item.label}: ${formatPercentSequence(item.field.value)}%`)
}

export function getActiveTaxRegimeVersion(regime: TaxRegimeRecord) {
  return regime.current_version || regime.versions?.find((version) => version.effective_to === null) || regime.versions?.[0] || null
}

export function sortTaxRegimeVersions(versions: TaxRegimeVersionRecord[]) {
  return [...versions].sort((a, b) => {
    const aActive = a.effective_to === null ? 1 : 0
    const bActive = b.effective_to === null ? 1 : 0
    if (aActive !== bActive) return bActive - aActive
    return String(b.effective_from || '').localeCompare(String(a.effective_from || ''))
  })
}
