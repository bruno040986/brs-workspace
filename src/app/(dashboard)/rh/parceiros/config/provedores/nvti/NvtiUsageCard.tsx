'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Loader2, Wallet } from 'lucide-react'
import {
  getNvtiConsumo, getNvtiLimites, setNvtiDefaultUserCap, setNvtiGlobalCap, setNvtiUserCap,
  type NvtiConsumo, type NvtiLimitesState,
} from '@/app/(dashboard)/higienizacao-nvti/actions'

function brl(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

type Feedback = { type: 'success' | 'error'; text: string }

export function NvtiUsageCard({ canEditLimites }: { canEditLimites: boolean }) {
  const [consumo, setConsumo] = useState<NvtiConsumo | null>(null)
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState<{ year: number; month: number }>(() => {
    const now = new Date()
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }
  })
  const [limites, setLimites] = useState<NvtiLimitesState | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [globalCapInput, setGlobalCapInput] = useState('')
  const [defaultCapInput, setDefaultCapInput] = useState('')
  const [savingCaps, setSavingCaps] = useState(false)

  const load = useCallback(async (year: number, monthNumber: number) => {
    setLoading(true)
    try {
      const data = await getNvtiConsumo(year, monthNumber)
      setConsumo(data)
      if (canEditLimites) {
        const limitesData = await getNvtiLimites()
        setLimites(limitesData)
        setGlobalCapInput(String(limitesData.globalCap))
        setDefaultCapInput(String(limitesData.defaultUserCap))
      }
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao carregar o consumo.' })
    } finally {
      setLoading(false)
    }
  }, [canEditLimites])

  useEffect(() => {
    void load(month.year, month.month)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function shiftMonth(delta: number) {
    const next = new Date(Date.UTC(month.year, month.month - 1 + delta, 1))
    const nextValue = { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 }
    setMonth(nextValue)
    void load(nextValue.year, nextValue.month)
  }

  async function handleSaveCaps() {
    setSavingCaps(true)
    setFeedback(null)
    try {
      const globalCap = Number(globalCapInput.replace(',', '.'))
      const defaultCap = Number(defaultCapInput.replace(',', '.'))
      if (limites && globalCap !== limites.globalCap) await setNvtiGlobalCap(globalCap)
      if (limites && defaultCap !== limites.defaultUserCap) await setNvtiDefaultUserCap(defaultCap)
      setFeedback({ type: 'success', text: 'Limites atualizados. Lotes pausados por limite retomam sozinhos em até 2 minutos.' })
      await load(month.year, month.month)
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao salvar limites.' })
    } finally {
      setSavingCaps(false)
    }
  }

  async function handleUserCap(userId: string, current: number | null) {
    const raw = window.prompt(
      'Teto mensal (R$) para este usuário. Deixe vazio para voltar ao padrão.',
      current !== null ? String(current) : '',
    )
    if (raw === null) return
    try {
      const trimmed = raw.trim().replace(',', '.')
      await setNvtiUserCap(userId, trimmed === '' ? null : Number(trimmed))
      setFeedback({ type: 'success', text: 'Teto do usuário atualizado.' })
      await load(month.year, month.month)
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao salvar teto do usuário.' })
    }
  }

  return (
    <div className="card" style={{ padding: '1.25rem', marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        <div style={{ background: 'rgba(27, 58, 107, 0.08)', color: 'var(--brs-navy)', padding: '0.5rem', borderRadius: 12 }}>
          <Wallet size={22} />
        </div>
        <div>
          <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>Consumo e limites de gasto</div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.875rem' }}>
            Batimento com a fatura mensal e tetos de gasto. Visível apenas aqui nas configurações.
          </div>
        </div>
      </div>

      {feedback && (
        <div
          style={{
            padding: '0.875rem 1rem',
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            marginBottom: '1rem',
            background: feedback.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: feedback.type === 'success' ? '#065F46' : '#991B1B',
            border: `1px solid ${feedback.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
          }}
        >
          {feedback.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{feedback.text}</span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => shiftMonth(-1)}>← Mês anterior</button>
        <div style={{ fontWeight: 800, color: 'var(--brs-gray-800)', minWidth: 110, textAlign: 'center' }}>
          {String(month.month).padStart(2, '0')}/{month.year}
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => shiftMonth(1)}>Mês seguinte →</button>
        {loading ? <Loader2 size={16} className="spinner" style={{ color: 'var(--brs-gray-400)' }} /> : null}
      </div>

      {consumo ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
            {[
              { label: 'Consultas no mês', value: consumo.totalQueries.toLocaleString('pt-BR') },
              { label: 'Cobradas (NVTI)', value: consumo.billedCount.toLocaleString('pt-BR') },
              { label: 'Reaproveitadas (grátis)', value: consumo.cachedCount.toLocaleString('pt-BR') },
              { label: 'Erros', value: consumo.errorCount.toLocaleString('pt-BR') },
              { label: 'Estimativa da fatura', value: brl(consumo.spendEstimate) },
            ].map((item) => (
              <div key={item.label} style={{ padding: '0.8rem 0.9rem', borderRadius: 12, border: '1px solid var(--brs-gray-100)', background: 'var(--brs-gray-50)' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--brs-gray-400)' }}>{item.label}</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', marginTop: 2 }}>{item.value}</div>
              </div>
            ))}
          </div>

          {consumo.byOrigin.length ? (
            <div style={{ marginTop: '0.75rem', color: 'var(--brs-gray-500)', fontSize: '0.82rem' }}>
              Por origem: {consumo.byOrigin.map((item) => {
                const label = item.origin === 'manual' ? 'Consulta manual' : item.origin === 'batch' ? 'Lotes' : 'Orquestradores'
                return `${label} ${item.total.toLocaleString('pt-BR')} (${brl(item.spend)})`
              }).join(' · ')}
            </div>
          ) : null}

          <div style={{ marginTop: '1rem', fontWeight: 700, color: 'var(--brs-gray-800)', fontSize: '0.9rem' }}>Consumo por usuário</div>
          <div className="table-wrapper" style={{ marginTop: '0.5rem' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Consultas</th>
                  <th>Cobradas</th>
                  <th>Reaproveitadas</th>
                  <th>Erros</th>
                  <th>Gasto</th>
                  <th>Teto</th>
                  {canEditLimites ? <th style={{ textAlign: 'right' }}>Ações</th> : null}
                </tr>
              </thead>
              <tbody>
                {consumo.byUser.length ? consumo.byUser.map((row) => (
                  <tr key={row.userId}>
                    <td>{row.name}</td>
                    <td>{row.total.toLocaleString('pt-BR')}</td>
                    <td>{row.billed.toLocaleString('pt-BR')}</td>
                    <td>{row.cached.toLocaleString('pt-BR')}</td>
                    <td>{row.errors ? <span className="badge badge-danger">{row.errors}</span> : '0'}</td>
                    <td>{brl(row.spend)}</td>
                    <td>{row.cap === null ? '—' : brl(row.cap)}</td>
                    {canEditLimites ? (
                      <td style={{ textAlign: 'right' }}>
                        {row.userId !== 'service' ? (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleUserCap(row.userId, row.cap)}>
                            Ajustar teto
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={canEditLimites ? 8 : 7} style={{ textAlign: 'center', color: 'var(--brs-gray-400)', padding: '1.25rem' }}>
                      Sem consultas neste mês.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {canEditLimites && limites ? (
            <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--brs-gray-100)' }}>
              <div style={{ fontWeight: 700, color: 'var(--brs-gray-800)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>Limites de gasto</div>
              <div className="form-grid form-grid-2">
                <div className="form-group">
                  <label className="form-label">Teto mensal global (R$)</label>
                  <input type="text" className="form-control" value={globalCapInput} onChange={(e) => setGlobalCapInput(e.target.value)} inputMode="decimal" />
                </div>
                <div className="form-group">
                  <label className="form-label">Teto mensal padrão por usuário (R$)</label>
                  <input type="text" className="form-control" value={defaultCapInput} onChange={(e) => setDefaultCapInput(e.target.value)} inputMode="decimal" />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-primary" disabled={savingCaps} onClick={() => void handleSaveCaps()} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {savingCaps ? <Loader2 size={16} className="spinner" /> : <CheckCircle size={16} />}
                  Salvar limites
                </button>
              </div>
              <div style={{ color: 'var(--brs-gray-400)', fontSize: '0.78rem', marginTop: '0.5rem' }}>
                Toda alteração de limite fica registrada em auditoria. O teto individual é ajustado por usuário na
                tabela acima.
              </div>
            </div>
          ) : null}
        </>
      ) : loading ? (
        <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--brs-gray-400)' }}>
          <Loader2 size={22} className="spinner" />
        </div>
      ) : null}
    </div>
  )
}
