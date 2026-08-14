'use client'

import { useEffect, useMemo, useState } from 'react'
import { Building2, ChevronDown, ChevronRight, Info, Plus, Trash2 } from 'lucide-react'
import { formatBankLabel, type CompanyBankAccount } from '@/lib/company-bank-accounts'
import type { PromotoraFinancialPaymentMode } from '@/lib/promotoras'
import {
  DirectFrequencyCard,
  IndirectConfigurationCard,
  IndirectRequestLines,
  InstitutionLogo,
  SummaryBadge,
  createEmptyDirectData,
  createEmptyIndirectData,
} from '@/app/(dashboard)/promotoras/_components/PromotoraFinancialConfigurations'
import {
  INSTITUICAO_VINCULO_TIPOS,
  createEmptyInstituicaoFinancialConfiguration,
  vinculoHabilitaCamposFinanceiros,
  vinculoHabilitaPromotora,
  vinculoTipoLabel,
  type InstituicaoFinancialConfiguration,
  type InstituicaoFinancialData,
  type InstituicaoVinculoTipo,
} from '@/lib/financial-institutions'
import type { InstituicaoLookupPayload } from '../actions'

type RemunerationTypeLookup = {
  id: string
  name: string
  is_active: boolean
}

type Props = {
  value: InstituicaoFinancialData
  lookups: InstituicaoLookupPayload | null
  availableRemunerationTypes: RemunerationTypeLookup[]
  companyBankAccounts: CompanyBankAccount[]
  disabled?: boolean
  onChange: (next: InstituicaoFinancialData) => void
}

const PAYMENT_MODES: Array<{ value: PromotoraFinancialPaymentMode; label: string }> = [
  { value: 'direto', label: 'Pagamento Direto' },
  { value: 'indireto', label: 'Pagamento Indireto (Saque Conta Corrente)' },
]

const VINCULO_HINTS: Record<Exclude<InstituicaoVinculoTipo, ''>, string> = {
  direto: 'A BRS recebe direto da instituição financeira, sem promotora intermediária.',
  sub_grade: 'Subestabelecido com grade própria — habilita a promotora e o cadastro financeiro (recebimento direto da instituição).',
  sub_indicado: 'Subestabelecido indicado — habilita a promotora e o cadastro financeiro (recebimento direto da instituição).',
  sub_zero: 'Subestabelecido zero — o recebimento vem da promotora; os campos financeiros são preenchidos no cadastro da Promotora.',
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function digitsOnly(value: string, max = 3) {
  return String(value || '').replace(/\D/g, '').slice(0, max)
}

function PromotoraAutocomplete({
  value,
  promotoras,
  disabled,
  onChange,
}: {
  value: { id: string; name: string; logo_url: string }
  promotoras: InstituicaoLookupPayload['promotoras']
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
    return promotoras.filter((item) => `${item.name} ${item.id}`.toLowerCase().includes(text)).slice(0, 8)
  }, [promotoras, query])

  const showSuggestions = !disabled && isOpen && query.trim().length >= 3 && filtered.length > 0

  return (
    <div className="form-group" style={{ marginBottom: 0, position: 'relative' }}>
      <label className="form-label">Promotora</label>
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

function FinancialConfigurationCard({
  config,
  index,
  disabled,
  remunerationTypes,
  promotoras,
  companyBankAccounts,
  receiptMethods,
  onChange,
  onRemove,
}: {
  config: InstituicaoFinancialConfiguration
  index: number
  disabled: boolean
  remunerationTypes: RemunerationTypeLookup[]
  promotoras: InstituicaoLookupPayload['promotoras']
  companyBankAccounts: CompanyBankAccount[]
  receiptMethods: InstituicaoLookupPayload['receiptMethods']
  onChange: (next: InstituicaoFinancialConfiguration) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(true)

  const vinculo = config.vinculo_tipo
  const mostraPromotora = vinculoHabilitaPromotora(vinculo)
  const mostraCamposFinanceiros = vinculo !== '' && vinculoHabilitaCamposFinanceiros(vinculo)

  const selectedPromotora = useMemo(
    () => promotoras.find((row) => row.id === config.promotora_id) || null,
    [config.promotora_id, promotoras],
  )

  function update(mutator: (draft: InstituicaoFinancialConfiguration) => void) {
    const next = cloneValue(config)
    mutator(next)
    onChange(next)
  }

  return (
    <div className="card" style={{ padding: '0.95rem', border: '1px solid var(--brs-gray-200)', boxShadow: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: '0.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 900, color: 'var(--brs-gray-900)' }}>Configuração {index + 1}</div>
            {vinculo ? <SummaryBadge>{vinculoTipoLabel(vinculo)}</SummaryBadge> : null}
            {config.remuneration_type_name ? <SummaryBadge>{config.remuneration_type_name}</SummaryBadge> : null}
            {config.promotora_name ? <SummaryBadge>{config.promotora_name}</SummaryBadge> : null}
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.84rem' }}>
            Combine tipo de remuneração, tipo de vínculo e regras de pagamento nesta mesma linha.
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
          <div style={{ display: 'grid', gridTemplateColumns: mostraPromotora ? 'minmax(0, 1.2fr) minmax(280px, 0.9fr)' : 'minmax(0, 1fr)', gap: '1rem' }}>
            <div style={{ display: 'grid', gap: '0.9rem' }}>
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

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Tipo de Vínculo</label>
                <select
                  className="form-control"
                  disabled={disabled}
                  value={config.vinculo_tipo}
                  onChange={(e) => {
                    const next = e.target.value as InstituicaoVinculoTipo
                    update((draft) => {
                      draft.vinculo_tipo = next
                      if (!vinculoHabilitaPromotora(next)) {
                        draft.promotora_id = ''
                        draft.promotora_name = ''
                        draft.promotora_logo_url = ''
                      }
                    })
                  }}
                >
                  <option value="">Selecione</option>
                  {INSTITUICAO_VINCULO_TIPOS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {vinculo ? (
                  <div style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: 'var(--brs-gray-500)', display: 'flex', gap: '0.35rem', alignItems: 'flex-start' }}>
                    <Info size={13} style={{ marginTop: 2, flex: '0 0 auto' }} />
                    <span>{VINCULO_HINTS[vinculo as Exclude<InstituicaoVinculoTipo, ''>]}</span>
                  </div>
                ) : null}
              </div>

              {mostraPromotora && (
                <PromotoraAutocomplete
                  value={{
                    id: config.promotora_id,
                    name: config.promotora_name,
                    logo_url: config.promotora_logo_url,
                  }}
                  promotoras={promotoras}
                  disabled={disabled}
                  onChange={(next) => update((draft) => {
                    draft.promotora_id = next.id
                    draft.promotora_name = next.name
                    draft.promotora_logo_url = next.logo_url
                  })}
                />
              )}

              {mostraCamposFinanceiros && (
                <>
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
                        Selecione a empresa contratada na aba Dados Gerais para liberar as contas bancárias.
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
                </>
              )}

              {vinculo === 'sub_zero' && (
                <div
                  style={{
                    padding: '0.8rem 0.9rem',
                    borderRadius: 12,
                    border: '1px solid #BFDBFE',
                    background: '#EFF6FF',
                    color: '#1D4ED8',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    display: 'flex',
                    gap: '0.5rem',
                    alignItems: 'flex-start',
                  }}
                >
                  <Info size={16} style={{ flex: '0 0 auto', marginTop: 1 }} />
                  <span>
                    No vínculo Subestabelecido Zero o recebimento vem da promotora. Os campos financeiros
                    (contas, prazos e frequência de pagamento) são preenchidos na aba Financeiro do cadastro da Promotora selecionada.
                  </span>
                </div>
              )}
            </div>

            {mostraPromotora ? (
              <InstitutionLogo
                institution={selectedPromotora ? { name: selectedPromotora.name, logo_url: selectedPromotora.logo_url } : (config.promotora_name ? { name: config.promotora_name, logo_url: config.promotora_logo_url } : null)}
                placeholderLabel="LOGOTIPO DA PROMOTORA"
              />
            ) : null}
          </div>

          {mostraCamposFinanceiros && (
            <div className="card" style={{ padding: '0.95rem', border: '1px solid var(--brs-gray-200)' }}>
              <div style={{ fontWeight: 900, color: 'var(--brs-gray-900)', marginBottom: '0.8rem' }}>Frequência de Pagamento</div>
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
                {PAYMENT_MODES.map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    disabled={disabled}
                    onClick={() => update((draft) => { draft.payment_mode = mode.value })}
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
          )}

          {mostraCamposFinanceiros && config.payment_mode === 'indireto' && (
            <IndirectRequestLines
              rows={config.indirect.dias_horarios_solicitacao_saque}
              disabled={disabled}
              onChange={(rows) => update((draft) => { draft.indirect.dias_horarios_solicitacao_saque = rows.slice(0, 6) })}
            />
          )}
        </div>
      )}
    </div>
  )
}

export default function InstituicaoFinancialConfigurations({
  value,
  lookups,
  availableRemunerationTypes,
  companyBankAccounts,
  disabled = false,
  onChange,
}: Props) {
  const configs = Array.isArray(value.configurations) ? value.configurations : []
  const receiptMethods = lookups?.receiptMethods || []
  const promotoras = lookups?.promotoras || []

  function updateFinancialData(mutator: (draft: InstituicaoFinancialData) => void) {
    const next = cloneValue(value)
    mutator(next)
    onChange(next)
  }

  function addConfiguration() {
    updateFinancialData((draft) => {
      draft.configurations = [...(draft.configurations || []), {
        ...createEmptyInstituicaoFinancialConfiguration(),
        direct: createEmptyDirectData(),
        indirect: createEmptyIndirectData(),
      }]
    })
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-200)', boxShadow: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 900, color: 'var(--brs-gray-900)' }}>Configuração Financeira</div>
            <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.84rem' }}>
              O Tipo de Vínculo define se a configuração usa promotora e onde os campos financeiros são preenchidos.
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
          <div style={{ marginTop: '0.35rem' }}>Crie pelo menos uma combinação de remuneração e tipo de vínculo.</div>
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
            promotoras={promotoras}
            companyBankAccounts={companyBankAccounts}
            receiptMethods={receiptMethods}
            onChange={(next) => updateFinancialData((draft) => { draft.configurations[index] = next })}
            onRemove={() => updateFinancialData((draft) => { draft.configurations = draft.configurations.filter((_, i) => i !== index) })}
          />
        ))}
      </div>
    </div>
  )
}
