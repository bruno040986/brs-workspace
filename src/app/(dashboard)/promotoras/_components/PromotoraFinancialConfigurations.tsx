'use client'

import { useEffect, useMemo, useState } from 'react'
import { Building2, ChevronDown, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react'
import { formatBankLabel, type CompanyBankAccount } from '@/lib/company-bank-accounts'
import type {
  PromotoraFinancialBiweeklyBoundMode,
  PromotoraFinancialConfiguration,
  PromotoraFinancialData,
  PromotoraFinancialDirectData,
  PromotoraFinancialIndirectData,
  PromotoraFinancialIndirectRequestLine,
  PromotoraFinancialPaymentMode,
  PromotoraFinancialPaymentRange,
  PromotoraFinancialReferencePoint,
  PromotoraFinancialTariffMode,
  PromotoraFinancialWeekDay,
  PromotoraFinancialWeeklyRow,
} from '@/lib/promotoras'
import type { PromotoraLookupPayload } from '../actions'

type RemunerationTypeLookup = {
  id: string
  name: string
  is_active: boolean
}

type Props = {
  value: PromotoraFinancialData
  lookups: PromotoraLookupPayload | null
  availableRemunerationTypes: RemunerationTypeLookup[]
  companyBankAccounts: CompanyBankAccount[]
  disabled?: boolean
  onChange: (next: PromotoraFinancialData) => void
}

const WEEK_DAYS: PromotoraFinancialWeekDay[] = [
  'Segunda-Feira',
  'Terça-Feira',
  'Quarta-Feira',
  'Quinta-Feira',
  'Sexta-Feira',
  'Sábado',
  'Domingo',
]

const WEEKLY_PAYMENT_DAYS: PromotoraFinancialWeekDay[] = [
  'Segunda-Feira',
  'Terça-Feira',
  'Quarta-Feira',
  'Quinta-Feira',
  'Sexta-Feira',
]

const REFERENCE_POINT_OPTIONS: Array<{ value: PromotoraFinancialReferencePoint; label: string }> = [
  { value: 'cadastro', label: 'Cadastro/Digitação' },
  { value: 'cliente', label: 'Pagamento Cliente' },
  { value: 'liberacao', label: 'Liberação' },
]

const PAYMENT_MODES: Array<{ value: PromotoraFinancialPaymentMode; label: string }> = [
  { value: 'direto', label: 'Pagamento Direto' },
  { value: 'indireto', label: 'Pagamento Indireto (Saque Conta Corrente)' },
]

const DIRECT_FREQUENCIES: Array<{ value: PromotoraFinancialDirectData['frequencia']; label: string }> = [
  { value: 'diario', label: 'Pagamento Diário' },
  { value: 'semanal', label: 'Pagamento Semanal' },
  { value: 'quinzenal', label: 'Pagamento Quinzenal' },
  { value: 'mensal', label: 'Pagamento Mensal' },
]

const TARIFF_MODES: Array<{ value: PromotoraFinancialTariffMode; label: string }> = [
  { value: 'R$', label: 'R$' },
  { value: '%', label: '%' },
  { value: 'R$ + %', label: 'R$ + %' },
]

const BIWEEKLY_FIRST_PAYMENT_OPTIONS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15']
const BIWEEKLY_SECOND_PAYMENT_OPTIONS = ['16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', 'ultimo']
const PAYMENT_RANGE_OPTIONS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', 'ultimo']
const WEEKLY_PERIOD_OPTIONS = ['Segunda-Feira', 'Terça-Feira', 'Quarta-Feira', 'Quinta-Feira', 'Sexta-Feira', 'Sábado', 'Domingo']

function createId(prefix = 'prom-fin') {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function digitsOnly(value: string, max = 3) {
  return String(value || '').replace(/\D/g, '').slice(0, max)
}

function formatMoneyValue(value: string) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return ''
  const cents = digits.slice(-2).padStart(2, '0')
  const whole = digits.slice(0, -2) || '0'
  const formattedWhole = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `R$ ${formattedWhole},${cents}`
}

function formatPercentValue(value: string) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return ''
  const cents = digits.slice(-2).padStart(2, '0')
  const whole = digits.slice(0, -2) || '0'
  const formattedWhole = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${formattedWhole},${cents}%`
}

function sanitizeMoneyInput(value: string, maxDigits = 5) {
  return digitsOnly(value, maxDigits)
}

function sanitizePercentInput(value: string, maxDigits = 5) {
  return digitsOnly(value, maxDigits)
}

function sanitizeTime(value: string) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 4)
  if (!digits) return ''
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`
}

function rangeLabel(value: string) {
  if (value === 'ultimo') return 'Último dia do mês'
  return value
}

function createEmptyPaymentRange(): PromotoraFinancialPaymentRange {
  return { modo: 'fixo', dia_inicial: '', dia_final: '' }
}

function createEmptyWeeklyRow(): PromotoraFinancialWeeklyRow {
  return {
    dia_da_semana: '',
    periodo_tipo: 'fixo',
    periodo_entre_inicio: '',
    periodo_entre_fim: '',
    periodo_fixo_dia: '',
    data_referencia_periodo_fechamento: '',
  }
}

export function createEmptyDirectData(): PromotoraFinancialDirectData {
  return {
    frequencia: 'diario',
    prazo_pagamento: '',
    data_referencia_prazo_pagto: '',
    frequencia_semanal: '1',
    tabela_semanal: [createEmptyWeeklyRow()],
    dia_pagamento_1_quinzena: createEmptyPaymentRange(),
    periodo_fechamento_1_quinzena: createEmptyPaymentRange(),
    dia_pagamento_2_quinzena: createEmptyPaymentRange(),
    periodo_fechamento_2_quinzena: createEmptyPaymentRange(),
    dia_pagamento_mensal: createEmptyPaymentRange(),
    periodo_fechamento_mensal: createEmptyPaymentRange(),
    data_referencia_periodo_fechamento: '',
    valor_minimo_enabled: false,
    valor_minimo_pagto: '',
    tarifa_enabled: false,
    tarifa_tipo: 'R$',
    tarifa_valor_real: '',
    tarifa_valor_percentual: '',
  }
}

export function createEmptyIndirectData(): PromotoraFinancialIndirectData {
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

function createEmptyConfiguration(): PromotoraFinancialConfiguration {
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
    direct: createEmptyDirectData(),
    indirect: createEmptyIndirectData(),
  }
}

function normalizeUrlValue(value: string) {
  return String(value || '').trim()
}

function inputDigitsValue(value: string, max = 3) {
  return String(value || '').replace(/\D/g, '').slice(0, max)
}

function copyToClipboard(value: string) {
  if (typeof navigator === 'undefined') return false
  const text = String(value || '').trim()
  if (!text) return false
  navigator.clipboard?.writeText(text).catch(() => {})
  return true
}

export function SummaryBadge({ children }: { children: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0.2rem 0.55rem',
        borderRadius: 999,
        background: 'rgba(39, 64, 132, 0.08)',
        color: 'var(--brs-navy)',
        fontSize: '0.75rem',
        fontWeight: 800,
      }}
    >
      {children}
    </span>
  )
}

function PaymentRangeField({
  label,
  value,
  disabled,
  modeOptions,
  betweenOptions,
  fixedOptions,
  onChange,
}: {
  label: string
  value: PromotoraFinancialPaymentRange
  disabled: boolean
  modeOptions: Array<{ value: PromotoraFinancialBiweeklyBoundMode; label: string }>
  betweenOptions: string[]
  fixedOptions: string[]
  onChange: (next: PromotoraFinancialPaymentRange) => void
}) {
  const between = value.modo === 'entre'
  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <label className="form-label">{label}</label>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.6rem', alignItems: 'center' }}>
        <select
          className="form-control"
          disabled={disabled}
          value={value.modo}
          onChange={(e) => onChange({ ...value, modo: e.target.value === 'entre' ? 'entre' : 'fixo' })}
        >
          {modeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {between ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--brs-gray-600)', fontWeight: 700 }}>Entre</span>
            <select className="form-control" disabled={disabled} style={{ minWidth: 110 }} value={value.dia_inicial} onChange={(e) => onChange({ ...value, dia_inicial: e.target.value })}>
              <option value="">Selecione</option>
              {betweenOptions.map((opt) => <option key={opt} value={opt}>{rangeLabel(opt)}</option>)}
            </select>
            <span style={{ color: 'var(--brs-gray-600)', fontWeight: 700 }}>a</span>
            <select className="form-control" disabled={disabled} style={{ minWidth: 110 }} value={value.dia_final} onChange={(e) => onChange({ ...value, dia_final: e.target.value })}>
              <option value="">Selecione</option>
              {betweenOptions.map((opt) => <option key={opt} value={opt}>{rangeLabel(opt)}</option>)}
            </select>
          </div>
        ) : (
          <select className="form-control" disabled={disabled} value={value.dia_inicial || value.dia_final} onChange={(e) => onChange({ ...value, dia_inicial: e.target.value, dia_final: e.target.value })}>
            <option value="">Selecione</option>
            {fixedOptions.map((opt) => <option key={opt} value={opt}>{rangeLabel(opt)}</option>)}
          </select>
        )}
      </div>
    </div>
  )
}

function WeekPeriodField({
  value,
  disabled,
  compact = false,
  onChange,
}: {
  value: PromotoraFinancialWeeklyRow
  disabled: boolean
  compact?: boolean
  onChange: (next: PromotoraFinancialWeeklyRow) => void
}) {
  const between = value.periodo_tipo === 'entre'
  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      {!compact ? <label className="form-label">Período de Fechamento</label> : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
        <select className="form-control" disabled={disabled} value={value.periodo_tipo} onChange={(e) => onChange({ ...value, periodo_tipo: e.target.value === 'entre' ? 'entre' : 'fixo' })}>
          <option value="entre">Entre</option>
          <option value="fixo">Dia Fixo</option>
        </select>
        {between ? (
          <>
            <span style={{ color: 'var(--brs-gray-600)', fontWeight: 700 }}>Entre</span>
            <select className="form-control" disabled={disabled} value={value.periodo_entre_inicio} onChange={(e) => onChange({ ...value, periodo_entre_inicio: e.target.value as PromotoraFinancialWeekDay | '' })}>
              <option value="">Selecione</option>
              {WEEKLY_PERIOD_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
            <span style={{ color: 'var(--brs-gray-600)', fontWeight: 700 }}>e</span>
            <select className="form-control" disabled={disabled} value={value.periodo_entre_fim} onChange={(e) => onChange({ ...value, periodo_entre_fim: e.target.value as PromotoraFinancialWeekDay | '' })}>
              <option value="">Selecione</option>
              {WEEKLY_PERIOD_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </>
        ) : (
          <select className="form-control" disabled={disabled} value={value.periodo_fixo_dia} onChange={(e) => onChange({ ...value, periodo_fixo_dia: e.target.value as PromotoraFinancialWeekDay | '' })}>
            <option value="">Selecione</option>
            {WEEKLY_PERIOD_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        )}
      </div>
    </div>
  )
}

function InstitutionAutocomplete({
  value,
  institutions,
  disabled,
  onChange,
}: {
  value: { id: string; name: string; logo_url: string }
  institutions: NonNullable<PromotoraLookupPayload['financialInstitutions']>
  disabled: boolean
  onChange: (next: { id: string; name: string; logo_url: string }) => void
}) {
  const [query, setQuery] = useState(value.name || '')
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    setQuery(value.name || '')
    setIsOpen(false)
  }, [value.id, value.name])

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (text.length < 3) return []
    return institutions.filter((item) => {
      const haystack = `${item.name} ${item.id}`.toLowerCase()
      return haystack.includes(text)
    }).slice(0, 8)
  }, [institutions, query])

  const showSuggestions = !disabled && isOpen && query.trim().length >= 3 && filtered.length > 0

  return (
    <div className="form-group" style={{ marginBottom: 0, position: 'relative' }}>
      <label className="form-label">Instituição Financeira</label>
      <input
        className="form-control"
        disabled={disabled}
        value={query}
        placeholder="Digite ao menos 3 caracteres"
        onFocus={() => {
          if (query.trim().length >= 3) setIsOpen(true)
        }}
        onChange={(e) => {
          const next = e.target.value
          setQuery(next)
          setIsOpen(true)
          if (value.id && next.trim() !== value.name) {
            onChange({ id: '', name: '', logo_url: '' })
          }
          if (!next.trim()) onChange({ id: '', name: '', logo_url: '' })
        }}
        onBlur={() => {
          window.setTimeout(() => setIsOpen(false), 120)
        }}
      />
      {showSuggestions ? (
        <div
          style={{
            position: 'absolute',
            zIndex: 20,
            left: 0,
            right: 0,
            top: '4.7rem',
            background: '#fff',
            border: '1px solid var(--brs-gray-200)',
            borderRadius: 14,
            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.12)',
            overflow: 'hidden',
          }}
        >
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault()
                onChange({ id: item.id, name: item.name, logo_url: item.logo_url || '' })
                setQuery(item.name)
                setIsOpen(false)
              }}
              style={{
                width: '100%',
                border: 0,
                background: '#fff',
                textAlign: 'left',
                padding: '0.75rem 0.9rem',
                borderBottom: '1px solid var(--brs-gray-100)',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                gap: '0.75rem',
                alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 700, color: 'var(--brs-gray-800)' }}>{item.name}</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--brs-gray-500)' }}>{item.is_active ? 'Ativa' : 'Inativa'}</span>
            </button>
          ))}
        </div>
      ) : null}
      {!disabled && query.trim().length > 0 && query.trim().length < 3 ? (
        <div style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>
          A pesquisa começa com 3 caracteres.
        </div>
      ) : null}
    </div>
  )
}

export function InstitutionLogo({
  institution,
  placeholderLabel = 'LOGOTIPO DA INSTITUIÇÃO FINANCEIRA',
}: {
  institution: { name: string; logo_url: string } | null
  placeholderLabel?: string
}) {
  return (
    <div
      style={{
        width: 'min(100%, 180px)',
        aspectRatio: '1 / 1',
        minHeight: 0,
        justifySelf: 'end',
        alignSelf: 'start',
        border: '1px solid var(--brs-gray-200)',
        borderRadius: 18,
        background: '#fff',
        display: 'grid',
        placeItems: 'center',
        padding: '0.7rem',
      }}
    >
      {institution?.logo_url ? (
        <img src={institution.logo_url} alt={institution.name || 'Logotipo da instituição financeira'} style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center' }} />
      ) : (
        <div style={{ textAlign: 'center', color: 'var(--brs-gray-400)', display: 'grid', placeItems: 'center', gap: '0.45rem', maxWidth: '10rem' }}>
          <Building2 size={28} />
          <div style={{ fontWeight: 800, lineHeight: 1.2, fontSize: '0.78rem' }}>{placeholderLabel}</div>
        </div>
      )}
    </div>
  )
}

function TariffFields({
  title,
  enabled,
  type,
  realValue,
  percentValue,
  disabled,
  showToggle = true,
  onToggle,
  onTypeChange,
  onChangeReal,
  onChangePercent,
}: {
  title: string
  enabled: boolean
  type: PromotoraFinancialTariffMode
  realValue: string
  percentValue: string
  disabled: boolean
  showToggle?: boolean
  onToggle: (next: boolean) => void
  onTypeChange: (next: PromotoraFinancialTariffMode) => void
  onChangeReal: (next: string) => void
  onChangePercent: (next: string) => void
}) {
  const active = showToggle ? enabled : true

  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      {showToggle ? (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, color: 'var(--brs-gray-700)' }}>
          <input type="checkbox" disabled={disabled} checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
          {title}
        </label>
      ) : (
        <label className="form-label">{title}</label>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '0.6rem', marginTop: '0.45rem' }}>
        <select className="form-control" disabled={disabled || !active} value={type} onChange={(e) => onTypeChange(e.target.value as PromotoraFinancialTariffMode)}>
          {TARIFF_MODES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {(type === 'R$' || type === 'R$ + %') && (
            <input
              className="form-control"
              disabled={disabled || !active}
              value={formatMoneyValue(realValue)}
              inputMode="numeric"
              placeholder="R$ 0,00"
              onChange={(e) => onChangeReal(sanitizeMoneyInput(e.target.value, 8))}
              style={{ width: 160 }}
            />
          )}
          {(type === '%' || type === 'R$ + %') && (
            <input
              className="form-control"
              disabled={disabled || !active}
              value={formatPercentValue(percentValue)}
              inputMode="numeric"
              placeholder="0,00%"
              onChange={(e) => onChangePercent(sanitizePercentInput(e.target.value, 8))}
              style={{ width: 160 }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export function DirectFrequencyCard<T extends { direct: PromotoraFinancialDirectData }>({
  config,
  disabled,
  onChange,
}: {
  config: T
  disabled: boolean
  onChange: (next: T) => void
}) {
  const direct = config.direct

  function updateDirect(mutator: (draft: PromotoraFinancialDirectData) => void) {
    const next = cloneValue(config)
    mutator(next.direct)
    onChange(next)
  }

  function updateWeeklyRow(index: number, row: PromotoraFinancialWeeklyRow) {
    updateDirect((draft) => {
      draft.tabela_semanal[index] = row
    })
  }

  function updateMode(nextMode: PromotoraFinancialDirectData['frequencia']) {
    updateDirect((draft) => {
      draft.frequencia = nextMode
      if (nextMode === 'semanal') {
        const desired = Number(draft.frequencia_semanal || '1') || 1
        while (draft.tabela_semanal.length < desired) draft.tabela_semanal.push(createEmptyWeeklyRow())
        draft.tabela_semanal = draft.tabela_semanal.slice(0, desired)
      }
    })
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {DIRECT_FREQUENCIES.map((opt) => (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => updateMode(opt.value)}
            style={{
              border: `1px solid ${direct.frequencia === opt.value ? 'var(--brs-navy)' : 'var(--brs-gray-200)'}`,
              background: direct.frequencia === opt.value ? 'rgba(39, 64, 132, 0.08)' : '#fff',
              color: direct.frequencia === opt.value ? 'var(--brs-navy)' : 'var(--brs-gray-700)',
              borderRadius: 999,
              padding: '0.5rem 0.9rem',
              fontWeight: 800,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {direct.frequencia === 'diario' && (
        <div className="card" style={{ padding: '0.9rem', border: '1px solid var(--brs-gray-200)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '0.85rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Prazo de Pagamento</label>
              <input
                className="form-control"
                disabled={disabled}
                inputMode="numeric"
                maxLength={3}
                value={direct.prazo_pagamento}
                onChange={(e) => updateDirect((draft) => { draft.prazo_pagamento = digitsOnly(e.target.value, 3) })}
                placeholder="999"
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Data de Referência do Prazo de Pagto</label>
              <select className="form-control" disabled={disabled} value={direct.data_referencia_prazo_pagto} onChange={(e) => updateDirect((draft) => { draft.data_referencia_prazo_pagto = e.target.value as PromotoraFinancialReferencePoint })}>
                <option value="">Selecione</option>
                {REFERENCE_POINT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {direct.frequencia === 'semanal' && (
        <div className="card" style={{ padding: '0.9rem', border: '1px solid var(--brs-gray-200)' }}>
          <div style={{ display: 'grid', gap: '0.9rem' }}>
            <div className="form-group" style={{ marginBottom: 0, maxWidth: 220 }}>
              <label className="form-label">Frequência Semanal</label>
              <select
                className="form-control"
                disabled={disabled}
                value={direct.frequencia_semanal}
                onChange={(e) => {
                  const next = e.target.value as PromotoraFinancialDirectData['frequencia_semanal']
                  updateDirect((draft) => {
                    draft.frequencia_semanal = next
                    const desired = Number(next || '1') || 1
                    while (draft.tabela_semanal.length < desired) draft.tabela_semanal.push(createEmptyWeeklyRow())
                    draft.tabela_semanal = draft.tabela_semanal.slice(0, desired)
                  })
                }}
              >
                {['1', '2', '3', '4'].map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                <colgroup>
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '46%' }} />
                  <col style={{ width: '32%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Dia da Semana</th>
                    <th>Período de Fechamento</th>
                    <th>Data de Referência do Período de Fechamento</th>
                  </tr>
                </thead>
                <tbody>
                  {direct.tabela_semanal.map((row, index) => (
                    <tr key={index}>
                      <td>
                        <select className="form-control" disabled={disabled} value={row.dia_da_semana} onChange={(e) => updateWeeklyRow(index, { ...row, dia_da_semana: e.target.value as PromotoraFinancialWeekDay })}>
                          <option value="">Selecione</option>
                          {WEEKLY_PAYMENT_DAYS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      </td>
                      <td>
                        <WeekPeriodField
                          value={row}
                          disabled={disabled}
                          compact
                          onChange={(next) => updateWeeklyRow(index, next)}
                        />
                      </td>
                      <td>
                        <select className="form-control" disabled={disabled} value={row.data_referencia_periodo_fechamento} onChange={(e) => updateWeeklyRow(index, { ...row, data_referencia_periodo_fechamento: e.target.value as PromotoraFinancialReferencePoint })}>
                          <option value="">Selecione</option>
                          {REFERENCE_POINT_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {direct.frequencia === 'quinzenal' && (
        <div className="card" style={{ padding: '0.9rem', border: '1px solid var(--brs-gray-200)' }}>
          <div style={{ display: 'grid', gap: '0.95rem' }}>
            <PaymentRangeField
              label="Dia de Pagamento na 1ª Quinzena"
              value={direct.dia_pagamento_1_quinzena}
              disabled={disabled}
              modeOptions={[
                { value: 'entre', label: 'Entre' },
                { value: 'fixo', label: 'Dia Fixo' },
              ]}
              betweenOptions={BIWEEKLY_FIRST_PAYMENT_OPTIONS}
              fixedOptions={BIWEEKLY_FIRST_PAYMENT_OPTIONS}
              onChange={(next) => updateDirect((draft) => { draft.dia_pagamento_1_quinzena = next })}
            />
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Período de Fechamento da 1ª Quinzena</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--brs-gray-600)', fontWeight: 700 }}>De</span>
                <select className="form-control" disabled={disabled} value={direct.periodo_fechamento_1_quinzena.dia_inicial} onChange={(e) => updateDirect((draft) => { draft.periodo_fechamento_1_quinzena.dia_inicial = e.target.value })}>
                  <option value="">Selecione</option>
                  {PAYMENT_RANGE_OPTIONS.map((opt) => <option key={opt} value={opt}>{rangeLabel(opt)}</option>)}
                </select>
                <span style={{ color: 'var(--brs-gray-600)', fontWeight: 700 }}>a</span>
                <select className="form-control" disabled={disabled} value={direct.periodo_fechamento_1_quinzena.dia_final} onChange={(e) => updateDirect((draft) => { draft.periodo_fechamento_1_quinzena.dia_final = e.target.value })}>
                  <option value="">Selecione</option>
                  {PAYMENT_RANGE_OPTIONS.map((opt) => <option key={opt} value={opt}>{rangeLabel(opt)}</option>)}
                </select>
              </div>
            </div>
            <PaymentRangeField
              label="Dia de Pagamento na 2ª Quinzena"
              value={direct.dia_pagamento_2_quinzena}
              disabled={disabled}
              modeOptions={[
                { value: 'entre', label: 'Entre' },
                { value: 'fixo', label: 'Dia Fixo' },
              ]}
              betweenOptions={BIWEEKLY_SECOND_PAYMENT_OPTIONS}
              fixedOptions={BIWEEKLY_SECOND_PAYMENT_OPTIONS}
              onChange={(next) => updateDirect((draft) => { draft.dia_pagamento_2_quinzena = next })}
            />
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Período de Fechamento da 2ª Quinzena</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--brs-gray-600)', fontWeight: 700 }}>De</span>
                <select className="form-control" disabled={disabled} value={direct.periodo_fechamento_2_quinzena.dia_inicial} onChange={(e) => updateDirect((draft) => { draft.periodo_fechamento_2_quinzena.dia_inicial = e.target.value })}>
                  <option value="">Selecione</option>
                  {PAYMENT_RANGE_OPTIONS.map((opt) => <option key={opt} value={opt}>{rangeLabel(opt)}</option>)}
                </select>
                <span style={{ color: 'var(--brs-gray-600)', fontWeight: 700 }}>a</span>
                <select className="form-control" disabled={disabled} value={direct.periodo_fechamento_2_quinzena.dia_final} onChange={(e) => updateDirect((draft) => { draft.periodo_fechamento_2_quinzena.dia_final = e.target.value })}>
                  <option value="">Selecione</option>
                  {PAYMENT_RANGE_OPTIONS.map((opt) => <option key={opt} value={opt}>{rangeLabel(opt)}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Data de Referência do Período de Fechamento</label>
              <select className="form-control" disabled={disabled} value={direct.data_referencia_periodo_fechamento} onChange={(e) => updateDirect((draft) => { draft.data_referencia_periodo_fechamento = e.target.value as PromotoraFinancialReferencePoint })}>
                <option value="">Selecione</option>
                {REFERENCE_POINT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {direct.frequencia === 'mensal' && (
        <div className="card" style={{ padding: '0.9rem', border: '1px solid var(--brs-gray-200)' }}>
          <div style={{ display: 'grid', gap: '0.95rem' }}>
            <PaymentRangeField
              label="Dia de Pagamento"
              value={direct.dia_pagamento_mensal}
              disabled={disabled}
              modeOptions={[
                { value: 'entre', label: 'Entre' },
                { value: 'fixo', label: 'Dia Fixo' },
              ]}
              betweenOptions={PAYMENT_RANGE_OPTIONS}
              fixedOptions={PAYMENT_RANGE_OPTIONS}
              onChange={(next) => updateDirect((draft) => { draft.dia_pagamento_mensal = next })}
            />
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Período de Fechamento</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--brs-gray-600)', fontWeight: 700 }}>De</span>
                <select className="form-control" disabled={disabled} value={direct.periodo_fechamento_mensal.dia_inicial} onChange={(e) => updateDirect((draft) => { draft.periodo_fechamento_mensal.dia_inicial = e.target.value })}>
                  <option value="">Selecione</option>
                  {PAYMENT_RANGE_OPTIONS.map((opt) => <option key={opt} value={opt}>{rangeLabel(opt)}</option>)}
                </select>
                <span style={{ color: 'var(--brs-gray-600)', fontWeight: 700 }}>a</span>
                <select className="form-control" disabled={disabled} value={direct.periodo_fechamento_mensal.dia_final} onChange={(e) => updateDirect((draft) => { draft.periodo_fechamento_mensal.dia_final = e.target.value })}>
                  <option value="">Selecione</option>
                  {PAYMENT_RANGE_OPTIONS.map((opt) => <option key={opt} value={opt}>{rangeLabel(opt)}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Data de Referência do Período de Fechamento</label>
              <select className="form-control" disabled={disabled} value={direct.data_referencia_periodo_fechamento} onChange={(e) => updateDirect((draft) => { draft.data_referencia_periodo_fechamento = e.target.value as PromotoraFinancialReferencePoint })}>
                <option value="">Selecione</option>
                {REFERENCE_POINT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.9rem' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, color: 'var(--brs-gray-700)' }}>
            <input
              type="checkbox"
              disabled={disabled}
              checked={direct.valor_minimo_enabled}
              onChange={(e) => updateDirect((draft) => { draft.valor_minimo_enabled = e.target.checked })}
            />
            Valor Mínimo p/ Pagto
          </label>
          <input
            className="form-control"
            disabled={disabled || !direct.valor_minimo_enabled}
            value={formatMoneyValue(direct.valor_minimo_pagto)}
            placeholder="R$ 0,00"
            inputMode="numeric"
            onChange={(e) => updateDirect((draft) => { draft.valor_minimo_pagto = sanitizeMoneyInput(e.target.value, 8) })}
          />
        </div>
        <TariffFields
          title="Tarifa por Pagamento"
          enabled={direct.tarifa_enabled}
          type={direct.tarifa_tipo}
          realValue={direct.tarifa_valor_real}
          percentValue={direct.tarifa_valor_percentual}
          disabled={disabled}
          onToggle={(next) => updateDirect((draft) => { draft.tarifa_enabled = next })}
          onTypeChange={(next) => updateDirect((draft) => { draft.tarifa_tipo = next })}
          onChangeReal={(next) => updateDirect((draft) => { draft.tarifa_valor_real = next })}
          onChangePercent={(next) => updateDirect((draft) => { draft.tarifa_valor_percentual = next })}
        />
      </div>
    </div>
  )
}

export function IndirectRequestLines({
  rows,
  disabled,
  onChange,
}: {
  rows: PromotoraFinancialIndirectRequestLine[]
  disabled: boolean
  onChange: (next: PromotoraFinancialIndirectRequestLine[]) => void
}) {
  function updateRow(index: number, row: PromotoraFinancialIndirectRequestLine) {
    const next = rows.map((item, i) => (i === index ? row : item))
    onChange(next)
  }

  return (
    <div className="card" style={{ padding: '0.9rem', border: '1px solid var(--brs-gray-200)' }}>
      <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)', marginBottom: '0.85rem' }}>Dias e horários de Solicitação de Saque</div>
      <div style={{ display: 'grid', gap: '0.65rem' }}>
        {rows.map((row, index) => (
          <div key={index} style={{ display: 'grid', gridTemplateColumns: '30px 1fr 90px 24px 90px', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              disabled={disabled}
              checked={row.enabled}
              onChange={(e) => updateRow(index, { ...row, enabled: e.target.checked })}
            />
            <select className="form-control" disabled={disabled || !row.enabled} value={row.dia_da_semana} onChange={(e) => updateRow(index, { ...row, dia_da_semana: e.target.value as PromotoraFinancialWeekDay })}>
              <option value="">Dia da Semana</option>
              {WEEK_DAYS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
            <input
              className="form-control"
              disabled={disabled || !row.enabled}
              value={row.hora_inicial}
              inputMode="numeric"
              maxLength={5}
              placeholder="00:00"
              onChange={(e) => updateRow(index, { ...row, hora_inicial: sanitizeTime(e.target.value) })}
            />
            <span style={{ color: 'var(--brs-gray-500)', fontWeight: 800, textAlign: 'center' }}>a</span>
            <input
              className="form-control"
              disabled={disabled || !row.enabled}
              value={row.hora_final}
              inputMode="numeric"
              maxLength={5}
              placeholder="00:00"
              onChange={(e) => updateRow(index, { ...row, hora_final: sanitizeTime(e.target.value) })}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export function IndirectConfigurationCard<T extends { indirect: PromotoraFinancialIndirectData }>({
  config,
  disabled,
  onChange,
}: {
  config: T
  disabled: boolean
  onChange: (next: T) => void
}) {
  function updateIndirect(mutator: (draft: PromotoraFinancialIndirectData) => void) {
    const next = cloneValue(config)
    mutator(next.indirect)
    onChange(next)
  }

  return (
    <div style={{ display: 'grid', gap: '0.95rem' }}>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Prazo de Pagamento na Conta Corrente</label>
        <input
          className="form-control"
          disabled={disabled}
          inputMode="numeric"
          maxLength={3}
          value={config.indirect.prazo_pagamento_conta_corrente}
          onChange={(e) => updateIndirect((draft) => { draft.prazo_pagamento_conta_corrente = inputDigitsValue(e.target.value, 3) })}
        />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Data de Ref do Prazo de Pagto</label>
        <select className="form-control" disabled={disabled} value={config.indirect.data_ref_prazo_pagto} onChange={(e) => updateIndirect((draft) => { draft.data_ref_prazo_pagto = e.target.value as PromotoraFinancialReferencePoint })}>
          <option value="">Selecione</option>
          {REFERENCE_POINT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Saques Gratuitos no Mês</label>
        <input
          className="form-control"
          disabled={disabled}
          inputMode="numeric"
          maxLength={2}
          value={config.indirect.saques_gratuitos_no_mes}
          onChange={(e) => updateIndirect((draft) => { draft.saques_gratuitos_no_mes = inputDigitsValue(e.target.value, 2) })}
        />
      </div>
        <TariffFields
          title="Tarifa por Saque"
          enabled={true}
          type={config.indirect.tarifa_tipo}
          realValue={config.indirect.tarifa_valor_real}
          percentValue={config.indirect.tarifa_valor_percentual}
          disabled={disabled}
          showToggle={false}
          onToggle={(next) => updateIndirect((draft) => { if (!next) { draft.tarifa_tipo = 'R$'; draft.tarifa_valor_real = ''; draft.tarifa_valor_percentual = '' } })}
          onTypeChange={(next) => updateIndirect((draft) => { draft.tarifa_tipo = next })}
          onChangeReal={(next) => updateIndirect((draft) => { draft.tarifa_valor_real = next })}
          onChangePercent={(next) => updateIndirect((draft) => { draft.tarifa_valor_percentual = next })}
        />
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Valor Mínimo p/ Saque</label>
        <input
          className="form-control"
          disabled={disabled}
          value={formatMoneyValue(config.indirect.valor_minimo_saque)}
          placeholder="R$ 0,00"
          inputMode="numeric"
          onChange={(e) => updateIndirect((draft) => { draft.valor_minimo_saque = sanitizeMoneyInput(e.target.value, 5) })}
        />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Prazo de Crédito do Saque</label>
        <input
          className="form-control"
          disabled={disabled}
          inputMode="numeric"
          maxLength={3}
          value={config.indirect.prazo_credito_saque}
          onChange={(e) => updateIndirect((draft) => { draft.prazo_credito_saque = inputDigitsValue(e.target.value, 3) })}
        />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">URL do Sistema para Realização do Saque</label>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            className="form-control"
            disabled={disabled}
            type="url"
            placeholder="https://www.sistemadesaque.com.br/"
            value={config.indirect.url_sistema_saque}
            onChange={(e) => updateIndirect((draft) => { draft.url_sistema_saque = normalizeUrlValue(e.target.value) })}
          />
          <button type="button" className="btn btn-outline btn-sm" disabled={disabled || !config.indirect.url_sistema_saque} onClick={() => copyToClipboard(config.indirect.url_sistema_saque)}>
            <Copy size={14} />
          </button>
        </div>
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Observações Importantes</label>
        <textarea
          className="form-control"
          disabled={disabled}
          maxLength={500}
          placeholder="Observações importantes."
          value={config.indirect.observacoes_importantes}
          onChange={(e) => updateIndirect((draft) => { draft.observacoes_importantes = e.target.value.slice(0, 500) })}
          rows={4}
        />
        <div style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>
          {config.indirect.observacoes_importantes.length}/500 caracteres
        </div>
      </div>
    </div>
  )
}

function FinancialConfigurationCard({
  config,
  index,
  disabled,
  remunerationTypes,
  institutions,
  companyBankAccounts,
  receiptMethods,
  onChange,
  onRemove,
}: {
  config: PromotoraFinancialConfiguration
  index: number
  disabled: boolean
  remunerationTypes: RemunerationTypeLookup[]
  institutions: NonNullable<PromotoraLookupPayload['financialInstitutions']>
  companyBankAccounts: CompanyBankAccount[]
  receiptMethods: NonNullable<PromotoraLookupPayload['receiptMethods']>
  onChange: (next: PromotoraFinancialConfiguration) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(true)

  const selectedInstitution = useMemo(
    () => institutions.find((institution) => institution.id === config.financial_institution_id) || null,
    [config.financial_institution_id, institutions],
  )

  function update(mutator: (draft: PromotoraFinancialConfiguration) => void) {
    const next = cloneValue(config)
    mutator(next)
    onChange(next)
  }

  function updatePaymentMode(nextMode: PromotoraFinancialPaymentMode) {
    update((draft) => {
      draft.payment_mode = nextMode
    })
  }

  function updateDirect(mutator: (draft: PromotoraFinancialDirectData) => void) {
    update((draft) => {
      mutator(draft.direct)
    })
  }

  function updateIndirect(mutator: (draft: PromotoraFinancialIndirectData) => void) {
    update((draft) => {
      mutator(draft.indirect)
    })
  }

  return (
    <div className="card" style={{ padding: '0.95rem', border: '1px solid var(--brs-gray-200)', boxShadow: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: '0.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 900, color: 'var(--brs-gray-900)' }}>Configuração {index + 1}</div>
            <SummaryBadge>{config.payment_mode === 'direto' ? 'Pagamento Direto' : 'Pagamento Indireto'}</SummaryBadge>
            {config.remuneration_type_name ? <SummaryBadge>{config.remuneration_type_name}</SummaryBadge> : null}
            {config.financial_institution_name ? <SummaryBadge>{config.financial_institution_name}</SummaryBadge> : null}
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.84rem' }}>
            Combine tipo de remuneração, instituição financeira e regras de pagamento nesta mesma linha.
          </div>
        </div>
        <div style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen((prev) => !prev)}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {open ? 'Recolher' : 'Expandir'}
          </button>
          {!disabled && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>
              <Trash2 size={14} />
              Remover
            </button>
          )}
        </div>
      </div>

      {open && (
        <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(280px, 0.9fr)', gap: '1rem' }}>
            <div style={{ display: 'grid', gap: '0.9rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '0.9rem' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Tipo de Remuneração</label>
                  <select className="form-control" disabled={disabled} value={config.remuneration_type_id} onChange={(e) => {
                    const selected = remunerationTypes.find((item) => item.id === e.target.value) || null
                    update((draft) => {
                      draft.remuneration_type_id = e.target.value
                      draft.remuneration_type_name = selected?.name || ''
                    })
                  }}>
                    <option value="">Selecione</option>
                    {remunerationTypes.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.name}{opt.is_active ? '' : ' (Inativo)'}
                      </option>
                    ))}
                  </select>
                </div>

                <InstitutionAutocomplete
                  value={{
                    id: config.financial_institution_id,
                    name: config.financial_institution_name,
                    logo_url: config.financial_institution_logo_url,
                  }}
                  institutions={institutions}
                  disabled={disabled}
                  onChange={(next) => update((draft) => {
                    draft.financial_institution_id = next.id
                    draft.financial_institution_name = next.name
                    draft.financial_institution_logo_url = next.logo_url
                  })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.9rem' }}>
                <label className="form-group" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 0, minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={config.prazo_repasse_enabled}
                    disabled={disabled}
                    onChange={(e) => update((draft) => {
                      draft.prazo_repasse_enabled = e.target.checked
                      if (!e.target.checked) draft.prazo_repasse_para_agente = ''
                    })}
                  />
                  Prazo de Repasse para o Agente
                </label>
                <input
                  className="form-control"
                  disabled={disabled || !config.prazo_repasse_enabled}
                  inputMode="numeric"
                  maxLength={3}
                  value={config.prazo_repasse_para_agente}
                  placeholder="999"
                  onChange={(e) => update((draft) => { draft.prazo_repasse_para_agente = digitsOnly(e.target.value, 3) })}
                  style={{ width: 110, justifySelf: 'start' }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Conta Bancária</label>
                <select
                  className="form-control"
                  disabled={disabled || companyBankAccounts.length === 0}
                  value={config.conta_bancaria_index}
                  onChange={(e) => update((draft) => { draft.conta_bancaria_index = e.target.value })}
                >
                  <option value="">{companyBankAccounts.length === 0 ? 'Selecione a empresa contratada' : 'Selecione'}</option>
                  {companyBankAccounts.map((account, accountIndex) => (
                    <option key={account.id || accountIndex} value={String(accountIndex)}>
                      {String(account.name || '').trim() || `Conta ${accountIndex + 1}`}
                    </option>
                  ))}
                </select>
                {!companyBankAccounts.length ? (
                  <div style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>
                    Selecione a empresa contratada para liberar as contas bancárias.
                  </div>
                ) : null}
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Forma de Recebimento</label>
                <select className="form-control" disabled={disabled} value={config.forma_recebimento_id} onChange={(e) => update((draft) => { draft.forma_recebimento_id = e.target.value })}>
                  <option value="">Selecione</option>
                  {receiptMethods.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.name}{opt.is_active ? '' : ' (Inativa)'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <InstitutionLogo institution={selectedInstitution} />
          </div>

          <div className="card" style={{ padding: '0.95rem', border: '1px solid var(--brs-gray-200)' }}>
            <div style={{ fontWeight: 900, color: 'var(--brs-gray-900)', marginBottom: '0.8rem' }}>Frequência de Pagamento</div>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
              {PAYMENT_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => updatePaymentMode(mode.value)}
                  style={{
                    border: `1px solid ${config.payment_mode === mode.value ? 'var(--brs-navy)' : 'var(--brs-gray-200)'}`,
                    background: config.payment_mode === mode.value ? 'rgba(39, 64, 132, 0.08)' : '#fff',
                    color: config.payment_mode === mode.value ? 'var(--brs-navy)' : 'var(--brs-gray-700)',
                    borderRadius: 999,
                    padding: '0.5rem 0.9rem',
                    fontWeight: 800,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            {config.payment_mode === 'direto' ? (
              <DirectFrequencyCard config={config} disabled={disabled} onChange={onChange} />
            ) : (
              <IndirectConfigurationCard config={config} disabled={disabled} onChange={onChange} />
            )}
          </div>

          {config.payment_mode === 'indireto' && (
            <IndirectRequestLines
              rows={config.indirect.dias_horarios_solicitacao_saque}
              disabled={disabled}
              onChange={(rows) => updateIndirect((draft) => { draft.dias_horarios_solicitacao_saque = rows.slice(0, 6) })}
            />
          )}
        </div>
      )}
    </div>
  )
}

export default function PromotoraFinancialConfigurations({
  value,
  lookups,
  availableRemunerationTypes,
  companyBankAccounts,
  disabled = false,
  onChange,
}: Props) {
  const configs = Array.isArray(value.configurations) ? value.configurations : []
  const receiptMethods = lookups?.receiptMethods || []
  const financialInstitutions = lookups?.financialInstitutions || []

  function updateFinancialData(mutator: (draft: PromotoraFinancialData) => void) {
    const next = cloneValue(value)
    mutator(next)
    onChange(next)
  }

  function updateConfiguration(index: number, next: PromotoraFinancialConfiguration) {
    updateFinancialData((draft) => {
      draft.configurations[index] = next
    })
  }

  function addConfiguration() {
    updateFinancialData((draft) => {
      draft.configurations = [...(draft.configurations || []), createEmptyConfiguration()]
    })
  }

  function removeConfiguration(index: number) {
    updateFinancialData((draft) => {
      draft.configurations = draft.configurations.filter((_, i) => i !== index)
    })
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-200)', boxShadow: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
          <div>
            <div style={{ fontWeight: 900, color: 'var(--brs-gray-900)' }}>Configuração Financeira</div>
            <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.84rem' }}>
              Escolha uma ou mais configurações e mantenha a combinação única por remuneração e instituição.
            </div>
          </div>
          {!disabled && (
            <button type="button" className="btn btn-primary" onClick={addConfiguration}>
              <Plus size={16} />
              Nova Configuração
            </button>
          )}
        </div>

      </div>

      {configs.length === 0 ? (
        <div className="card" style={{ padding: '1.25rem', border: '1px dashed var(--brs-gray-300)', textAlign: 'center', color: 'var(--brs-gray-500)' }}>
          <Building2 size={30} style={{ marginBottom: '0.6rem', color: 'var(--brs-gray-300)' }} />
          <div style={{ fontWeight: 800, color: 'var(--brs-gray-800)' }}>Nenhuma configuração financeira adicionada</div>
          <div style={{ marginTop: '0.35rem' }}>Crie pelo menos uma combinação de remuneração e instituição financeira para continuar.</div>
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: '1rem' }}>
        {configs.map((config, index) => (
          <FinancialConfigurationCard
            key={config.id}
            config={config}
            index={index}
            disabled={disabled}
            remunerationTypes={availableRemunerationTypes}
            institutions={financialInstitutions}
            companyBankAccounts={companyBankAccounts}
            receiptMethods={receiptMethods}
            onChange={(next) => updateConfiguration(index, next)}
            onRemove={() => removeConfiguration(index)}
          />
        ))}
      </div>
    </div>
  )
}
