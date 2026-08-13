'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Building2,
  CheckCircle,
  Copy,
  Loader2,
  Plus,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react'
import CopyableFieldShell from '@/components/forms/CopyableFieldShell'
import { avaliarGarantia, type ProducaoMes } from '@/lib/agente-corban-garantia'
import {
  AGENTE_CORBAN_BANK_ACCOUNT_TYPES,
  AGENTE_CORBAN_PERSON_TYPE_LABELS,
  AGENTE_CORBAN_STATUSES,
  formatAgenteCorbanLabel,
  formatAgenteCorbanPersonTypeLabel,
  formatAgenteCorbanStatusLabel,
  formatBankAccountFromSeq,
  formatBankAgencyWithDigitFromSeq,
  formatBankLabel,
  formatPercentValue,
  formatCurrencyDisplay,
  formatCpfOrCnpjDisplay,
  formatDateDisplay,
  createEmptyAgenteCorbanDraft,
  createEmptySocio,
  normalizeArwCodeValue,
  maskCep,
  maskCnpj,
  maskCpf,
  maskEmailInput,
  maskPhone,
  maskUuidInput,
  normalizeGenderValue,
  normalizeShortNumberValue,
  normalizePercentDigits,
  normalizeText,
  onlyDigits,
  parseBankAccountSeq,
  parseBankAgencySeq,
  type AgenteCorbanDraft,
  type AgenteCorbanSocio,
  type AgenteCorbanStatus,
  type BankLookup,
} from '@/lib/agente-corban'
import { getFieldByPath } from '@/lib/agente-corban-fields'
import {
  getDivergenciasReceita,
  getFieldProvenance,
  PROVENANCE_ORIGIN_LABELS,
  type FieldProvenanceEntry,
  type FieldProvenanceMap,
} from '@/lib/agente-corban-provenance'

type CatalogRow = { id: string; name: string; is_active?: boolean }

type CompanyProfileLookup = {
  id: string
  nickname: string
  cnpj?: string | null
  is_active?: boolean
  company_data?: Record<string, any> | null
}

type CommercialEntityLookup = {
  id: string
  name: string
  role?: string | null
  parent_id?: string | null
  status?: string | null
  cadastral_data?: {
    commercial_name?: string | null
  } | null
  arw_code?: string | null
  filial?: string | null
  nivel_acesso?: string | null
  tipo_agente?: string | null
  regra_fisico?: string | null
}

type AgenteCorbanLookups = {
  companyProfiles: CompanyProfileLookup[]
  commercialEntities: CommercialEntityLookup[]
  catalogs: Record<string, CatalogRow[]>
}

type Props = {
  initialDraft: AgenteCorbanDraft
  initialLookups?: AgenteCorbanLookups
}

type Message = { type: 'success' | 'error'; text: string } | null

type TabKey =
  | 'dados-principais'
  | 'contato'
  | 'socios'
  | 'testemunha'
  | 'endereco'
  | 'acesso'
  | 'bancarios'
  | 'garantia'
  | 'documentos'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'dados-principais', label: 'Dados Principais' },
  { key: 'contato', label: 'Contato' },
  { key: 'socios', label: 'Sócios' },
  { key: 'testemunha', label: 'Testemunha' },
  { key: 'endereco', label: 'Endereço' },
  { key: 'acesso', label: 'Acesso' },
  { key: 'bancarios', label: 'Dados Bancários' },
  { key: 'garantia', label: 'Garantia' },
  { key: 'documentos', label: 'Documentos' },
]

const GENDER_OPTIONS = [
  { value: '', label: 'Selecione' },
  { value: 'Masculino', label: 'Masculino' },
  { value: 'Feminino', label: 'Feminino' },
]

const PERSON_TYPE_OPTIONS = [
  { value: '', label: 'Selecione' },
  { value: 'PF', label: AGENTE_CORBAN_PERSON_TYPE_LABELS.PF },
  { value: 'PJ', label: AGENTE_CORBAN_PERSON_TYPE_LABELS.PJ },
]

const RECEIPT_TYPE_OPTIONS = [
  { value: '', label: 'Selecione' },
  { value: 'Transferência – TED', label: 'Transferência – TED' },
  { value: 'Pix', label: 'Pix' },
]

const PAYMENT_PERIOD_OPTIONS = [
  { value: '', label: 'Selecione' },
  { value: 'Diário', label: 'Diário' },
  { value: 'Semanal', label: 'Semanal' },
]

function formatCommercialEntityLabel(entity?: CommercialEntityLookup | null) {
  const commercialName = normalizeText(entity?.cadastral_data?.commercial_name || '')
  const fallbackName = normalizeText(entity?.name || '')
  const baseLabel = commercialName || fallbackName
  if (!baseLabel) return ''
  return `${baseLabel}${entity?.status === 'inativo' ? ' (Inativo)' : ''}`
}

function formatBankAgencyDisplay(seq: string) {
  const digits = onlyDigits(seq).slice(0, 5)
  if (!digits) return ''
  const padded = digits.padStart(5, '0')
  return `${padded.slice(0, 4)}-${padded.slice(4)}`
}

function formatBankAccountDisplay(seq: string) {
  const digits = onlyDigits(seq).slice(0, 11)
  if (!digits) return ''
  const core = digits.slice(0, -1) || '0'
  return `${core}-${digits.slice(-1)}`
}

function inferAppendOnlySequence(prevSeq: string, currentValue: string, maxDigits: number) {
  const prev = String(prevSeq || '').replace(/\D/g, '').slice(0, maxDigits)
  const next = String(currentValue || '').replace(/\D/g, '').slice(0, maxDigits)
  if (!prev) return next
  if (!next) return ''
  if (next.startsWith(prev)) return next.slice(0, maxDigits)
  if (next.length < prev.length) return next
  if (next.length - prev.length > 1) return next.slice(0, maxDigits)
  const lastDigit = next.slice(-1)
  return `${prev}${lastDigit}`.slice(0, maxDigits)
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

  if (key === 'Tab' || key.startsWith('Arrow') || key === 'Home' || key === 'End') return

  const digit = /^\d$/.test(key) ? key : digitFromCode
  if (digit) {
    e.preventDefault()
    if (prevSeq.length >= maxDigits) return
    setSeq((prevSeq + digit).slice(0, maxDigits))
    return
  }

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
  const next = (String(prevSeq || '').replace(/\D/g, '') + digits).slice(0, maxDigits)
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
    setSeq((String(prevSeq || '').replace(/\D/g, '') + dataDigits).slice(0, maxDigits))
    return
  }

  const inferred = inferAppendOnlySequence(prevSeq, e.target.value, maxDigits)
  setSeq(inferred)
}

function getPixTypeOptions(personType: 'PF' | 'PJ') {
  return [
    { value: '', label: 'Selecione' },
    { value: personType === 'PF' ? 'cpf' : 'cnpj', label: personType === 'PF' ? 'CPF' : 'CNPJ' },
    { value: 'phone', label: 'Celular' },
    { value: 'email', label: 'E-mail' },
    { value: 'random', label: 'Aleatória' },
    { value: 'bank', label: 'Dados Bancários' },
  ]
}

function shellInputStyle(): React.CSSProperties {
  return { width: '100%' }
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  helperText,
  copyValue,
  type = 'text',
  inputMode,
  disabled,
  autoComplete,
  name,
  spellCheck,
  autoCapitalize,
  autoCorrect,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  helperText?: string
  copyValue?: string
  type?: React.HTMLInputTypeAttribute
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  disabled?: boolean
  autoComplete?: string
  name?: string
  spellCheck?: boolean
  autoCapitalize?: string
  autoCorrect?: string
}) {
  return (
    <CopyableFieldShell label={label} helperText={helperText} copyValue={copyValue ?? value} displayValue={copyValue ?? value}>
      <input
        className="form-control"
        style={shellInputStyle()}
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        name={name}
        spellCheck={spellCheck}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
      />
    </CopyableFieldShell>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
  helperText,
  disabled,
  copyValue,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  options: Array<{ value: string; label: string }>
  helperText?: string
  disabled?: boolean
  copyValue?: string
}) {
  const selected = options.find((option) => option.value === value)
  return (
    <CopyableFieldShell label={label} helperText={helperText} copyValue={copyValue ?? selected?.label ?? value} displayValue={selected?.label ?? value}>
      <select className="form-control" style={shellInputStyle()} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </CopyableFieldShell>
  )
}

function PasswordField({
  label,
  value,
  onChange,
  helperText,
  placeholder,
  disabled,
  autoComplete,
  name,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  helperText?: string
  placeholder?: string
  disabled?: boolean
  autoComplete?: string
  name?: string
}) {
  return (
    <CopyableFieldShell label={label} helperText={helperText} copyValue={value} displayValue={value} kind="password">
      {({ reveal }) => (
        <input
          className="form-control"
          style={shellInputStyle()}
          type={reveal ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={autoComplete}
          name={name}
        />
      )}
    </CopyableFieldShell>
  )
}

function ReadOnlyField({
  label,
  value,
  helperText,
}: {
  label: string
  value: string
  helperText?: string
}) {
  return (
    <CopyableFieldShell label={label} helperText={helperText} copyValue={value} displayValue={value}>
      <div className="form-control" style={{ ...shellInputStyle(), display: 'flex', alignItems: 'center', background: '#fff', minHeight: 42 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || '—'}</span>
      </div>
    </CopyableFieldShell>
  )
}

function formatDateTimeBr(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso)
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * Aviso "alterado pelo parceiro" de um campo com proveniência de consulta
 * externa. Clique abre o detalhe: valor original, qual API e quando.
 */
function ProvenanceNotice({ entry }: { entry: FieldProvenanceEntry }) {
  const [open, setOpen] = useState(false)
  const fonte = PROVENANCE_ORIGIN_LABELS[entry.origem] || entry.origem
  return (
    <div style={{ marginTop: '0.3rem' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="O parceiro alterou o valor que veio da consulta. Clique para ver o original."
        style={{
          border: '1px solid #FDE68A',
          background: '#FFFBEB',
          color: '#92400E',
          borderRadius: 999,
          padding: '0.1rem 0.55rem',
          fontSize: '0.7rem',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        ⚠ alterado pelo parceiro {open ? '▴' : '▾'}
      </button>
      {open && (
        <div
          style={{
            marginTop: '0.35rem',
            border: '1px solid #FDE68A',
            background: '#FFFBEB',
            borderRadius: 8,
            padding: '0.5rem 0.7rem',
            fontSize: '0.78rem',
            color: '#78350F',
            lineHeight: 1.6,
          }}
        >
          <div>
            <strong>Original ({fonte}):</strong> {entry.valor_api || '—'}
          </div>
          <div>
            <strong>Enviado pelo parceiro:</strong> {entry.valor_final || '—'}
          </div>
          {entry.consultado_em && <div style={{ color: '#92400E' }}>Consulta em {formatDateTimeBr(entry.consultado_em)}</div>}
          {entry.alterado_em && <div style={{ color: '#92400E' }}>Alterado em {formatDateTimeBr(entry.alterado_em)}</div>}
        </div>
      )}
    </div>
  )
}

function BankLookupField({
  value,
  onSelect,
  onQueryChange,
  query,
  options,
  loading,
  open,
  onOpenChange,
}: {
  value: string
  onSelect: (bank: BankLookup) => void
  onQueryChange: (next: string) => void
  query: string
  options: BankLookup[]
  loading: boolean
  open: boolean
  onOpenChange: (next: boolean) => void
}) {
  const displayValue = value || query

  return (
    <CopyableFieldShell label="Banco" copyValue={displayValue} displayValue={displayValue} helperText="Digite ao menos 3 caracteres para buscar pelo código ou nome do banco.">
      <div style={{ position: 'relative' }}>
        <input
          className="form-control"
          style={shellInputStyle()}
          value={query}
          onChange={(e) => {
            const next = e.target.value
            onQueryChange(next)
            onOpenChange(true)
          }}
          onFocus={() => onOpenChange(true)}
          onBlur={() => onOpenChange(false)}
          placeholder={loading ? 'Carregando bancos...' : 'Digite o nome ou o código'}
        />

        {open && query.trim().length >= 3 ? (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 'calc(100% + 6px)',
              zIndex: 20,
              background: '#fff',
              border: '1px solid var(--brs-gray-200)',
              borderRadius: 12,
              boxShadow: '0 16px 40px rgba(15, 23, 42, 0.12)',
              maxHeight: 240,
              overflowY: 'auto',
            }}
          >
            {loading ? (
              <div style={{ padding: '0.9rem', color: 'var(--brs-gray-500)', fontSize: '0.85rem' }}>Carregando bancos...</div>
            ) : options.length > 0 ? (
              options.map((bank) => {
                const label = formatBankLabel(bank)
                return (
                  <button
                    key={`${bank.code}-${bank.name}`}
                    type="button"
                    className="btn btn-ghost"
                    style={{ width: '100%', borderRadius: 0, justifyContent: 'flex-start', padding: '0.8rem 0.9rem' }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onSelect(bank)
                      onOpenChange(false)
                    }}
                  >
                    {label}
                  </button>
                )
              })
            ) : (
              <div style={{ padding: '0.9rem', color: 'var(--brs-gray-500)', fontSize: '0.85rem' }}>Nenhum banco encontrado.</div>
            )}
          </div>
        ) : null}
      </div>
    </CopyableFieldShell>
  )
}

function SectionTitle({
  icon,
  title,
  description,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '1rem' }}>
      {icon ? (
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: 'rgba(39, 64, 132, 0.08)',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--brs-navy)',
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
      ) : null}
      <div>
        <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>{title}</div>
        {description ? <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>{description}</div> : null}
      </div>
    </div>
  )
}

function SocioCard({
  row,
  index,
  onChange,
  onRemove,
  onMakePrincipal,
  onFillCep,
  onFillCpf,
  prov,
}: {
  row: AgenteCorbanSocio
  index: number
  onChange: (next: AgenteCorbanSocio) => void
  onRemove: () => void
  onMakePrincipal: () => void
  onFillCep: () => void
  onFillCpf: () => void | Promise<void>
  /** Aviso de proveniência de um campo deste sócio (ex.: prov('name')). */
  prov?: (field: string) => React.ReactNode
}) {
  return (
    <div className="card" style={{ padding: '1rem', border: row.is_principal ? '1px solid rgba(39, 64, 132, 0.25)' : '1px solid var(--brs-gray-100)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>
            Sócio {index + 1}
            {row.is_principal ? (
              <span style={{ marginLeft: '0.55rem', fontSize: '0.75rem', padding: '0.2rem 0.45rem', borderRadius: 999, background: '#DCFCE7', color: '#166534' }}>
                Principal
              </span>
            ) : null}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>
            Digite o CPF para buscar os dados, se não carregar preencha manualmente.
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={onMakePrincipal}>
            <ShieldCheck size={16} />
            Principal
          </button>
          <button type="button" className="btn btn-outline" onClick={onRemove}>
            Remover
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '0.75rem' }}>
        <div style={{ gridColumn: 'span 3' }}>
          <CopyableFieldShell label="CPF" copyValue={maskCpf(row.cpf || '')} displayValue={maskCpf(row.cpf || '')}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                className="form-control"
                style={{ flex: 1 }}
                value={maskCpf(row.cpf || '')}
                onChange={(e) => onChange({ ...row, cpf: onlyDigits(e.target.value) })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void onFillCpf()
                  }
                }}
                onBlur={() => {
                  if (onlyDigits(row.cpf || '').length === 11) {
                    void onFillCpf()
                  }
                }}
                placeholder="000.000.000-00"
              />
              <button type="button" className="btn btn-outline" onClick={() => void onFillCpf()}>
                Buscar
              </button>
            </div>
          </CopyableFieldShell>
        </div>

        <div style={{ gridColumn: 'span 5' }}>
          <TextField
            label="Nome Completo"
            value={row.name || ''}
            onChange={(next) => onChange({ ...row, name: next })}
            placeholder="Nome completo do sócio"
            copyValue={row.name || ''}
          />
          {prov?.('name')}
        </div>

        <div style={{ gridColumn: 'span 2' }}>
          <SelectField
            label="Gênero"
            value={row.gender || ''}
            onChange={(next) => onChange({ ...row, gender: next })}
            options={GENDER_OPTIONS}
            copyValue={row.gender || ''}
          />
          {prov?.('gender')}
        </div>

        <div style={{ gridColumn: 'span 2' }}>
          <CopyableFieldShell label="Data de Nascimento" copyValue={formatDateDisplay(row.birth_date || '')} displayValue={formatDateDisplay(row.birth_date || '')}>
            <input
              className="form-control"
              type="text"
              inputMode="numeric"
              value={formatDateDisplay(row.birth_date || '')}
              onChange={(e) => onChange({ ...row, birth_date: formatDateDisplay(e.target.value) })}
              placeholder="DD/MM/AAAA"
            />
          </CopyableFieldShell>
          {prov?.('birth_date')}
        </div>
      </div>

      <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--brs-gray-100)' }}>
        <SectionTitle icon={<Users size={18} />} title="Contato e qualificação" description="Necessário para a assinatura eletrônica e a qualificação no contrato." />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '0.75rem' }}>
          <div style={{ gridColumn: 'span 4' }}>
            <TextField label="E-mail" value={row.email || ''} onChange={(next) => onChange({ ...row, email: next })} copyValue={row.email || ''} />
          </div>
          <div style={{ gridColumn: 'span 4' }}>
            <TextField label="WhatsApp" value={maskPhone(row.phone || '')} onChange={(next) => onChange({ ...row, phone: onlyDigits(next) })} copyValue={maskPhone(row.phone || '')} placeholder="(00) 00000-0000" />
          </div>
          <div style={{ gridColumn: 'span 4' }}>
            <TextField label="Estado Civil" value={row.marital_status || ''} onChange={(next) => onChange({ ...row, marital_status: next })} copyValue={row.marital_status || ''} />
          </div>
          <div style={{ gridColumn: 'span 6' }}>
            <TextField label="Profissão" value={row.profession || ''} onChange={(next) => onChange({ ...row, profession: next })} copyValue={row.profession || ''} />
          </div>
          <div style={{ gridColumn: 'span 6' }}>
            <TextField label="Cargo/Função no CNPJ" value={row.company_role || ''} onChange={(next) => onChange({ ...row, company_role: next })} copyValue={row.company_role || ''} placeholder="Sócio-Administrador" />
          </div>
        </div>
      </div>

      <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--brs-gray-100)' }}>
        <SectionTitle icon={<Building2 size={18} />} title="Endereço residencial" description="Digite o CEP para buscar os dados e complete o número e complemento." />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '0.75rem' }}>
          <div style={{ gridColumn: 'span 3' }}>
            <CopyableFieldShell label="CEP" copyValue={maskCep(row.residential_cep || '')} displayValue={maskCep(row.residential_cep || '')}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  className="form-control"
                  style={{ flex: 1 }}
                  value={maskCep(row.residential_cep || '')}
                  onChange={(e) => onChange({ ...row, residential_cep: onlyDigits(e.target.value) })}
                  placeholder="00000-000"
                />
                <button type="button" className="btn btn-outline" onClick={onFillCep}>
                  Buscar
                </button>
                </div>
              </CopyableFieldShell>
            </div>

          <div style={{ gridColumn: 'span 3' }}>
            <TextField
              label="UF Residencial"
              value={row.residential_address_state || ''}
              onChange={(next) => onChange({ ...row, residential_address_state: normalizeText(next).toUpperCase().slice(0, 2) })}
              copyValue={row.residential_address_state || ''}
              placeholder="SP"
            />
          </div>

          <div style={{ gridColumn: 'span 3' }}>
            <TextField
              label="Cidade Residencial"
              value={row.residential_address_city || ''}
              onChange={(next) => onChange({ ...row, residential_address_city: next })}
              copyValue={row.residential_address_city || ''}
            />
          </div>

          <div style={{ gridColumn: 'span 3' }}>
            <TextField
              label="Bairro Residencial"
              value={row.residential_address_neighborhood || ''}
              onChange={(next) => onChange({ ...row, residential_address_neighborhood: next })}
              copyValue={row.residential_address_neighborhood || ''}
            />
          </div>

          <div style={{ gridColumn: 'span 6' }}>
            <TextField
              label="Logradouro / Endereço Residencial"
              value={row.residential_address_street || ''}
              onChange={(next) => onChange({ ...row, residential_address_street: next })}
              copyValue={row.residential_address_street || ''}
            />
          </div>

          <div style={{ gridColumn: 'span 3' }}>
            <TextField
              label="Número Residencial"
              value={normalizeShortNumberValue(row.residential_address_number || '')}
              onChange={(next) => onChange({ ...row, residential_address_number: normalizeShortNumberValue(next) })}
              copyValue={normalizeShortNumberValue(row.residential_address_number || '')}
              inputMode="numeric"
              placeholder="00000"
            />
          </div>

          <div style={{ gridColumn: 'span 3' }}>
            <TextField
              label="Complemento Residencial"
              value={row.residential_address_complement || ''}
              onChange={(next) => onChange({ ...row, residential_address_complement: next })}
              copyValue={row.residential_address_complement || ''}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AgenteCorbanEditorClient({ initialDraft, initialLookups }: Props) {
  const router = useRouter()
  const [draft, setDraft] = useState<AgenteCorbanDraft>(() => {
    const base = initialDraft || createEmptyAgenteCorbanDraft()
    // Guarantee a real editable row even when the persisted record has no sócios yet.
    return {
      ...base,
      socios: Array.isArray(base.socios) && base.socios.length > 0 ? base.socios : [createEmptySocio({ is_principal: true })],
    }
  })
  const [activeTab, setActiveTab] = useState<TabKey>('dados-principais')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<Message>(null)
  const [lookups] = useState<AgenteCorbanLookups>(() => initialLookups || { companyProfiles: [], commercialEntities: [], catalogs: {} })
  const [ufs, setUfs] = useState<string[]>([])
  const [bankQuery, setBankQuery] = useState(() =>
    initialDraft.bank_code || initialDraft.bank_name
      ? formatBankLabel({
          code: initialDraft.bank_code,
          name: initialDraft.bank_name,
          fullName: initialDraft.bank_name,
        })
      : '',
  )
  const [bankAgencySeq, setBankAgencySeq] = useState(() => parseBankAgencySeq(initialDraft.bank_agency))
  const [bankAccountSeq, setBankAccountSeq] = useState(() => parseBankAccountSeq(initialDraft.bank_account))
  const [bankOptions, setBankOptions] = useState<BankLookup[]>([])
  const [bankLoading, setBankLoading] = useState(false)
  const [bankDropdownOpen, setBankDropdownOpen] = useState(false)

  useEffect(() => {
    setBankAgencySeq(parseBankAgencySeq(draft.bank_agency))
  }, [draft.bank_agency])

  useEffect(() => {
    setBankAccountSeq(parseBankAccountSeq(draft.bank_account))
  }, [draft.bank_account])

  useEffect(() => {
    async function loadUfs() {
      try {
        const res = await fetch('/api/lookups/ufs', { cache: 'no-store' })
        const payload = await res.json().catch(() => ({}))
        if (res.ok && Array.isArray(payload?.ufs)) {
          setUfs(payload.ufs.map((item: any) => String(item?.sigla || '').toUpperCase()).filter(Boolean))
        }
      } catch {
        // ignore
      }
    }

    void loadUfs()
  }, [])

  useEffect(() => {
    if (!bankDropdownOpen) return
    const query = normalizeText(bankQuery)
    if (query.length < 3) {
      setBankOptions([])
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        setBankLoading(true)
        const res = await fetch(`/api/lookups/banks?q=${encodeURIComponent(query)}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        const payload = await res.json().catch(() => ({}))
        if (res.ok && Array.isArray(payload?.banks)) {
          setBankOptions(payload.banks)
        } else {
          setBankOptions([])
        }
      } catch {
        if (!controller.signal.aborted) setBankOptions([])
      } finally {
        if (!controller.signal.aborted) setBankLoading(false)
      }
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [bankDropdownOpen, bankQuery])

  const companyProfiles = lookups.companyProfiles || []
  const commercialEntities = lookups.commercialEntities || []
  const catalogs = lookups.catalogs || {}
  const recordId = String(draft.id || '').trim()
  const isNew = !recordId
  const tabs = TABS

  const companyProfileOptions = useMemo(() => {
    return [
      { value: '', label: 'Selecione' },
      ...companyProfiles.map((profile) => ({
        value: profile.id,
        label: `${profile.nickname}${profile.is_active === false ? ' (Inativa)' : ''}${profile.cnpj ? ` · ${formatCpfOrCnpjDisplay(profile.cnpj)}` : ''}`,
      })),
    ]
  }, [companyProfiles])

  const catalogOptions = (resource: string) => [
    { value: '', label: 'Selecione' },
    ...(catalogs[resource] || []).map((row) => ({
      value: row.id,
      label: `${row.name}${row.is_active === false ? ' (Inativo)' : ''}`,
    })),
  ]

  const selectedSuperintendente = commercialEntities.find((entity) => entity.id === draft.superintendente_id) || null
  const selectedSupervisor = commercialEntities.find((entity) => entity.id === draft.supervisor_id) || null
  const selectedGerente = commercialEntities.find((entity) => entity.id === draft.gerente_id) || null
  const tipoAgenteOptions = catalogOptions('agente-corban-tipos-agente')
  const selectedTipoAgenteLabel = tipoAgenteOptions.find((option) => option.value === draft.tipo_agente)?.label || ''
  const showLojaCommissionPercent = normalizeText(selectedTipoAgenteLabel) === 'Loja / Parceiro'
  const resolvedPixType = (() => {
    const current = String(draft.pix_type || '').trim()
    if (current === 'phone' || current === 'email' || current === 'random' || current === 'bank') return current
    return draft.person_type === 'PF' ? 'cpf' : 'cnpj'
  })()
  const pixTypeOptions = getPixTypeOptions(draft.person_type)
  const derivedDocumentPixKey = draft.person_type === 'PF' ? maskCpf(draft.cpf_cnpj || '') : maskCnpj(draft.cpf_cnpj || '')
  const displayedBankOptions = useMemo(() => {
    const query = normalizeText(bankQuery).toLowerCase()
    if (!query) return bankOptions

    const queryDigits = query.replace(/\D/g, '')
    if (/^\d+$/.test(query) && queryDigits.length >= 3) {
      const code = queryDigits.slice(0, 3)
      return bankOptions.filter((bank) => String(bank.code || '').replace(/\D/g, '').slice(0, 3).padStart(3, '0') === code)
    }

    return bankOptions.filter((bank) => {
      const code = String(bank.code || '').replace(/\D/g, '').slice(0, 3).padStart(3, '0')
      const label = formatBankLabel(bank).toLowerCase()
      const fullName = String(bank.fullName || '').toLowerCase()
      return code.includes(queryDigits) || label.includes(query) || fullName.includes(query)
    })
  }, [bankOptions, bankQuery])

  const supervisorOptions = useMemo(() => {
    return [
      { value: '', label: 'Selecione' },
      ...commercialEntities
        .filter((entity) => entity.role === 'supervisor' && entity.parent_id === draft.superintendente_id)
        .map((entity) => ({ value: entity.id, label: formatCommercialEntityLabel(entity) })),
    ]
  }, [commercialEntities, draft.superintendente_id])

  const gerenteOptions = useMemo(() => {
    return [
      { value: '', label: 'Selecione' },
      ...commercialEntities
        .filter((entity) => entity.role === 'gerente' && entity.parent_id === draft.supervisor_id)
        .map((entity) => ({ value: entity.id, label: formatCommercialEntityLabel(entity) })),
    ]
  }, [commercialEntities, draft.supervisor_id])

  function patchDraft(patch: Partial<AgenteCorbanDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  /** Patch de um campo da seção Testemunha (objeto auto-contido). */
  function patchWitness(key: string, value: any) {
    setDraft((current) => ({ ...current, witness: { ...(current.witness || {}), [key]: value } }))
  }

  /** Patch de um campo escalar da seção Garantia. */
  function patchGarantia(key: string, value: any) {
    setDraft((current) => ({ ...current, garantia: { ...(current.garantia || {}), [key]: value } }))
  }

  /** Atualiza a lista de produção mensal (manual) da seção Garantia. */
  function setGarantiaProducao(next: Array<{ mes: string; valor: number }>) {
    setDraft((current) => ({ ...current, garantia: { ...(current.garantia || {}), producao: next } }))
  }

  function updateSocio(index: number, next: AgenteCorbanSocio) {
    setDraft((current) => ({
      ...current,
      socios: current.socios.map((socio, currentIndex) => (currentIndex === index ? next : socio)),
    }))
  }

  function addSocio() {
    setDraft((current) => ({
      ...current,
      socios: [...current.socios, createEmptySocio({ is_principal: current.socios.length === 0 })],
    }))
  }

  function removeSocio(index: number) {
    setDraft((current) => {
      const next = current.socios.filter((_, currentIndex) => currentIndex !== index)
      if (next.length === 0) return { ...current, socios: [createEmptySocio({ is_principal: true })] }
      if (!next.some((row) => row.is_principal)) next[0] = { ...next[0], is_principal: true }
      return { ...current, socios: next }
    })
  }

  function makePrincipal(index: number) {
    setDraft((current) => ({
      ...current,
      socios: current.socios.map((socio, currentIndex) => ({ ...socio, is_principal: currentIndex === index })),
    }))
  }

  function extractFirstString(data: any, paths: string[]) {
    for (const path of paths) {
      const raw = path.split('.').reduce<any>((current, key) => current?.[key], data)
      const text = normalizeText(raw)
      if (text) return text
    }
    return ''
  }

  async function fillMainByDocument() {
    const digits = onlyDigits(draft.cpf_cnpj || '')
    if (digits.length === 14) {
      try {
        const res = await fetch(`/api/cnpjws/cnpj/${digits}`, { cache: 'no-store' })
        const payload = await res.json().catch(() => ({}))

        if (!res.ok) throw new Error(payload?.error || 'CNPJ não encontrado.')

        const est = payload?.estabelecimento || {}
        const dataAbertura = String(est?.data_inicio_atividade || '').trim()
        const situacaoCadastral = String(est?.situacao_cadastral || '').trim()
        const porteEmpresa = String(payload?.porte?.descricao || '').trim()
        const capitalSocial = String(payload?.capital_social || '').trim()
        const naturezaJuridica = String(payload?.natureza_juridica?.descricao || '').trim()
        const phone = `${String(est?.ddd1 || '')}${String(est?.telefone1 || '')}`.trim()
        const email = maskEmailInput(
          extractFirstString(payload, [
            'estabelecimento.email',
            'estabelecimento.contato.email',
            'contato.email',
            'email',
          ]),
        )
        patchDraft({
          person_type: 'PJ',
          cpf_cnpj: digits,
          name: draft.name || String(payload?.razao_social || '').trim(),
          fantasy_name: draft.fantasy_name || String(est?.nome_fantasia || '').trim(),
          data_abertura: draft.data_abertura || formatDateDisplay(dataAbertura),
          situacao_cadastral: draft.situacao_cadastral || situacaoCadastral,
          porte_empresa: draft.porte_empresa || porteEmpresa,
          capital_social: draft.capital_social || formatCurrencyDisplay(capitalSocial),
          natureza_juridica: draft.natureza_juridica || naturezaJuridica,
          address_state: draft.address_state || String(est?.estado?.sigla || '').trim(),
          address_city: draft.address_city || String(est?.cidade?.nome || '').trim(),
          cep: draft.cep || onlyDigits(est?.cep || ''),
          address_neighborhood: draft.address_neighborhood || String(est?.bairro || '').trim(),
          address_street: draft.address_street || String(est?.logradouro || '').trim(),
          address_number: draft.address_number || normalizeShortNumberValue(est?.numero || ''),
          address_complement: draft.address_complement || String(est?.complemento || '').trim(),
          phone_whatsapp: draft.phone_whatsapp || onlyDigits(phone),
          email_comissao: draft.email_comissao || email,
          ...(resolvedPixType === 'cpf' || resolvedPixType === 'cnpj' ? { pix_key: digits } : {}),
        })
        setMessage({ type: 'success', text: 'Dados preenchidos via CNPJ.ws.' })
      } catch (error: any) {
        setMessage({ type: 'error', text: error?.message || 'Falha ao consultar CNPJ.' })
      }
      return
    }

    if (digits.length === 11) {
      try {
        const res = await fetch(`/api/cpfhub/cpf/${digits}`, { cache: 'no-store' })
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(payload?.error || 'CPF não encontrado.')

        const source = payload?.result || payload?.data || payload || {}
        const name = String(source?.name || source?.nome || source?.pessoa?.nome || '').trim()
        const birthRaw = String(
          source?.birth_date ||
            source?.birthDate ||
            source?.data_nascimento ||
            source?.nascimento ||
            source?.pessoa?.data_nascimento ||
            source?.pessoa?.nascimento ||
            '',
        )
        const gender = normalizeGenderValue(source?.gender || source?.genero || source?.['gênero'] || source?.sexo || source?.sex || '')
        const birthDate = formatDateDisplay(birthRaw)

        patchDraft({
          person_type: 'PF',
          cpf_cnpj: digits,
          name: draft.name || name,
          birth_date: draft.birth_date || birthDate,
          gender: draft.gender || gender,
          ...(resolvedPixType === 'cpf' || resolvedPixType === 'cnpj' ? { pix_key: digits } : {}),
        })
        setMessage({ type: 'success', text: 'Dados preenchidos via CPFHub.' })
      } catch (error: any) {
        setMessage({ type: 'error', text: error?.message || 'Falha ao consultar CPF.' })
      }
      return
    }

    setMessage({ type: 'error', text: 'Informe um CPF ou CNPJ válido para busca.' })
  }

  async function fillSocioByCpf(index: number) {
    const row = draft.socios[index]
    if (!row) return

    const digits = onlyDigits(row.cpf || '')
    if (digits.length !== 11) {
      setMessage({ type: 'error', text: `Informe um CPF válido para o sócio ${index + 1}.` })
      return
    }

    try {
      const res = await fetch(`/api/cpfhub/cpf/${digits}`, { cache: 'no-store' })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || 'CPF não encontrado.')

      const source = payload?.result || payload?.data || payload || {}
      const name = extractFirstString(source, ['name', 'nome', 'pessoa.nome'])
      const birthDate = formatDateDisplay(
        extractFirstString(source, [
          'birth_date',
          'birthDate',
          'data_nascimento',
          'nascimento',
          'pessoa.data_nascimento',
          'pessoa.nascimento',
        ]),
      )
      const gender = normalizeGenderValue(extractFirstString(source, ['gender', 'genero', 'gênero', 'sexo', 'sex']))

      updateSocio(index, {
        ...row,
        cpf: digits,
        name: row.name || name,
        birth_date: row.birth_date || birthDate,
        gender: row.gender || gender,
      })
      setMessage({ type: 'success', text: `Sócio ${index + 1} preenchido via CPFHub.` })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Falha ao consultar CPF do sócio.' })
    }
  }

  async function fillAddressByCep() {
    const cep = onlyDigits(draft.cep || '')
    if (cep.length !== 8) {
      setMessage({ type: 'error', text: 'Informe um CEP válido para consulta.' })
      return
    }

    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { cache: 'no-store' })
      const payload = await res.json()
      if (!res.ok || payload?.erro) throw new Error('CEP não encontrado.')

      patchDraft({
        cep,
        address_street: draft.address_street || String(payload?.logradouro || '').trim(),
        address_neighborhood: draft.address_neighborhood || String(payload?.bairro || '').trim(),
        address_city: draft.address_city || String(payload?.localidade || '').trim(),
        address_state: draft.address_state || String(payload?.uf || '').trim(),
        address_complement: draft.address_complement || String(payload?.complemento || '').trim(),
      })
      setMessage({ type: 'success', text: 'Endereço preenchido via ViaCEP.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Falha ao consultar CEP.' })
    }
  }

  async function fillSocioCep(index: number) {
    const row = draft.socios[index]
    if (!row) return
    const cep = onlyDigits(row.residential_cep || '')
    if (cep.length !== 8) {
      setMessage({ type: 'error', text: 'Informe um CEP válido para o sócio.' })
      return
    }

    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { cache: 'no-store' })
      const payload = await res.json()
      if (!res.ok || payload?.erro) throw new Error('CEP não encontrado.')

      updateSocio(index, {
        ...row,
        residential_cep: cep,
        residential_address_street: row.residential_address_street || String(payload?.logradouro || '').trim(),
        residential_address_neighborhood: row.residential_address_neighborhood || String(payload?.bairro || '').trim(),
        residential_address_city: row.residential_address_city || String(payload?.localidade || '').trim(),
        residential_address_state: row.residential_address_state || String(payload?.uf || '').trim(),
        residential_address_complement: row.residential_address_complement || String(payload?.complemento || '').trim(),
      })
      setMessage({ type: 'success', text: `CEP do sócio ${index + 1} preenchido via ViaCEP.` })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Falha ao consultar CEP.' })
    }
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    try {
      const { saveAgenteCorbanRecord } = await import('../actions')
      const result = await saveAgenteCorbanRecord(draft)
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || 'Falha ao salvar registro.' })
        return
      }

      const nextId = String(result.id || draft.id || '').trim()
      setMessage({ type: 'success', text: isNew ? 'Agente Corban criado com sucesso.' : 'Agente Corban atualizado com sucesso.' })

      if (isNew && nextId) {
        router.replace(`/agente-corban/${nextId}`)
        return
      }

      if (nextId) {
        patchDraft({ id: nextId })
      }
    } finally {
      setSaving(false)
    }
  }

  const socioRows = draft.socios.length > 0 ? draft.socios : [createEmptySocio({ is_principal: true })]

  // ----- proveniência (portal do parceiro): campos alterados + divergências RFB
  const provenanceMap = useMemo<FieldProvenanceMap>(() => getFieldProvenance(draft.corban_data), [draft.corban_data])
  const divergenciasReceita = useMemo(() => getDivergenciasReceita(draft.corban_data), [draft.corban_data])
  const camposAlterados = useMemo(
    () => Object.entries(provenanceMap).filter(([, entry]) => entry?.alterado_pelo_parceiro),
    [provenanceMap],
  )
  const prov = (path: string): React.ReactNode => {
    const entry = provenanceMap[path]
    return entry?.alterado_pelo_parceiro ? <ProvenanceNotice entry={entry} /> : null
  }
  const labelForPath = (path: string): string => getFieldByPath(path)?.label || path

  const statusBadgeClass =
    draft.status === 'ativo'
      ? 'badge-success'
      : draft.status === 'inativo'
        ? 'badge-gray'
        : draft.status === 'aguarda_assinatura'
          ? 'badge-gray'
          : 'badge-navy'
  return (
    <div className="page-content" style={{ paddingBottom: '7.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <UserRound size={18} />
            {formatAgenteCorbanLabel(draft)}
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Editor tabulado do parceiro mestre. O save é explícito e preserva os campos legados e o `corban_data`.
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Link href="/agente-corban" className="btn btn-outline">
            <ArrowLeft size={16} />
            Voltar
          </Link>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
            Salvar
          </button>
        </div>
      </div>

      {message && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.875rem 1rem',
            borderRadius: 10,
            border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
            background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: message.type === 'success' ? '#065F46' : '#991B1B',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          {message.type === 'success' ? <CheckCircle size={18} /> : <Search size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      {(camposAlterados.length > 0 || divergenciasReceita.length > 0) && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.875rem 1rem',
            borderRadius: 10,
            border: '1px solid #FDE68A',
            background: '#FFFBEB',
            color: '#78350F',
            fontSize: '0.85rem',
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: camposAlterados.length + divergenciasReceita.length > 0 ? '0.35rem' : 0 }}>
            ⚠ Conferência do cadastro do portal
            {camposAlterados.length > 0 && ` — ${camposAlterados.length} campo(s) alterado(s) pelo parceiro sobre os dados das consultas`}
            {divergenciasReceita.length > 0 && `${camposAlterados.length > 0 ? ' e' : ' —'} ${divergenciasReceita.length} divergência(s) com a Receita Federal`}
          </div>
          {camposAlterados.length > 0 && (
            <div style={{ marginBottom: divergenciasReceita.length > 0 ? '0.35rem' : 0 }}>
              <strong>Alterados:</strong> {camposAlterados.map(([path]) => labelForPath(path)).join('; ')}. Os avisos ⚠ nas
              abas mostram o valor original de cada um.
            </div>
          )}
          {divergenciasReceita.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {divergenciasReceita.map((divergencia, index) => (
                <li key={index}>
                  {divergencia.descricao}
                  {divergencia.valor_declarado || divergencia.valor_receita ? (
                    <span style={{ color: '#92400E' }}>
                      {divergencia.valor_declarado ? ` Declarado: ${divergencia.valor_declarado}.` : ''}
                      {divergencia.valor_receita ? ` Receita: ${divergencia.valor_receita}.` : ''}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', padding: '0.85rem', borderBottom: '1px solid var(--brs-gray-100)' }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`btn ${activeTab === tab.key ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ padding: '1rem' }}>
          {activeTab === 'dados-principais' && (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <SectionTitle icon={<Settings2 size={18} />} title="Dados principais" description="Os blocos PF e PJ aparecem conforme o tipo selecionado." />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '0.75rem' }}>
                <div style={{ gridColumn: 'span 3' }}>
                  <SelectField
                    label="Status"
                    value={draft.status}
                    onChange={(next) => patchDraft({ status: next as AgenteCorbanStatus })}
                    options={AGENTE_CORBAN_STATUSES.map((status) => ({ value: status, label: formatAgenteCorbanStatusLabel(status) }))}
                    copyValue={formatAgenteCorbanStatusLabel(draft.status)}
                  />
                </div>

                <div style={{ gridColumn: 'span 3' }}>
                  <SelectField
                    label="Tipo de Pessoa"
                    value={draft.person_type}
                    onChange={(next) => patchDraft({ person_type: next as 'PF' | 'PJ' })}
                    options={PERSON_TYPE_OPTIONS}
                    copyValue={formatAgenteCorbanPersonTypeLabel(draft.person_type)}
                  />
                </div>

                <div style={{ gridColumn: 'span 6' }}>
                  <CopyableFieldShell
                    label={draft.person_type === 'PF' ? 'CPF' : 'CNPJ'}
                    copyValue={formatCpfOrCnpjDisplay(draft.cpf_cnpj || '')}
                    displayValue={formatCpfOrCnpjDisplay(draft.cpf_cnpj || '')}
                  >
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        className="form-control"
                        style={{ flex: 1 }}
                        value={formatCpfOrCnpjDisplay(draft.cpf_cnpj || '')}
                        onChange={(e) => {
                          const digits = onlyDigits(e.target.value)
                          patchDraft({ cpf_cnpj: digits })
                          if (resolvedPixType === 'cpf' || resolvedPixType === 'cnpj') {
                            patchDraft({ pix_key: digits })
                          }
                        }}
                        placeholder={draft.person_type === 'PF' ? '000.000.000-00' : '00.000.000/0000-00'}
                      />
                      <button type="button" className="btn btn-outline" onClick={fillMainByDocument}>
                        Buscar
                      </button>
                    </div>
                  </CopyableFieldShell>
                </div>

                <div style={{ gridColumn: 'span 4' }}>
                  <TextField
                    label={draft.person_type === 'PJ' ? 'Razão Social' : 'Nome'}
                    value={draft.name || ''}
                    onChange={(next) => patchDraft({ name: next })}
                    copyValue={draft.name || ''}
                    placeholder={draft.person_type === 'PJ' ? 'Razão social' : 'Nome'}
                  />
                  {prov('master.name')}
                </div>

                {draft.person_type === 'PJ' && (
                  <>
                    <div style={{ gridColumn: 'span 4' }}>
                      <TextField
                        label="Nome Fantasia"
                        value={draft.fantasy_name || ''}
                        onChange={(next) => patchDraft({ fantasy_name: next })}
                        copyValue={draft.fantasy_name || ''}
                      />
                      {prov('master.fantasy_name')}
                    </div>
                    <div style={{ gridColumn: 'span 4' }}>
                      <CopyableFieldShell label="Data de Abertura" copyValue={formatDateDisplay(draft.data_abertura || '')} displayValue={formatDateDisplay(draft.data_abertura || '')}>
                        <input
                          className="form-control"
                          type="text"
                          inputMode="numeric"
                          value={formatDateDisplay(draft.data_abertura || '')}
                          onChange={(e) => patchDraft({ data_abertura: formatDateDisplay(e.target.value) })}
                          placeholder="DD/MM/AAAA"
                        />
                      </CopyableFieldShell>
                      {prov('master.data_abertura')}
                    </div>
                    <div style={{ gridColumn: 'span 4' }}>
                      <TextField
                        label="Situação Cadastral"
                        value={draft.situacao_cadastral || ''}
                        onChange={(next) => patchDraft({ situacao_cadastral: next })}
                        copyValue={draft.situacao_cadastral || ''}
                        placeholder="Ativa"
                      />
                    </div>
                    <div style={{ gridColumn: 'span 4' }}>
                      <TextField
                        label="Porte da Empresa"
                        value={draft.porte_empresa || ''}
                        onChange={(next) => patchDraft({ porte_empresa: next })}
                        copyValue={draft.porte_empresa || ''}
                      />
                    </div>
                    <div style={{ gridColumn: 'span 4' }}>
                      <TextField
                        label="Capital Social"
                        value={formatCurrencyDisplay(draft.capital_social || '')}
                        onChange={(next) => patchDraft({ capital_social: formatCurrencyDisplay(next) })}
                        copyValue={formatCurrencyDisplay(draft.capital_social || '')}
                        placeholder="R$ 0,00"
                        inputMode="numeric"
                      />
                    </div>
                    <div style={{ gridColumn: 'span 4' }}>
                      <TextField
                        label="Natureza Jurídica"
                        value={draft.natureza_juridica || ''}
                        onChange={(next) => patchDraft({ natureza_juridica: next })}
                        copyValue={draft.natureza_juridica || ''}
                      />
                    </div>
                    <div style={{ gridColumn: 'span 6' }}>
                      <TextField
                        label="Representante Legal"
                        value={draft.representante_legal || ''}
                        onChange={(next) => patchDraft({ representante_legal: next })}
                        copyValue={draft.representante_legal || ''}
                      />
                    </div>
                    <div style={{ gridColumn: 'span 3' }}>
                      <TextField
                        label="País"
                        value={draft.pais || ''}
                        onChange={(next) => patchDraft({ pais: next })}
                        copyValue={draft.pais || ''}
                        placeholder="Brasil"
                      />
                    </div>
                    <div style={{ gridColumn: 'span 3' }}>
                      <TextField
                        label="Código CNAE Principal"
                        value={draft.cnae_main_code || ''}
                        onChange={(next) => patchDraft({ cnae_main_code: next })}
                        copyValue={draft.cnae_main_code || ''}
                      />
                    </div>
                    <div style={{ gridColumn: 'span 8' }}>
                      <TextField
                        label="Atividade Econômica Principal (CNAE)"
                        value={draft.cnae_main_desc || ''}
                        onChange={(next) => patchDraft({ cnae_main_desc: next })}
                        copyValue={draft.cnae_main_desc || ''}
                      />
                    </div>
                    <div style={{ gridColumn: 'span 4', display: 'flex', alignItems: 'center', gap: '0.5rem', paddingTop: '1.5rem' }}>
                      <input
                        type="checkbox"
                        id="has_secondary_socio"
                        checked={!!draft.has_secondary_socio}
                        onChange={(e) => patchDraft({ has_secondary_socio: e.target.checked })}
                        style={{ cursor: 'pointer' }}
                      />
                      <label htmlFor="has_secondary_socio" style={{ fontSize: '0.85rem', cursor: 'pointer', userSelect: 'none' }}>
                        Possui segundo sócio? <span style={{ color: 'var(--brs-gray-400)' }}>(se não, cadastre a testemunha)</span>
                      </label>
                    </div>
                  </>
                )}

                {draft.person_type === 'PF' && (
                  <>
                    <div style={{ gridColumn: 'span 4' }}>
                      <TextField
                        label="Nome Comercial"
                        value={draft.fantasy_name || ''}
                        onChange={(next) => patchDraft({ fantasy_name: next })}
                        copyValue={draft.fantasy_name || ''}
                      />
                    </div>
                    <div style={{ gridColumn: 'span 4' }}>
                      <CopyableFieldShell label="Data de Nascimento" copyValue={formatDateDisplay(draft.birth_date || '')} displayValue={formatDateDisplay(draft.birth_date || '')}>
                        <input
                          className="form-control"
                          type="text"
                          inputMode="numeric"
                          value={formatDateDisplay(draft.birth_date || '')}
                          onChange={(e) => patchDraft({ birth_date: formatDateDisplay(e.target.value) })}
                          placeholder="DD/MM/AAAA"
                        />
                      </CopyableFieldShell>
                    </div>
                    <div style={{ gridColumn: 'span 4' }}>
                      <SelectField
                        label="Gênero"
                        value={draft.gender || ''}
                        onChange={(next) => patchDraft({ gender: normalizeGenderValue(next) })}
                        options={GENDER_OPTIONS}
                        copyValue={draft.gender || ''}
                      />
                    </div>
                    <div style={{ gridColumn: 'span 3' }}>
                      <TextField label="RG" value={draft.rg || ''} onChange={(next) => patchDraft({ rg: next })} copyValue={draft.rg || ''} />
                    </div>
                    <div style={{ gridColumn: 'span 3' }}>
                      <TextField label="Órgão Emissor" value={draft.rg_issuer || ''} onChange={(next) => patchDraft({ rg_issuer: next })} copyValue={draft.rg_issuer || ''} placeholder="SSP" />
                    </div>
                    <div style={{ gridColumn: 'span 2' }}>
                      <SelectField label="UF RG" value={draft.rg_state || ''} onChange={(next) => patchDraft({ rg_state: normalizeText(next).toUpperCase().slice(0, 2) })} options={[{ value: '', label: 'UF' }, ...ufs.map((uf) => ({ value: uf, label: uf }))]} copyValue={draft.rg_state || ''} />
                    </div>
                    <div style={{ gridColumn: 'span 4' }}>
                      <CopyableFieldShell label="Data de Expedição do RG" copyValue={formatDateDisplay(draft.rg_expedition_date || '')} displayValue={formatDateDisplay(draft.rg_expedition_date || '')}>
                        <input className="form-control" type="text" inputMode="numeric" value={formatDateDisplay(draft.rg_expedition_date || '')} onChange={(e) => patchDraft({ rg_expedition_date: formatDateDisplay(e.target.value) })} placeholder="DD/MM/AAAA" />
                      </CopyableFieldShell>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {activeTab === 'contato' && (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <SectionTitle icon={<Users size={18} />} title="Contato" />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '0.75rem' }}>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField
                    label="E-mail Principal"
                    value={maskEmailInput(draft.email_comissao || '')}
                    onChange={(next) => patchDraft({ email_comissao: maskEmailInput(next) })}
                    copyValue={maskEmailInput(draft.email_comissao || '')}
                    placeholder="principal@dominio.com"
                  />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField
                    label="WhatsApp Principal"
                    value={maskPhone(draft.phone_whatsapp || '')}
                    onChange={(next) => patchDraft({ phone_whatsapp: onlyDigits(next) })}
                    copyValue={maskPhone(draft.phone_whatsapp || '')}
                    placeholder="(00) 00000-0000"
                  />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField
                    label="E-mail Financeiro"
                    value={maskEmailInput(draft.email_financeiro || '')}
                    onChange={(next) => patchDraft({ email_financeiro: maskEmailInput(next) })}
                    copyValue={maskEmailInput(draft.email_financeiro || '')}
                    placeholder="financeiro@dominio.com"
                  />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField
                    label="E-mail de Informes"
                    value={maskEmailInput(draft.email_informe || '')}
                    onChange={(next) => patchDraft({ email_informe: maskEmailInput(next) })}
                    copyValue={maskEmailInput(draft.email_informe || '')}
                    placeholder="informes@dominio.com"
                  />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField
                    label="E-mail Jurídico"
                    value={maskEmailInput(draft.email_juridico || '')}
                    onChange={(next) => patchDraft({ email_juridico: maskEmailInput(next) })}
                    copyValue={maskEmailInput(draft.email_juridico || '')}
                    placeholder="juridico@dominio.com"
                  />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField
                    label="WhatsApp Financeiro"
                    value={maskPhone(draft.phone_whatsapp_financeiro || '')}
                    onChange={(next) => patchDraft({ phone_whatsapp_financeiro: onlyDigits(next) })}
                    copyValue={maskPhone(draft.phone_whatsapp_financeiro || '')}
                    placeholder="(00) 00000-0000"
                  />
                </div>
                {draft.person_type === 'PJ' && (
                  <>
                    <div style={{ gridColumn: 'span 4' }}>
                      <TextField
                        label="E-mail Pessoal do Sócio Principal (PJ)"
                        value={maskEmailInput(draft.email_formalizacao || '')}
                        onChange={(next) => patchDraft({ email_formalizacao: maskEmailInput(next) })}
                        copyValue={maskEmailInput(draft.email_formalizacao || '')}
                        placeholder="socio.principal@dominio.com"
                      />
                    </div>
                    <div style={{ gridColumn: 'span 4' }}>
                      <TextField
                        label="WhatsApp do Sócio Principal (PJ)"
                        value={maskPhone(draft.phone_commercial || '')}
                        onChange={(next) => patchDraft({ phone_commercial: onlyDigits(next) })}
                        copyValue={maskPhone(draft.phone_commercial || '')}
                        placeholder="(00) 00000-0000"
                      />
                    </div>
                    <div style={{ gridColumn: 'span 4' }}>
                      <TextField
                        label="E-mail Pessoal do Sócio Secundário (PJ)"
                        value={maskEmailInput(draft.email_proposta || '')}
                        onChange={(next) => patchDraft({ email_proposta: maskEmailInput(next) })}
                        copyValue={maskEmailInput(draft.email_proposta || '')}
                        placeholder="socio.secundario@dominio.com"
                      />
                    </div>
                    <div style={{ gridColumn: 'span 4' }}>
                      <TextField
                        label="WhatsApp do Sócio Secundário (PJ)"
                        value={maskPhone(draft.phone_residential || '')}
                        onChange={(next) => patchDraft({ phone_residential: onlyDigits(next) })}
                        copyValue={maskPhone(draft.phone_residential || '')}
                        placeholder="(00) 00000-0000"
                      />
                    </div>
                  </>
                )}
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField label="Telefone de Suporte" value={maskPhone(draft.phone_support || '')} onChange={(next) => patchDraft({ phone_support: onlyDigits(next) })} copyValue={maskPhone(draft.phone_support || '')} placeholder="(00) 00000-0000" />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField label="E-mail da Mesa de Liberação" value={maskEmailInput(draft.email_mesa_liberacao || '')} onChange={(next) => patchDraft({ email_mesa_liberacao: maskEmailInput(next) })} copyValue={maskEmailInput(draft.email_mesa_liberacao || '')} placeholder="mesa@dominio.com" />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField label="E-mail Próprio Cunho" value={maskEmailInput(draft.email_proprio_cunho || '')} onChange={(next) => patchDraft({ email_proprio_cunho: maskEmailInput(next) })} copyValue={maskEmailInput(draft.email_proprio_cunho || '')} placeholder="proprio@dominio.com" />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'socios' && (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                <SectionTitle icon={<Users size={18} />} title="Sócios" description="Aba aplicável para pessoa juridica." />
                {draft.person_type === 'PJ' ? (
                  <button type="button" className="btn btn-primary" onClick={addSocio}>
                    <Plus size={16} />
                    Novo sócio
                  </button>
                ) : null}
              </div>

              {draft.person_type === 'PJ' ? (
                socioRows.map((row, index) => (
                  <SocioCard
                    key={row.id || index}
                    row={row}
                    index={index}
                    onChange={(next) => updateSocio(index, next)}
                    onRemove={() => removeSocio(index)}
                    onMakePrincipal={() => makePrincipal(index)}
                    onFillCpf={() => fillSocioByCpf(index)}
                    onFillCep={() => fillSocioCep(index)}
                    prov={(field) => prov(`socios.${index}.${field}`)}
                  />
                ))
              ) : (
                <div className="card" style={{ padding: '1rem', color: 'var(--brs-gray-500)' }}>
                  Digite o CPF para buscar os dados, se não carregar preencha manualmente.
                </div>
              )}
            </div>
          )}

          {activeTab === 'endereco' && (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <SectionTitle icon={<Building2 size={18} />} title="Endereço" description="Digite o CEP para buscar os dados e complete o número e complemento." />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '0.75rem' }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <CopyableFieldShell label="CEP" copyValue={maskCep(draft.cep || '')} displayValue={maskCep(draft.cep || '')}>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        className="form-control"
                        style={{ flex: 1 }}
                        value={maskCep(draft.cep || '')}
                        onChange={(e) => patchDraft({ cep: onlyDigits(e.target.value) })}
                        placeholder="00000-000"
                      />
                      <button type="button" className="btn btn-outline" onClick={fillAddressByCep}>
                        Buscar
                      </button>
                    </div>
                  </CopyableFieldShell>
                  {prov('address.cep')}
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField
                    label="Logradouro"
                    value={draft.address_street || ''}
                    onChange={(next) => patchDraft({ address_street: next })}
                    copyValue={draft.address_street || ''}
                  />
                  {prov('address.address_street')}
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <TextField
                    label="Número"
                    value={normalizeShortNumberValue(draft.address_number || '')}
                    onChange={(next) => patchDraft({ address_number: normalizeShortNumberValue(next) })}
                    copyValue={normalizeShortNumberValue(draft.address_number || '')}
                    inputMode="numeric"
                    placeholder="00000"
                  />
                  {prov('address.address_number')}
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField
                    label="Complemento"
                    value={draft.address_complement || ''}
                    onChange={(next) => patchDraft({ address_complement: next })}
                    copyValue={draft.address_complement || ''}
                  />
                  {prov('address.address_complement')}
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField
                    label="Bairro"
                    value={draft.address_neighborhood || ''}
                    onChange={(next) => patchDraft({ address_neighborhood: next })}
                    copyValue={draft.address_neighborhood || ''}
                  />
                  {prov('address.address_neighborhood')}
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField
                    label="Cidade"
                    value={draft.address_city || ''}
                    onChange={(next) => patchDraft({ address_city: next })}
                    copyValue={draft.address_city || ''}
                  />
                  {prov('address.address_city')}
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <SelectField
                    label="UF"
                    value={draft.address_state || ''}
                    onChange={(next) => patchDraft({ address_state: normalizeText(next).toUpperCase().slice(0, 2) })}
                    options={[
                      { value: '', label: 'Selecione' },
                      ...ufs.map((uf) => ({ value: uf, label: uf })),
                    ]}
                    copyValue={draft.address_state || ''}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'acesso' && (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <SectionTitle icon={<ShieldCheck size={18} />} title="Acesso" description="Preencha os campos conforme o preenchimento no sistema ARW e preencha os campos Código ARW e Senha Inicial ARW para constar no e-mail de boas vindas." />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '0.75rem' }}>
                <div style={{ gridColumn: 'span 4' }}>
                  <SelectField
                    label="Filial"
                    value={draft.filial || ''}
                    onChange={(next) => patchDraft({ filial: next })}
                    options={companyProfileOptions}
                    copyValue={companyProfileOptions.find((option) => option.value === draft.filial)?.label || draft.filial || ''}
                  />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <SelectField
                    label="Nível de Acesso"
                    value={draft.nivel_acesso || ''}
                    onChange={(next) => patchDraft({ nivel_acesso: next })}
                    options={catalogOptions('agente-corban-niveis-acesso')}
                    copyValue={catalogOptions('agente-corban-niveis-acesso').find((option) => option.value === draft.nivel_acesso)?.label || draft.nivel_acesso || ''}
                  />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: showLojaCommissionPercent
                        ? 'minmax(0, 1.15fr) minmax(0, 0.95fr)'
                        : 'minmax(0, 1fr)',
                      gap: '0.75rem',
                      alignItems: 'start',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <SelectField
                        label="Tipo de Agente"
                        value={draft.tipo_agente || ''}
                        onChange={(next) => patchDraft({ tipo_agente: next })}
                        options={tipoAgenteOptions}
                        copyValue={selectedTipoAgenteLabel || draft.tipo_agente || ''}
                      />
                    </div>
                    {showLojaCommissionPercent ? (
                      <div style={{ minWidth: 0 }}>
                        <TextField
                          label="Percentual de Comissão Loja"
                          value={formatPercentValue(draft.commission_loja_percent || '')}
                          onChange={(next) => patchDraft({ commission_loja_percent: normalizePercentDigits(next) })}
                          copyValue={formatPercentValue(draft.commission_loja_percent || '')}
                          placeholder="0,00%"
                          inputMode="numeric"
                          autoComplete="off"
                          name="agente-corban-percentual-comissao-loja"
                          spellCheck={false}
                          autoCorrect="off"
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <SelectField
                    label="Superintendente"
                    value={draft.superintendente_id || ''}
                    onChange={(next) => patchDraft({ superintendente_id: next || null, supervisor_id: null, gerente_id: null })}
                    options={[
                      { value: '', label: 'Selecione' },
                      ...commercialEntities
                        .filter((entity) => entity.role === 'superintendente')
                        .map((entity) => ({ value: entity.id, label: formatCommercialEntityLabel(entity) })),
                    ]}
                    copyValue={formatCommercialEntityLabel(selectedSuperintendente) || draft.superintendente_id || ''}
                  />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <SelectField
                    label="Supervisor"
                    value={draft.supervisor_id || ''}
                    onChange={(next) => patchDraft({ supervisor_id: next || null, gerente_id: null })}
                    options={supervisorOptions}
                    disabled={!draft.superintendente_id}
                    copyValue={formatCommercialEntityLabel(selectedSupervisor) || draft.supervisor_id || ''}
                  />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <SelectField
                    label="Gerente"
                    value={draft.gerente_id || ''}
                    onChange={(next) => patchDraft({ gerente_id: next || null })}
                    options={gerenteOptions}
                    disabled={!draft.supervisor_id}
                    copyValue={formatCommercialEntityLabel(selectedGerente) || draft.gerente_id || ''}
                  />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <SelectField
                    label="Regra de Físico"
                    value={draft.regra_fisico || ''}
                    onChange={(next) => patchDraft({ regra_fisico: next })}
                    options={catalogOptions('agente-corban-regras-fisico')}
                    copyValue={catalogOptions('agente-corban-regras-fisico').find((option) => option.value === draft.regra_fisico)?.label || draft.regra_fisico || ''}
                  />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField
                    label="Código ARW"
                    value={draft.arw_code || ''}
                    onChange={(next) => patchDraft({ arw_code: normalizeArwCodeValue(next, draft.address_state || '') })}
                    copyValue={draft.arw_code || ''}
                    placeholder="DF3"
                    helperText="Formato: UF + número, como DF3 ou DF30."
                    autoComplete="new-password"
                    name="agente-corban-arw-code"
                    spellCheck={false}
                    autoCapitalize="characters"
                    autoCorrect="off"
                  />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <PasswordField
                    label="Senha Inicial ARW"
                    value={draft.temporary_password || ''}
                    onChange={(next) => patchDraft({ temporary_password: next })}
                    placeholder="Senha provisória de acesso"
                    autoComplete="new-password"
                    name="agente-corban-arw-password"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'bancarios' && (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <SectionTitle icon={<Building2 size={18} />} title="Dados Bancários" description="Os dados bancários devem ser vinculados ao CNPJ ou CPF do cadastro." />

              <div style={{ display: 'grid', gap: '0.85rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '0.75rem' }}>
                  <div style={{ gridColumn: 'span 4' }}>
                    <BankLookupField
                      value={draft.bank_name || ''}
                      query={bankQuery}
                      options={displayedBankOptions}
                      loading={bankLoading}
                      open={bankDropdownOpen}
                      onOpenChange={setBankDropdownOpen}
                      onQueryChange={(next) => {
                        setBankQuery(next)
                        patchDraft({
                          bank_code: '',
                          bank_name: '',
                        })
                        setBankDropdownOpen(true)
                      }}
                      onSelect={(bank) => {
                        const label = formatBankLabel(bank)
                        setBankQuery(label)
                        patchDraft({
                          bank_code: String(bank.code || '').replace(/\D/g, '').slice(0, 3).padStart(3, '0'),
                          bank_name: String(bank.name || '').trim(),
                        })
                      }}
                    />
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <CopyableFieldShell label="Agência" copyValue={formatBankAgencyDisplay(bankAgencySeq || '')} displayValue={formatBankAgencyDisplay(bankAgencySeq || '')}>
                      <input
                        className="form-control"
                        inputMode="numeric"
                        value={formatBankAgencyDisplay(bankAgencySeq || '')}
                        onChange={(e) => {
                          handleDigitSequenceChange(e, bankAgencySeq, (nextSeq) => {
                            const seq = onlyDigits(nextSeq).slice(0, 5)
                            setBankAgencySeq(seq)
                            patchDraft({ bank_agency: seq })
                          }, 5)
                        }}
                        onKeyDown={(e) => {
                          handleDigitSequenceKeyDown(e, bankAgencySeq, (nextSeq) => {
                            const seq = onlyDigits(nextSeq).slice(0, 5)
                            setBankAgencySeq(seq)
                            patchDraft({ bank_agency: seq })
                          }, 5)
                        }}
                        onPaste={(e) => {
                          handleDigitSequencePaste(e, bankAgencySeq, (nextSeq) => {
                            const seq = onlyDigits(nextSeq).slice(0, 5)
                            setBankAgencySeq(seq)
                            patchDraft({ bank_agency: seq })
                          }, 5)
                        }}
                        placeholder="0000-0"
                      />
                    </CopyableFieldShell>
                  </div>
                  <div style={{ gridColumn: 'span 3' }}>
                    <CopyableFieldShell label="Conta" copyValue={formatBankAccountDisplay(bankAccountSeq || '')} displayValue={formatBankAccountDisplay(bankAccountSeq || '')}>
                      <input
                        className="form-control"
                        inputMode="numeric"
                        value={formatBankAccountDisplay(bankAccountSeq || '')}
                        onChange={(e) => {
                          handleDigitSequenceChange(e, bankAccountSeq, (nextSeq) => {
                            const seq = onlyDigits(nextSeq).slice(0, 11)
                            setBankAccountSeq(seq)
                            patchDraft({ bank_account: seq })
                          }, 11)
                        }}
                        onKeyDown={(e) => {
                          handleDigitSequenceKeyDown(e, bankAccountSeq, (nextSeq) => {
                            const seq = onlyDigits(nextSeq).slice(0, 11)
                            setBankAccountSeq(seq)
                            patchDraft({ bank_account: seq })
                          }, 11)
                        }}
                        onPaste={(e) => {
                          handleDigitSequencePaste(e, bankAccountSeq, (nextSeq) => {
                            const seq = onlyDigits(nextSeq).slice(0, 11)
                            setBankAccountSeq(seq)
                            patchDraft({ bank_account: seq })
                          }, 11)
                        }}
                        placeholder="0000000000-0"
                      />
                    </CopyableFieldShell>
                  </div>
                  <div style={{ gridColumn: 'span 3' }}>
                    <SelectField
                      label="Tipo de Conta"
                      value={draft.bank_account_type || 'Corrente'}
                      onChange={(next) => patchDraft({ bank_account_type: next === 'Poupança' ? 'Poupança' : 'Corrente' })}
                      options={AGENTE_CORBAN_BANK_ACCOUNT_TYPES.map((type) => ({ value: type, label: type }))}
                      copyValue={draft.bank_account_type || 'Corrente'}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '0.75rem' }}>
                  <div style={{ gridColumn: 'span 3' }}>
                    <SelectField
                      label="Tipo de Chave Pix"
                      value={resolvedPixType}
                      onChange={(next) => {
                        const nextPixType = next as any
                        patchDraft({
                          pix_type: nextPixType,
                          pix_key:
                            nextPixType === 'bank'
                              ? 'Dados Bancários cadastrados'
                              : nextPixType === 'cpf' || nextPixType === 'cnpj'
                                ? onlyDigits(draft.cpf_cnpj || '')
                                : '',
                        })
                      }}
                      options={pixTypeOptions}
                      copyValue={pixTypeOptions.find((option) => option.value === resolvedPixType)?.label || resolvedPixType}
                    />
                  </div>
                  <div style={{ gridColumn: 'span 9' }}>
                    {resolvedPixType === 'bank' ? (
                      <ReadOnlyField label="Chave PIX" value="Dados Bancários cadastrados" />
                    ) : resolvedPixType === 'email' ? (
                      <TextField
                        label="Chave PIX"
                        value={maskEmailInput(draft.pix_key || '')}
                        onChange={(next) => patchDraft({ pix_key: maskEmailInput(next) })}
                        copyValue={maskEmailInput(draft.pix_key || '')}
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        name="agente-corban-pix-email"
                        spellCheck={false}
                        autoCorrect="off"
                        placeholder="nome@dominio.com"
                      />
                    ) : resolvedPixType === 'phone' ? (
                      <TextField
                        label="Chave PIX"
                        value={maskPhone(draft.pix_key || '')}
                        onChange={(next) => patchDraft({ pix_key: onlyDigits(next) })}
                        copyValue={maskPhone(draft.pix_key || '')}
                        inputMode="numeric"
                        autoComplete="off"
                        name="agente-corban-pix-phone"
                        spellCheck={false}
                        autoCorrect="off"
                        placeholder="(99) 99999-9999"
                      />
                    ) : resolvedPixType === 'random' ? (
                      <TextField
                        label="Chave PIX"
                        value={maskUuidInput(draft.pix_key || '')}
                        onChange={(next) => patchDraft({ pix_key: maskUuidInput(next) })}
                        copyValue={maskUuidInput(draft.pix_key || '')}
                        autoComplete="off"
                        name="agente-corban-pix-random"
                        spellCheck={false}
                        autoCorrect="off"
                        placeholder="123e4567-e89b-12d3-a456-426614174000"
                      />
                    ) : (
                      <ReadOnlyField
                        label="Chave PIX"
                        value={derivedDocumentPixKey}
                        helperText="Preenchido automaticamente a partir do documento principal."
                      />
                    )}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '0.75rem' }}>
                  <div style={{ gridColumn: 'span 4' }}>
                    <SelectField
                      label="Tipo de Recebimento"
                      value={draft.commission_receive_type || ''}
                      onChange={(next) => patchDraft({ commission_receive_type: next })}
                      options={RECEIPT_TYPE_OPTIONS}
                      copyValue={RECEIPT_TYPE_OPTIONS.find((option) => option.value === draft.commission_receive_type)?.label || draft.commission_receive_type || ''}
                    />
                  </div>
                  <div style={{ gridColumn: 'span 4' }}>
                    <SelectField
                      label="Período de Pagamento"
                      value={draft.payment_period || ''}
                      onChange={(next) => patchDraft({ payment_period: next })}
                      options={PAYMENT_PERIOD_OPTIONS}
                      copyValue={PAYMENT_PERIOD_OPTIONS.find((option) => option.value === draft.payment_period)?.label || draft.payment_period || ''}
                    />
                  </div>
                </div>

              </div>
            </div>
          )}

          {activeTab === 'testemunha' && (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <SectionTitle
                icon={<Users size={18} />}
                title="Testemunha / Avalista e Devedor Solidário"
                description="Qualificação completa: além de testemunha, esta pessoa assina como avalista e devedor solidário do contrato."
              />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '0.75rem' }}>
                <div style={{ gridColumn: 'span 6' }}>
                  <TextField label="Nome" value={draft.witness?.name || ''} onChange={(v) => patchWitness('name', v)} copyValue={draft.witness?.name || ''} />
                  {prov('witness.name')}
                </div>
                <div style={{ gridColumn: 'span 3' }}>
                  <TextField label="CPF" value={maskCpf(draft.witness?.cpf || '')} onChange={(v) => patchWitness('cpf', onlyDigits(v))} copyValue={maskCpf(draft.witness?.cpf || '')} placeholder="000.000.000-00" />
                </div>
                <div style={{ gridColumn: 'span 3' }}>
                  <TextField label="Nacionalidade" value={draft.witness?.nationality || ''} onChange={(v) => patchWitness('nationality', v)} copyValue={draft.witness?.nationality || ''} placeholder="Brasileira" />
                </div>
                <div style={{ gridColumn: 'span 3' }}>
                  <TextField label="RG" value={draft.witness?.rg || ''} onChange={(v) => patchWitness('rg', v)} copyValue={draft.witness?.rg || ''} />
                </div>
                <div style={{ gridColumn: 'span 3' }}>
                  <TextField label="Órgão Emissor" value={draft.witness?.rg_issuer || ''} onChange={(v) => patchWitness('rg_issuer', v)} copyValue={draft.witness?.rg_issuer || ''} placeholder="SSP" />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <SelectField label="UF RG" value={draft.witness?.rg_state || ''} onChange={(v) => patchWitness('rg_state', normalizeText(v).toUpperCase().slice(0, 2))} options={[{ value: '', label: 'UF' }, ...ufs.map((uf) => ({ value: uf, label: uf }))]} copyValue={draft.witness?.rg_state || ''} />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField label="Data de Nascimento" value={draft.witness?.birth_date || ''} onChange={(v) => patchWitness('birth_date', v)} copyValue={draft.witness?.birth_date || ''} placeholder="AAAA-MM-DD" />
                  {prov('witness.birth_date')}
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField label="Estado Civil" value={draft.witness?.marital_status || ''} onChange={(v) => patchWitness('marital_status', v)} copyValue={draft.witness?.marital_status || ''} />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField label="Profissão" value={draft.witness?.profession || ''} onChange={(v) => patchWitness('profession', v)} copyValue={draft.witness?.profession || ''} />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField label="E-mail" value={draft.witness?.email || ''} onChange={(v) => patchWitness('email', v)} copyValue={draft.witness?.email || ''} />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField label="WhatsApp" value={maskPhone(draft.witness?.phone || '')} onChange={(v) => patchWitness('phone', onlyDigits(v))} copyValue={maskPhone(draft.witness?.phone || '')} placeholder="(00) 00000-0000" />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <TextField label="CEP" value={maskCep(draft.witness?.cep || '')} onChange={(v) => patchWitness('cep', onlyDigits(v))} copyValue={maskCep(draft.witness?.cep || '')} placeholder="00000-000" />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField label="Logradouro" value={draft.witness?.address_street || ''} onChange={(v) => patchWitness('address_street', v)} copyValue={draft.witness?.address_street || ''} />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <TextField label="Número" value={draft.witness?.address_number || ''} onChange={(v) => patchWitness('address_number', v)} copyValue={draft.witness?.address_number || ''} />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField label="Complemento" value={draft.witness?.address_complement || ''} onChange={(v) => patchWitness('address_complement', v)} copyValue={draft.witness?.address_complement || ''} />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField label="Bairro" value={draft.witness?.address_neighborhood || ''} onChange={(v) => patchWitness('address_neighborhood', v)} copyValue={draft.witness?.address_neighborhood || ''} />
                </div>
                <div style={{ gridColumn: 'span 4' }}>
                  <TextField label="Cidade" value={draft.witness?.address_city || ''} onChange={(v) => patchWitness('address_city', v)} copyValue={draft.witness?.address_city || ''} />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <SelectField label="UF" value={draft.witness?.address_state || ''} onChange={(v) => patchWitness('address_state', normalizeText(v).toUpperCase().slice(0, 2))} options={[{ value: '', label: 'UF' }, ...ufs.map((uf) => ({ value: uf, label: uf }))]} copyValue={draft.witness?.address_state || ''} />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'garantia' && (() => {
            const producao: ProducaoMes[] = Array.isArray(draft.garantia?.producao) ? draft.garantia!.producao : []
            const valorGarantido = Number(String(draft.garantia?.valor_garantia ?? '').replace(/[^\d.-]/g, '')) || 0
            const aval = avaliarGarantia(valorGarantido, producao)
            const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
            const socioPrincipal = draft.socios?.find((s) => s.is_principal) || draft.socios?.[0]
            return (
              <div style={{ display: 'grid', gap: '1rem' }}>
                <SectionTitle
                  icon={<ShieldCheck size={18} />}
                  title="Garantia (Nota Promissória)"
                  description="A garantia cobre o bimestre: a soma de 2 meses de produção deve caber no valor garantido. Faixas dobram: 500k → 1M → 2M → 4M…"
                />

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '0.75rem' }}>
                  <div style={{ gridColumn: 'span 4' }}>
                    <TextField
                      label="Valor Garantido (= valor da NP)"
                      value={draft.garantia?.valor_garantia || ''}
                      onChange={(v) => patchGarantia('valor_garantia', onlyDigits(v))}
                      copyValue={String(draft.garantia?.valor_garantia || '')}
                      inputMode="numeric"
                      placeholder="500000"
                    />
                  </div>
                </div>

                {/* Produção mensal (manual — sem API ARW ainda) */}
                <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Produção mensal (últimos meses) — entrada manual</div>
                    <button type="button" className="btn btn-outline" onClick={() => setGarantiaProducao([...producao, { mes: '', valor: 0 }])}>Adicionar mês</button>
                  </div>
                  {producao.length === 0 ? (
                    <div style={{ fontSize: '0.82rem', color: 'var(--brs-gray-500)' }}>Nenhum mês informado. Adicione os últimos 6 meses para o monitoramento.</div>
                  ) : (
                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                      {producao.map((row, index) => (
                        <div key={index} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <input className="form-control" style={{ maxWidth: 140 }} value={row.mes || ''} placeholder="2026-07" onChange={(e) => setGarantiaProducao(producao.map((r, i) => (i === index ? { ...r, mes: e.target.value } : r)))} />
                          <input className="form-control" style={{ flex: 1 }} inputMode="numeric" value={row.valor || ''} placeholder="Valor produzido (R$)" onChange={(e) => setGarantiaProducao(producao.map((r, i) => (i === index ? { ...r, valor: Number(onlyDigits(e.target.value)) } : r)))} />
                          <button type="button" className="btn btn-outline text-danger" onClick={() => setGarantiaProducao(producao.filter((_, i) => i !== index))}>Remover</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Indicador + visões */}
                <div className="card" style={{ padding: '1rem', border: `1px solid ${aval.precisaRevisar ? '#FECACA' : 'var(--brs-gray-100)'}`, background: aval.precisaRevisar ? '#FEF2F2' : '#fff' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '0.75rem', fontSize: '0.82rem' }}>
                    <div><div style={{ color: 'var(--brs-gray-500)' }}>Garantido (faixa atual)</div><div style={{ fontWeight: 800 }}>{brl(aval.valorGarantido)}</div></div>
                    <div><div style={{ color: 'var(--brs-gray-500)' }}>Bimestre mais recente</div><div style={{ fontWeight: 800 }}>{brl(aval.bimestreRecente)}</div></div>
                    <div><div style={{ color: 'var(--brs-gray-500)' }}>Média mensal</div><div style={{ fontWeight: 700 }}>{brl(aval.mediaMensal)}</div></div>
                    <div><div style={{ color: 'var(--brs-gray-500)' }}>Média bimestral</div><div style={{ fontWeight: 700 }}>{brl(aval.mediaBimestral)}</div></div>
                  </div>
                  <div style={{ marginTop: '0.75rem', fontWeight: 700, color: aval.precisaRevisar ? '#991B1B' : '#166534' }}>
                    {aval.precisaRevisar
                      ? `🚩 Revisar garantia — o bimestre ultrapassou a faixa. Sugerido: ${brl(aval.faixaSugerida)}.`
                      : '✅ Dentro da garantia — o bimestre cabe na faixa atual.'}
                  </div>
                </div>

                {/* Avalistas / devedores solidários (sócio principal + testemunha) */}
                <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.5rem' }}>Avalistas / Devedores Solidários</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--brs-gray-600)' }}>
                    • {socioPrincipal?.name || '(sócio principal não cadastrado)'} {socioPrincipal?.cpf ? `— ${maskCpf(socioPrincipal.cpf)}` : ''} <span style={{ color: 'var(--brs-gray-400)' }}>(sócio principal)</span>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--brs-gray-600)' }}>
                    • {draft.witness?.name || '(testemunha não cadastrada)'} {draft.witness?.cpf ? `— ${maskCpf(draft.witness.cpf)}` : ''} <span style={{ color: 'var(--brs-gray-400)' }}>(testemunha)</span>
                  </div>
                </div>
              </div>
            )
          })()}

          {activeTab === 'documentos' && (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <SectionTitle icon={<Copy size={18} />} title="Documentos" description="Pasta, arquivos e fotos operacionais do parceiro." />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '0.75rem' }}>
                <div style={{ gridColumn: 'span 6' }}>
                  <TextField
                    label="Pasta de Documentos"
                    value={draft.google_drive_url || ''}
                    onChange={(next) => patchDraft({ google_drive_url: next })}
                    copyValue={draft.google_drive_url || ''}
                    type="url"
                    placeholder="https://drive.google.com/..."
                  />
                </div>
                <div style={{ gridColumn: 'span 3' }}>
                  <TextField
                    label="Documento de Identificação Oficial com foto"
                    value={draft.official_document_url || ''}
                    onChange={(next) => patchDraft({ official_document_url: next })}
                    copyValue={draft.official_document_url || ''}
                    type="url"
                    placeholder="https://..."
                  />
                </div>
                <div style={{ gridColumn: 'span 3' }}>
                  <TextField
                    label="Comprovante Bancário"
                    value={draft.bank_proof_url || ''}
                    onChange={(next) => patchDraft({ bank_proof_url: next })}
                    copyValue={draft.bank_proof_url || ''}
                    type="url"
                    placeholder="https://..."
                  />
                </div>
                <div style={{ gridColumn: 'span 6' }}>
                  <TextField
                    label="Contrato Social, Requerimento de Empresário, Estatuto Social ou CCMEI"
                    value={draft.contract_pdf_url || ''}
                    onChange={(next) => patchDraft({ contract_pdf_url: next })}
                    copyValue={draft.contract_pdf_url || ''}
                    type="url"
                    placeholder="https://..."
                  />
                </div>
                <div style={{ gridColumn: 'span 6' }}>
                  <TextField
                    label="Comprovante de Endereço"
                    value={draft.address_proof_url || ''}
                    onChange={(next) => patchDraft({ address_proof_url: next })}
                    copyValue={draft.address_proof_url || ''}
                    type="url"
                    placeholder="https://..."
                  />
                </div>
                <div style={{ gridColumn: 'span 6' }}>
                  <TextField
                    label="Documento de Identificação Oficial com foto do Sócio Principal"
                    value={draft.primary_socio_document_url || ''}
                    onChange={(next) => patchDraft({ primary_socio_document_url: next })}
                    copyValue={draft.primary_socio_document_url || ''}
                    type="url"
                    placeholder="https://..."
                  />
                </div>
                <div style={{ gridColumn: 'span 6' }}>
                  <TextField
                    label="Documento de Identificação Oficial com foto do Sócio Secundário"
                    value={draft.secondary_socio_document_url || ''}
                    onChange={(next) => patchDraft({ secondary_socio_document_url: next })}
                    copyValue={draft.secondary_socio_document_url || ''}
                    type="url"
                    placeholder="https://..."
                  />
                </div>
                <div style={{ gridColumn: 'span 6' }}>
                  <TextField
                    label="Foto da Fachada"
                    value={draft.front_photo_url || ''}
                    onChange={(next) => patchDraft({ front_photo_url: next })}
                    copyValue={draft.front_photo_url || ''}
                    type="url"
                    placeholder="https://..."
                  />
                </div>
                <div style={{ gridColumn: 'span 6' }}>
                  <TextField
                    label="Foto Interna"
                    value={draft.internal_photo_url || ''}
                    onChange={(next) => patchDraft({ internal_photo_url: next })}
                    copyValue={draft.internal_photo_url || ''}
                    type="url"
                    placeholder="https://..."
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 15,
          background: 'rgba(255,255,255,0.96)',
          backdropFilter: 'blur(10px)',
          border: '1px solid var(--brs-gray-200)',
          borderRadius: 16,
          boxShadow: '0 16px 40px rgba(15, 23, 42, 0.10)',
          padding: '0.85rem 1rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className={`badge ${statusBadgeClass}`}>{formatAgenteCorbanStatusLabel(draft.status)}</span>
            <span className="badge badge-gray">{formatAgenteCorbanPersonTypeLabel(draft.person_type)}</span>
            {recordId ? <span style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>ID {recordId}</span> : null}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline" onClick={() => router.push('/agente-corban')}>
              <ArrowLeft size={16} />
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
              Salvar alterações
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
