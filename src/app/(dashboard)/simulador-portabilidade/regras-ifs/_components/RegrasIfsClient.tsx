'use client'

import { useState } from 'react'
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { MinReleaseMode, RegraBancoPortabilidade } from '@/lib/portability/types'
import { saveRegraIfPortabilidade } from '../../actions'

interface Props {
  convenios: Array<{ id: string; nome: string; codigo: string }>
  financialInstitutions: Array<{ id: string; name: string; logo_url?: string; logo_wide_url?: string }>
  initialRules: RegraBancoPortabilidade[]
}

function listToTxt(arr: string[] | undefined | null): string {
  return (arr || []).join(', ')
}

function txtToList(str: string): string[] {
  return str
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
}

function mapToTxt(map: Record<string, number> | undefined | null): string {
  if (!map) return ''
  return Object.entries(map)
    .map(([k, v]) => `${k}:${v}`)
    .join(', ')
}

function txtToMap(str: string): Record<string, number> {
  const res: Record<string, number> = {}
  str.split(',').forEach((part) => {
    const [k, v] = part.split(':')
    if (k && v != null) {
      const num = parseFloat(v.trim().replace(',', '.'))
      if (!isNaN(num)) {
        res[k.trim().toUpperCase()] = num
      }
    }
  })
  return res
}

function formatAgeText(years: number | null | undefined, months: number | null | undefined): string {
  if (years == null) return ''
  if (months && months > 0) return `${years} anos e ${months} meses`
  return `${years} anos`
}

function parseAgeText(str: string): { years: number | null; months: number | null } {
  if (!str.trim()) return { years: null, months: null }
  const yMatch = str.match(/(\d+)\s*anos?/i)
  const mMatch = str.match(/(\d+)\s*mes/i)
  const years = yMatch ? parseInt(yMatch[1], 10) : parseInt(str.replace(/\D/g, ''), 10) || null
  const months = mMatch ? parseInt(mMatch[1], 10) : 0
  return { years, months }
}

export default function RegrasIfsClient({ convenios, financialInstitutions, initialRules }: Props) {
  const [rules, setRules] = useState<RegraBancoPortabilidade[]>(initialRules)
  const [search, setSearch] = useState('')
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  function toggleOpen(id: string) {
    setOpenMap((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  function updateRule(id: string, key: keyof RegraBancoPortabilidade, val: any) {
    setRules((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r
        return { ...r, [key]: val }
      })
    )
  }

  async function handleSave(rule: RegraBancoPortabilidade) {
    setSavingId(rule.id)
    const res = await saveRegraIfPortabilidade(rule)
    setSavingId(null)
    if (res.success) {
      showToast(`Regras de ${rule.name} salvas com sucesso!`)
    } else {
      alert(`Erro ao salvar regra: ${res.error}`)
    }
  }

  const filteredRules = rules.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ paddingBottom: '3rem' }}>
      {/* Toast Notification */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '1.5rem',
            right: '1.5rem',
            background: 'var(--brs-navy, #17384B)',
            color: '#fff',
            padding: '0.75rem 1.25rem',
            borderRadius: '999px',
            fontSize: '0.875rem',
            fontWeight: 700,
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <CheckCircle2 size={18} color="#10B981" />
          {toast}
        </div>
      )}

      {/* Page Header */}
      <div
        style={{
          background: 'linear-gradient(135deg, #17384B 0%, #2A5268 100%)',
          color: '#fff',
          borderRadius: '16px',
          padding: '1.25rem 1.5rem',
          boxShadow: '0 8px 24px rgba(23,56,75,0.12)',
          marginBottom: '1.25rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <SlidersHorizontal size={24} color="#D97706" />
            Regras Individuais por Instituição Financeira
          </h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#DCE6EF' }}>
            Gerencie as regras de portabilidade, empréstimo novo, limites e bloqueios das instituições financeiras cadastradas no Workspace.
          </p>
        </div>

        <div style={{ position: 'relative', width: '240px' }}>
          <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
          <input
            type="text"
            className="form-control"
            placeholder="Buscar instituição..."
            style={{ paddingLeft: '2.2rem', fontSize: '0.85rem', height: '38px', background: 'rgba(255,255,255,0.15)', color: '#fff', borderColor: 'rgba(255,255,255,0.25)' }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Rules List */}
      {filteredRules.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--brs-gray-500)' }}>
          Nenhuma Instituição Financeira encontrada cadastrada no Workspace.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {filteredRules.map((r) => {
            const isOpen = !!openMap[r.id]
            const isSaving = savingId === r.id

            return (
              <div
                key={r.id}
                className="card"
                style={{
                  padding: 0,
                  borderRadius: '14px',
                  overflow: 'hidden',
                  border: `1px solid ${r.enabled ? '#CBD5E1' : '#E2E8F0'}`,
                  background: '#FFFFFF',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
                }}
              >
                {/* Header Card */}
                <div
                  style={{
                    padding: '1rem 1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: isOpen ? '#F8FAFC' : '#FFFFFF',
                    cursor: 'pointer',
                  }}
                  onClick={() => toggleOpen(r.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) => {
                        e.stopPropagation()
                        updateRule(r.id, 'enabled', e.target.checked)
                      }}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />

                    {/* Logo da IF */}
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 8,
                        border: '1px solid #E2E8F0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        background: '#fff',
                      }}
                    >
                      {r.logoUrl ? (
                        <img src={r.logoUrl} alt={r.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      ) : (
                        <Building2 size={20} color="var(--brs-navy)" />
                      )}
                    </div>

                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--brs-navy)' }}>
                        {r.name}
                      </h3>
                      <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)', marginTop: '0.1rem' }}>
                        Convênio: {r.convenioCodigo || 'INSS'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={isSaving}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleSave(r)
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700 }}
                    >
                      {isSaving ? <RefreshCw className="spin" size={14} /> : <Save size={14} />}
                      {isSaving ? 'Salvando...' : 'Salvar Regras'}
                    </button>

                    {isOpen ? <ChevronUp size={20} color="#64748B" /> : <ChevronDown size={20} color="#64748B" />}
                  </div>
                </div>

                {/* Form Accordion Details */}
                {isOpen && (
                  <div style={{ padding: '1.25rem 1.5rem', borderTop: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: '1.25rem', background: '#FAFAFA' }}>
                    {/* Seção 1: Convênio & Coeficiente Empréstimo Novo */}
                    <div style={{ background: '#fff', padding: '1rem', borderRadius: '10px', border: '1px solid #E2E8F0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontWeight: 700, fontSize: '0.8rem' }}>Convênio Vinculado</label>
                        <select
                          className="form-control"
                          style={{ fontSize: '0.85rem' }}
                          value={r.convenioCodigo || 'INSS'}
                          onChange={(e) => updateRule(r.id, 'convenioCodigo', e.target.value)}
                        >
                          <option value="INSS">INSS</option>
                          <option value="SIAPE">SIAPE</option>
                          <option value="OUTROS">OUTROS</option>
                        </select>
                      </div>

                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontWeight: 700, fontSize: '0.8rem' }}>Coeficiente Empréstimo Novo Médio</label>
                        <input
                          type="number"
                          step="0.00001"
                          className="form-control"
                          style={{ fontSize: '0.85rem' }}
                          placeholder="Ex.: 0.023896"
                          value={r.coeficienteNovoMedio ?? ''}
                          onChange={(e) => updateRule(r.id, 'coeficienteNovoMedio', e.target.value ? parseFloat(e.target.value) : null)}
                        />
                      </div>

                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontWeight: 700, fontSize: '0.8rem' }}>Coeficiente Portabilidade Específico</label>
                        <input
                          type="number"
                          step="0.00001"
                          className="form-control"
                          style={{ fontSize: '0.85rem' }}
                          placeholder="Usa padrão global se vazio"
                          value={r.portCoeff ?? ''}
                          onChange={(e) => updateRule(r.id, 'portCoeff', e.target.value ? parseFloat(e.target.value) : null)}
                        />
                      </div>
                    </div>

                    {/* Seção 2: Regras LOAS e Representante Legal por IF */}
                    <div style={{ background: '#fff', padding: '1rem', borderRadius: '10px', border: '1px solid #E2E8F0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={!!r.blockLoas}
                            onChange={(e) => updateRule(r.id, 'blockLoas', e.target.checked)}
                            style={{ width: '16px', height: '16px' }}
                          />
                          Bloquear espécies LOAS nesta IF
                        </label>
                        <input
                          type="text"
                          className="form-control"
                          style={{ fontSize: '0.82rem' }}
                          placeholder="Ex.: 87,88"
                          value={r.loasSpecies || ''}
                          onChange={(e) => updateRule(r.id, 'loasSpecies', e.target.value)}
                        />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={!!r.blockRepresentative}
                            onChange={(e) => updateRule(r.id, 'blockRepresentative', e.target.checked)}
                            style={{ width: '16px', height: '16px' }}
                          />
                          Não operar com representante legal nesta IF
                        </label>
                        <input
                          type="text"
                          className="form-control"
                          style={{ fontSize: '0.82rem' }}
                          placeholder="Motivo (ex.: Não faz representante)"
                          value={r.representativeReason || ''}
                          onChange={(e) => updateRule(r.id, 'representativeReason', e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Seção 3: Limites, Idades, Prazos e Troco */}
                    <div style={{ background: '#fff', padding: '1rem', borderRadius: '10px', border: '1px solid #E2E8F0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Taxa Mínima Entrada (%)</label>
                        <input
                          type="number"
                          step="0.01"
                          className="form-control"
                          style={{ fontSize: '0.82rem' }}
                          value={r.entry ?? ''}
                          onChange={(e) => updateRule(r.id, 'entry', e.target.value ? parseFloat(e.target.value) : null)}
                        />
                      </div>

                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Refin Mínimo (%)</label>
                        <input
                          type="number"
                          step="0.01"
                          className="form-control"
                          style={{ fontSize: '0.82rem' }}
                          value={r.refiMin ?? ''}
                          onChange={(e) => updateRule(r.id, 'refiMin', e.target.value ? parseFloat(e.target.value) : null)}
                        />
                      </div>

                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Refin Máximo (%)</label>
                        <input
                          type="number"
                          step="0.01"
                          className="form-control"
                          style={{ fontSize: '0.82rem' }}
                          value={r.refiMax ?? ''}
                          onChange={(e) => updateRule(r.id, 'refiMax', e.target.value ? parseFloat(e.target.value) : null)}
                        />
                      </div>

                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Idade Mínima</label>
                        <input
                          type="number"
                          className="form-control"
                          style={{ fontSize: '0.82rem' }}
                          value={r.ageMin ?? ''}
                          onChange={(e) => updateRule(r.id, 'ageMin', e.target.value ? parseInt(e.target.value, 10) : null)}
                        />
                      </div>

                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Idade Máxima</label>
                        <input
                          type="text"
                          className="form-control"
                          style={{ fontSize: '0.82rem' }}
                          placeholder="Ex.: 71 anos e 11 meses"
                          value={formatAgeText(r.ageMaxYears, r.ageMaxMonths)}
                          onChange={(e) => {
                            const parsed = parseAgeText(e.target.value)
                            updateRule(r.id, 'ageMaxYears', parsed.years)
                            updateRule(r.id, 'ageMaxMonths', parsed.months)
                          }}
                        />
                      </div>

                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Idade Máxima ao Final</label>
                        <input
                          type="text"
                          className="form-control"
                          style={{ fontSize: '0.82rem' }}
                          placeholder="Ex.: 80 anos e 11 meses"
                          value={formatAgeText(r.endAgeYears, r.endAgeMonths)}
                          onChange={(e) => {
                            const parsed = parseAgeText(e.target.value)
                            updateRule(r.id, 'endAgeYears', parsed.years)
                            updateRule(r.id, 'endAgeMonths', parsed.months)
                          }}
                        />
                      </div>

                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Prazo Padrão</label>
                        <input
                          type="number"
                          className="form-control"
                          style={{ fontSize: '0.82rem' }}
                          value={r.term ?? ''}
                          onChange={(e) => updateRule(r.id, 'term', parseInt(e.target.value, 10) || 108)}
                        />
                      </div>

                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Parcela Mínima (R$)</label>
                        <input
                          type="number"
                          className="form-control"
                          style={{ fontSize: '0.82rem' }}
                          value={r.minInstallment ?? ''}
                          onChange={(e) => updateRule(r.id, 'minInstallment', e.target.value ? parseFloat(e.target.value) : null)}
                        />
                      </div>

                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Saldo Mínimo (R$)</label>
                        <input
                          type="number"
                          className="form-control"
                          style={{ fontSize: '0.82rem' }}
                          value={r.minDebt ?? ''}
                          onChange={(e) => updateRule(r.id, 'minDebt', e.target.value ? parseFloat(e.target.value) : null)}
                        />
                      </div>

                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Troco / Liberado Mínimo (R$)</label>
                        <input
                          type="number"
                          className="form-control"
                          style={{ fontSize: '0.82rem' }}
                          value={r.minRelease ?? ''}
                          onChange={(e) => updateRule(r.id, 'minRelease', e.target.value ? parseFloat(e.target.value) : null)}
                        />
                      </div>

                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Regra do Troco</label>
                        <select
                          className="form-control"
                          style={{ fontSize: '0.82rem' }}
                          value={r.minReleaseMode || 'fixed'}
                          onChange={(e) => updateRule(r.id, 'minReleaseMode', e.target.value as MinReleaseMode)}
                        >
                          <option value="fixed">Valor fixo</option>
                          <option value="maxFixedOrPercentDebt">Maior entre valor fixo e % da dívida</option>
                          <option value="maxFixedOrPercentNew">Maior entre valor fixo e % do contrato novo</option>
                          <option value="percentDebtOnly">Somente % da dívida</option>
                          <option value="installment">Uma parcela de troco</option>
                        </select>
                      </div>

                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Pagas Padrão</label>
                        <input
                          type="number"
                          className="form-control"
                          style={{ fontSize: '0.82rem' }}
                          value={r.defaultPaid ?? ''}
                          onChange={(e) => updateRule(r.id, 'defaultPaid', e.target.value ? parseInt(e.target.value, 10) : null)}
                        />
                      </div>
                    </div>

                    {/* Seção 4: Exceções e Observações */}
                    <div style={{ background: '#fff', padding: '1rem', borderRadius: '10px', border: '1px solid #E2E8F0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Bancos que Não Porta</label>
                        <textarea
                          className="form-control"
                          style={{ fontSize: '0.82rem', height: '60px' }}
                          placeholder="Ex.: C6, SAFRA, ALFA, MASTER"
                          value={listToTxt(r.blocked)}
                          onChange={(e) => updateRule(r.id, 'blocked', txtToList(e.target.value))}
                        />
                      </div>

                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Bancos com Regra de Parcelas Pagas</label>
                        <textarea
                          className="form-control"
                          style={{ fontSize: '0.82rem', height: '60px' }}
                          placeholder="Ex.: FACTA:24, AGIBANK:15, PAN:12"
                          value={mapToTxt(r.paid)}
                          onChange={(e) => updateRule(r.id, 'paid', txtToMap(e.target.value))}
                        />
                      </div>

                      <div className="form-group" style={{ margin: 0, gridColumn: 'span 2' }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Outras Observações</label>
                        <textarea
                          className="form-control"
                          style={{ fontSize: '0.82rem', height: '60px' }}
                          placeholder="Ex.: Unifica até 3 parcelas, não reduz parcela..."
                          value={r.notes || ''}
                          onChange={(e) => updateRule(r.id, 'notes', e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
