'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  Banknote,
  Building2,
  CheckCircle,
  ChevronLeft,
  CirclePlus,
  Copy,
  Edit2,
  FileText,
  Globe,
  Loader2,
  Plus,
  Save,
  PhoneCall,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react'
import {
  createEmptyBankAccount,
  formatBankAccountFromSeq,
  formatBankAgencyWithDigitFromSeq,
  formatBankLabel,
  getBankBrandIcon,
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
  type CompanyBankAccount,
} from '@/lib/company-bank-accounts'
import { createEmptyFiscalFigure, normalizeCompanyFiscalData, type CompanyFiscalData, type FiscalFigureRecord } from '@/lib/company-fiscal-data'
import { formatCnaeCode } from '@/lib/cnaes'
import { formatCtnCode } from '@/lib/ctns'
import { formatNbsCode } from '@/lib/nbs'
import type {
  PromotoraRecord,
  PromotoraCommercialContact,
  PromotoraOperationalContact,
  PromotoraSystemEntry,
  PromotoraFiscalConfiguration,
  PromotoraFiscalData,
  PromotoraFiscalRetentionOverride,
} from '@/lib/promotoras'
import PromotoraFinancialConfigurations from './PromotoraFinancialConfigurations'
import PromotoraFiscalConfigurations from './PromotoraFiscalConfigurations'
import type { PromotoraLookupPayload } from '../actions'
import { getPromotora, getPromotoraLookups, savePromotora, setPromotoraStatus } from '../actions'

type TabKey = 'dados' | 'contatos' | 'fiscal' | 'financeiro' | 'sistemas'
type ContactTab = 'comercial' | 'operacional'

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]

async function copyText(value: string) {
  const text = String(value || '').trim()
  if (!text || typeof navigator === 'undefined') return false
  try {
    await navigator.clipboard?.writeText(text)
    return true
  } catch {
    return false
  }
}

function onlyDigitsWithFallback(value: string) {
  return String(value || '').replace(/\D/g, '')
}

function normalizeUrlValue(value: string) {
  return String(value || '').trim()
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

function createId(prefix = 'prom-fiscal') {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function formatTaxPercentValue(value: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const normalized = raw.replace(/[.]/g, ',')
  const [wholeRaw = '', decimalRaw = ''] = normalized.split(',')
  const whole = wholeRaw.replace(/\D/g, '').slice(0, 3)
  const decimal = decimalRaw.replace(/\D/g, '').slice(0, 2)
  return normalized.includes(',') ? `${whole || '0'},${decimal.padEnd(2, '0')}` : `${whole},00`
}

function sanitizeTaxPercentValue(value: string) {
  const raw = String(value || '').replace(/[.]/g, ',')
  const [wholeRaw = '', decimalRaw = ''] = raw.split(',')
  const whole = wholeRaw.replace(/\D/g, '').slice(0, 3)
  const decimal = decimalRaw.replace(/\D/g, '').slice(0, 2)
  if (raw.includes(',')) return `${whole}${raw.startsWith(',') ? '' : ','}${decimal}`
  return whole
}

function getSafeHref(value: string, kind: 'url' | 'email' | 'phone') {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (kind === 'email') return `mailto:${raw}`
  if (kind === 'phone') {
    const digits = onlyDigitsWithFallback(raw)
    return digits.length >= 10 ? `https://wa.me/55${digits}` : ''
  }
  if (/^(https?:\/\/|mailto:|tel:)/i.test(raw)) return raw
  if (/^www\./i.test(raw)) return `https://${raw}`
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw)) return `https://${raw}`
  return raw.startsWith('/') ? raw : ''
}

type CommercialTypeLookup = {
  id: string
  name: string
  is_active: boolean
}

function UfFlagsSelector({
  value,
  disabled,
  onChange,
}: {
  value: string[]
  disabled: boolean
  onChange: (next: string[]) => void
}) {
  const selected = new Set(value || [])

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(58px, 1fr))',
        gap: '0.5rem',
      }}
    >
      {UFS.map((uf) => {
        const active = selected.has(uf)
        return (
          <button
            key={uf}
            type="button"
            disabled={disabled}
            onClick={() => {
              const next = new Set(selected)
              if (next.has(uf)) next.delete(uf)
              else next.add(uf)
              onChange(Array.from(next).sort())
            }}
            style={{
              border: `1px solid ${active ? 'var(--brs-navy)' : 'var(--brs-gray-200)'}`,
              background: active ? 'rgba(39, 64, 132, 0.08)' : '#fff',
              color: active ? 'var(--brs-navy)' : 'var(--brs-gray-700)',
              borderRadius: 12,
              minHeight: 42,
              padding: '0.5rem 0.7rem',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.4rem',
              fontWeight: 700,
              cursor: disabled ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 4,
                border: `1.5px solid ${active ? 'var(--brs-navy)' : 'var(--brs-gray-300)'}`,
                background: active ? 'var(--brs-navy)' : '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                flex: '0 0 auto',
              }}
            >
              {active ? <CheckCircle size={10} /> : null}
            </span>
            <span>{uf}</span>
          </button>
        )
      })}
    </div>
  )
}

function CommercialContactCard({
  row,
  index,
  disabled,
  lookups,
  onChange,
  onRemove,
}: {
  row: PromotoraCommercialContact
  index: number
  disabled: boolean
  lookups: CommercialTypeLookup[]
  onChange: (next: PromotoraCommercialContact) => void
  onRemove: () => void
}) {
  return (
    <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-200)', boxShadow: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>Contato Comercial {index + 1}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>
            Configure o tipo comercial, as UFs e os dados de contato em um cartão próprio.
          </div>
        </div>
        {!disabled && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>
            <X size={14} />
            Remover
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '0.75rem' }}>
        <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 3' }}>
          <label className="form-label">Tipo de Comercial</label>
          <select
            className="form-control"
            disabled={disabled}
            value={row.commercial_type_id}
            onChange={(e) => onChange({ ...row, commercial_type_id: e.target.value })}
          >
            <option value="">Selecione</option>
            {lookups.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name}{opt.is_active ? '' : ' (Inativo)'}
              </option>
            ))}
          </select>
          {!lookups.length && (
            <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)', marginTop: '0.4rem' }}>
              Cadastre tipos em Configurações para disponibilizar esta lista.
            </div>
          )}
        </div>

        <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 3' }}>
          <label className="form-label">CPF</label>
          <input
            className="form-control"
            disabled={disabled}
            value={maskCpf(row.cpf || '')}
            onChange={(e) => onChange({ ...row, cpf: onlyDigits(e.target.value) })}
            placeholder="000.000.000-00"
          />
        </div>

        <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 6', gridRow: 'span 2' }}>
          <label className="form-label">UFs de Atuação</label>
          <UfFlagsSelector
            value={row.region_ufs || []}
            disabled={disabled}
            onChange={(next) => onChange({ ...row, region_ufs: next })}
          />
        </div>

        <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 4' }}>
          <label className="form-label">Nome Completo</label>
          <input
            className="form-control"
            disabled={disabled}
            value={row.nome_completo || ''}
            onChange={(e) => onChange({ ...row, nome_completo: e.target.value })}
            placeholder="Nome do contato"
          />
        </div>

        <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 2' }}>
          <label className="form-label">Data de Nascimento</label>
          <input
            className="form-control"
            type="date"
            disabled={disabled}
            value={row.data_nascimento || ''}
            onChange={(e) => onChange({ ...row, data_nascimento: e.target.value })}
          />
        </div>

        <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 3' }}>
          <label className="form-label">E-mail</label>
          {disabled ? (
            <ReadOnlyField label="" value={maskEmailInput(row.email || '')} kind="email" />
          ) : (
            <input
              className="form-control"
              value={maskEmailInput(row.email || '')}
              onChange={(e) => onChange({ ...row, email: maskEmailInput(e.target.value) })}
              placeholder="email@dominio.com"
            />
          )}
        </div>

        <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 3' }}>
          <label className="form-label">WhatsApp</label>
          {disabled ? (
            <ReadOnlyField label="" value={maskPhone(row.whatsapp || '')} kind="phone" />
          ) : (
            <input
              className="form-control"
              value={maskPhone(row.whatsapp || '')}
              onChange={(e) => onChange({ ...row, whatsapp: onlyDigits(e.target.value) })}
              placeholder="(00) 90000-0000"
            />
          )}
        </div>

        <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 3' }}>
          <label className="form-label">Data Inicial</label>
          <input
            className="form-control"
            type="date"
            disabled={disabled}
            value={row.data_inicial || ''}
            onChange={(e) => onChange({ ...row, data_inicial: e.target.value })}
          />
        </div>

        <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 3' }}>
          <label className="form-label">Data Final</label>
          <input
            className="form-control"
            type="date"
            disabled={disabled}
            value={row.data_final || ''}
            onChange={(e) => onChange({ ...row, data_final: e.target.value })}
          />
        </div>
      </div>
    </div>
  )
}

function ReadOnlyField({
  label,
  value,
  kind = 'text',
  onClick,
  }: {
  label: string
  value: string
  kind?: 'text' | 'url' | 'email' | 'phone'
  onClick?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fieldLabel = String(label || '').trim()
  const rawValue = String(value || '').trim()
  const href = getSafeHref(rawValue, kind === 'text' ? 'url' : kind)
  const isPhone = kind === 'phone'
  const clickable = !!href

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  async function handleCopy() {
    const ok = await copyText(rawValue)
    if (!ok) return
    setCopied(true)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => {
      setCopied(false)
    }, 1400)
  }

  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      {fieldLabel ? <label className="form-label">{fieldLabel}</label> : null}
      <div
        style={{ position: 'relative' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <button
          type="button"
          className="form-control"
          onClick={() => {
            if (onClick) return onClick()
            if (!href || typeof window === 'undefined') return
            window.open(href, '_blank', 'noopener,noreferrer')
          }}
          style={{
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            paddingRight: '4.2rem',
            cursor: clickable ? 'pointer' : 'default',
            background: '#fff',
            color: 'var(--brs-gray-800)',
            borderColor: 'var(--brs-gray-200)',
            boxShadow: 'none',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {rawValue || '—'}
          </span>
        </button>

        {clickable && (
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation()
              await handleCopy()
            }}
            aria-label={fieldLabel ? `Copiar ${fieldLabel}` : 'Copiar valor'}
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              border: '1px solid transparent',
              background: copied ? '#ECFDF5' : 'transparent',
              color: copied ? '#047857' : 'var(--brs-gray-500)',
              cursor: 'pointer',
              padding: '0.3rem',
              borderRadius: '999px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 160ms ease',
            }}
          >
            {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
          </button>
        )}

        {copied && (
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 'calc(100% + 6px)',
              zIndex: 30,
              background: '#ECFDF5',
              color: '#047857',
              border: '1px solid #A7F3D0',
              borderRadius: 10,
              boxShadow: '0 12px 24px rgba(15, 23, 42, 0.10)',
              padding: '0.45rem 0.65rem',
              fontSize: '0.78rem',
              fontWeight: 700,
            }}
          >
            Copiado
          </div>
        )}

        {isPhone && href && hovered && (
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 'calc(100% + 6px)',
              zIndex: 30,
              background: '#fff',
              border: '1px solid var(--brs-gray-200)',
              borderRadius: 12,
              boxShadow: '0 16px 32px rgba(15, 23, 42, 0.14)',
              padding: '0.65rem 0.75rem',
              minWidth: 220,
            }}
          >
            <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-500)', marginBottom: '0.35rem' }}>
              WhatsApp
            </div>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                color: 'var(--brs-navy)',
                fontWeight: 700,
              }}
            >
              <PhoneCall size={14} />
              Abrir conversa
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

function EditableFilePreview({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  disabled: boolean
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadedLogo = String(value || '').trim()
  const fieldLabel = String(label || '').trim()

  function handleFile(file: File | null) {
    if (!file || disabled) return
    const reader = new FileReader()
    reader.onload = () => onChange(String(reader.result || ''))
    reader.readAsDataURL(file)
  }

  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      {fieldLabel ? <label className="form-label">{fieldLabel}</label> : null}
      <input
        ref={fileInputRef}
        className="form-control"
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0] || null)}
      />
      <button
        type="button"
        onClick={() => {
          if (!disabled) fileInputRef.current?.click()
        }}
        style={{
          width: 112,
          height: 112,
          borderRadius: 18,
          border: '1px solid var(--brs-gray-200)',
          overflow: 'hidden',
          background: '#fff',
          display: 'grid',
          placeItems: 'center',
          cursor: disabled ? 'default' : 'pointer',
          padding: 0,
        }}
      >
        {uploadedLogo ? (
          <img src={uploadedLogo} alt="Logo da promotora" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ display: 'grid', placeItems: 'center', gap: '0.35rem', color: 'var(--brs-gray-400)' }}>
            <Upload size={22} />
            {!disabled && <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Clique para enviar</span>}
          </div>
        )}
      </button>
    </div>
  )
}

function emptyCommercialContact(): PromotoraCommercialContact {
  return {
    id: globalThis.crypto?.randomUUID?.() || `commercial-${Date.now()}`,
    commercial_type_id: '',
    region_ufs: [],
    cpf: '',
    nome_completo: '',
    data_nascimento: '',
    email: '',
    whatsapp: '',
    data_inicial: '',
    data_final: '',
    is_active: true,
  }
}

function emptyOperationalContact(): PromotoraOperationalContact {
  return {
    id: globalThis.crypto?.randomUUID?.() || `operational-${Date.now()}`,
    sector_id: '',
    nome_responsavel: '',
    data_nascimento: '',
    whatsapp: '',
    email: '',
    data_inicial: '',
    data_final: '',
    is_active: true,
  }
}

function emptySystemEntry(): PromotoraSystemEntry {
  return {
    id: globalThis.crypto?.randomUUID?.() || `system-${Date.now()}`,
    system_type_id: '',
    descricao: '',
    url: '',
    observacoes: '',
    is_active: true,
  }
}

function BankIcon({ account }: { account: CompanyBankAccount }) {
  const icon = getBankBrandIcon(account.bank_code, account.bank_name)
  if (icon) {
    return (
      <svg viewBox="0 0 24 24" role="img" aria-label={icon.title} style={{ width: 28, height: 28, display: 'block' }}>
        <path fill={`#${icon.hex}`} d={icon.path} />
      </svg>
    )
  }
  return <Banknote size={20} color="var(--brs-gray-400)" />
}

function BankAccountCard({
  account,
  companyCnpj,
  banks,
  readonly,
  onChange,
  onRemove,
  onMakePrincipal,
}: {
  account: CompanyBankAccount
  companyCnpj: string
  banks: BankLookup[]
  readonly: boolean
  onChange: (next: CompanyBankAccount) => void
  onRemove: () => void
  onMakePrincipal: () => void
}) {
  const [bankSearch, setBankSearch] = useState('')
  const [bankDropdownOpen, setBankDropdownOpen] = useState(false)
  const [agencySeq, setAgencySeq] = useState(parseBankAgencySeq(account.bank_agency))
  const [accountSeq, setAccountSeq] = useState(parseBankAccountSeq(account.bank_account))

  useEffect(() => setAgencySeq(parseBankAgencySeq(account.bank_agency)), [account.bank_agency])
  useEffect(() => setAccountSeq(parseBankAccountSeq(account.bank_account)), [account.bank_account])

  const filteredBanks = useMemo(() => {
    const query = bankSearch.trim().toLowerCase()
    if (!bankDropdownOpen || query.length < 3) return []
    return banks
      .filter((bank) => {
        const label = formatBankLabel(bank).toLowerCase()
        return label.includes(query) || String(bank.code || '').toLowerCase().includes(query) || String(bank.fullName || '').toLowerCase().includes(query)
      })
      .slice(0, 12)
  }, [banks, bankDropdownOpen, bankSearch])

  const uploadedLogo = String(account.bank_logo_data_url || '').trim()

  function handleFile(file: File | null) {
    if (!file || readonly) return
    const reader = new FileReader()
    reader.onload = () => onChange({ ...account, bank_logo_data_url: String(reader.result || '') })
    reader.readAsDataURL(file)
  }

  return (
    <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)' }}>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <div style={{ width: 62, height: 62, borderRadius: 14, border: '1px solid var(--brs-gray-200)', background: '#fff', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
            {uploadedLogo ? <img src={uploadedLogo} alt="Logo do banco" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <BankIcon account={account} />}
          </div>
          <div>
            <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>Conta {account.name ? `- ${account.name}` : ''}</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--brs-gray-500)' }}>
              {account.bank_name || 'Selecione um banco'}
              {account.bank_code ? ` • ${String(account.bank_code).padStart(3, '0')}` : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {!readonly && (
            <>
              <button type="button" className="btn btn-outline btn-sm" onClick={onMakePrincipal}>
                <ShieldCheck size={14} />
                Principal
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={onRemove}>
                <Trash2 size={14} />
                Remover
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem', marginTop: '1rem' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Nome da Conta</label>
          <input
            className="form-control"
            maxLength={100}
            value={account.name || ''}
            disabled={readonly}
            onChange={(e) => onChange({ ...account, name: e.target.value })}
            placeholder="Conta principal"
          />
        </div>
        <div className="form-group" style={{ marginBottom: 0, position: 'relative' }}>
          <label className="form-label">Banco</label>
          <input
            className="form-control"
            disabled={readonly}
            value={bankSearch || formatBankLabel({ code: account.bank_code, name: account.bank_name, fullName: account.bank_full_name })}
            onChange={(e) => {
              setBankSearch(e.target.value)
              setBankDropdownOpen(true)
            }}
            onFocus={() => setBankDropdownOpen(true)}
            placeholder="Digite ao menos 3 caracteres"
          />
          {filteredBanks.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4, background: '#fff', border: '1px solid var(--brs-gray-200)', borderRadius: 10, boxShadow: '0 10px 30px rgba(15,23,42,0.08)', maxHeight: 260, overflowY: 'auto' }}>
              {filteredBanks.map((bank) => (
                <button
                  key={`${bank.code}-${bank.name}`}
                  type="button"
                  className="btn btn-ghost"
                  style={{ width: '100%', justifyContent: 'flex-start', borderRadius: 0, padding: '0.75rem 0.9rem' }}
                  onClick={() => {
                    onChange({
                      ...account,
                      bank_code: String(bank.code || '').replace(/\D/g, '').slice(0, 3).padStart(3, '0'),
                      bank_name: String(bank.name || '').trim(),
                      bank_full_name: String(bank.fullName || '').trim(),
                      bank_ispb: String(bank.ispb || '').trim(),
                    })
                    setBankSearch(formatBankLabel(bank))
                    setBankDropdownOpen(false)
                  }}
                >
                  {formatBankLabel(bank)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Agência com dígito</label>
          <input
            className="form-control"
            inputMode="numeric"
            disabled={readonly}
            value={formatBankAgencyWithDigitFromSeq(agencySeq)}
            onChange={(e) => {
              const digits = String(e.target.value || '').replace(/\D/g, '').slice(0, 5)
              setAgencySeq(digits)
              onChange({ ...account, bank_agency: formatBankAgencyWithDigitFromSeq(digits) })
            }}
            placeholder="0000-0"
          />
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Conta com dígito</label>
          <input
            className="form-control"
            inputMode="numeric"
            disabled={readonly}
            value={formatBankAccountFromSeq(accountSeq)}
            onChange={(e) => {
              const digits = String(e.target.value || '').replace(/\D/g, '').slice(0, 11)
              setAccountSeq(digits)
              onChange({ ...account, bank_account: formatBankAccountFromSeq(digits) })
            }}
            placeholder="0000000000-0"
          />
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Tipo de Conta</label>
          <select
            className="form-control"
            disabled={readonly}
            value={account.bank_account_type || 'Corrente'}
            onChange={(e) => onChange({ ...account, bank_account_type: e.target.value === 'Poupança' ? 'Poupança' : 'Corrente' })}
          >
            <option value="Corrente">Corrente</option>
            <option value="Poupança">Poupança</option>
          </select>
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Tipo de Chave Pix</label>
          <select
            className="form-control"
            disabled={readonly}
            value={account.pix_type || 'cnpj'}
            onChange={(e) => onChange({ ...account, pix_type: e.target.value as any, pix_key: e.target.value === 'bank' ? 'Dados Bancários' : account.pix_key })}
          >
            <option value="cnpj">CNPJ</option>
            <option value="phone">Celular</option>
            <option value="email">E-mail</option>
            <option value="bank">Dados Bancários</option>
            <option value="random">Aleatória</option>
          </select>
        </div>

        {account.pix_type !== 'bank' && (
          <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
            <label className="form-label">Chave Pix</label>
            {account.pix_type === 'cnpj' ? (
              <input className="form-control" disabled value={maskCnpj(companyCnpj || '')} />
            ) : account.pix_type === 'phone' ? (
              <input
                className="form-control"
                disabled={readonly}
                inputMode="numeric"
                value={maskPhone(account.pix_key || '')}
                onChange={(e) => onChange({ ...account, pix_key: maskPhone(e.target.value) })}
                placeholder="(00) 90000-0000"
              />
            ) : account.pix_type === 'email' ? (
              <input
                className="form-control"
                disabled={readonly}
                value={maskEmailInput(account.pix_key || '')}
                onChange={(e) => onChange({ ...account, pix_key: maskEmailInput(e.target.value) })}
                placeholder="email@dominio.com"
              />
            ) : (
              <input
                className="form-control"
                disabled={readonly}
                value={maskUuidInput(account.pix_key || '')}
                onChange={(e) => onChange({ ...account, pix_key: maskUuidInput(e.target.value) })}
                placeholder="UUID do PIX"
              />
            )}
          </div>
        )}

        <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
          <label className="form-label">Logotipo</label>
          {!readonly && <input className="form-control" type="file" accept="image/*" onChange={(e) => handleFile(e.target.files?.[0] || null)} />}
          <div style={{ width: 90, height: 90, borderRadius: 16, border: '1px solid var(--brs-gray-200)', overflow: 'hidden', marginTop: 10, background: '#fff', display: 'grid', placeItems: 'center' }}>
            {uploadedLogo ? <img src={uploadedLogo} alt="Logo do banco" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Upload size={20} color="var(--brs-gray-400)" />}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PromotoraEditor({ promotoraId, readOnly = false, isNew = false }: { promotoraId?: string; readOnly?: boolean; isNew?: boolean }) {
  const router = useRouter()
  const [item, setItem] = useState<PromotoraRecord | null>(null)
  const [lookups, setLookups] = useState<PromotoraLookupPayload | null>(null)
  const [banks, setBanks] = useState<BankLookup[]>([])
  const [activeTab, setActiveTab] = useState<TabKey>('dados')
  const [activeContactTab, setActiveContactTab] = useState<ContactTab>('comercial')
  const [editingFiscalField, setEditingFiscalField] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyStatus, setBusyStatus] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const lastFinanceSystemUrlRef = useRef('')

  async function loadData() {
    setLoading(true)
    try {
      const [lookupsRes, bankRes, itemRes] = await Promise.all([
        getPromotoraLookups(),
        fetch('/api/lookups/banks').then((r) => r.json()).catch(() => null),
        !isNew && promotoraId ? getPromotora(promotoraId) : Promise.resolve({ success: true, item: null }),
      ])

      if (lookupsRes.success) setLookups(lookupsRes.lookups || null)
      else setMessage({ type: 'error', text: lookupsRes.error || 'Erro ao carregar listas.' })

      setBanks(Array.isArray(bankRes?.banks) ? bankRes.banks : [])

      if (itemRes.success) {
        if (itemRes.item) setItem(itemRes.item)
      } else {
        setMessage({ type: 'error', text: 'Erro ao carregar promotora.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar promotora.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isNew) {
      setItem({
        id: undefined,
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
      })
    }

    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promotoraId, isNew])

  const selectedCompany = useMemo(() => {
    if (!item?.financial_data?.empresa_contratada_id || !lookups?.companies) return null
    return lookups.companies.find((company: any) => company.id === item.financial_data.empresa_contratada_id) || null
  }, [item?.financial_data?.empresa_contratada_id, lookups?.companies])

  const selectedCompanyFiscalData = useMemo<CompanyFiscalData | null>(() => {
    const raw = (selectedCompany as any)?.company_data?.fiscal_data
    return normalizeCompanyFiscalData(raw)
  }, [selectedCompany])

  const companyBankAccounts: CompanyBankAccount[] = useMemo(() => {
    const raw = (selectedCompany as any)?.company_data?.bank_accounts
    return Array.isArray(raw) ? raw : []
  }, [selectedCompany])

  const availableFinancialRemunerationTypes = useMemo(() => {
    const linkedIds = new Set((item?.fiscal_data?.configurations || []).map((config) => String(config.remuneration_type_id || '').trim()).filter(Boolean))
    return (lookups?.remunerationTypes || []).filter((type) => linkedIds.has(type.id))
  }, [item?.fiscal_data?.configurations, lookups?.remunerationTypes])

  const totalRetencoes = useMemo(() => {
    if (!item) return '0,00'
    const values = [
      item.fiscal_data?.simples_nacional,
      item.fiscal_data?.iss,
      item.fiscal_data?.irpj_retido,
      item.fiscal_data?.csll_retido,
      item.fiscal_data?.pis_retido,
      item.fiscal_data?.cofins_retido,
      item.fiscal_data?.cbs_retido,
      item.fiscal_data?.ibs_retido,
    ]
    const total = values.reduce((sum, value) => sum + (Number(String(value || '0').replace(',', '.')) || 0), 0)
    return total.toFixed(2).replace('.', ',')
  }, [item])

  const fiscalTaxFields = [
    { key: 'simples_nacional', label: 'Simples Nacional' },
    { key: 'iss', label: 'ISS' },
    { key: 'irpj_retido', label: 'IRPJ Retido' },
    { key: 'csll_retido', label: 'CSLL Retido' },
    { key: 'pis_retido', label: 'PIS Retido' },
    { key: 'cofins_retido', label: 'COFINS Retido' },
    { key: 'cbs_retido', label: 'CBS Retido' },
    { key: 'ibs_retido', label: 'IBS Retido' },
  ] as const

  useEffect(() => {
    if (!item) return
    setItem((prev) => {
      if (!prev) return prev
      const financeUrl = String(prev.financial_data?.url_sistema || '').trim()
      const systems = Array.isArray(prev.systems) ? [...prev.systems] : []
      const isMinimalSystem = (entry: PromotoraSystemEntry) =>
        !String(entry.system_type_id || '').trim() &&
        !String(entry.descricao || '').trim() &&
        !String(entry.observacoes || '').trim()

      const findEmptySlot = () => systems.findIndex((entry) => !String(entry.url || '').trim() && isMinimalSystem(entry))
      const findUrlSlot = (url: string) => systems.findIndex((entry) => String(entry.url || '').trim() === url)

      const syncFinanceUrl = (previousUrl: string, nextUrl: string) => {
        if (previousUrl && previousUrl !== nextUrl) {
          const previousIndex = findUrlSlot(previousUrl)
          if (previousIndex >= 0 && isMinimalSystem(systems[previousIndex])) {
            if (nextUrl) {
              systems[previousIndex] = { ...systems[previousIndex], url: nextUrl }
            } else {
              systems.splice(previousIndex, 1)
            }
            return true
          }
        }

        if (!nextUrl) return false
        if (findUrlSlot(nextUrl) >= 0) return false

        const emptyIndex = findEmptySlot()
        if (emptyIndex >= 0) {
          systems[emptyIndex] = { ...systems[emptyIndex], url: nextUrl }
        } else {
          systems.push({ ...emptySystemEntry(), url: nextUrl })
        }
        return true
      }

      for (const config of prev.fiscal_data?.configurations || []) {
        if (config?.meio_envio_nfse !== 'sistema') continue
        const nextUrl = String(config.nfse_system_url || '').trim()
        if (!nextUrl) continue
        if (findUrlSlot(nextUrl) >= 0) continue
        const emptyIndex = findEmptySlot()
        if (emptyIndex >= 0) {
          systems[emptyIndex] = { ...systems[emptyIndex], url: nextUrl }
        } else {
          systems.push({ ...emptySystemEntry(), url: nextUrl })
        }
      }

      const changed = syncFinanceUrl(lastFinanceSystemUrlRef.current, financeUrl)
      lastFinanceSystemUrlRef.current = financeUrl
      if (!changed && systems.length === (prev.systems || []).length) return prev
      return { ...prev, systems }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.fiscal_data?.configurations, item?.financial_data?.url_sistema])

  async function fillByCnpj() {
    if (!item) return
    const cnpj = onlyDigits(item.cnpj || '')
    if (cnpj.length !== 14) {
      setMessage({ type: 'error', text: 'Informe um CNPJ válido para consulta.' })
      return
    }

    try {
      const endpoints = [
        `https://publica.cnpj.ws/cnpj/${cnpj}`,
        `/api/cnpjws/cnpj/${cnpj}`,
      ]

      let lastError = 'CNPJ não encontrado.'
      let data: any = null

      for (const endpoint of endpoints) {
        try {
          const res = await fetch(endpoint, { cache: 'no-store' })
          const payload = await res.json().catch(async () => ({ error: await res.text() }))

          if (res.ok) {
            data = payload
            break
          }

          lastError =
            payload?.error ||
            payload?.message ||
            (res.status === 401 || res.status === 403
              ? 'A consulta CNPJ.ws não foi autorizada ou está indisponível no momento.'
              : 'CNPJ não encontrado.')
        } catch (error: any) {
          lastError = error?.message || lastError
        }
      }

      if (!data) throw new Error(lastError)

      const est = data?.estabelecimento || {}
      setItem((prev) =>
        prev
          ? {
              ...prev,
              cnpj,
              razao_social: data?.razao_social || prev.razao_social,
              nome_fantasia: est?.nome_fantasia || prev.nome_fantasia,
              address_data: {
                ...(prev.address_data || {}),
                cep: est?.cep || prev.address_data?.cep || '',
                logradouro: est?.logradouro || prev.address_data?.logradouro || '',
                bairro: est?.bairro || prev.address_data?.bairro || '',
                cidade: est?.cidade?.nome || prev.address_data?.cidade || '',
                uf: est?.estado?.sigla || prev.address_data?.uf || '',
                numero: est?.numero || prev.address_data?.numero || '',
                complemento: est?.complemento || prev.address_data?.complemento || '',
              },
            }
          : prev,
      )
      setMessage({ type: 'success', text: 'Dados preenchidos via CNPJ.ws.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao consultar CNPJ.' })
    }
  }

  async function fillByCep() {
    if (!item) return
    const cep = onlyDigits(item.address_data?.cep || '')
    if (cep.length !== 8) {
      setMessage({ type: 'error', text: 'Informe um CEP válido para consulta.' })
      return
    }

    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok || data?.erro) throw new Error('CEP não encontrado.')
      setItem((prev) =>
        prev
          ? {
              ...prev,
              address_data: {
                ...(prev.address_data || {}),
                cep,
                logradouro: data?.logradouro || prev.address_data?.logradouro || '',
                bairro: data?.bairro || prev.address_data?.bairro || '',
                cidade: data?.localidade || prev.address_data?.cidade || '',
                uf: data?.uf || prev.address_data?.uf || '',
              },
            }
          : prev,
      )
      setMessage({ type: 'success', text: 'Endereço preenchido via ViaCEP.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao consultar CEP.' })
    }
  }

  async function save() {
    if (!item) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await savePromotora(item)
      if (res.success) {
        setMessage({ type: 'success', text: item.id ? 'Promotora atualizada com sucesso.' : 'Promotora criada com sucesso.' })
        if (!item.id && res.id) {
          router.replace(`/promotoras/${res.id}`)
        } else {
          await loadData()
        }
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar promotora.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao salvar promotora.' })
    } finally {
      setSaving(false)
    }
  }

  async function toggleStatus() {
    if (!item?.id) return
    setBusyStatus(true)
    try {
      const nextActive = !item.is_active
      const res = await setPromotoraStatus(item.id, nextActive)
      if (res.success) {
        setMessage({ type: 'success', text: nextActive ? 'Promotora reativada.' : 'Promotora inativada.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao alterar status.' })
      }
    } finally {
      setBusyStatus(false)
    }
  }

  function updateItem(next: PromotoraRecord | null) {
    setItem(next)
  }

  function updateCommercialContact(index: number, next: PromotoraCommercialContact) {
    updateItem(item ? { ...item, contacts_commercial: item.contacts_commercial.map((row, i) => (i === index ? next : row)) } : item)
  }

  function updateOperationalContact(index: number, next: PromotoraOperationalContact) {
    updateItem(item ? { ...item, contacts_operational: item.contacts_operational.map((row, i) => (i === index ? next : row)) } : item)
  }

  function updateSystem(index: number, next: PromotoraSystemEntry) {
    updateItem(item ? { ...item, systems: item.systems.map((row, i) => (i === index ? next : row)) } : item)
  }

  if (loading || !item) {
    return (
      <div className="page-content">
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
        </div>
      </div>
    )
  }

  const isReadOnly = readOnly && !isNew

  return (
    <div className={`page-content ${isReadOnly ? 'promotora-readonly' : ''}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                border: '1px solid var(--brs-gray-200)',
                background: '#fff',
                display: 'grid',
                placeItems: 'center',
                overflow: 'hidden',
                flex: '0 0 auto',
              }}
            >
              {item.logo_url ? (
                <img src={item.logo_url} alt="Logotipo da promotora" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <Building2 size={16} color="var(--brs-gray-400)" />
              )}
            </div>
            {item.id ? item.razao_social || 'Promotora' : 'Nova Promotora'}
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Cadastro completo das Promotoras parceiras que serão utilizadas em outros subsistemas do Workspace.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={() => router.push('/promotoras')}>
            <ChevronLeft size={16} />
            Voltar
          </button>
          {isReadOnly ? (
            <>
              {item.id && (
                <button type="button" className="btn btn-primary" onClick={() => router.push(`/promotoras/${item.id}`)}>
                  <Edit2 size={16} />
                  Editar
                </button>
              )}
              {item.id && (
                <button type="button" className={`btn ${item.is_active ? 'btn-outline' : 'btn-primary'}`} onClick={toggleStatus} disabled={busyStatus}>
                  {busyStatus ? <Loader2 size={16} className="spinner" /> : null}
                  {item.is_active ? 'Inativar' : 'Ativar'}
                </button>
              )}
            </>
          ) : (
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
              Salvar
            </button>
          )}
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
            gap: '0.5rem',
            alignItems: 'center',
          }}
        >
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {[
          { key: 'dados', label: 'Dados Cadastrais', icon: Building2 },
          { key: 'contatos', label: 'Contatos', icon: Users },
          { key: 'fiscal', label: 'Fiscal e Tributário', icon: FileText },
          { key: 'financeiro', label: 'Financeiro', icon: Banknote },
          { key: 'sistemas', label: 'Sistemas', icon: Globe },
        ].map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              type="button"
              className={`btn ${activeTab === tab.key ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setActiveTab(tab.key as TabKey)}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'dados' && (
        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '0.75rem', alignItems: 'start' }}>
            <div className="form-group" style={{ gridColumn: '1 / span 1', gridRow: '1 / span 2', marginBottom: 0 }}>
              <label className="form-label">Logo</label>
              {isReadOnly ? (
                <div style={{ width: 112, height: 112, borderRadius: 18, border: '1px solid var(--brs-gray-200)', overflow: 'hidden', background: '#fff', display: 'grid', placeItems: 'center' }}>
                  {item.logo_url ? <img src={item.logo_url} alt="Logo da promotora" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Upload size={22} color="var(--brs-gray-400)" />}
                </div>
              ) : (
                <EditableFilePreview
                  label=""
                  value={item.logo_url || ''}
                  disabled={isReadOnly}
                  onChange={(next) => updateItem(item ? { ...item, logo_url: next } : item)}
                />
              )}
            </div>

            <div className="form-group" style={{ gridColumn: '2 / span 3' }}>
              <label className="form-label">Empresa Contratada</label>
              <select
                className="form-control"
                disabled={isReadOnly}
                value={item.financial_data?.empresa_contratada_id || ''}
                onChange={(e) => updateItem(item ? { ...item, financial_data: { ...(item.financial_data || {}), empresa_contratada_id: e.target.value, conta_recebimento_index: '' } } : item)}
              >
                <option value="">Selecione</option>
                {lookups?.companies?.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.display_name}{company.is_active ? '' : ' (Inativa)'}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group" style={{ gridColumn: '5 / span 2' }}>
              <label className="form-label">CNPJ</label>
              {isReadOnly ? (
                <ReadOnlyField label="" value={maskCnpj(item.cnpj || '')} />
              ) : (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input className="form-control" value={maskCnpj(item.cnpj || '')} onChange={(e) => updateItem(item ? { ...item, cnpj: onlyDigits(e.target.value) } : item)} placeholder="00.000.000/0000-00" />
                  <button type="button" className="btn btn-outline" onClick={fillByCnpj}>
                    Buscar
                  </button>
                </div>
              )}
            </div>

            <div className="form-group" style={{ gridColumn: '7 / span 3' }}>
              <label className="form-label">Razão Social</label>
              <input className="form-control" value={item.razao_social || ''} disabled={isReadOnly} onChange={(e) => updateItem(item ? { ...item, razao_social: e.target.value } : item)} />
            </div>

            <div className="form-group" style={{ gridColumn: '10 / span 3' }}>
              <label className="form-label">Nome Fantasia</label>
              <input className="form-control" value={item.nome_fantasia || ''} disabled={isReadOnly} onChange={(e) => updateItem(item ? { ...item, nome_fantasia: e.target.value } : item)} />
            </div>

            <div className="form-group" style={{ gridColumn: '2 / span 2' }}>
              <label className="form-label">CEP</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input className="form-control" value={maskCep(item.address_data?.cep || '')} disabled={isReadOnly} onChange={(e) => updateItem(item ? { ...item, address_data: { ...(item.address_data || {}), cep: onlyDigits(e.target.value) } } : item)} placeholder="00000-000" />
                {!isReadOnly && (
                  <button type="button" className="btn btn-outline" onClick={fillByCep}>
                    Buscar
                  </button>
                )}
              </div>
            </div>

            <div className="form-group" style={{ gridColumn: '4 / span 5' }}>
              <label className="form-label">Logradouro</label>
              <input className="form-control" value={item.address_data?.logradouro || ''} disabled={isReadOnly} onChange={(e) => updateItem(item ? { ...item, address_data: { ...(item.address_data || {}), logradouro: e.target.value } } : item)} />
            </div>

            <div className="form-group" style={{ gridColumn: '9 / span 4' }}>
              <label className="form-label">Bairro</label>
              <input className="form-control" value={item.address_data?.bairro || ''} disabled={isReadOnly} onChange={(e) => updateItem(item ? { ...item, address_data: { ...(item.address_data || {}), bairro: e.target.value } } : item)} />
            </div>

            <div className="form-group" style={{ gridColumn: '1 / span 5' }}>
              <label className="form-label">Cidade</label>
              <input className="form-control" value={item.address_data?.cidade || ''} disabled={isReadOnly} onChange={(e) => updateItem(item ? { ...item, address_data: { ...(item.address_data || {}), cidade: e.target.value } } : item)} />
            </div>

            <div className="form-group" style={{ gridColumn: '6 / span 1' }}>
              <label className="form-label">UF</label>
              <select className="form-control" value={item.address_data?.uf || ''} disabled={isReadOnly} onChange={(e) => updateItem(item ? { ...item, address_data: { ...(item.address_data || {}), uf: e.target.value } } : item)}>
                <option value="">Selecione</option>
                {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
              </select>
            </div>

            <div className="form-group" style={{ gridColumn: '7 / span 1' }}>
              <label className="form-label">Número</label>
              <input className="form-control" value={item.address_data?.numero || ''} disabled={isReadOnly} onChange={(e) => updateItem(item ? { ...item, address_data: { ...(item.address_data || {}), numero: e.target.value } } : item)} />
            </div>

            <div className="form-group" style={{ gridColumn: '8 / span 5' }}>
              <label className="form-label">Complemento</label>
              <input className="form-control" value={item.address_data?.complemento || ''} disabled={isReadOnly} onChange={(e) => updateItem(item ? { ...item, address_data: { ...(item.address_data || {}), complemento: e.target.value } } : item)} />
            </div>

            <div className="form-group" style={{ gridColumn: '1 / span 6' }}>
              <label className="form-label">Site Institucional</label>
              {isReadOnly ? (
                <ReadOnlyField label="" value={item.address_data?.site_institucional || ''} kind="url" />
              ) : (
                <input className="form-control" type="url" value={item.address_data?.site_institucional || ''} onChange={(e) => updateItem(item ? { ...item, address_data: { ...(item.address_data || {}), site_institucional: normalizeUrlValue(e.target.value) } } : item)} placeholder="https://www.seudominio.com.br" />
              )}
            </div>

            <div className="form-group" style={{ gridColumn: '7 / span 6' }}>
              <label className="form-label">E-mail Principal</label>
              {isReadOnly ? (
                <ReadOnlyField label="" value={maskEmailInput(item.address_data?.email_principal || '')} kind="email" />
              ) : (
                <input className="form-control" type="email" autoComplete="email" inputMode="email" value={maskEmailInput(item.address_data?.email_principal || '')} onChange={(e) => updateItem(item ? { ...item, address_data: { ...(item.address_data || {}), email_principal: maskEmailInput(e.target.value) } } : item)} placeholder="nome@dominio.com" />
              )}
            </div>

            <div className="form-group" style={{ gridColumn: '1 / span 4' }}>
              <label className="form-label">Link para Contrato Assinado</label>
              {isReadOnly ? (
                <ReadOnlyField label="" value={item.address_data?.contrato_url || ''} kind="url" />
              ) : (
                <input className="form-control" type="url" value={item.address_data?.contrato_url || ''} onChange={(e) => updateItem(item ? { ...item, address_data: { ...(item.address_data || {}), contrato_url: normalizeUrlValue(e.target.value) } } : item)} placeholder="https://..." />
              )}
            </div>

            <div className="form-group" style={{ gridColumn: '5 / span 4' }}>
              <label className="form-label">Pasta de Documentos</label>
              {isReadOnly ? (
                <ReadOnlyField label="" value={item.address_data?.drive_documentos_url || ''} kind="url" />
              ) : (
                <input className="form-control" type="url" value={item.address_data?.drive_documentos_url || ''} onChange={(e) => updateItem(item ? { ...item, address_data: { ...(item.address_data || {}), drive_documentos_url: normalizeUrlValue(e.target.value) } } : item)} placeholder="https://drive.google.com/..." />
              )}
            </div>

            <div className="form-group" style={{ gridColumn: '9 / span 4' }}>
              <label className="form-label">Pasta de Logotipos e Marketing</label>
              {isReadOnly ? (
                <ReadOnlyField label="" value={item.address_data?.drive_logotipos_url || ''} kind="url" />
              ) : (
                <input className="form-control" type="url" value={item.address_data?.drive_logotipos_url || ''} onChange={(e) => updateItem(item ? { ...item, address_data: { ...(item.address_data || {}), drive_logotipos_url: normalizeUrlValue(e.target.value) } } : item)} placeholder="https://drive.google.com/..." />
              )}
            </div>
          </div>
        </div>
      )}      {activeTab === 'contatos' && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div className="card" style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className={`btn ${activeContactTab === 'comercial' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setActiveContactTab('comercial')}>Comercial</button>
                <button type="button" className={`btn ${activeContactTab === 'operacional' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setActiveContactTab('operacional')}>Operacional</button>
              </div>
              {!isReadOnly && (
                <button type="button" className="btn btn-outline" onClick={() => {
                  if (activeContactTab === 'comercial') updateItem(item ? { ...item, contacts_commercial: [...item.contacts_commercial, emptyCommercialContact()] } : item)
                  else updateItem(item ? { ...item, contacts_operational: [...item.contacts_operational, emptyOperationalContact()] } : item)
                }}>
                  <CirclePlus size={16} />
                  Novo Contato
                </button>
              )}
            </div>

            {activeContactTab === 'comercial' ? (
              <div style={{ display: 'grid', gap: '1rem' }}>
                {item.contacts_commercial.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--brs-gray-500)' }}>
                    Nenhuma linha cadastrada.
                  </div>
                ) : item.contacts_commercial.map((row, index) => (
                  <CommercialContactCard
                    key={row.id}
                    row={row}
                    index={index}
                    disabled={isReadOnly}
                    lookups={lookups?.commercialTypes || []}
                    onChange={(next) => updateCommercialContact(index, next)}
                    onRemove={() => updateItem(item ? { ...item, contacts_commercial: item.contacts_commercial.filter((_, i) => i !== index) } : item)}
                  />
                ))}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                  <colgroup>
                    <col style={{ width: '8%' }} />
                    <col style={{ width: '24%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '24%' }} />
                    <col style={{ width: '9%' }} />
                    <col style={{ width: '9%' }} />
                    <col style={{ width: '2%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Setor</th>
                      <th>Nome Responsável</th>
                      <th>Data de Nascimento</th>
                      <th>WhatsApp</th>
                      <th>E-mail</th>
                      <th>Data Inicial</th>
                      <th>Data Final</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.contacts_operational.length === 0 ? (
                      <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>Nenhuma linha cadastrada.</td></tr>
                    ) : item.contacts_operational.map((row, index) => (
                      <tr key={row.id}>
                        <td>
                          <select className="form-control" disabled={isReadOnly} value={row.sector_id} onChange={(e) => updateOperationalContact(index, { ...row, sector_id: e.target.value })}>
                            <option value="">Selecione</option>
                            {lookups?.sectors?.map((opt) => <option key={opt.id} value={opt.id}>{opt.name}</option>)}
                          </select>
                        </td>
                        <td><input className="form-control" style={{ width: '100%', minWidth: 0 }} disabled={isReadOnly} value={row.nome_responsavel || ''} onChange={(e) => updateOperationalContact(index, { ...row, nome_responsavel: e.target.value })} /></td>
                        <td><input className="form-control" type="date" style={{ width: '100%', minWidth: 0 }} disabled={isReadOnly} value={row.data_nascimento || ''} onChange={(e) => updateOperationalContact(index, { ...row, data_nascimento: e.target.value })} /></td>
                        <td>
                          {isReadOnly ? (
                            <ReadOnlyField label="" value={maskPhone(row.whatsapp || '')} kind="phone" />
                          ) : (
                            <input className="form-control" style={{ width: '100%', minWidth: 0 }} value={maskPhone(row.whatsapp || '')} onChange={(e) => updateOperationalContact(index, { ...row, whatsapp: onlyDigits(e.target.value) })} />
                          )}
                        </td>
                        <td>
                          {isReadOnly ? (
                            <ReadOnlyField label="" value={maskEmailInput(row.email || '')} kind="email" />
                          ) : (
                            <input className="form-control" style={{ width: '100%', minWidth: 0 }} value={maskEmailInput(row.email || '')} onChange={(e) => updateOperationalContact(index, { ...row, email: maskEmailInput(e.target.value) })} />
                          )}
                        </td>
                        <td><input className="form-control" type="date" style={{ width: '100%', minWidth: 0 }} disabled={isReadOnly} value={row.data_inicial || ''} onChange={(e) => updateOperationalContact(index, { ...row, data_inicial: e.target.value })} /></td>
                        <td><input className="form-control" type="date" style={{ width: '100%', minWidth: 0 }} disabled={isReadOnly} value={row.data_final || ''} onChange={(e) => updateOperationalContact(index, { ...row, data_final: e.target.value })} /></td>
                        <td><button type="button" className="btn btn-ghost btn-sm" disabled={isReadOnly} onClick={() => updateItem(item ? { ...item, contacts_operational: item.contacts_operational.filter((_, i) => i !== index) } : item)}><X size={14} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'fiscal' && (
        <PromotoraFiscalConfigurations
          value={item.fiscal_data || { configurations: [] }}
          companyFiscalData={selectedCompanyFiscalData}
          companyLabel={String(selectedCompany?.nickname || '')}
          companyId={String(selectedCompany?.id || '')}
          lookups={lookups}
          disabled={isReadOnly}
          onChange={(next) => updateItem(item ? { ...item, fiscal_data: next } : item)}
          onAutoSave={save}
        />
      )}

      {activeTab === 'financeiro' && (
        <PromotoraFinancialConfigurations
          value={item.financial_data || {
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
          }}
          lookups={lookups}
          availableRemunerationTypes={availableFinancialRemunerationTypes}
          companyBankAccounts={companyBankAccounts}
          disabled={isReadOnly}
          onChange={(next) => updateItem(item ? { ...item, financial_data: next } : item)}
        />
      )}

      {activeTab === 'sistemas' && (
        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>Sistemas da Promotora</div>
            {!isReadOnly && (
              <button type="button" className="btn btn-outline" onClick={() => updateItem(item ? { ...item, systems: [...item.systems, emptySystemEntry()] } : item)}>
                <CirclePlus size={16} />
                Nova Linha
              </button>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Tipo de Sistema</th>
                  <th>Descrição</th>
                  <th>Observações</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {item.systems.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>Nenhuma linha cadastrada.</td></tr>
                ) : item.systems.map((row, index) => (
                  <tr key={row.id}>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <input
                          className="form-control"
                          readOnly={isReadOnly}
                          type="url"
                          value={row.url || ''}
                          onChange={(e) => updateSystem(index, { ...row, url: e.target.value })}
                          placeholder="https://www.sistema.com.br"
                          style={{ cursor: isReadOnly ? 'text' : undefined }}
                        />
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          disabled={!String(row.url || '').trim()}
                          onClick={() => copyText(String(row.url || '').trim())}
                          aria-label="Copiar URL do sistema"
                          title="Copiar URL"
                        >
                          <Copy size={14} />
                        </button>
                      </div>
                    </td>
                    <td>
                      <select
                        className="form-control"
                        disabled={isReadOnly}
                        value={row.system_type_id || ''}
                        onChange={(e) => updateSystem(index, { ...row, system_type_id: e.target.value })}
                      >
                        <option value="">Selecione</option>
                        {lookups?.systemTypes?.map((opt) => <option key={opt.id} value={opt.id}>{opt.name}</option>)}
                      </select>
                    </td>
                    <td><input className="form-control" disabled={isReadOnly} value={row.descricao || ''} onChange={(e) => updateSystem(index, { ...row, descricao: e.target.value })} /></td>
                    <td><input className="form-control" disabled={isReadOnly} value={row.observacoes || ''} onChange={(e) => updateSystem(index, { ...row, observacoes: e.target.value })} /></td>
                    <td>
                      <span className={`badge ${row.is_active ? 'badge-success' : 'badge-gray'}`}>{row.is_active ? 'Ativo' : 'Inativo'}</span>
                    </td>
                    <td>
                      {!isReadOnly && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateItem(item ? { ...item, systems: item.systems.filter((_, i) => i !== index) } : item)}>
                          <X size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isReadOnly && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
            Salvar
          </button>
        </div>
      )}
    </div>
  )
}




