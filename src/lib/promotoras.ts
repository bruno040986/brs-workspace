import { createEmptyBankAccount, normalizeCompanyBankAccounts, type CompanyBankAccount } from '@/lib/company-bank-accounts'
import { createEmptyFiscalFigure, type FiscalCatalogReference, type FiscalFigureRecord } from '@/lib/company-fiscal-data'
import { formatCnaeCode } from '@/lib/cnaes'
import { formatCtnCode } from '@/lib/ctns'
import { formatNbsCode } from '@/lib/nbs'
import { normalizeTaxRegimeConfig, type TaxRateField, type TaxRegimeConfiguration } from '@/lib/tax-regimes'

export type PromotoraAddressData = {
  cep?: string
  logradouro?: string
  bairro?: string
  cidade?: string
  uf?: string
  numero?: string
  complemento?: string
  site_institucional?: string
  email_principal?: string
  contrato_url?: string
  drive_documentos_url?: string
  drive_logotipos_url?: string
}

export type PromotoraCommercialContact = {
  id: string
  commercial_type_id: string
  region_ufs: string[]
  cpf: string
  nome_completo: string
  data_nascimento: string
  email: string
  whatsapp: string
  data_inicial: string
  data_final: string
  is_active: boolean
}

export type PromotoraOperationalContact = {
  id: string
  sector_id: string
  nome_responsavel: string
  data_nascimento: string
  whatsapp: string
  email: string
  data_inicial: string
  data_final: string
  is_active: boolean
}

export type PromotoraFiscalRetentionOverride = {
  custom: boolean
  value: string
}

export type PromotoraFiscalConfiguration = {
  id: string
  remuneration_type_id: string
  remuneration_type_name: string
  nfse_emission_type_id: string
  nfse_emission_type_name: string
  company_profile_id: string
  company_profile_name: string
  figure_id: string
  figure_label: string
  figure_snapshot: FiscalFigureRecord
  effective_from: string
  effective_to: string | null
  meio_envio_nfse: 'email' | 'sistema'
  nfse_email: string
  nfse_system_url: string
  retention_overrides: Partial<Record<keyof TaxRegimeConfiguration['section_4'], PromotoraFiscalRetentionOverride>>
}

export type PromotoraFiscalData = {
  configurations: PromotoraFiscalConfiguration[]
  exige_nfse?: boolean
  nfse_emission_type_id?: string
  simples_nacional?: string
  iss?: string
  irpj_retido?: string
  csll_retido?: string
  pis_retido?: string
  cofins_retido?: string
  cbs_retido?: string
  ibs_retido?: string
  total_retencoes?: string
  meio_envio_nfse?: 'email' | 'sistema'
  nfse_email?: string
  nfse_system_url?: string
}

export type PromotoraFinancialReferencePoint = 'cadastro' | 'cliente' | 'liberacao'
export type PromotoraFinancialTariffMode = 'R$' | '%' | 'R$ + %'
export type PromotoraFinancialPaymentMode = 'direto' | 'indireto'
export type PromotoraFinancialDirectFrequency = 'diario' | 'semanal' | 'quinzenal' | 'mensal'
export type PromotoraFinancialWeekPeriodType = 'entre' | 'fixo'
export type PromotoraFinancialWeekDay =
  | 'Segunda-Feira'
  | 'Terça-Feira'
  | 'Quarta-Feira'
  | 'Quinta-Feira'
  | 'Sexta-Feira'
  | 'Sábado'
  | 'Domingo'

export type PromotoraFinancialWeeklyRow = {
  dia_da_semana: PromotoraFinancialWeekDay | ''
  periodo_tipo: PromotoraFinancialWeekPeriodType
  periodo_entre_inicio: PromotoraFinancialWeekDay | ''
  periodo_entre_fim: PromotoraFinancialWeekDay | ''
  periodo_fixo_dia: PromotoraFinancialWeekDay | ''
  data_referencia_periodo_fechamento: PromotoraFinancialReferencePoint | ''
}

export type PromotoraFinancialBiweeklyBoundMode = 'entre' | 'fixo'
export type PromotoraFinancialBiweeklyRangeDay = '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '10' | '11' | '12' | '13' | '14' | '15' | '16' | '17' | '18' | '19' | '20' | '21' | '22' | '23' | '24' | '25' | '26' | '27' | '28' | '29' | '30' | 'ultimo'

export type PromotoraFinancialBiweeklyBound = {
  modo: PromotoraFinancialBiweeklyBoundMode
  dia_inicial: PromotoraFinancialBiweeklyRangeDay | ''
  dia_final: PromotoraFinancialBiweeklyRangeDay | ''
}

export type PromotoraFinancialPaymentRange = {
  modo: PromotoraFinancialBiweeklyBoundMode
  dia_inicial: string
  dia_final: string
}

export type PromotoraFinancialDirectData = {
  frequencia: PromotoraFinancialDirectFrequency
  prazo_pagamento: string
  data_referencia_prazo_pagto: PromotoraFinancialReferencePoint | ''
  frequencia_semanal: '1' | '2' | '3' | '4'
  tabela_semanal: PromotoraFinancialWeeklyRow[]
  dia_pagamento_1_quinzena: PromotoraFinancialPaymentRange
  periodo_fechamento_1_quinzena: PromotoraFinancialPaymentRange
  dia_pagamento_2_quinzena: PromotoraFinancialPaymentRange
  periodo_fechamento_2_quinzena: PromotoraFinancialPaymentRange
  dia_pagamento_mensal: PromotoraFinancialPaymentRange
  periodo_fechamento_mensal: PromotoraFinancialPaymentRange
  data_referencia_periodo_fechamento: PromotoraFinancialReferencePoint | ''
  valor_minimo_enabled: boolean
  valor_minimo_pagto: string
  tarifa_enabled: boolean
  tarifa_tipo: PromotoraFinancialTariffMode
  tarifa_valor_real: string
  tarifa_valor_percentual: string
}

export type PromotoraFinancialIndirectRequestLine = {
  enabled: boolean
  dia_da_semana: PromotoraFinancialWeekDay | ''
  hora_inicial: string
  hora_final: string
}

export type PromotoraFinancialIndirectData = {
  dias_horarios_solicitacao_saque: PromotoraFinancialIndirectRequestLine[]
  prazo_pagamento_conta_corrente: string
  data_ref_prazo_pagto: PromotoraFinancialReferencePoint | ''
  saques_gratuitos_no_mes: string
  tarifa_tipo: PromotoraFinancialTariffMode
  tarifa_valor_real: string
  tarifa_valor_percentual: string
  valor_minimo_saque: string
  prazo_credito_saque: string
  url_sistema_saque: string
  observacoes_importantes: string
}

export type PromotoraFinancialInstitutionSnapshot = {
  id: string
  name: string
  logo_url: string
}

export type PromotoraFinancialConfiguration = {
  id: string
  remuneration_type_id: string
  remuneration_type_name: string
  financial_institution_id: string
  financial_institution_name: string
  financial_institution_logo_url: string
  prazo_repasse_enabled: boolean
  prazo_repasse_para_agente: string
  conta_bancaria_index: string
  forma_recebimento_id: string
  payment_mode: PromotoraFinancialPaymentMode
  direct: PromotoraFinancialDirectData
  indirect: PromotoraFinancialIndirectData
}

export type PromotoraFinancialData = {
  realiza_comissao: boolean
  solicitar_saque: boolean
  saque_dias: string[]
  saque_inicio: string
  saque_fim: string
  url_sistema: string
  prazo_pagamento: number
  flag_dia_pagamento: boolean
  dia_semana_ativo: boolean
  dia_semana_valor: string
  dia_mes_valor: string
  empresa_contratada_id: string
  conta_recebimento_index: string
  forma_recebimento_id: string
  configurations: PromotoraFinancialConfiguration[]
  legacy?: Record<string, any>
}

export type PromotoraSystemEntry = {
  id: string
  system_type_id: string
  system_type_ids?: string[]
  descricao: string
  url: string
  observacoes: string
  is_active: boolean
}

export type PromotoraRecord = {
  id?: string
  cnpj: string
  razao_social: string
  nome_fantasia: string
  logo_url: string
  address_data: PromotoraAddressData
  contacts_commercial: PromotoraCommercialContact[]
  contacts_operational: PromotoraOperationalContact[]
  fiscal_data: PromotoraFiscalData
  financial_data: PromotoraFinancialData
  bank_accounts: CompanyBankAccount[]
  systems: PromotoraSystemEntry[]
  is_active?: boolean
  deleted_at?: string | null
  created_at?: string
  updated_at?: string
}

type RawRecord = Record<string, any>

function createId() {
  return globalThis.crypto?.randomUUID?.() || `prom-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function onlyDigits(value: string) {
  return String(value || '').replace(/\D/g, '')
}

function normalizeText(value: any, maxLength?: number) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return typeof maxLength === 'number' ? text.slice(0, maxLength) : text
}

function normalizePercent(value: any) {
  const raw = String(value || '').replace(',', '.').replace(/[^0-9.]/g, '')
  if (!raw) return ''
  const parsed = Number(raw)
  if (Number.isNaN(parsed)) return ''
  return parsed.toFixed(2)
}

function normalizeRateDigits(value: any) {
  return String(value || '').replace(/\D/g, '').slice(0, 4)
}

function createEmptyFinancialPaymentRange(): PromotoraFinancialPaymentRange {
  return { modo: 'fixo', dia_inicial: '', dia_final: '' }
}

function createEmptyFinancialWeeklyRow(): PromotoraFinancialWeeklyRow {
  return {
    dia_da_semana: '',
    periodo_tipo: 'fixo',
    periodo_entre_inicio: '',
    periodo_entre_fim: '',
    periodo_fixo_dia: '',
    data_referencia_periodo_fechamento: '',
  }
}

function createEmptyFinancialDirectData(): PromotoraFinancialDirectData {
  return {
    frequencia: 'diario',
    prazo_pagamento: '',
    data_referencia_prazo_pagto: '',
    frequencia_semanal: '1',
    tabela_semanal: [createEmptyFinancialWeeklyRow()],
    dia_pagamento_1_quinzena: createEmptyFinancialPaymentRange(),
    periodo_fechamento_1_quinzena: createEmptyFinancialPaymentRange(),
    dia_pagamento_2_quinzena: createEmptyFinancialPaymentRange(),
    periodo_fechamento_2_quinzena: createEmptyFinancialPaymentRange(),
    dia_pagamento_mensal: createEmptyFinancialPaymentRange(),
    periodo_fechamento_mensal: createEmptyFinancialPaymentRange(),
    data_referencia_periodo_fechamento: '',
    valor_minimo_enabled: false,
    valor_minimo_pagto: '',
    tarifa_enabled: false,
    tarifa_tipo: 'R$',
    tarifa_valor_real: '',
    tarifa_valor_percentual: '',
  }
}

function createEmptyFinancialIndirectData(): PromotoraFinancialIndirectData {
  return {
    dias_horarios_solicitacao_saque: Array.from({ length: 6 }, () => ({
      enabled: false,
      dia_da_semana: '',
      hora_inicial: '',
      hora_final: '',
    })),
    prazo_pagamento_conta_corrente: '',
    data_ref_prazo_pagto: '',
    saques_gratuitos_no_mes: '',
    tarifa_tipo: 'R$',
    tarifa_valor_real: '',
    tarifa_valor_percentual: '',
    valor_minimo_saque: '',
    prazo_credito_saque: '',
    url_sistema_saque: '',
    observacoes_importantes: '',
  }
}

function createEmptyFinancialConfiguration(): PromotoraFinancialConfiguration {
  return {
    id: createId(),
    remuneration_type_id: '',
    remuneration_type_name: '',
    financial_institution_id: '',
    financial_institution_name: '',
    financial_institution_logo_url: '',
    prazo_repasse_enabled: false,
    prazo_repasse_para_agente: '',
    conta_bancaria_index: '',
    forma_recebimento_id: '',
    payment_mode: 'direto',
    direct: createEmptyFinancialDirectData(),
    indirect: createEmptyFinancialIndirectData(),
  }
}

function normalizeFinancialReferencePoint(value: any): PromotoraFinancialReferencePoint | '' {
  const raw = normalizeText(value, 40).toLowerCase()
  if (raw === 'cadastro' || raw === 'cadastro/digitação' || raw === 'cadastro/digitacao') return 'cadastro'
  if (raw === 'cliente' || raw === 'pagamento cliente') return 'cliente'
  if (raw === 'liberacao' || raw === 'liberação') return 'liberacao'
  return ''
}

function normalizeFinancialTariffMode(value: any): PromotoraFinancialTariffMode {
  const raw = normalizeText(value, 12)
  if (raw === '%' || raw === 'R$ + %') return raw as PromotoraFinancialTariffMode
  return 'R$'
}

function normalizeFinancialWeekDay(value: any): PromotoraFinancialWeekDay | '' {
  const raw = normalizeText(value, 30)
  const allowed: PromotoraFinancialWeekDay[] = ['Segunda-Feira', 'Terça-Feira', 'Quarta-Feira', 'Quinta-Feira', 'Sexta-Feira', 'Sábado', 'Domingo']
  return allowed.includes(raw as PromotoraFinancialWeekDay) ? (raw as PromotoraFinancialWeekDay) : ''
}

function normalizeFinancialTime(value: any) {
  const raw = normalizeText(value, 8)
  return /^\d{2}:\d{2}$/.test(raw) ? raw : ''
}

function normalizeFinancialDigits(value: any, max = 3) {
  return String(value || '').replace(/\D/g, '').slice(0, max)
}

function normalizeFinancialCurrency(value: any) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return raw.replace(/\s+/g, ' ')
}

function normalizeFinancialPercent(value: any) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return raw.replace(/\s+/g, ' ')
}

function normalizeFinancialPaymentRange(raw: any): PromotoraFinancialPaymentRange {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}
  return {
    modo: value.modo === 'entre' ? 'entre' : 'fixo',
    dia_inicial: normalizeFinancialDigits(value.dia_inicial, 2),
    dia_final: normalizeFinancialDigits(value.dia_final, 2),
  }
}

function normalizeFinancialWeeklyRow(raw: any): PromotoraFinancialWeeklyRow {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}
  return {
    dia_da_semana: normalizeFinancialWeekDay(value.dia_da_semana),
    periodo_tipo: value.periodo_tipo === 'entre' ? 'entre' : 'fixo',
    periodo_entre_inicio: normalizeFinancialWeekDay(value.periodo_entre_inicio),
    periodo_entre_fim: normalizeFinancialWeekDay(value.periodo_entre_fim),
    periodo_fixo_dia: normalizeFinancialWeekDay(value.periodo_fixo_dia),
    data_referencia_periodo_fechamento: normalizeFinancialReferencePoint(value.data_referencia_periodo_fechamento),
  }
}

function normalizeFinancialIndirectLine(raw: any): PromotoraFinancialIndirectRequestLine {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}
  return {
    enabled: !!value.enabled,
    dia_da_semana: normalizeFinancialWeekDay(value.dia_da_semana),
    hora_inicial: normalizeFinancialTime(value.hora_inicial),
    hora_final: normalizeFinancialTime(value.hora_final),
  }
}

function normalizeFinancialInstitutionSnapshot(raw: any): PromotoraFinancialInstitutionSnapshot {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}
  return {
    id: normalizeText(value.id ?? '', 80),
    name: normalizeText(value.name ?? '', 120),
    logo_url: normalizeText(value.logo_url ?? value.logo ?? '', 1000),
  }
}

export function normalizeFinancialDirectData(direct: any): PromotoraFinancialDirectData {
  return {
    ...createEmptyFinancialDirectData(),
    ...(direct && typeof direct === 'object' ? {
      frequencia: ['diario', 'semanal', 'quinzenal', 'mensal'].includes(String((direct as any).frequencia || '').toLowerCase())
        ? (String((direct as any).frequencia).toLowerCase() as PromotoraFinancialDirectFrequency)
        : 'diario',
      prazo_pagamento: normalizeFinancialDigits((direct as any).prazo_pagamento ?? '', 3),
      data_referencia_prazo_pagto: normalizeFinancialReferencePoint((direct as any).data_referencia_prazo_pagto ?? ''),
      frequencia_semanal: ['1', '2', '3', '4'].includes(String((direct as any).frequencia_semanal ?? '1')) ? String((direct as any).frequencia_semanal) as any : '1',
      tabela_semanal: Array.isArray((direct as any).tabela_semanal) && (direct as any).tabela_semanal.length > 0
        ? (direct as any).tabela_semanal.map((row: any) => normalizeFinancialWeeklyRow(row)).slice(0, 4)
        : [createEmptyFinancialWeeklyRow()],
      dia_pagamento_1_quinzena: normalizeFinancialPaymentRange((direct as any).dia_pagamento_1_quinzena ?? {}),
      periodo_fechamento_1_quinzena: normalizeFinancialPaymentRange((direct as any).periodo_fechamento_1_quinzena ?? {}),
      dia_pagamento_2_quinzena: normalizeFinancialPaymentRange((direct as any).dia_pagamento_2_quinzena ?? {}),
      periodo_fechamento_2_quinzena: normalizeFinancialPaymentRange((direct as any).periodo_fechamento_2_quinzena ?? {}),
      dia_pagamento_mensal: normalizeFinancialPaymentRange((direct as any).dia_pagamento_mensal ?? {}),
      periodo_fechamento_mensal: normalizeFinancialPaymentRange((direct as any).periodo_fechamento_mensal ?? {}),
      data_referencia_periodo_fechamento: normalizeFinancialReferencePoint((direct as any).data_referencia_periodo_fechamento ?? ''),
      valor_minimo_enabled: !!(direct as any).valor_minimo_enabled,
      valor_minimo_pagto: normalizeFinancialCurrency((direct as any).valor_minimo_pagto ?? ''),
      tarifa_enabled: !!(direct as any).tarifa_enabled,
      tarifa_tipo: normalizeFinancialTariffMode((direct as any).tarifa_tipo ?? 'R$'),
      tarifa_valor_real: normalizeFinancialCurrency((direct as any).tarifa_valor_real ?? ''),
      tarifa_valor_percentual: normalizeFinancialPercent((direct as any).tarifa_valor_percentual ?? ''),
    } : {}),
  }
}

export function normalizeFinancialIndirectData(indirect: any): PromotoraFinancialIndirectData {
  return {
    ...createEmptyFinancialIndirectData(),
    ...(indirect && typeof indirect === 'object' ? {
      dias_horarios_solicitacao_saque: Array.isArray((indirect as any).dias_horarios_solicitacao_saque) && (indirect as any).dias_horarios_solicitacao_saque.length > 0
        ? (indirect as any).dias_horarios_solicitacao_saque.map((row: any) => normalizeFinancialIndirectLine(row)).slice(0, 6)
        : createEmptyFinancialIndirectData().dias_horarios_solicitacao_saque,
      prazo_pagamento_conta_corrente: normalizeFinancialDigits((indirect as any).prazo_pagamento_conta_corrente ?? '', 3),
      data_ref_prazo_pagto: normalizeFinancialReferencePoint((indirect as any).data_ref_prazo_pagto ?? ''),
      saques_gratuitos_no_mes: normalizeFinancialDigits((indirect as any).saques_gratuitos_no_mes ?? '', 2),
      tarifa_tipo: normalizeFinancialTariffMode((indirect as any).tarifa_tipo ?? 'R$'),
      tarifa_valor_real: normalizeFinancialCurrency((indirect as any).tarifa_valor_real ?? ''),
      tarifa_valor_percentual: normalizeFinancialPercent((indirect as any).tarifa_valor_percentual ?? ''),
      valor_minimo_saque: normalizeFinancialCurrency((indirect as any).valor_minimo_saque ?? ''),
      prazo_credito_saque: normalizeFinancialDigits((indirect as any).prazo_credito_saque ?? '', 3),
      url_sistema_saque: normalizeText((indirect as any).url_sistema_saque ?? '', 500),
      observacoes_importantes: normalizeText((indirect as any).observacoes_importantes ?? '', 500),
    } : {}),
  }
}

function normalizeFinancialConfigurations(raw: any): PromotoraFinancialConfiguration[] {
  const configsRaw = Array.isArray(raw?.configurations)
    ? raw.configurations
    : Array.isArray(raw?.financial_configurations)
      ? raw.financial_configurations
      : Array.isArray(raw?.configuracoes_financeiras)
        ? raw.configuracoes_financeiras
        : []

  return configsRaw.map((config: any) => {
    const value = config && typeof config === 'object' ? (config as Record<string, any>) : {}
    const direct = value.direct && typeof value.direct === 'object' ? value.direct : value.payment_direct
    const indirect = value.indirect && typeof value.indirect === 'object' ? value.indirect : value.payment_indirect
    return {
      ...createEmptyFinancialConfiguration(),
      id: normalizeText(value.id ?? '', 80) || createId(),
      remuneration_type_id: normalizeText(value.remuneration_type_id ?? value.tipo_remuneracao_id ?? '', 80),
      remuneration_type_name: normalizeText(value.remuneration_type_name ?? value.tipo_remuneracao_nome ?? '', 120),
      financial_institution_id: normalizeText(value.financial_institution_id ?? value.instituicao_financeira_id ?? '', 80),
      financial_institution_name: normalizeText(value.financial_institution_name ?? value.instituicao_financeira_nome ?? '', 120),
      financial_institution_logo_url: normalizeText(value.financial_institution_logo_url ?? value.instituicao_financeira_logo_url ?? '', 1000),
      prazo_repasse_enabled: !!value.prazo_repasse_enabled,
      prazo_repasse_para_agente: normalizeFinancialDigits(value.prazo_repasse_para_agente ?? value.prazo_repasse ?? '', 3),
      conta_bancaria_index: normalizeText(value.conta_bancaria_index ?? '', 80),
      forma_recebimento_id: normalizeText(value.forma_recebimento_id ?? '', 80),
      payment_mode: value.payment_mode === 'indireto' ? 'indireto' : 'direto',
      direct: normalizeFinancialDirectData(direct),
      indirect: normalizeFinancialIndirectData(indirect),
    }
  })
}

function createEmptyFiscalRetentionOverride(): PromotoraFiscalRetentionOverride {
  return {
    custom: false,
    value: '',
  }
}

function buildFigureLabel(figure: FiscalFigureRecord) {
  const parts = [
    figure.cnae?.code ? `${formatCnaeCode(String(figure.cnae.code || ''))}` : '',
    figure.ctn?.code ? `${formatCtnCode(String(figure.ctn.code || ''))}` : '',
    figure.nbs?.code ? `${formatNbsCode(String(figure.nbs.code || ''))}` : '',
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(' > ') : 'Figura Tributária'
}

function normalizeFiscalCatalogReference(raw: any, maxDigits: number): FiscalCatalogReference {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}
  return {
    id: record.id ? String(record.id) : undefined,
    code: onlyDigits(record.code ?? record.codigo ?? record.value ?? '').slice(0, maxDigits),
    description: normalizeText(record.description ?? record.descricao ?? record.name ?? record.nome ?? '', 500),
  }
}

function normalizeFiscalFigureSnapshot(raw: any): FiscalFigureRecord {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}
  const figure = createEmptyFiscalFigure()
  const configSource = record.config ?? record.configuration ?? record.data ?? record.figure_config ?? record.tax_regime_config ?? record

  return {
    ...figure,
    id: record.id ? String(record.id) : figure.id,
    tax_regime_id: normalizeText(record.tax_regime_id ?? record.regime_id ?? record.tax_regime ?? '', 80),
    tax_regime_name: normalizeText(record.tax_regime_name ?? record.regime_name ?? record.tax_regime_label ?? '', 120),
    tax_regime_version_id: normalizeText(record.tax_regime_version_id ?? record.version_id ?? '', 80) || undefined,
    tax_regime_version_name: normalizeText(record.tax_regime_version_name ?? record.version_name ?? '', 120) || undefined,
    effective_from: normalizeText(record.effective_from ?? record.vigencia_inicio ?? record.start_date ?? '', 10),
    effective_to:
      record.effective_to === null
        ? null
        : normalizeText(record.effective_to ?? record.vigencia_fim ?? record.end_date ?? '', 10) || null,
    cnae: normalizeFiscalCatalogReference(record.cnae ?? record.cnae_data, 7),
    ctn: normalizeFiscalCatalogReference(record.ctn ?? record.ctn_data, 6),
    nbs: normalizeFiscalCatalogReference(record.nbs ?? record.nbs_data, 9),
    config: normalizeTaxRegimeConfig(configSource),
  }
}

function normalizeRetentionOverrides(raw: any) {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}
  return {
    irpj: {
      custom: !!record.irpj?.custom,
      value: normalizeRateDigits(record.irpj?.value ?? record.irpj_retido ?? ''),
    },
    csll: {
      custom: !!record.csll?.custom,
      value: normalizeRateDigits(record.csll?.value ?? record.csll_retido ?? ''),
    },
    pis: {
      custom: !!record.pis?.custom,
      value: normalizeRateDigits(record.pis?.value ?? record.pis_retido ?? ''),
    },
    cofins: {
      custom: !!record.cofins?.custom,
      value: normalizeRateDigits(record.cofins?.value ?? record.cofins_retido ?? ''),
    },
    ibs: {
      custom: !!record.ibs?.custom,
      value: normalizeRateDigits(record.ibs?.value ?? record.ibs_retido ?? ''),
    },
    cbs: {
      custom: !!record.cbs?.custom,
      value: normalizeRateDigits(record.cbs?.value ?? record.cbs_retido ?? ''),
    },
  }
}

function normalizePromotoraFiscalConfiguration(raw: any): PromotoraFiscalConfiguration {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}
  const figureSnapshot = normalizeFiscalFigureSnapshot(record.figure_snapshot ?? record.figure ?? record.fiscal_figure ?? record)
  const overrides = normalizeRetentionOverrides(record.retention_overrides ?? record.retencoes ?? record.retention)

  return {
    id: record.id ? String(record.id) : `prom-fiscal-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    remuneration_type_id: normalizeText(record.remuneration_type_id ?? record.tipo_remuneracao_id ?? '', 80),
    remuneration_type_name: normalizeText(record.remuneration_type_name ?? record.tipo_remuneracao_nome ?? '', 120),
    nfse_emission_type_id: normalizeText(record.nfse_emission_type_id ?? record.tipo_emissao_nfse_id ?? '', 80),
    nfse_emission_type_name: normalizeText(record.nfse_emission_type_name ?? record.tipo_emissao_nfse_nome ?? '', 120),
    company_profile_id: normalizeText(record.company_profile_id ?? record.empresa_contratada_id ?? '', 80),
    company_profile_name: normalizeText(record.company_profile_name ?? record.empresa_contratada_nome ?? '', 120),
    figure_id: normalizeText(record.figure_id ?? figureSnapshot.id ?? '', 80),
    figure_label: normalizeText(record.figure_label ?? buildFigureLabel(figureSnapshot), 220),
    figure_snapshot: figureSnapshot,
    effective_from: normalizeText(record.effective_from ?? record.vigencia_inicio ?? '', 10),
    effective_to:
      record.effective_to === null
        ? null
        : normalizeText(record.effective_to ?? record.vigencia_fim ?? '', 10) || null,
    meio_envio_nfse: record.meio_envio_nfse === 'sistema' ? 'sistema' : 'email',
    nfse_email: normalizeText(record.nfse_email ?? '', 120).toLowerCase(),
    nfse_system_url: normalizeText(record.nfse_system_url ?? '', 500),
    retention_overrides: overrides,
  }
}

function hasLegacyFiscalFields(raw: RawRecord) {
  return Boolean(
    raw.exige_nfse ||
      raw.nfse_emission_type_id ||
      raw.simples_nacional ||
      raw.iss ||
      raw.irpj_retido ||
      raw.csll_retido ||
      raw.pis_retido ||
      raw.cofins_retido ||
      raw.cbs_retido ||
      raw.ibs_retido ||
      raw.total_retencoes ||
      raw.nfse_email ||
      raw.nfse_system_url,
  )
}

function normalizeLegacyFiscalConfiguration(raw: RawRecord): PromotoraFiscalConfiguration {
  const figureSnapshot = createEmptyFiscalFigure()
  figureSnapshot.tax_regime_name = normalizeText(raw.fiscal_label ?? raw.regime_name ?? 'Configuração legada', 120)
  figureSnapshot.config = normalizeTaxRegimeConfig({
    section_1: {
      simples_nacional: { enabled: !!raw.simples_nacional, value: normalizeRateDigits(raw.simples_nacional) } as TaxRateField,
      iss: { enabled: !!raw.iss, value: normalizeRateDigits(raw.iss) } as TaxRateField,
    },
    section_2: {
      pis: { enabled: !!raw.pis_retido, value: normalizeRateDigits(raw.pis_retido) } as TaxRateField,
      cofins: { enabled: !!raw.cofins_retido, value: normalizeRateDigits(raw.cofins_retido) } as TaxRateField,
      accepts_credit: false,
    },
    section_3: {
      ibs: { enabled: !!raw.ibs_retido, value: normalizeRateDigits(raw.ibs_retido) } as TaxRateField,
      cbs: { enabled: !!raw.cbs_retido, value: normalizeRateDigits(raw.cbs_retido) } as TaxRateField,
    },
    section_4: {
      irpj: { enabled: !!raw.irpj_retido, value: normalizeRateDigits(raw.irpj_retido) } as TaxRateField,
      csll: { enabled: !!raw.csll_retido, value: normalizeRateDigits(raw.csll_retido) } as TaxRateField,
      pis: { enabled: !!raw.pis_retido, value: normalizeRateDigits(raw.pis_retido) } as TaxRateField,
      cofins: { enabled: !!raw.cofins_retido, value: normalizeRateDigits(raw.cofins_retido) } as TaxRateField,
      ibs: { enabled: !!raw.ibs_retido, value: normalizeRateDigits(raw.ibs_retido) } as TaxRateField,
      cbs: { enabled: !!raw.cbs_retido, value: normalizeRateDigits(raw.cbs_retido) } as TaxRateField,
    },
  })

  return {
    id: `prom-fiscal-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    remuneration_type_id: normalizeText(raw.remuneration_type_id ?? '', 80),
    remuneration_type_name: normalizeText(raw.remuneration_type_name ?? '', 120),
    nfse_emission_type_id: normalizeText(raw.nfse_emission_type_id ?? '', 80),
    nfse_emission_type_name: normalizeText(raw.nfse_emission_type_name ?? '', 120),
    company_profile_id: normalizeText(raw.company_profile_id ?? raw.empresa_contratada_id ?? '', 80),
    company_profile_name: normalizeText(raw.company_profile_name ?? raw.empresa_contratada_nome ?? '', 120),
    figure_id: '',
    figure_label: 'Configuração legada',
    figure_snapshot: figureSnapshot,
    effective_from: normalizeText(raw.effective_from ?? '', 10),
    effective_to: normalizeText(raw.effective_to ?? '', 10) || null,
    meio_envio_nfse: raw.meio_envio_nfse === 'sistema' ? 'sistema' : 'email',
    nfse_email: normalizeText(raw.nfse_email ?? '', 120).toLowerCase(),
    nfse_system_url: normalizeText(raw.nfse_system_url ?? '', 500),
    retention_overrides: normalizeRetentionOverrides(raw),
  }
}

export function normalizePromotoraFiscalData(raw: any): PromotoraFiscalData {
  const record = raw && typeof raw === 'object' ? (raw as RawRecord) : {}
  const configsRaw = Array.isArray(record.configurations)
    ? record.configurations
    : Array.isArray(record.fiscal_configurations)
      ? record.fiscal_configurations
      : Array.isArray(record.configuracoes)
        ? record.configuracoes
        : []

  if (configsRaw.length > 0) {
    return {
      configurations: configsRaw.map((config) => normalizePromotoraFiscalConfiguration(config)),
      exige_nfse: !!record.exige_nfse,
      nfse_emission_type_id: normalizeText(record.nfse_emission_type_id ?? ''),
      simples_nacional: normalizePercent(record.simples_nacional),
      iss: normalizePercent(record.iss),
      irpj_retido: normalizePercent(record.irpj_retido),
      csll_retido: normalizePercent(record.csll_retido),
      pis_retido: normalizePercent(record.pis_retido),
      cofins_retido: normalizePercent(record.cofins_retido),
      cbs_retido: normalizePercent(record.cbs_retido),
      ibs_retido: normalizePercent(record.ibs_retido),
      total_retencoes: normalizePercent(record.total_retencoes),
      meio_envio_nfse: record.meio_envio_nfse === 'sistema' ? 'sistema' : 'email',
      nfse_email: normalizeText(record.nfse_email ?? '').toLowerCase(),
      nfse_system_url: normalizeText(record.nfse_system_url ?? ''),
    }
  }

  const hasLegacy = hasLegacyFiscalFields(record)
  return {
    configurations: hasLegacy ? [normalizeLegacyFiscalConfiguration(record)] : [],
    exige_nfse: !!record.exige_nfse,
    nfse_emission_type_id: normalizeText(record.nfse_emission_type_id ?? ''),
    simples_nacional: normalizePercent(record.simples_nacional),
    iss: normalizePercent(record.iss),
    irpj_retido: normalizePercent(record.irpj_retido),
    csll_retido: normalizePercent(record.csll_retido),
    pis_retido: normalizePercent(record.pis_retido),
    cofins_retido: normalizePercent(record.cofins_retido),
    cbs_retido: normalizePercent(record.cbs_retido),
    ibs_retido: normalizePercent(record.ibs_retido),
    total_retencoes: normalizePercent(record.total_retencoes),
    meio_envio_nfse: record.meio_envio_nfse === 'sistema' ? 'sistema' : 'email',
    nfse_email: normalizeText(record.nfse_email ?? '').toLowerCase(),
    nfse_system_url: normalizeText(record.nfse_system_url ?? ''),
  }
}

function normalizeUfList(value: any) {
  const list = Array.isArray(value) ? value : String(value || '').split(',')
  return [...new Set(list.map((uf) => normalizeText(uf).toUpperCase()).filter(Boolean))].sort()
}

function normalizeStringArray(value: any) {
  const list = Array.isArray(value) ? value : String(value || '').split(',')
  return [...new Set(list.map((item) => normalizeText(item)).filter(Boolean))]
}

export function normalizeCommercialContacts(rows: any): PromotoraCommercialContact[] {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: normalizeText(row?.id) || createId(),
    commercial_type_id: normalizeText(row?.commercial_type_id),
    region_ufs: normalizeUfList(row?.region_ufs),
    cpf: onlyDigits(row?.cpf).slice(0, 11),
    nome_completo: normalizeText(row?.nome_completo),
    data_nascimento: normalizeText(row?.data_nascimento),
    email: normalizeText(row?.email).toLowerCase(),
    whatsapp: onlyDigits(row?.whatsapp).slice(0, 11),
    data_inicial: normalizeText(row?.data_inicial),
    data_final: normalizeText(row?.data_final),
    is_active: row?.is_active !== false,
  })).filter((row) =>
    Boolean(
      row.commercial_type_id ||
      row.region_ufs.length ||
      row.cpf ||
      row.nome_completo ||
      row.data_nascimento ||
      row.email ||
      row.whatsapp ||
      row.data_inicial ||
      row.data_final,
    ),
  )
}

export function normalizeOperationalContacts(rows: any): PromotoraOperationalContact[] {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: normalizeText(row?.id) || createId(),
    sector_id: normalizeText(row?.sector_id),
    nome_responsavel: normalizeText(row?.nome_responsavel),
    data_nascimento: normalizeText(row?.data_nascimento),
    whatsapp: onlyDigits(row?.whatsapp).slice(0, 11),
    email: normalizeText(row?.email).toLowerCase(),
    data_inicial: normalizeText(row?.data_inicial),
    data_final: normalizeText(row?.data_final),
    is_active: row?.is_active !== false,
  })).filter((row) =>
    Boolean(
      row.sector_id ||
      row.nome_responsavel ||
      row.data_nascimento ||
      row.whatsapp ||
      row.email ||
      row.data_inicial ||
      row.data_final,
    ),
  )
}

export function normalizeSystems(rows: any): PromotoraSystemEntry[] {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: normalizeText(row?.id) || createId(),
    system_type_id: normalizeText(row?.system_type_id) || normalizeStringArray(row?.system_type_ids)[0] || '',
    descricao: normalizeText(row?.descricao),
    url: normalizeText(row?.url),
    observacoes: normalizeText(row?.observacoes),
    is_active: row?.is_active !== false,
  })).filter((row) =>
    Boolean(row.system_type_id || row.descricao || row.url || row.observacoes),
  )
}

export function createEmptyPromotora(): PromotoraRecord {
  return {
    cnpj: '',
    razao_social: '',
    nome_fantasia: '',
    logo_url: '',
    address_data: {
      cep: '',
      logradouro: '',
      bairro: '',
      cidade: '',
      uf: '',
      numero: '',
      complemento: '',
      site_institucional: '',
      email_principal: '',
      contrato_url: '',
      drive_documentos_url: '',
      drive_logotipos_url: '',
    },
    contacts_commercial: [],
    contacts_operational: [],
    fiscal_data: {
      configurations: [],
    },
    financial_data: {
      realiza_comissao: false,
      solicitar_saque: false,
      saque_dias: [],
      saque_inicio: '',
      saque_fim: '',
      url_sistema: '',
      prazo_pagamento: 1,
      flag_dia_pagamento: false,
      dia_semana_ativo: true,
      dia_semana_valor: '',
      dia_mes_valor: '',
      empresa_contratada_id: '',
      conta_recebimento_index: '',
      forma_recebimento_id: '',
      configurations: [],
    },
    bank_accounts: [createEmptyBankAccount({ is_principal: true })],
    systems: [],
    is_active: true,
  }
}

export function normalizePromotoraRecord(input: Partial<PromotoraRecord> & Record<string, any>): PromotoraRecord {
  const cnpj = onlyDigits(input.cnpj || '').slice(0, 14)
  const baseAddress = input.address_data || {}
  const companyBankData = normalizeCompanyBankAccounts(
    { bank_accounts: Array.isArray(input.bank_accounts) ? input.bank_accounts : [] },
    cnpj,
  )
  const bankAccounts = (companyBankData.bank_accounts || []).filter((account: CompanyBankAccount) =>
    Boolean(
      account.bank_code ||
      account.bank_name ||
      account.bank_ispb ||
      account.bank_full_name ||
      account.bank_logo_data_url ||
      account.name ||
      account.bank_agency ||
      account.bank_account ||
      account.pix_key,
    ),
  )

  const fiscalData: PromotoraFiscalData = normalizePromotoraFiscalData(input.fiscal_data)
  const rawFinancialData = input.financial_data && typeof input.financial_data === 'object' ? (input.financial_data as Record<string, any>) : {}
  const financialConfigurations = normalizeFinancialConfigurations(rawFinancialData)

  const financialData: PromotoraFinancialData = {
    realiza_comissao: !!input.financial_data?.realiza_comissao,
    solicitar_saque: !!input.financial_data?.solicitar_saque,
    saque_dias: normalizeStringArray(input.financial_data?.saque_dias),
    saque_inicio: normalizeText(input.financial_data?.saque_inicio),
    saque_fim: normalizeText(input.financial_data?.saque_fim),
    url_sistema: normalizeText(input.financial_data?.url_sistema),
    prazo_pagamento: Math.max(1, Math.min(99, Number(input.financial_data?.prazo_pagamento || 1) || 1)),
    flag_dia_pagamento: !!input.financial_data?.flag_dia_pagamento,
    dia_semana_ativo: input.financial_data?.dia_semana_ativo !== false,
    dia_semana_valor: normalizeText(input.financial_data?.dia_semana_valor),
    dia_mes_valor: normalizeText(input.financial_data?.dia_mes_valor),
    empresa_contratada_id: normalizeText(input.financial_data?.empresa_contratada_id),
    conta_recebimento_index: normalizeText(input.financial_data?.conta_recebimento_index),
    forma_recebimento_id: normalizeText(input.financial_data?.forma_recebimento_id),
    configurations: financialConfigurations,
    legacy: {
      ...rawFinancialData,
    },
  }

  const normalizedBankAccounts = bankAccounts

  return {
    id: input.id,
    cnpj,
    razao_social: normalizeText(input.razao_social),
    nome_fantasia: normalizeText(input.nome_fantasia),
    logo_url: normalizeText(input.logo_url),
    address_data: {
      cep: normalizeText(baseAddress.cep),
      logradouro: normalizeText(baseAddress.logradouro),
      bairro: normalizeText(baseAddress.bairro),
      cidade: normalizeText(baseAddress.cidade),
      uf: normalizeText(baseAddress.uf).toUpperCase(),
      numero: normalizeText(baseAddress.numero),
      complemento: normalizeText(baseAddress.complemento),
      site_institucional: normalizeText(baseAddress.site_institucional),
      email_principal: normalizeText(baseAddress.email_principal).toLowerCase(),
      contrato_url: normalizeText(baseAddress.contrato_url),
      drive_documentos_url: normalizeText(baseAddress.drive_documentos_url),
      drive_logotipos_url: normalizeText(baseAddress.drive_logotipos_url),
    },
    contacts_commercial: normalizeCommercialContacts(input.contacts_commercial),
    contacts_operational: normalizeOperationalContacts(input.contacts_operational),
    fiscal_data: fiscalData,
    financial_data: financialData,
    bank_accounts: normalizedBankAccounts,
    systems: normalizeSystems(input.systems),
    is_active: input.is_active !== false,
    deleted_at: input.deleted_at ?? null,
    created_at: input.created_at,
    updated_at: input.updated_at,
  }
}
