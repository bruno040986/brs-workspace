'use client'

import { useState } from 'react'
import { Building2, ChevronDown, ChevronRight, Info, Plus, Trash2 } from 'lucide-react'
import { formatBankLabel, type CompanyBankAccount } from '@/lib/company-bank-accounts'
import type { PromotoraFinancialPaymentMode, PromotoraFiscalConfiguration } from '@/lib/promotoras'
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
  fiscalConfigOptionLabel,
  pagadorLabel,
  type InstituicaoFinancialConfiguration,
  type InstituicaoFinancialData,
} from '@/lib/financial-institutions'
import type { InstituicaoLookupPayload } from '../actions'

type Props = {
  value: InstituicaoFinancialData
  lookups: InstituicaoLookupPayload | null
  fiscalConfigs: PromotoraFiscalConfiguration[]
  companyBankAccounts: CompanyBankAccount[]
  disabled?: boolean
  onChange: (next: InstituicaoFinancialData) => void
}

const PAYMENT_MODES: Array<{ value: PromotoraFinancialPaymentMode; label: string }> = [
  { value: 'direto', label: 'Pagamento Direto' },
  { value: 'indireto', label: 'Pagamento Indireto (Saque Conta Corrente)' },
]

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function digitsOnly(value: string, max = 3) {
  return String(value || '').replace(/\D/g, '').slice(0, max)
}

function FinancialConfigurationCard({
  config,
  index,
  disabled,
  fiscalConfigs,
  companyBankAccounts,
  receiptMethods,
  onChange,
  onRemove,
}: {
  config: InstituicaoFinancialConfiguration
  index: number
  disabled: boolean
  fiscalConfigs: PromotoraFiscalConfiguration[]
  companyBankAccounts: CompanyBankAccount[]
  receiptMethods: InstituicaoLookupPayload['receiptMethods']
  onChange: (next: InstituicaoFinancialConfiguration) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(true)

  const fiscal = fiscalConfigs.find((row) => row.id === config.fiscal_config_id) || null
  const vinculo = fiscal?.vinculo_tipo || ''
  const pagador = fiscal?.pagador
  const pagoPelaPromotora = pagador === 'promotora'
  const mostraPromotora = vinculo !== '' && vinculo !== 'direto'

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
            {vinculo ? <SummaryBadge>{INSTITUICAO_VINCULO_TIPOS.find((opt) => opt.value === vinculo)?.label || ''}</SummaryBadge> : null}
            {fiscal?.remuneration_type_name ? <SummaryBadge>{fiscal.remuneration_type_name}</SummaryBadge> : null}
            {fiscal?.promotora_name ? <SummaryBadge>{fiscal.promotora_name}</SummaryBadge> : null}
            {pagador ? <SummaryBadge>{`Paga: ${pagadorLabel(pagador)}`}</SummaryBadge> : null}
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.84rem' }}>
            Vínculo, promotora e quem paga vêm da configuração tributária escolhida.
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
                <label className="form-label">Configuração Tributária</label>
                <select
                  className="form-control"
                  disabled={disabled}
                  value={config.fiscal_config_id}
                  onChange={(e) => {
                    const selected = fiscalConfigs.find((row) => row.id === e.target.value) || null
                    update((draft) => {
                      draft.fiscal_config_id = e.target.value
                      draft.remuneration_type_id = selected?.remuneration_type_id || ''
                      draft.remuneration_type_name = selected?.remuneration_type_name || ''
                    })
                  }}
                >
                  <option value="">Selecione</option>
                  {fiscalConfigs.map((row) => (
                    <option key={row.id} value={row.id}>
                      {fiscalConfigOptionLabel(row)}
                    </option>
                  ))}
                </select>
                {fiscalConfigs.length === 0 ? (
                  <div style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>
                    Cadastre uma configuração tributária na aba Fiscal e Tributário primeiro.
                  </div>
                ) : null}
              </div>

              {pagoPelaPromotora && (
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
                    Esta remuneração é paga pela promotora {fiscal?.promotora_name || ''}. Conta bancária e forma de
                    recebimento ficam no cadastro dela; aqui só o prazo de repasse e a frequência de pagamento.
                  </span>
                </div>
              )}

              {fiscal && (
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
              )}

              {fiscal && !pagoPelaPromotora && (
                <>
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
            </div>

            {mostraPromotora ? (
              <InstitutionLogo
                institution={fiscal?.promotora_name ? { name: fiscal.promotora_name, logo_url: fiscal.promotora_logo_url || '' } : null}
                placeholderLabel="LOGOTIPO DA PROMOTORA"
              />
            ) : null}
          </div>

          {fiscal && (
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
                <DirectFrequencyCard config={config} disabled={disabled} onChange={onChange} hideValorMinimoTarifa={pagoPelaPromotora} />
              ) : (
                <IndirectConfigurationCard config={config} disabled={disabled} onChange={onChange} hideValorMinimoTarifa={pagoPelaPromotora} />
              )}
            </div>
          )}

          {fiscal && config.payment_mode === 'indireto' && (
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
  fiscalConfigs,
  companyBankAccounts,
  disabled = false,
  onChange,
}: Props) {
  const configs = Array.isArray(value.configurations) ? value.configurations : []
  const receiptMethods = lookups?.receiptMethods || []

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
              Cada configuração financeira se refere a uma configuração tributária, que define vínculo, promotora e quem paga.
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
          <div style={{ marginTop: '0.35rem' }}>Crie pelo menos uma configuração tributária e associe-a aqui.</div>
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: '1rem' }}>
        {configs.map((config, index) => (
          <FinancialConfigurationCard
            key={config.id}
            config={config}
            index={index}
            disabled={disabled}
            fiscalConfigs={fiscalConfigs}
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
