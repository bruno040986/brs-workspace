'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { formatCnaeCode } from '@/lib/cnaes'
import { formatCtnCode } from '@/lib/ctns'
import { formatNbsCode } from '@/lib/nbs'
import { getTaxRegimeTotals, formatPercentSequence, type TaxRateField } from '@/lib/tax-regimes'
import { createEmptyFiscalFigure, normalizeCompanyFiscalData, type CompanyFiscalData, type FiscalFigureRecord } from '@/lib/company-fiscal-data'
import { calcularImpostoComissao } from '@/lib/comissao-liquida'
import type { PromotoraLookupPayload } from '../actions'
import type { PromotoraFiscalConfiguration, PromotoraFiscalData, PromotoraFiscalRetentionOverride } from '@/lib/promotoras'

type Props = {
  value: PromotoraFiscalData
  companyFiscalData: CompanyFiscalData | null
  companyLabel?: string
  companyId?: string
  lookups: PromotoraLookupPayload | null
  disabled?: boolean
  onChange: (next: PromotoraFiscalData) => void
  onAutoSave?: () => void | Promise<void>
  /** Instituições Financeiras: habilita a flag de imposto da comissão líquida. */
  enableComissaoLiquida?: boolean
}

type SectionField = {
  key: string
  label: string
  field: TaxRateField
}

type RetentionKey = 'irpj' | 'csll' | 'pis' | 'cofins' | 'ibs' | 'cbs'

function createId() {
  return globalThis.crypto?.randomUUID?.() || `prom-fiscal-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function cloneFigure(figure: FiscalFigureRecord) {
  return typeof structuredClone === 'function'
    ? structuredClone(figure)
    : (JSON.parse(JSON.stringify(figure)) as FiscalFigureRecord)
}

function normalizeDigits(value: string) {
  return String(value || '').replace(/\D/g, '').slice(0, 4)
}

function emptyOverride(): PromotoraFiscalRetentionOverride {
  return { custom: false, value: '' }
}

function emptyConfig(): PromotoraFiscalConfiguration {
  const figure = createEmptyFiscalFigure()
  return {
    id: createId(),
    remuneration_type_id: '',
    remuneration_type_name: '',
    nfse_emission_type_id: '',
    nfse_emission_type_name: '',
    company_profile_id: '',
    company_profile_name: '',
    figure_id: '',
    figure_label: '',
    figure_snapshot: figure,
    effective_from: '',
    effective_to: null,
    meio_envio_nfse: 'email',
    nfse_email: '',
    nfse_system_url: '',
    retention_overrides: {
      irpj: emptyOverride(),
      csll: emptyOverride(),
      pis: emptyOverride(),
      cofins: emptyOverride(),
      ibs: emptyOverride(),
      cbs: emptyOverride(),
    },
  }
}

function formatFigureLabel(figure: FiscalFigureRecord) {
  const parts = [
    figure.cnae?.code ? formatCnaeCode(String(figure.cnae.code || '')) : '',
    figure.ctn?.code ? formatCtnCode(String(figure.ctn.code || '')) : '',
    figure.nbs?.code ? formatNbsCode(String(figure.nbs.code || '')) : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' > ') : 'Figura sem código'
}

function formatDateDisplay(value: string | null | undefined) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-')
    return `${day}/${month}/${year}`
  }
  return raw
}

function formatCatalogDisplay(code: string, description: string, fallback: string, formatter: (value: string) => string) {
  const formattedCode = formatter(code)
  const cleanDescription = String(description || '').trim()
  if (formattedCode && cleanDescription) return `${formattedCode} - ${cleanDescription}`
  if (formattedCode) return formattedCode
  if (cleanDescription) return cleanDescription
  return fallback
}

function FigureCatalogSummary({ figure }: { figure: FiscalFigureRecord }) {
  const items = [
    {
      label: 'CNAE',
      value: formatCatalogDisplay(figure.cnae?.code || '', figure.cnae?.description || '', 'CNAE não informado', formatCnaeCode),
    },
    {
      label: 'CTN',
      value: formatCatalogDisplay(figure.ctn?.code || '', figure.ctn?.description || '', 'CTN não informado', formatCtnCode),
    },
    {
      label: 'NBS',
      value: formatCatalogDisplay(figure.nbs?.code || '', figure.nbs?.description || '', 'NBS não informado', formatNbsCode),
    },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.8rem' }}>
      {items.map((item) => (
        <div key={item.label} className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">{item.label}</label>
          <input className="form-control" readOnly value={item.value} style={{ background: '#F8FAFC' }} />
        </div>
      ))}
    </div>
  )
}

function buildFigureOptions(companyFiscalData: CompanyFiscalData | null) {
  return (companyFiscalData?.figures || []).map((figure) => ({
    id: figure.id,
    figure,
    label: `${formatFigureLabel(figure)}${figure.tax_regime_name ? ` - ${figure.tax_regime_name}` : ''}`,
  }))
}

function resolveRetentionField(
  baseField: TaxRateField,
  override: PromotoraFiscalRetentionOverride | undefined,
): { value: string; editable: boolean } {
  if (!override?.custom) {
    return { value: baseField.value, editable: false }
  }
  return { value: override.value, editable: true }
}

function SectionValue({
  label,
  field,
  editable = false,
  onChange,
  disabled = false,
}: {
  label: string
  field: TaxRateField
  editable?: boolean
  onChange?: (next: string) => void
  disabled?: boolean
}) {
  const canEdit = !disabled && editable && !!onChange

  return (
    <div style={{ minWidth: 100 }}>
      <div style={{ marginBottom: '0.35rem', fontSize: '0.72rem', fontWeight: 800, color: 'var(--brs-gray-600)', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ position: 'relative', width: 100 }}>
        <input
          className="form-control"
          inputMode={canEdit ? 'numeric' : undefined}
          readOnly={!canEdit}
          disabled={disabled}
          value={formatPercentSequence(field.value)}
          onKeyDown={(event) => {
            if (!canEdit) return
            const key = event.key
            if (key === 'Backspace') {
              event.preventDefault()
              onChange?.(normalizeDigits(field.value.slice(0, -1)))
              return
            }
            if (key === 'Delete') {
              event.preventDefault()
              onChange?.('')
              return
            }
            if (key === 'Tab' || key.startsWith('Arrow') || key === 'Home' || key === 'End') return
            if (/^\d$/.test(key)) {
              event.preventDefault()
              onChange?.(normalizeDigits(`${field.value}${key}`))
              return
            }
            if (key.length === 1) event.preventDefault()
          }}
          onPaste={(event) => {
            if (!canEdit) return
            const digits = event.clipboardData.getData('text').replace(/\D/g, '')
            if (!digits) return
            event.preventDefault()
            onChange?.(normalizeDigits(`${field.value}${digits}`))
          }}
          onChange={(event) => {
            if (!canEdit) return
            onChange?.(normalizeDigits(event.target.value))
          }}
          style={{
            width: '100%',
            minWidth: 100,
            maxWidth: 100,
            boxSizing: 'border-box',
            paddingRight: '1.7rem',
            fontWeight: 800,
            textAlign: 'right',
            background: canEdit ? '#fff' : '#F8FAFC',
          }}
        />
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: '0.55rem',
            top: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            color: 'var(--brs-gray-500)',
            fontSize: '0.9rem',
            fontWeight: 800,
            pointerEvents: 'none',
          }}
        >
          %
        </span>
      </div>
    </div>
  )
}

function TotalField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 112 }}>
      <div style={{ marginBottom: '0.35rem', fontSize: '0.72rem', fontWeight: 800, color: 'var(--brs-gray-600)', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ position: 'relative' }}>
        <input
          className="form-control"
          readOnly
          value={value}
          style={{
            width: 112,
            minWidth: 112,
            maxWidth: 112,
            boxSizing: 'border-box',
            paddingRight: '1.55rem',
            fontWeight: 800,
            textAlign: 'right',
            background: '#EFF6FF',
            borderColor: '#93C5FD',
            color: 'var(--brs-navy)',
          }}
        />
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: '0.55rem',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--brs-navy)',
            fontSize: '0.9rem',
            fontWeight: 800,
            pointerEvents: 'none',
          }}
        >
          %
        </span>
      </div>
    </div>
  )
}

function SectionPreview({
  title,
  description,
  fields,
  showTotal,
  acceptsCredit,
  editable = false,
  disabled = false,
  onChangeField,
}: {
  title: string
  description: string
  fields: SectionField[]
  showTotal?: boolean
  acceptsCredit?: boolean
  editable?: boolean
  disabled?: boolean
  onChangeField?: (key: string, next: string) => void
}) {
  if (fields.length === 0) return null
  const total = getTaxRegimeTotals({
    section_1: {
      simples_nacional: { enabled: false, value: '' },
      iss: { enabled: false, value: '' },
    },
    section_2: {
      pis: fields[0]?.field || { enabled: false, value: '' },
      cofins: fields[1]?.field || { enabled: false, value: '' },
      accepts_credit: !!acceptsCredit,
    },
    section_3: {
      ibs: { enabled: false, value: '' },
      cbs: { enabled: false, value: '' },
    },
    section_4: {
      irpj: { enabled: false, value: '' },
      csll: { enabled: false, value: '' },
      pis: { enabled: false, value: '' },
      cofins: { enabled: false, value: '' },
      ibs: { enabled: false, value: '' },
      cbs: { enabled: false, value: '' },
    },
  }).section_2

  return (
    <div className="card" style={{ padding: '0.95rem', border: '1px solid var(--brs-gray-100)', background: '#fff' }}>
      <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)', marginBottom: '0.25rem' }}>{title}</div>
      <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.84rem', marginBottom: '0.8rem', lineHeight: 1.45 }}>{description}</div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.8rem', flexWrap: 'wrap' }}>
        {fields.map((field, index) => (
          <div key={field.key} style={{ display: 'flex', alignItems: 'flex-end', gap: '0.8rem', flexWrap: 'nowrap' }}>
            <SectionValue
              label={field.label}
              field={field.field}
              editable={editable}
              disabled={disabled}
              onChange={onChangeField ? (next) => onChangeField(field.key, next) : undefined}
            />
            {showTotal && index < fields.length - 1 ? (
              <div style={{ paddingBottom: '0.95rem', color: 'var(--brs-gray-500)', fontSize: '1.15rem', fontWeight: 800 }}>+</div>
            ) : null}
          </div>
        ))}

        {showTotal ? <div style={{ paddingBottom: '0.95rem', color: 'var(--brs-gray-500)', fontSize: '1.15rem', fontWeight: 800 }}>=</div> : null}
        {showTotal ? <TotalField label="Totalizador" value={total} /> : null}
        {typeof acceptsCredit === 'boolean' ? (
          <div style={{ minWidth: 150 }}>
            <div style={{ marginBottom: '0.35rem', fontSize: '0.72rem', fontWeight: 800, color: 'var(--brs-gray-600)', textTransform: 'uppercase' }}>
              Creditamento
            </div>
            <span className={`badge ${acceptsCredit ? 'badge-success' : 'badge-gray'}`}>{acceptsCredit ? 'Sim' : 'Não'}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function RetentionField({
  label,
  baseField,
  override,
  onToggle,
  onChange,
  disabled,
}: {
  label: string
  baseField: TaxRateField
  override: PromotoraFiscalRetentionOverride | undefined
  onToggle: (next: boolean) => void
  onChange: (next: string) => void
  disabled: boolean
}) {
  const resolved = resolveRetentionField(baseField, override)
  const editable = !disabled

  return (
    <div style={{ minWidth: 118, maxWidth: 118 }}>
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.45rem',
          marginBottom: '0.35rem',
          color: 'var(--brs-gray-700)',
          fontSize: '0.88rem',
          fontWeight: 700,
          whiteSpace: 'nowrap',
        }}
      >
        <input type="checkbox" disabled={disabled} checked={!!override?.custom} onChange={(e) => onToggle(e.target.checked)} />
        <span>{label}</span>
      </label>
      <div style={{ position: 'relative', width: 118 }}>
        <input
          className="form-control"
          inputMode="numeric"
          readOnly={!editable}
          disabled={disabled}
          value={formatPercentSequence(resolved.value)}
          onKeyDown={(event) => {
            if (!editable) return
            const key = event.key
            if (key === 'Backspace') {
              event.preventDefault()
              onChange(normalizeDigits(resolved.value.slice(0, -1)))
              return
            }
            if (key === 'Delete') {
              event.preventDefault()
              onChange('')
              return
            }
            if (key === 'Tab' || key.startsWith('Arrow') || key === 'Home' || key === 'End') return
            if (/^\d$/.test(key)) {
              event.preventDefault()
              onChange(normalizeDigits(`${resolved.value}${key}`))
              return
            }
            if (key.length === 1) event.preventDefault()
          }}
          onPaste={(event) => {
            if (!editable) return
            const digits = event.clipboardData.getData('text').replace(/\D/g, '')
            if (!digits) return
            event.preventDefault()
            onChange(normalizeDigits(`${resolved.value}${digits}`))
          }}
          onChange={(event) => {
            if (!editable) return
            onChange(normalizeDigits(event.target.value))
          }}
          style={{
            width: '100%',
            minWidth: 118,
            maxWidth: 118,
            boxSizing: 'border-box',
            paddingRight: '1.7rem',
            fontWeight: 800,
            textAlign: 'right',
            background: editable ? '#fff' : '#F8FAFC',
          }}
        />
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: '0.55rem',
            top: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            color: editable ? 'var(--brs-gray-500)' : 'var(--brs-gray-400)',
            fontSize: '0.9rem',
            fontWeight: 800,
            pointerEvents: 'none',
          }}
        >
          %
        </span>
      </div>
    </div>
  )
}

function RetentionSection({
  title,
  description,
  figure,
  overrides,
  disabled,
  onChangeOverride,
}: {
  title: string
  description: string
  figure: FiscalFigureRecord
  overrides: Partial<Record<RetentionKey, PromotoraFiscalRetentionOverride>>
  disabled: boolean
  onChangeOverride: (key: RetentionKey, next: PromotoraFiscalRetentionOverride) => void
}) {
  const fields = [
    { key: 'irpj', label: 'IRPJ', field: figure.config.section_4.irpj },
    { key: 'csll', label: 'CSLL', field: figure.config.section_4.csll },
    { key: 'pis', label: 'PIS', field: figure.config.section_4.pis },
    { key: 'cofins', label: 'COFINS', field: figure.config.section_4.cofins },
    { key: 'ibs', label: 'IBS', field: figure.config.section_4.ibs },
    { key: 'cbs', label: 'CBS', field: figure.config.section_4.cbs },
  ].filter((item) => item.field.enabled) as Array<{ key: RetentionKey; label: string; field: TaxRateField }>

  const effectiveFields = fields.map((item) => {
    const override = overrides[item.key]
    return {
      key: item.key,
      label: item.label,
      field: {
        enabled: item.field.enabled,
        value: override?.custom ? override.value : item.field.value,
      } satisfies TaxRateField,
    }
  })

  if (fields.length === 0) return null

  const total = getTaxRegimeTotals({
    section_1: {
      simples_nacional: { enabled: false, value: '' },
      iss: { enabled: false, value: '' },
    },
    section_2: {
      pis: { enabled: false, value: '' },
      cofins: { enabled: false, value: '' },
      accepts_credit: false,
    },
    section_3: {
      ibs: { enabled: false, value: '' },
      cbs: { enabled: false, value: '' },
    },
    section_4: {
      irpj: effectiveFields.find((item) => item.key === 'irpj')?.field || { enabled: false, value: '' },
      csll: effectiveFields.find((item) => item.key === 'csll')?.field || { enabled: false, value: '' },
      pis: effectiveFields.find((item) => item.key === 'pis')?.field || { enabled: false, value: '' },
      cofins: effectiveFields.find((item) => item.key === 'cofins')?.field || { enabled: false, value: '' },
      ibs: effectiveFields.find((item) => item.key === 'ibs')?.field || { enabled: false, value: '' },
      cbs: effectiveFields.find((item) => item.key === 'cbs')?.field || { enabled: false, value: '' },
    },
  }).section_4

  return (
    <div className="card" style={{ padding: '0.95rem', border: '1px solid var(--brs-gray-100)', background: '#fff' }}>
      <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)', marginBottom: '0.25rem' }}>{title}</div>
      <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.84rem', marginBottom: '0.8rem', lineHeight: 1.45 }}>{description}</div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.8rem', flexWrap: 'wrap' }}>
        {fields.map((item, index) => {
          const override = overrides[item.key] || emptyOverride()
          return (
            <div key={item.key} style={{ display: 'flex', alignItems: 'flex-end', gap: '0.8rem', flexWrap: 'nowrap' }}>
              <RetentionField
                label={item.label}
                baseField={item.field}
                override={override}
                disabled={disabled}
                onToggle={(next) => {
                  const nextOverride = next
                    ? { custom: true, value: override.value || item.field.value }
                    : { custom: false, value: override.value }
                  onChangeOverride(item.key, nextOverride)
                }}
                onChange={(next) => onChangeOverride(item.key, { custom: true, value: next })}
              />
              {index < fields.length - 1 ? <div style={{ paddingBottom: '0.95rem', color: 'var(--brs-gray-500)', fontSize: '1.15rem', fontWeight: 800 }}>+</div> : null}
            </div>
          )
        })}

        <div style={{ paddingBottom: '0.95rem', color: 'var(--brs-gray-500)', fontSize: '1.15rem', fontWeight: 800 }}>=</div>
        <TotalField label="Totalizador" value={total} />
      </div>
    </div>
  )
}

function ComissaoLiquidaSection({
  config,
  disabled,
  onToggle,
  onChangeAjuste,
}: {
  config: PromotoraFiscalConfiguration
  disabled: boolean
  onToggle: (marcada: boolean) => void
  onChangeAjuste: (valor: string) => void
}) {
  const marcada = config.usar_para_comissao === true
  const resultado = useMemo(() => calcularImpostoComissao(config), [config])

  return (
    <div style={{ border: `1px solid ${marcada ? '#A7F3D0' : 'var(--brs-gray-200)'}`, background: marcada ? '#F0FDF4' : '#F8FAFC', borderRadius: 14, padding: '1rem', display: 'grid', gap: '0.75rem' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: disabled ? 'default' : 'pointer', fontWeight: 700, color: 'var(--brs-gray-900)' }}>
        <input
          type="checkbox"
          disabled={disabled}
          checked={marcada}
          onChange={(e) => onToggle(e.target.checked)}
        />
        Usar esta configuração no cálculo da comissão líquida (Comissionamento)
      </label>
      <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem', marginTop: '-0.4rem' }}>
        Entram na soma o ISS e os impostos passíveis de retenção habilitados (com os overrides acima).
        Impostos com creditamento nunca entram. Flag única por instituição — marcar aqui desmarca as demais.
      </div>

      {marcada ? (
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {resultado.itens.length === 0 ? (
              <span style={{ fontSize: '0.85rem', color: '#92400E' }}>
                Nenhum ISS/retenção habilitado nesta configuração — o total considera só o ajuste adicional.
              </span>
            ) : (
              resultado.itens.map((item) => (
                <span key={item.label} className="badge badge-gray" style={{ background: '#fff' }}>
                  {item.label}: {item.percent.toFixed(2).replace('.', ',')}%
                </span>
              ))
            )}
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ marginBottom: 0, width: 220 }}>
              <label className="form-label">Ajuste adicional (%)</label>
              <input
                className="form-control"
                inputMode="numeric"
                disabled={disabled}
                value={formatPercentSequence(config.comissao_ajuste_adicional || '')}
                onKeyDown={(event) => {
                  const key = event.key
                  const atual = config.comissao_ajuste_adicional || ''
                  if (key === 'Backspace') {
                    event.preventDefault()
                    onChangeAjuste(normalizeDigits(atual.slice(0, -1)))
                    return
                  }
                  if (key === 'Delete') {
                    event.preventDefault()
                    onChangeAjuste('')
                    return
                  }
                  if (key === 'Tab' || key.startsWith('Arrow') || key === 'Home' || key === 'End') return
                  if (/^\d$/.test(key)) {
                    event.preventDefault()
                    onChangeAjuste(normalizeDigits(`${atual}${key}`))
                    return
                  }
                  if (key.length === 1) event.preventDefault()
                }}
                onChange={() => {}}
                placeholder="00,00"
              />
              <div style={{ fontSize: '0.76rem', color: 'var(--brs-gray-400)', marginTop: '0.2rem' }}>
                Arredondamento ou custo % não-tributário que incide sobre o recebido.
              </div>
            </div>
            <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)', fontSize: '1.05rem', paddingBottom: '1.2rem' }}>
              Total p/ comissão líquida: {resultado.totalPercent.toFixed(2).replace('.', ',')}%
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ConfigurationCard({
  config,
  companyFiscalData,
  companyLabel,
  companyId,
  lookups,
  disabled,
  onChange,
  onRemove,
  onAutoSave,
  enableComissaoLiquida,
  onToggleComissao,
}: {
  config: PromotoraFiscalConfiguration
  companyFiscalData: CompanyFiscalData | null
  lookups: PromotoraLookupPayload | null
  disabled: boolean
  onChange: (next: PromotoraFiscalConfiguration) => void
  onRemove: () => void
  onAutoSave?: () => void | Promise<void>
  companyLabel?: string
  companyId?: string
  enableComissaoLiquida?: boolean
  onToggleComissao?: (marcada: boolean) => void
}) {
  const companyName = String(companyLabel || '').trim() || 'Empresa contratada'
  const figureOptions = useMemo(() => buildFigureOptions(companyFiscalData), [companyFiscalData])

  const selectedFigure = useMemo(() => {
    const byId = figureOptions.find((item) => item.id === config.figure_id)
    if (byId) return byId.figure
    if (config.figure_snapshot?.id) return config.figure_snapshot
    return null
  }, [config.figure_id, config.figure_snapshot, figureOptions])

  const configFigure = useMemo(() => {
    if (config.figure_snapshot?.id) return config.figure_snapshot
    if (selectedFigure) return cloneFigure(selectedFigure)
    return createEmptyFiscalFigure()
  }, [config.figure_snapshot, selectedFigure])

  const section1 = [
    { key: 'simples_nacional', label: 'Simples Nacional', field: configFigure.config.section_1.simples_nacional },
    { key: 'iss', label: 'ISS', field: configFigure.config.section_1.iss },
  ].filter((item) => item.field.enabled) as SectionField[]

  const section2 = [
    { key: 'pis', label: 'PIS', field: configFigure.config.section_2.pis },
    { key: 'cofins', label: 'COFINS', field: configFigure.config.section_2.cofins },
  ].filter((item) => item.field.enabled) as SectionField[]

  const section3 = [
    { key: 'ibs', label: 'IBS', field: configFigure.config.section_3.ibs },
    { key: 'cbs', label: 'CBS', field: configFigure.config.section_3.cbs },
  ].filter((item) => item.field.enabled) as SectionField[]

  const remunerationTypes = lookups?.remunerationTypes || []
  const nfseEmissionTypes = lookups?.nfseEmissionTypes || []
  const canSelectFigure = !!companyFiscalData && figureOptions.length > 0

  function update(next: Partial<PromotoraFiscalConfiguration>, save = false) {
    onChange({ ...config, ...next })
    if (save) void onAutoSave?.()
  }

  function updateRetention(key: RetentionKey, next: PromotoraFiscalRetentionOverride) {
    update({
      retention_overrides: {
        ...config.retention_overrides,
        [key]: next,
      },
    }, false)
  }

  function updateFigureSnapshot(mutator: (draft: FiscalFigureRecord) => void) {
    const nextFigure = cloneFigure(configFigure)
    mutator(nextFigure)
    update({
      figure_snapshot: nextFigure,
      figure_label: formatFigureLabel(nextFigure),
    }, false)
  }

  function updateSection1Field(key: string, next: string) {
    updateFigureSnapshot((draft) => {
      if (key === 'simples_nacional' || key === 'iss') {
        draft.config.section_1[key].value = normalizeDigits(next)
      }
    })
  }

  function selectFigure(nextFigureId: string) {
    const nextFigure = figureOptions.find((item) => item.id === nextFigureId)?.figure || null
    if (!nextFigure) {
      update({
        figure_id: '',
        figure_label: '',
        company_profile_id: '',
        company_profile_name: '',
        figure_snapshot: createEmptyFiscalFigure(),
        retention_overrides: {
          irpj: emptyOverride(),
          csll: emptyOverride(),
          pis: emptyOverride(),
          cofins: emptyOverride(),
          ibs: emptyOverride(),
          cbs: emptyOverride(),
        },
      }, false)
      return
    }

    update({
      figure_id: nextFigure.id,
      figure_label: formatFigureLabel(nextFigure),
      company_profile_id: String(companyId || '').trim(),
      company_profile_name: companyName,
      figure_snapshot: cloneFigure(nextFigure),
      retention_overrides: {
        irpj: emptyOverride(),
        csll: emptyOverride(),
        pis: emptyOverride(),
        cofins: emptyOverride(),
        ibs: emptyOverride(),
        cbs: emptyOverride(),
      },
    }, false)
  }

  return (
    <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)', display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: '0.3rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>Configuração Tributária</div>
            <span className={`badge ${config.effective_to ? 'badge-gray' : 'badge-success'}`}>{config.effective_to ? 'Inativa' : 'Ativa'}</span>
            <span className="badge badge-gray" style={{ background: '#F8FAFC', color: 'var(--brs-gray-600)' }}>
              {config.figure_label || 'Sem figura selecionada'}
            </span>
            <span className="badge badge-gray" style={{ background: '#EFF6FF', color: 'var(--brs-navy)' }}>
              {companyName}
            </span>
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.86rem' }}>
            Vincule tipo de remuneração, tipo de emissão e a figura tributária da empresa contratada.
          </div>
        </div>

        {!disabled ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} style={{ color: 'var(--brs-danger)' }}>
            <Trash2 size={16} />
            Remover configuração
          </button>
        ) : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(180px, 1fr))', gap: '0.8rem' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Vigência inicial</label>
          <input
            type="date"
            className="form-control"
            disabled={disabled}
            value={config.effective_from || ''}
            onChange={(e) => update({ effective_from: e.target.value }, false)}
            onBlur={onAutoSave}
          />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Vigência final</label>
          <input
            type="date"
            className="form-control"
            disabled={disabled}
            value={config.effective_to || ''}
            onChange={(e) => update({ effective_to: e.target.value || null }, false)}
            onBlur={onAutoSave}
          />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Status</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            <span className={`badge ${config.effective_to ? 'badge-gray' : 'badge-success'}`}>{config.effective_to ? 'Inativa' : 'Ativa'}</span>
            <span className="badge badge-gray" style={{ background: '#EFF6FF', color: 'var(--brs-navy)' }}>
              {config.effective_from ? `Início: ${formatDateDisplay(config.effective_from)}` : 'Sem vigência inicial'}
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.8rem' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Tipo de Remuneração</label>
          <select
            className="form-control"
            disabled={disabled}
            value={config.remuneration_type_id || ''}
            onChange={(e) => {
              const selected = remunerationTypes.find((item) => item.id === e.target.value)
              update({
                remuneration_type_id: e.target.value,
                remuneration_type_name: selected?.name || '',
              }, false)
            }}
          >
            <option value="">Selecione</option>
            {remunerationTypes.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name}{opt.is_active ? '' : ' (Inativo)'}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Tipo de Emissão de NFSe</label>
          <select
            className="form-control"
            disabled={disabled}
            value={config.nfse_emission_type_id || ''}
            onChange={(e) => {
              const selected = nfseEmissionTypes.find((item) => item.id === e.target.value)
              update({
                nfse_emission_type_id: e.target.value,
                nfse_emission_type_name: selected?.name || '',
              }, false)
            }}
          >
            <option value="">Selecione</option>
            {nfseEmissionTypes.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name}{opt.is_active ? '' : ' (Inativo)'}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Figura Tributária</label>
          <select
            className="form-control"
            disabled={disabled || !canSelectFigure}
            value={config.figure_id || ''}
            onChange={(e) => selectFigure(e.target.value)}
          >
            <option value="">{canSelectFigure ? 'Selecione' : 'Cadastre a empresa contratada primeiro'}</option>
            {figureOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
          {!companyFiscalData ? (
            <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)', marginTop: '0.35rem' }}>
              Escolha uma empresa contratada para liberar a seleção da figura tributária.
            </div>
          ) : figureOptions.length === 0 ? (
            <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)', marginTop: '0.35rem' }}>
              A empresa contratada ainda não possui figuras tributárias cadastradas.
            </div>
          ) : null}
        </div>
      </div>

      {config.figure_id ? (
        <div style={{ borderRadius: 16, border: '1px solid var(--brs-gray-100)', background: 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)', padding: '1rem', display: 'grid', gap: '0.9rem' }}>
          <FigureCatalogSummary figure={configFigure} />
          <SectionPreview
            title="Alíquotas Fixas Sobre a Emissão de NFSe"
            description="Somente um dos campos pode ser habilitado de acordo com a legislação do regime tributário."
            fields={section1}
            editable
            disabled={disabled}
            onChangeField={updateSection1Field}
          />

          <SectionPreview
            title="Alíquotas Federais Fixas Sobre a Emissão de NFSe"
            description="As alíquotas de PIS e COFINS incidem sobre as NFs emitidas e podem ou não ter creditamento de acordo com o regime tributário vigente."
            fields={section2}
            showTotal
            acceptsCredit={configFigure.config.section_2.accepts_credit}
          />

          <SectionPreview
            title="Tributos com Creditamento Pleno"
            description="As alíquotas de IBS e CBS incidem sobre as NFs emitidas e têm creditamento pleno de acordo com a legislação, quando aplicáveis."
            fields={section3}
            showTotal
          />

          <RetentionSection
            title="Impostos Passíveis de Retenção pelo Tomador do Serviço"
            description="Alíquotas máximas para o IRPJ e as CSRF que podem ser retidos pelo tomador do serviço, com base no CNAE, CTN e NBS do serviço prestado."
            figure={configFigure}
            overrides={config.retention_overrides}
            disabled={disabled}
            onChangeOverride={updateRetention}
          />

          {enableComissaoLiquida ? (
            <ComissaoLiquidaSection
              config={config}
              disabled={disabled}
              onToggle={(marcada) => onToggleComissao?.(marcada)}
              onChangeAjuste={(valor) => update({ comissao_ajuste_adicional: valor }, false)}
            />
          ) : null}

          <div className="form-group" style={{ marginBottom: 0, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(180px, 1fr))', gap: '0.8rem' }}>
            <div>
              <label className="form-label">Meio de Envio de NFSe</label>
              <select
                className="form-control"
                disabled={disabled}
                value={config.meio_envio_nfse || 'email'}
                onChange={(e) =>
                  update({
                    meio_envio_nfse: e.target.value === 'sistema' ? 'sistema' : 'email',
                    nfse_email: e.target.value === 'email' ? config.nfse_email : '',
                    nfse_system_url: e.target.value === 'sistema' ? config.nfse_system_url : '',
                  }, false)
                }
              >
                <option value="email">E-mail</option>
                <option value="sistema">Sistema</option>
              </select>
            </div>

            <div>
              <label className="form-label">{config.meio_envio_nfse === 'sistema' ? 'URL do Sistema' : 'E-mail'}</label>
              {config.meio_envio_nfse === 'sistema' ? (
                <input
                  className="form-control"
                  type="url"
                  disabled={disabled}
                  value={config.nfse_system_url || ''}
                  onChange={(e) => update({ nfse_system_url: String(e.target.value || '').trim() }, false)}
                  placeholder="https://..."
                />
              ) : (
                <input
                  className="form-control"
                  type="email"
                  disabled={disabled}
                  value={config.nfse_email || ''}
                  onChange={(e) => update({ nfse_email: String(e.target.value || '').trim().toLowerCase() }, false)}
                  placeholder="email@dominio.com"
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ padding: '1rem', borderRadius: 14, border: '1px dashed var(--brs-gray-200)', background: '#F8FAFC', color: 'var(--brs-gray-500)', fontSize: '0.92rem' }}>
          Selecione uma figura tributária para carregar os campos padrões e liberar as retenções editáveis.
        </div>
      )}
    </div>
  )
}

export default function PromotoraFiscalConfigurations({
  value,
  companyFiscalData,
  companyLabel,
  companyId,
  lookups,
  disabled = false,
  onChange,
  onAutoSave,
  enableComissaoLiquida = false,
}: Props) {
  const configs = value?.configurations || []
  const safeCompanyFiscalData = useMemo(() => normalizeCompanyFiscalData(companyFiscalData), [companyFiscalData])
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null)

  useEffect(() => {
    if (!activeConfigId) return
    const timer = window.setTimeout(() => {
      const node = document.querySelector(`[data-fiscal-config-id="${activeConfigId}"]`)
      if (node instanceof HTMLElement) {
        node.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [activeConfigId, configs.length])

  function commit(nextConfigs: PromotoraFiscalConfiguration[], save = false) {
    onChange({
      ...value,
      configurations: nextConfigs,
    })
    if (save) void onAutoSave?.()
  }

  function addConfig() {
    const nextConfig = emptyConfig()
    setActiveConfigId(nextConfig.id)
    commit([...configs, nextConfig], false)
  }

  function updateConfig(index: number, next: PromotoraFiscalConfiguration, save = false) {
    const nextConfigs = configs.map((config, currentIndex) => (currentIndex === index ? next : config))
    commit(nextConfigs, save)
  }

  function removeConfig(index: number) {
    commit(configs.filter((_, currentIndex) => currentIndex !== index), true)
  }

  // Flag exclusiva: marcar uma configuração desmarca as demais.
  function marcarComissao(index: number, marcada: boolean) {
    const nextConfigs = configs.map((config, currentIndex) => ({
      ...config,
      usar_para_comissao: marcada && currentIndex === index,
    }))
    commit(nextConfigs, false)
  }

  const hasCompanyFigures = (safeCompanyFiscalData?.figures || []).length > 0

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div className="card" style={{ padding: '1rem', display: 'grid', gap: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>Fiscal e Tributário</div>
            <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.88rem', marginTop: '0.2rem' }}>
              Cada configuração vincula remuneração, emissão de NFSe e a figura tributária da empresa contratada.
            </div>
          </div>
          {!disabled ? (
            <button type="button" className="btn btn-outline" onClick={addConfig} disabled={!companyFiscalData || !hasCompanyFigures}>
              <Plus size={16} />
              Nova Configuração Tributária
            </button>
          ) : null}
        </div>

        {!companyFiscalData ? (
          <div style={{ padding: '0.875rem 1rem', borderRadius: 12, border: '1px solid #FDE68A', background: '#FFFBEB', color: '#92400E', fontSize: '0.88rem' }}>
            Selecione uma Empresa Contratada na aba Dados Cadastrais para habilitar as figuras tributárias.
          </div>
        ) : null}
      </div>

      {configs.length === 0 ? (
        <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--brs-gray-500)' }}>
          Nenhuma configuração tributária cadastrada.
        </div>
      ) : (
        configs.map((config, index) => (
          <div key={config.id} data-fiscal-config-id={config.id}>
            <ConfigurationCard
              config={config}
              companyFiscalData={safeCompanyFiscalData}
              companyLabel={companyLabel}
              companyId={companyId}
              lookups={lookups}
              disabled={disabled}
              onChange={(next) => updateConfig(index, next, false)}
              onRemove={() => removeConfig(index)}
              onAutoSave={onAutoSave}
              enableComissaoLiquida={enableComissaoLiquida}
              onToggleComissao={(marcada) => marcarComissao(index, marcada)}
            />
          </div>
        ))
      )}
    </div>
  )
}
