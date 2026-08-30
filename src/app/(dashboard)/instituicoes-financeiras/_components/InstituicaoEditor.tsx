'use client'

import { useEffect, useMemo, useState } from 'react'
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
  Handshake,
  Headset,
  Link2,
  Loader2,
  Package,
  Plug,
  Save,
  Share2,
  Upload,
  Users,
  X,
} from 'lucide-react'
import {
  maskCep,
  maskCnpj,
  maskEmailInput,
  maskPhone,
  maskTelefoneComercial,
  onlyDigits,
  formatBankLabel,
  type BankLookup,
  type CompanyBankAccount,
} from '@/lib/company-bank-accounts'
import { normalizeCompanyFiscalData, type CompanyFiscalData } from '@/lib/company-fiscal-data'
import { formatCnaeCode } from '@/lib/cnaes'
import { formatCapitalSocialBr, normalizeCnpjWsCompleto } from '@/lib/cnpj-consulta'
import {
  INSTITUICAO_TIPOS,
  createEmptyInstituicaoFinanceira,
  createEmptyMarketingLink,
  createEmptyTarifaArquivo,
  normalizeLinksData,
  normalizeApiConexao,
  API_CONEXAO_CAMPOS,
  type InstituicaoAtendimentoLine,
  type InstituicaoFinanceiraRecord,
  type InstituicaoSacChannel,
  type InstituicaoTipo,
} from '@/lib/financial-institutions'
import type {
  PromotoraCommercialContact,
  PromotoraOperationalContact,
  PromotoraSystemEntry,
} from '@/lib/promotoras'
import {
  CommercialContactCard,
  EditableFilePreview,
  ReadOnlyField,
  emptyCommercialContact,
  emptyOperationalContact,
  emptySystemEntry,
} from '@/app/(dashboard)/promotoras/_components/PromotoraEditor'
import PromotoraFiscalConfigurations from '@/app/(dashboard)/promotoras/_components/PromotoraFiscalConfigurations'
import InstituicaoFinancialConfigurations from './InstituicaoFinancialConfigurations'
import type { InstituicaoLookupPayload } from '../actions'
import {
  getInstituicaoFinanceira,
  getInstituicaoLookups,
  saveInstituicaoFinanceira,
  setInstituicaoFinanceiraStatus,
} from '../actions'

type TabKey = 'dados' | 'contatos' | 'fiscal' | 'financeiro' | 'sistemas' | 'sac' | 'links' | 'negociacoes' | 'produtos' | 'api'
type ContactTab = 'comercial' | 'operacional' | 'redes'

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]

const WEEK_DAYS = [
  'Segunda-Feira',
  'Terça-Feira',
  'Quarta-Feira',
  'Quinta-Feira',
  'Sexta-Feira',
  'Sábado',
  'Domingo',
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

function sanitizeTime(value: string) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 4)
  if (!digits) return ''
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`
}

function WideFilePreview({
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
  const uploaded = String(value || '').trim()

  function handleFile(file: File | null) {
    if (!file || disabled) return
    const reader = new FileReader()
    reader.onload = () => onChange(String(reader.result || ''))
    reader.readAsDataURL(file)
  }

  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <label className="form-label">{label}</label>
      <label
        style={{
          width: 220,
          height: 88,
          borderRadius: 14,
          border: '1px solid var(--brs-gray-200)',
          overflow: 'hidden',
          background: '#fff',
          display: 'grid',
          placeItems: 'center',
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        {!disabled && (
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files?.[0] || null)} />
        )}
        {uploaded ? (
          <img src={uploaded} alt={label} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <div style={{ display: 'grid', placeItems: 'center', gap: '0.3rem', color: 'var(--brs-gray-400)' }}>
            <Upload size={20} />
            {!disabled && <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>Clique para enviar</span>}
          </div>
        )}
      </label>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.85rem', lineHeight: 1.5 }}>
      <span style={{ color: 'var(--brs-gray-500)', fontWeight: 600, flex: '0 0 auto' }}>{label}:</span>
      <span style={{ color: 'var(--brs-gray-800)' }}>{value || '-'}</span>
    </div>
  )
}

function AtendimentoLines({
  rows,
  disabled,
  onChange,
}: {
  rows: InstituicaoAtendimentoLine[]
  disabled: boolean
  onChange: (next: InstituicaoAtendimentoLine[]) => void
}) {
  function updateRow(index: number, row: InstituicaoAtendimentoLine) {
    onChange(rows.map((item, i) => (i === index ? row : item)))
  }

  function marcar24Horas() {
    onChange(WEEK_DAYS.map((dia) => ({ enabled: true, dia_da_semana: dia as InstituicaoAtendimentoLine['dia_da_semana'], hora_inicial: '00:00', hora_final: '23:59' })))
  }

  return (
    <div style={{ display: 'grid', gap: '0.55rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)', fontSize: '0.88rem' }}>Dias e Horários de Atendimento</div>
        {!disabled && (
          <button type="button" className="btn btn-outline btn-sm" onClick={marcar24Horas}>
            Atendimento 24 horas
          </button>
        )}
      </div>
      {rows.map((row, index) => (
        <div key={index} style={{ display: 'grid', gridTemplateColumns: '26px 1fr 88px 20px 88px', gap: '0.45rem', alignItems: 'center' }}>
          <input
            type="checkbox"
            disabled={disabled}
            checked={row.enabled}
            onChange={(e) => updateRow(index, { ...row, enabled: e.target.checked })}
          />
          <select className="form-control" disabled={disabled || !row.enabled} value={row.dia_da_semana} onChange={(e) => updateRow(index, { ...row, dia_da_semana: e.target.value as InstituicaoAtendimentoLine['dia_da_semana'] })}>
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
  )
}

function SacChannelCard({
  title,
  subtitle,
  channel,
  disabled,
  onChange,
}: {
  title: string
  subtitle: string
  channel: InstituicaoSacChannel
  disabled: boolean
  onChange: (next: InstituicaoSacChannel) => void
}) {
  return (
    <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-200)', boxShadow: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>{title}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>{subtitle}</div>
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, color: 'var(--brs-gray-700)', cursor: disabled ? 'default' : 'pointer' }}>
          <input
            type="checkbox"
            disabled={disabled}
            checked={channel.card_enabled}
            onChange={(e) => onChange({ ...channel, card_enabled: e.target.checked })}
          />
          Exibir no card do site
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '0.75rem' }}>
        <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 4' }}>
          <label className="form-label">Telefone</label>
          {disabled ? (
            <ReadOnlyField label="" value={maskTelefoneComercial(channel.telefone || '')} kind="phone" />
          ) : (
            <input className="form-control" value={maskTelefoneComercial(channel.telefone || '')} onChange={(e) => onChange({ ...channel, telefone: onlyDigits(e.target.value) })} placeholder="(00) 0000-0000 ou 0800 000 0000" />
          )}
        </div>
        <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 4' }}>
          <label className="form-label">WhatsApp</label>
          {disabled ? (
            <ReadOnlyField label="" value={maskPhone(channel.whatsapp || '')} kind="phone" />
          ) : (
            <input className="form-control" value={maskPhone(channel.whatsapp || '')} onChange={(e) => onChange({ ...channel, whatsapp: onlyDigits(e.target.value) })} placeholder="(00) 90000-0000" />
          )}
        </div>
        <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 4' }}>
          <label className="form-label">Telegram</label>
          <input className="form-control" disabled={disabled} value={channel.telegram || ''} onChange={(e) => onChange({ ...channel, telegram: e.target.value })} placeholder="@usuario ou link" />
        </div>
        <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 6' }}>
          <label className="form-label">E-mail</label>
          {disabled ? (
            <ReadOnlyField label="" value={maskEmailInput(channel.email || '')} kind="email" />
          ) : (
            <input className="form-control" type="email" value={maskEmailInput(channel.email || '')} onChange={(e) => onChange({ ...channel, email: maskEmailInput(e.target.value) })} placeholder="email@dominio.com" />
          )}
        </div>
        <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 6' }}>
          <label className="form-label">URL</label>
          {disabled ? (
            <ReadOnlyField label="" value={channel.url || ''} kind="url" />
          ) : (
            <input className="form-control" type="url" value={channel.url || ''} onChange={(e) => onChange({ ...channel, url: normalizeUrlValue(e.target.value) })} placeholder="https://..." />
          )}
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <AtendimentoLines
            rows={channel.atendimento}
            disabled={disabled}
            onChange={(next) => onChange({ ...channel, atendimento: next })}
          />
        </div>
      </div>
    </div>
  )
}

function BancoVinculadoField({
  bankCode,
  bankName,
  banks,
  disabled,
  onChange,
}: {
  bankCode: string
  bankName: string
  banks: BankLookup[]
  disabled: boolean
  onChange: (next: { code: string; name: string }) => void
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!open || query.length < 3) return []
    return banks
      .filter((bank) => {
        const label = formatBankLabel(bank).toLowerCase()
        return label.includes(query) || String(bank.code || '').toLowerCase().includes(query) || String(bank.fullName || '').toLowerCase().includes(query)
      })
      .slice(0, 12)
  }, [banks, open, search])

  const currentLabel = bankName ? `${bankCode ? `${bankCode} - ` : ''}${bankName}` : ''

  return (
    <div className="form-group" style={{ marginBottom: 0, position: 'relative' }}>
      <label className="form-label">Banco Vinculado (opcional)</label>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          className="form-control"
          disabled={disabled}
          value={search || currentLabel}
          onChange={(e) => {
            setSearch(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          placeholder="Digite ao menos 3 caracteres"
        />
        {!disabled && (bankName || search) ? (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            title="Limpar banco vinculado"
            onClick={() => {
              setSearch('')
              onChange({ code: '', name: '' })
            }}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
      {filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4, background: '#fff', border: '1px solid var(--brs-gray-200)', borderRadius: 10, boxShadow: '0 10px 30px rgba(15,23,42,0.08)', maxHeight: 260, overflowY: 'auto' }}>
          {filtered.map((bank) => (
            <button
              key={`${bank.code}-${bank.name}`}
              type="button"
              className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'flex-start', borderRadius: 0, padding: '0.75rem 0.9rem' }}
              onMouseDown={(event) => {
                event.preventDefault()
                onChange({
                  code: String(bank.code || '').replace(/\D/g, '').slice(0, 3).padStart(3, '0'),
                  name: String(bank.name || '').trim(),
                })
                setSearch('')
                setOpen(false)
              }}
            >
              {formatBankLabel(bank)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function InstituicaoEditor({ instituicaoId, readOnly = false, isNew = false }: { instituicaoId?: string; readOnly?: boolean; isNew?: boolean }) {
  const router = useRouter()
  const [item, setItem] = useState<InstituicaoFinanceiraRecord | null>(null)
  const [lookups, setLookups] = useState<InstituicaoLookupPayload | null>(null)
  const [banks, setBanks] = useState<BankLookup[]>([])
  const [activeTab, setActiveTab] = useState<TabKey>('dados')
  const [activeContactTab, setActiveContactTab] = useState<ContactTab>('comercial')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyStatus, setBusyStatus] = useState(false)
  const [consultandoCnpj, setConsultandoCnpj] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  async function loadData() {
    setLoading(true)
    try {
      const [lookupsRes, bankRes, itemRes] = await Promise.all([
        getInstituicaoLookups(),
        fetch('/api/lookups/banks').then((r) => r.json()).catch(() => null),
        !isNew && instituicaoId ? getInstituicaoFinanceira(instituicaoId) : Promise.resolve({ success: true, item: null }),
      ])

      if (lookupsRes.success) setLookups(lookupsRes.lookups || null)
      else setMessage({ type: 'error', text: lookupsRes.error || 'Erro ao carregar listas.' })

      setBanks(Array.isArray(bankRes?.banks) ? bankRes.banks : [])

      if (itemRes.success) {
        if (itemRes.item) {
          // Mescla com o registro vazio para garantir todos os campos (registros antigos só tinham nome + logo)
          const empty = createEmptyInstituicaoFinanceira()
          const raw = itemRes.item as any
          setItem({
            ...empty,
            ...raw,
            institution_type: (raw.institution_type || '') as InstituicaoTipo,
            general_data: { ...empty.general_data, ...(raw.general_data || {}) },
            social_media: { ...empty.social_media, ...(raw.social_media || {}) },
            sac_ouvidoria: {
              sac: { ...empty.sac_ouvidoria.sac, ...(raw.sac_ouvidoria?.sac || {}), atendimento: Array.isArray(raw.sac_ouvidoria?.sac?.atendimento) && raw.sac_ouvidoria.sac.atendimento.length > 0 ? raw.sac_ouvidoria.sac.atendimento : empty.sac_ouvidoria.sac.atendimento },
              ouvidoria: { ...empty.sac_ouvidoria.ouvidoria, ...(raw.sac_ouvidoria?.ouvidoria || {}), atendimento: Array.isArray(raw.sac_ouvidoria?.ouvidoria?.atendimento) && raw.sac_ouvidoria.ouvidoria.atendimento.length > 0 ? raw.sac_ouvidoria.ouvidoria.atendimento : empty.sac_ouvidoria.ouvidoria.atendimento },
            },
            fiscal_data: raw.fiscal_data && Array.isArray(raw.fiscal_data.configurations) ? raw.fiscal_data : { configurations: [] },
            financial_data: {
              empresa_contratada_id: String(raw.financial_data?.empresa_contratada_id || ''),
              configurations: Array.isArray(raw.financial_data?.configurations) ? raw.financial_data.configurations : [],
            },
            contacts_commercial: Array.isArray(raw.contacts_commercial) ? raw.contacts_commercial : [],
            contacts_operational: Array.isArray(raw.contacts_operational) ? raw.contacts_operational : [],
            systems: Array.isArray(raw.systems) ? raw.systems : [],
            links_data: normalizeLinksData(raw.links_data),
            api_conexao: normalizeApiConexao(raw.api_conexao),
          })
        }
      } else {
        setMessage({ type: 'error', text: 'Erro ao carregar instituição financeira.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar instituição financeira.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isNew) {
      setItem(createEmptyInstituicaoFinanceira())
    }
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instituicaoId, isNew])

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

  const fiscalLookups = useMemo(() => (lookups ? { ...lookups, financialInstitutions: [] } : null), [lookups])

  async function fillByCnpj() {
    if (!item) return
    const cnpj = onlyDigits(item.cnpj || '')
    if (cnpj.length !== 14) {
      setMessage({ type: 'error', text: 'Informe um CNPJ válido para consulta.' })
      return
    }

    setConsultandoCnpj(true)
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
          if (res.ok && payload?.razao_social) {
            data = payload
            break
          }
          lastError = payload?.error || payload?.message || 'CNPJ não encontrado.'
        } catch (error: any) {
          lastError = error?.message || lastError
        }
      }

      if (!data) throw new Error(lastError)

      const rica = normalizeCnpjWsCompleto(data)
      setItem((prev) =>
        prev
          ? {
              ...prev,
              cnpj,
              razao_social: rica.razao_social || prev.razao_social,
              name: prev.name || rica.nome_fantasia || rica.razao_social,
              general_data: {
                ...prev.general_data,
                data_abertura: rica.data_abertura,
                natureza_juridica: rica.natureza_juridica,
                natureza_juridica_codigo: rica.natureza_juridica_codigo,
                porte: rica.porte,
                capital_social: rica.capital_social,
                situacao_cadastral: rica.situacao_cadastral,
                situacao_cadastral_data: rica.situacao_cadastral_data,
                situacao_cadastral_motivo: rica.situacao_cadastral_motivo,
                tipo_estabelecimento: rica.tipo_estabelecimento,
                cnae_principal_codigo: rica.cnae_principal_codigo,
                cnae_principal_descricao: rica.cnae_principal_descricao,
                cnaes_secundarios: rica.cnaes_secundarios,
                simples_optante: rica.simples_optante,
                simples_data_opcao: rica.simples_data_opcao,
                simples_data_exclusao: rica.simples_data_exclusao,
                is_mei: rica.is_mei,
                mei_data_opcao: rica.mei_data_opcao,
                mei_data_exclusao: rica.mei_data_exclusao,
                inscricoes_estaduais: rica.inscricoes_estaduais,
                email_rfb: rica.email_rfb,
                telefone_rfb_1: rica.telefone_rfb_1,
                telefone_rfb_2: rica.telefone_rfb_2,
                socios: rica.socios,
                receita_consultado_em: rica.consultado_em,
                cep: rica.cep || prev.general_data.cep,
                logradouro: rica.logradouro || prev.general_data.logradouro,
                numero: rica.numero || prev.general_data.numero,
                complemento: rica.complemento || prev.general_data.complemento,
                bairro: rica.bairro || prev.general_data.bairro,
                cidade: rica.cidade || prev.general_data.cidade,
                uf: rica.uf || prev.general_data.uf,
                email_principal: prev.general_data.email_principal || rica.email_rfb,
              },
            }
          : prev,
      )
      setMessage({ type: 'success', text: 'Dados completos preenchidos via CNPJ.ws.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao consultar CNPJ.' })
    } finally {
      setConsultandoCnpj(false)
    }
  }

  async function fillByCep() {
    if (!item) return
    const cep = onlyDigits(item.general_data?.cep || '')
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
              general_data: {
                ...prev.general_data,
                cep,
                logradouro: data?.logradouro || prev.general_data.logradouro,
                bairro: data?.bairro || prev.general_data.bairro,
                cidade: data?.localidade || prev.general_data.cidade,
                uf: data?.uf || prev.general_data.uf,
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
      const res = await saveInstituicaoFinanceira(item)
      if (res.success) {
        setMessage({ type: 'success', text: item.id ? 'Instituição financeira atualizada com sucesso.' : 'Instituição financeira criada com sucesso.' })
        if (!item.id && res.id) {
          router.replace(`/instituicoes-financeiras/${res.id}`)
        } else {
          await loadData()
        }
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar instituição financeira.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao salvar instituição financeira.' })
    } finally {
      setSaving(false)
    }
  }

  async function toggleStatus() {
    if (!item?.id) return
    setBusyStatus(true)
    try {
      const nextActive = !item.is_active
      const res = await setInstituicaoFinanceiraStatus(item.id, nextActive)
      if (res.success) {
        setMessage({ type: 'success', text: nextActive ? 'Instituição financeira reativada.' : 'Instituição financeira inativada.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao alterar status.' })
      }
    } finally {
      setBusyStatus(false)
    }
  }

  function updateItem(next: InstituicaoFinanceiraRecord | null) {
    setItem(next)
  }

  function updateGeneral(patch: Partial<InstituicaoFinanceiraRecord['general_data']>) {
    updateItem(item ? { ...item, general_data: { ...item.general_data, ...patch } } : item)
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
  const general = item.general_data
  const situacaoAtiva = String(general.situacao_cadastral || '').toLowerCase() === 'ativa'
  const temDadosReceita = Boolean(general.receita_consultado_em || general.situacao_cadastral || general.natureza_juridica)

  return (
    <div className="page-content">
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
                <img src={item.logo_url} alt="Logotipo da instituição" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <Building2 size={16} color="var(--brs-gray-400)" />
              )}
            </div>
            {item.id ? item.name || 'Instituição Financeira' : 'Nova Instituição Financeira'}
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Cadastro completo das instituições financeiras parceiras — base para o site institucional e outros subsistemas.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={() => router.push('/instituicoes-financeiras')}>
            <ChevronLeft size={16} />
            Voltar
          </button>
          {isReadOnly ? (
            <>
              {item.id && (
                <button type="button" className="btn btn-primary" onClick={() => router.push(`/instituicoes-financeiras/${item.id}`)}>
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
          { key: 'dados', label: 'Dados Gerais', icon: Building2 },
          { key: 'contatos', label: 'Contatos', icon: Users },
          { key: 'fiscal', label: 'Fiscal e Tributário', icon: FileText },
          { key: 'financeiro', label: 'Financeiro', icon: Banknote },
          { key: 'sistemas', label: 'Sistemas', icon: Globe },
          { key: 'sac', label: 'Sac & Ouvidoria', icon: Headset },
          { key: 'links', label: 'Links', icon: Link2 },
          { key: 'negociacoes', label: 'Negociações', icon: Handshake },
          { key: 'produtos', label: 'Produtos e Convênios', icon: Package },
          { key: 'api', label: 'Conexão de API', icon: Plug },
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
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div className="card" style={{ padding: '1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '0.75rem', alignItems: 'start' }}>
              <div className="form-group" style={{ gridColumn: 'span 3' }}>
                <label className="form-label">CNPJ</label>
                {isReadOnly ? (
                  <ReadOnlyField label="" value={maskCnpj(item.cnpj || '')} />
                ) : (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input className="form-control" value={maskCnpj(item.cnpj || '')} onChange={(e) => updateItem(item ? { ...item, cnpj: onlyDigits(e.target.value) } : item)} placeholder="00.000.000/0000-00" />
                    <button type="button" className="btn btn-outline" onClick={fillByCnpj} disabled={consultandoCnpj}>
                      {consultandoCnpj ? <Loader2 size={14} className="spinner" /> : null}
                      Buscar
                    </button>
                  </div>
                )}
              </div>

              <div className="form-group" style={{ gridColumn: 'span 5' }}>
                <label className="form-label">Razão Social</label>
                <input className="form-control" value={item.razao_social || ''} disabled={isReadOnly} onChange={(e) => updateItem(item ? { ...item, razao_social: e.target.value } : item)} />
              </div>

              <div className="form-group" style={{ gridColumn: 'span 4' }}>
                <label className="form-label">Nome Comercial</label>
                <input className="form-control" value={item.name || ''} disabled={isReadOnly} onChange={(e) => updateItem(item ? { ...item, name: e.target.value } : item)} placeholder="Marca usada nos cards e no site" />
              </div>

              <div className="form-group" style={{ gridColumn: 'span 3' }}>
                <label className="form-label">Tipo de Instituição</label>
                <select
                  className="form-control"
                  disabled={isReadOnly}
                  value={item.institution_type || ''}
                  onChange={(e) => updateItem(item ? { ...item, institution_type: e.target.value as InstituicaoTipo } : item)}
                >
                  <option value="">Selecione</option>
                  {INSTITUICAO_TIPOS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div style={{ gridColumn: 'span 5' }}>
                <BancoVinculadoField
                  bankCode={item.linked_bank_code || ''}
                  bankName={item.linked_bank_name || ''}
                  banks={banks}
                  disabled={isReadOnly}
                  onChange={(next) => updateItem(item ? { ...item, linked_bank_code: next.code, linked_bank_name: next.name } : item)}
                />
              </div>

              <div className="form-group" style={{ gridColumn: 'span 4' }}>
                <label className="form-label">Empresa Contratada (BRS)</label>
                <select
                  className="form-control"
                  disabled={isReadOnly}
                  value={item.financial_data?.empresa_contratada_id || ''}
                  onChange={(e) => updateItem(item ? { ...item, financial_data: { ...item.financial_data, empresa_contratada_id: e.target.value } } : item)}
                >
                  <option value="">Selecione</option>
                  {lookups?.companies?.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.display_name}{company.is_active ? '' : ' (Inativa)'}
                    </option>
                  ))}
                </select>
                <div style={{ marginTop: '0.3rem', fontSize: '0.78rem', color: 'var(--brs-gray-500)' }}>
                  Necessária para as abas Fiscal e Financeiro.
                </div>
              </div>

              <div style={{ gridColumn: 'span 6', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <WideFilePreview
                  label="Logotipo 500x200px"
                  value={item.logo_wide_url || ''}
                  disabled={isReadOnly}
                  onChange={(next) => updateItem(item ? { ...item, logo_wide_url: next } : item)}
                />
                <EditableFilePreview
                  label="Logotipo 500x500px"
                  value={item.logo_url || ''}
                  disabled={isReadOnly}
                  onChange={(next) => updateItem(item ? { ...item, logo_url: next } : item)}
                />
              </div>

              <div className="form-group" style={{ gridColumn: 'span 3' }}>
                <label className="form-label">CEP</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input className="form-control" value={maskCep(general.cep || '')} disabled={isReadOnly} onChange={(e) => updateGeneral({ cep: onlyDigits(e.target.value) })} placeholder="00000-000" />
                  {!isReadOnly && (
                    <button type="button" className="btn btn-outline" onClick={fillByCep}>
                      Buscar
                    </button>
                  )}
                </div>
              </div>

              <div className="form-group" style={{ gridColumn: 'span 3' }}>
                <label className="form-label">Logradouro</label>
                <input className="form-control" value={general.logradouro || ''} disabled={isReadOnly} onChange={(e) => updateGeneral({ logradouro: e.target.value })} />
              </div>

              <div className="form-group" style={{ gridColumn: 'span 1' }}>
                <label className="form-label">Número</label>
                <input className="form-control" value={general.numero || ''} disabled={isReadOnly} onChange={(e) => updateGeneral({ numero: e.target.value })} />
              </div>

              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="form-label">Complemento</label>
                <input className="form-control" value={general.complemento || ''} disabled={isReadOnly} onChange={(e) => updateGeneral({ complemento: e.target.value })} />
              </div>

              <div className="form-group" style={{ gridColumn: 'span 3' }}>
                <label className="form-label">Bairro</label>
                <input className="form-control" value={general.bairro || ''} disabled={isReadOnly} onChange={(e) => updateGeneral({ bairro: e.target.value })} />
              </div>

              <div className="form-group" style={{ gridColumn: 'span 4' }}>
                <label className="form-label">Cidade</label>
                <input className="form-control" value={general.cidade || ''} disabled={isReadOnly} onChange={(e) => updateGeneral({ cidade: e.target.value })} />
              </div>

              <div className="form-group" style={{ gridColumn: 'span 1' }}>
                <label className="form-label">UF</label>
                <select className="form-control" value={general.uf || ''} disabled={isReadOnly} onChange={(e) => updateGeneral({ uf: e.target.value })}>
                  <option value="">-</option>
                  {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                </select>
              </div>

              <div className="form-group" style={{ gridColumn: 'span 4' }}>
                <label className="form-label">Site Institucional</label>
                {isReadOnly ? (
                  <ReadOnlyField label="" value={general.site_institucional || ''} kind="url" />
                ) : (
                  <input className="form-control" type="url" value={general.site_institucional || ''} onChange={(e) => updateGeneral({ site_institucional: normalizeUrlValue(e.target.value) })} placeholder="https://www.instituicao.com.br" />
                )}
              </div>

              <div className="form-group" style={{ gridColumn: 'span 3' }}>
                <label className="form-label">E-mail Principal</label>
                {isReadOnly ? (
                  <ReadOnlyField label="" value={maskEmailInput(general.email_principal || '')} kind="email" />
                ) : (
                  <input className="form-control" type="email" value={maskEmailInput(general.email_principal || '')} onChange={(e) => updateGeneral({ email_principal: maskEmailInput(e.target.value) })} placeholder="nome@dominio.com" />
                )}
              </div>
            </div>
          </div>

          {temDadosReceita && (
            <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-200)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
                <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>Dados da Receita Federal</div>
                <span
                  className={`badge ${situacaoAtiva ? 'badge-success' : 'badge-gray'}`}
                  title={general.situacao_cadastral_motivo || undefined}
                >
                  {general.situacao_cadastral || 'Situação não consultada'}
                  {general.situacao_cadastral_data ? ` desde ${formatDateDisplay(general.situacao_cadastral_data)}` : ''}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.4rem 1.5rem' }}>
                <InfoRow label="Abertura" value={formatDateDisplay(general.data_abertura)} />
                <InfoRow label="Natureza Jurídica" value={general.natureza_juridica ? `${general.natureza_juridica_codigo ? `${general.natureza_juridica_codigo} - ` : ''}${general.natureza_juridica}` : ''} />
                <InfoRow label="Porte" value={general.porte} />
                <InfoRow label="Capital Social" value={formatCapitalSocialBr(general.capital_social)} />
                <InfoRow label="Estabelecimento" value={general.tipo_estabelecimento} />
                <InfoRow label="CNAE Principal" value={general.cnae_principal_codigo ? `${formatCnaeCode(general.cnae_principal_codigo)} - ${general.cnae_principal_descricao}` : ''} />
                <InfoRow label="Simples Nacional" value={general.simples_optante ? `Optante${general.simples_data_opcao ? ` desde ${formatDateDisplay(general.simples_data_opcao)}` : ''}` : 'Não optante'} />
                <InfoRow label="MEI" value={general.is_mei ? `Sim${general.mei_data_opcao ? ` desde ${formatDateDisplay(general.mei_data_opcao)}` : ''}` : 'Não'} />
                <InfoRow label="E-mail (RFB)" value={general.email_rfb} />
                <InfoRow label="Telefones (RFB)" value={[general.telefone_rfb_1 ? maskPhone(general.telefone_rfb_1) : '', general.telefone_rfb_2 ? maskPhone(general.telefone_rfb_2) : ''].filter(Boolean).join(' / ')} />
                <InfoRow
                  label="Inscrições Estaduais"
                  value={general.inscricoes_estaduais.map((ie) => `${ie.numero} (${ie.uf}${ie.ativo ? '' : ' - inativa'})`).join(', ')}
                />
                <InfoRow label="Consultado em" value={general.receita_consultado_em ? new Date(general.receita_consultado_em).toLocaleString('pt-BR') : ''} />
              </div>

              {general.cnaes_secundarios.length > 0 && (
                <div style={{ marginTop: '0.9rem' }}>
                  <div style={{ fontWeight: 700, color: 'var(--brs-gray-700)', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                    CNAEs Secundários ({general.cnaes_secundarios.length})
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--brs-gray-600)', fontSize: '0.85rem', columns: general.cnaes_secundarios.length > 8 ? 2 : 1 }}>
                    {general.cnaes_secundarios.map((cnae, index) => (
                      <li key={`${cnae.code}-${index}`}>
                        <span style={{ fontFamily: 'monospace' }}>{formatCnaeCode(cnae.code)}</span> — {cnae.desc}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {general.socios.length > 0 && (
                <div style={{ marginTop: '0.9rem' }}>
                  <div style={{ fontWeight: 700, color: 'var(--brs-gray-700)', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                    Quadro Societário / Administradores ({general.socios.length})
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Nome</th>
                          <th>CPF/CNPJ</th>
                          <th>Qualificação</th>
                          <th>Entrada</th>
                          <th>Faixa Etária</th>
                        </tr>
                      </thead>
                      <tbody>
                        {general.socios.map((socio, index) => (
                          <tr key={`${socio.nome}-${index}`}>
                            <td style={{ fontWeight: 600 }}>{socio.nome}</td>
                            <td style={{ fontFamily: 'monospace' }}>{socio.cpf_cnpj || '-'}</td>
                            <td>{socio.qualificacao || '-'}</td>
                            <td>{formatDateDisplay(socio.data_entrada)}</td>
                            <td>{socio.faixa_etaria || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'contatos' && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div className="card" style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" className={`btn ${activeContactTab === 'comercial' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setActiveContactTab('comercial')}>Comercial</button>
                <button type="button" className={`btn ${activeContactTab === 'operacional' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setActiveContactTab('operacional')}>Operacional</button>
                <button type="button" className={`btn ${activeContactTab === 'redes' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setActiveContactTab('redes')}>
                  <Share2 size={14} />
                  Redes Sociais
                </button>
              </div>
              {!isReadOnly && activeContactTab !== 'redes' && (
                <button type="button" className="btn btn-outline" onClick={() => {
                  if (activeContactTab === 'comercial') updateItem(item ? { ...item, contacts_commercial: [...item.contacts_commercial, emptyCommercialContact()] } : item)
                  else updateItem(item ? { ...item, contacts_operational: [...item.contacts_operational, emptyOperationalContact()] } : item)
                }}>
                  <CirclePlus size={16} />
                  Novo Contato
                </button>
              )}
            </div>

            {activeContactTab === 'comercial' && (
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
            )}

            {activeContactTab === 'operacional' && (
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

            {activeContactTab === 'redes' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
                {([
                  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/...' },
                  { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/...' },
                  { key: 'tiktok', label: 'TikTok', placeholder: 'https://tiktok.com/@...' },
                  { key: 'discord', label: 'Discord', placeholder: 'https://discord.gg/...' },
                  { key: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@...' },
                  { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/company/...' },
                  { key: 'github', label: 'GitHub', placeholder: 'https://github.com/...' },
                  { key: 'x', label: 'X', placeholder: 'https://x.com/...' },
                  { key: 'kwai', label: 'Kwai', placeholder: 'https://kwai.com/@...' },
                  { key: 'canal_whatsapp', label: 'Canal WhatsApp', placeholder: 'https://whatsapp.com/channel/...' },
                  { key: 'comunidade_whatsapp', label: 'Comunidade WhatsApp', placeholder: 'https://chat.whatsapp.com/...' },
                  { key: 'pinterest', label: 'Pinterest', placeholder: 'https://pinterest.com/...' },
                  { key: 'telegram', label: 'Telegram', placeholder: 'https://t.me/...' },
                ] as const).map((social) => (
                  <div key={social.key} className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">{social.label}</label>
                    {isReadOnly ? (
                      <ReadOnlyField label="" value={item.social_media[social.key] || ''} kind="url" />
                    ) : (
                      <input
                        className="form-control"
                        type="url"
                        value={item.social_media[social.key] || ''}
                        onChange={(e) => updateItem(item ? { ...item, social_media: { ...item.social_media, [social.key]: normalizeUrlValue(e.target.value) } } : item)}
                        placeholder={social.placeholder}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'fiscal' && (
        <PromotoraFiscalConfigurations
          enableComissaoLiquida
          value={item.fiscal_data || { configurations: [] }}
          companyFiscalData={selectedCompanyFiscalData}
          companyLabel={String(selectedCompany?.nickname || '')}
          companyId={String(selectedCompany?.id || '')}
          lookups={fiscalLookups}
          disabled={isReadOnly}
          onChange={(next) => updateItem(item ? { ...item, fiscal_data: next } : item)}
          onAutoSave={save}
        />
      )}

      {activeTab === 'financeiro' && (
        <InstituicaoFinancialConfigurations
          value={item.financial_data || { empresa_contratada_id: '', configurations: [] }}
          lookups={lookups}
          availableRemunerationTypes={availableFinancialRemunerationTypes}
          companyBankAccounts={companyBankAccounts}
          disabled={isReadOnly}
          onChange={(next) => updateItem(item ? { ...item, financial_data: next } : item)}
        />
      )}

      {activeTab === 'api' && item && (
        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)', marginBottom: '0.25rem' }}>Conexão de API</div>
          <p style={{ fontSize: '0.85rem', color: 'var(--brs-gray-600)', marginBottom: '1rem' }}>
            O que a instituição disponibiliza por API. Marque &quot;API Disponível&quot; para liberar os demais itens. Quando
            &quot;Simulação&quot; ou &quot;Digitação&quot; estão marcadas, a instituição aparece pros parceiros no CRM AlvoConsig
            (API Instituições Financeiras).
          </p>
          <div style={{ display: 'grid', gap: '0.6rem' }}>
            {API_CONEXAO_CAMPOS.map(({ chave, rotulo }) => {
              const principal = chave === 'disponivel'
              const desabilitado = isReadOnly || (!principal && !item.api_conexao.disponivel)
              return (
                <label key={chave} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', opacity: desabilitado && !principal ? 0.55 : 1, fontWeight: principal ? 700 : 500 }}>
                  <input
                    type="checkbox"
                    checked={item.api_conexao[chave]}
                    disabled={desabilitado}
                    onChange={(e) => {
                      const marcado = e.target.checked
                      const proximo = { ...item.api_conexao, [chave]: marcado }
                      updateItem({ ...item, api_conexao: principal && !marcado ? normalizeApiConexao({ disponivel: false }) : proximo })
                    }}
                  />
                  {rotulo}
                </label>
              )
            })}
          </div>
        </div>
      )}

      {activeTab === 'sistemas' && (
        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <div>
              <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>Sistemas da Instituição</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>
                Marque cada sistema como <strong>Interno</strong> (uso do suporte da BRS — o parceiro não vê) ou{' '}
                <strong>Externo</strong> (aparece pro parceiro no Portal, em &quot;Acessos das Instituições&quot;).
              </div>
            </div>
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
                  <th>Visibilidade</th>
                  <th>Descrição</th>
                  <th>Observações</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {item.systems.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>Nenhuma linha cadastrada.</td></tr>
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
                    <td>
                      <select
                        className="form-control"
                        disabled={isReadOnly}
                        value={row.visibilidade === 'externo' ? 'externo' : 'interno'}
                        onChange={(e) => updateSystem(index, { ...row, visibilidade: e.target.value === 'externo' ? 'externo' : 'interno' })}
                        title="Interno: só o suporte da BRS vê. Externo: aparece pro parceiro no Portal (Acessos das Instituições)."
                      >
                        <option value="interno">Interno</option>
                        <option value="externo">Externo</option>
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

      {activeTab === 'sac' && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <SacChannelCard
            title="SAC"
            subtitle="Canais de atendimento ao cliente da instituição."
            channel={item.sac_ouvidoria.sac}
            disabled={isReadOnly}
            onChange={(next) => updateItem(item ? { ...item, sac_ouvidoria: { ...item.sac_ouvidoria, sac: next } } : item)}
          />
          <SacChannelCard
            title="Ouvidoria"
            subtitle="Canais de ouvidoria da instituição."
            channel={item.sac_ouvidoria.ouvidoria}
            disabled={isReadOnly}
            onChange={(next) => updateItem(item ? { ...item, sac_ouvidoria: { ...item.sac_ouvidoria, ouvidoria: next } } : item)}
          />
        </div>
      )}

      {activeTab === 'links' && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div className="card" style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <div>
                <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>Marketing</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>Links de materiais de marketing da instituição (drives, portais, campanhas).</div>
              </div>
              {!isReadOnly && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => updateItem(item ? { ...item, links_data: { ...item.links_data, marketing_links: [...item.links_data.marketing_links, createEmptyMarketingLink()] } } : item)}
                >
                  <CirclePlus size={16} />
                  Novo Link
                </button>
              )}
            </div>
            {item.links_data.marketing_links.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--brs-gray-500)' }}>Nenhum link cadastrado.</div>
            ) : (
              <div style={{ display: 'grid', gap: '0.65rem' }}>
                {item.links_data.marketing_links.map((link, index) => (
                  <div key={link.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr) auto', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      className="form-control"
                      disabled={isReadOnly}
                      value={link.descricao}
                      placeholder="Descrição (ex.: Kit de banners)"
                      onChange={(e) => updateItem(item ? { ...item, links_data: { ...item.links_data, marketing_links: item.links_data.marketing_links.map((row, i) => (i === index ? { ...row, descricao: e.target.value } : row)) } } : item)}
                    />
                    {isReadOnly ? (
                      <ReadOnlyField label="" value={link.url} kind="url" />
                    ) : (
                      <input
                        className="form-control"
                        type="url"
                        value={link.url}
                        placeholder="https://..."
                        onChange={(e) => updateItem(item ? { ...item, links_data: { ...item.links_data, marketing_links: item.links_data.marketing_links.map((row, i) => (i === index ? { ...row, url: normalizeUrlValue(e.target.value) } : row)) } } : item)}
                      />
                    )}
                    <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                      <button type="button" className="btn btn-outline btn-sm" disabled={!link.url} onClick={() => copyText(link.url)} title="Copiar URL">
                        <Copy size={14} />
                      </button>
                      {!isReadOnly && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => updateItem(item ? { ...item, links_data: { ...item.links_data, marketing_links: item.links_data.marketing_links.filter((_, i) => i !== index) } } : item)}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <div>
                <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>Tabela de Tarifas</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>Link direto da instituição (quando existir) e/ou arquivos enviados, identificados pela descrição.</div>
              </div>
              {!isReadOnly && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => updateItem(item ? { ...item, links_data: { ...item.links_data, tabela_tarifas_arquivos: [...item.links_data.tabela_tarifas_arquivos, createEmptyTarifaArquivo()] } } : item)}
                >
                  <CirclePlus size={16} />
                  Novo Arquivo
                </button>
              )}
            </div>

            <div className="form-group" style={{ marginBottom: '1rem', maxWidth: 640 }}>
              <label className="form-label">Link Direto (URL)</label>
              {isReadOnly ? (
                <ReadOnlyField label="" value={item.links_data.tabela_tarifas_url || ''} kind="url" />
              ) : (
                <input
                  className="form-control"
                  type="url"
                  value={item.links_data.tabela_tarifas_url || ''}
                  onChange={(e) => updateItem(item ? { ...item, links_data: { ...item.links_data, tabela_tarifas_url: normalizeUrlValue(e.target.value) } } : item)}
                  placeholder="https://www.instituicao.com.br/tarifas"
                />
              )}
            </div>

            {item.links_data.tabela_tarifas_arquivos.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1.25rem', color: 'var(--brs-gray-500)', border: '1px dashed var(--brs-gray-300)', borderRadius: 12 }}>
                Nenhum arquivo de tabela de tarifas enviado.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '0.65rem' }}>
                {item.links_data.tabela_tarifas_arquivos.map((arquivo, index) => (
                  <div key={arquivo.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr) auto', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      className="form-control"
                      disabled={isReadOnly}
                      value={arquivo.descricao}
                      placeholder="Descrição (ex.: Tarifas Consignado INSS 2026)"
                      onChange={(e) => updateItem(item ? { ...item, links_data: { ...item.links_data, tabela_tarifas_arquivos: item.links_data.tabela_tarifas_arquivos.map((row, i) => (i === index ? { ...row, descricao: e.target.value } : row)) } } : item)}
                    />
                    {arquivo.file_data_url ? (
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', minWidth: 0 }}>
                        <a
                          href={arquivo.file_data_url}
                          download={arquivo.file_name || 'tabela-de-tarifas'}
                          className="btn btn-outline btn-sm"
                          style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}
                          title={`Baixar ${arquivo.file_name || 'arquivo'}`}
                        >
                          {arquivo.file_name || 'arquivo enviado'}
                        </a>
                        {!isReadOnly && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            title="Substituir arquivo"
                            onClick={() => updateItem(item ? { ...item, links_data: { ...item.links_data, tabela_tarifas_arquivos: item.links_data.tabela_tarifas_arquivos.map((row, i) => (i === index ? { ...row, file_name: '', file_data_url: '' } : row)) } } : item)}
                          >
                            <Upload size={14} />
                          </button>
                        )}
                      </div>
                    ) : (
                      <input
                        className="form-control"
                        type="file"
                        disabled={isReadOnly}
                        accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null
                          if (!file) return
                          const reader = new FileReader()
                          reader.onload = () => {
                            const dataUrl = String(reader.result || '')
                            updateItem(item ? { ...item, links_data: { ...item.links_data, tabela_tarifas_arquivos: item.links_data.tabela_tarifas_arquivos.map((row, i) => (i === index ? { ...row, file_name: file.name, file_data_url: dataUrl } : row)) } } : item)
                          }
                          reader.readAsDataURL(file)
                        }}
                      />
                    )}
                    {!isReadOnly && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => updateItem(item ? { ...item, links_data: { ...item.links_data, tabela_tarifas_arquivos: item.links_data.tabela_tarifas_arquivos.filter((_, i) => i !== index) } } : item)}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'negociacoes' && (
        <div className="card" style={{ padding: '2.5rem', border: '1px dashed var(--brs-gray-300)', textAlign: 'center', color: 'var(--brs-gray-500)' }}>
          <Handshake size={40} style={{ marginBottom: '0.75rem', color: 'var(--brs-gray-300)' }} />
          <div style={{ fontWeight: 800, color: 'var(--brs-gray-800)', fontSize: '1.05rem' }}>Negociações</div>
          <div style={{ marginTop: '0.4rem' }}>Em breve — aqui você vai registrar os acordos e as negociações firmadas com esta instituição.</div>
        </div>
      )}

      {activeTab === 'produtos' && (
        <div className="card" style={{ padding: '2.5rem', border: '1px dashed var(--brs-gray-300)', textAlign: 'center', color: 'var(--brs-gray-500)' }}>
          <Package size={40} style={{ marginBottom: '0.75rem', color: 'var(--brs-gray-300)' }} />
          <div style={{ fontWeight: 800, color: 'var(--brs-gray-800)', fontSize: '1.05rem' }}>Produtos e Convênios</div>
          <div style={{ marginTop: '0.4rem' }}>Em breve — aqui você vai cadastrar as modalidades de crédito e os convênios operados com esta instituição.</div>
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
