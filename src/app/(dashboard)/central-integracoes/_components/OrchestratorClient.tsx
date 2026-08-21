'use client'

/**
 * Visão de um orquestrador: linha do tempo dos webhooks (com payload e
 * reprocessamento manual), log de erros e resumo 24h por sistema.
 */

import { Fragment, useCallback, useState } from 'react'
import {
  AlertCircle, ChevronDown, ChevronRight, Loader2, RefreshCw, RotateCcw,
} from 'lucide-react'
import {
  getOrchestratorEventDetail,
  getOrchestratorEvents,
  getOrchestratorErrors,
  retryOrchestratorEvent,
  type OrchestratorStats,
} from '../actions'
import { EVENT_STATUS_LABEL, type OrchestratorErrorLog, type OrchestratorEvent } from '../types'

function fmt(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const SOURCES = ['', 'vendeai', 'callface', 'site']
const STATUSES = ['', 'received', 'processed', 'failed', 'retrying']

export default function OrchestratorClient({
  slug,
  initialEvents,
  initialErrors,
  initialStats,
  loadError,
}: {
  slug: string
  initialEvents: OrchestratorEvent[]
  initialErrors: OrchestratorErrorLog[]
  initialStats: OrchestratorStats | null
  loadError: string | null
}) {
  const [tab, setTab] = useState<'eventos' | 'erros'>('eventos')
  const [events, setEvents] = useState(initialEvents)
  const [errors, setErrors] = useState(initialErrors)
  const [stats] = useState(initialStats)
  const [source, setSource] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(loadError)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [payloads, setPayloads] = useState<Record<number, unknown>>({})
  const [retrying, setRetrying] = useState<number | null>(null)

  const reload = useCallback(async (opts: { source?: string; status?: string; append?: boolean } = {}) => {
    setBusy(true)
    setError(null)
    const src = opts.source ?? source
    const st = opts.status ?? status
    const before = opts.append && events.length ? events[events.length - 1].id : undefined
    const res = await getOrchestratorEvents(slug, { source: src || undefined, status: st || undefined, before, limit: 50 })
    if (res.ok) {
      setEvents(opts.append ? [...events, ...res.data.events] : res.data.events)
    } else {
      setError(res.error)
    }
    setBusy(false)
  }, [slug, source, status, events])

  const reloadErrors = useCallback(async (append = false) => {
    setBusy(true)
    const before = append && errors.length ? errors[errors.length - 1].id : undefined
    const res = await getOrchestratorErrors(slug, { before, limit: 50 })
    if (res.ok) setErrors(append ? [...errors, ...res.data.errors] : res.data.errors)
    else setError(res.error)
    setBusy(false)
  }, [slug, errors])

  const toggleExpand = useCallback(async (id: number) => {
    if (expanded === id) {
      setExpanded(null)
      return
    }
    setExpanded(id)
    if (payloads[id] === undefined) {
      const res = await getOrchestratorEventDetail(slug, id)
      if (res.ok) setPayloads((prev) => ({ ...prev, [id]: res.data.event.payload }))
    }
  }, [expanded, payloads, slug])

  const retry = useCallback(async (id: number) => {
    setRetrying(id)
    const res = await retryOrchestratorEvent(slug, id)
    if (!res.ok) setError(res.error)
    else if (!res.data.ok) setError(`Reprocesso do evento ${id} falhou: ${res.data.error ?? 'erro'}`)
    await reload()
    setRetrying(null)
  }, [slug, reload])

  return (
    <div>
      {stats ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
          {['vendeai', 'callface', 'site'].map((src) => {
            const rows24 = stats.events24h.filter((r) => r.source === src)
            const total24 = rows24.reduce((acc, r) => acc + r.count, 0)
            const failed24 = rows24.filter((r) => r.status === 'failed').reduce((acc, r) => acc + r.count, 0)
            return (
              <div key={src} className="card" style={{ padding: '0.9rem 1rem' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--brs-gray-500)' }}>{src}</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', marginTop: 2 }}>
                  {total24} <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--brs-gray-400)' }}>eventos 24h</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: failed24 ? '#dc2626' : 'var(--brs-gray-400)' }}>
                  {failed24} falhos
                </div>
              </div>
            )
          })}
          {stats.dailyQuota.map((q) => (
            <div key={q.scope} className="card" style={{ padding: '0.9rem 1rem' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--brs-gray-500)' }}>Cota diária</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', marginTop: 2 }}>
                {q.used}{q.limit ? ` / ${q.limit}` : ''}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)' }}>{q.scope.split(':')[0]}</div>
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <div style={{ padding: '0.75rem 1rem', borderRadius: 10, background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA', marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.875rem' }}>
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.9rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className={`btn ${tab === 'eventos' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('eventos')}>Eventos</button>
        <button className={`btn ${tab === 'erros' ? 'btn-primary' : 'btn-outline'}`} onClick={() => { setTab('erros'); void reloadErrors() }}>Erros</button>

        {tab === 'eventos' ? (
          <>
            <select className="form-input" style={{ width: 160 }} value={source} onChange={(e) => { setSource(e.target.value); void reload({ source: e.target.value }) }}>
              {SOURCES.map((s) => <option key={s} value={s}>{s || 'Todas as fontes'}</option>)}
            </select>
            <select className="form-input" style={{ width: 160 }} value={status} onChange={(e) => { setStatus(e.target.value); void reload({ status: e.target.value }) }}>
              {STATUSES.map((s) => <option key={s} value={s}>{s ? (EVENT_STATUS_LABEL[s]?.label ?? s) : 'Todos os status'}</option>)}
            </select>
          </>
        ) : null}

        <button className="btn btn-outline" onClick={() => (tab === 'eventos' ? reload() : reloadErrors())} disabled={busy} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {busy ? <Loader2 size={15} className="spinner" /> : <RefreshCw size={15} />} Atualizar
        </button>
      </div>

      {tab === 'eventos' ? (
        <div className="card">
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 30 }} />
                  <th>ID</th>
                  <th>Fonte</th>
                  <th>Tipo</th>
                  <th>Status</th>
                  <th>Tent.</th>
                  <th>Recebido</th>
                  <th>Erro</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => {
                  const badge = EVENT_STATUS_LABEL[ev.status] ?? { label: ev.status, badge: 'badge-gray' }
                  return (
                    <Fragment key={ev.id}>
                      <tr onClick={() => toggleExpand(ev.id)} style={{ cursor: 'pointer' }}>
                        <td>{expanded === ev.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                        <td>{ev.id}</td>
                        <td>{ev.source}</td>
                        <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.event_type}</td>
                        <td><span className={`badge ${badge.badge}`}>{badge.label}</span></td>
                        <td>{ev.attempts}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmt(ev.received_at)}</td>
                        <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', color: '#991B1B', fontSize: '0.8rem' }}>{ev.error ?? ''}</td>
                        <td>
                          {ev.status === 'failed' ? (
                            <button
                              className="btn btn-outline"
                              style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              disabled={retrying === ev.id}
                              onClick={(e) => { e.stopPropagation(); void retry(ev.id) }}
                            >
                              {retrying === ev.id ? <Loader2 size={13} className="spinner" /> : <RotateCcw size={13} />} Reprocessar
                            </button>
                          ) : null}
                        </td>
                      </tr>
                      {expanded === ev.id ? (
                        <tr>
                          <td colSpan={9} style={{ background: 'var(--brs-gray-50)' }}>
                            <pre style={{ margin: 0, padding: '0.75rem', fontSize: '0.75rem', maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                              {payloads[ev.id] === undefined ? 'Carregando payload…' : JSON.stringify(payloads[ev.id], null, 2)}
                            </pre>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
                {events.length === 0 ? (
                  <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--brs-gray-400)', padding: '2rem' }}>Nenhum evento com esse filtro.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {events.length >= 50 ? (
            <div style={{ padding: '0.75rem', textAlign: 'center' }}>
              <button className="btn btn-outline" onClick={() => reload({ append: true })} disabled={busy}>Carregar mais</button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="card">
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Escopo</th>
                  <th>Mensagem</th>
                  <th>Evento</th>
                  <th>Quando</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((err) => (
                  <tr key={err.id}>
                    <td>{err.id}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{err.scope}</td>
                    <td style={{ maxWidth: 420, fontSize: '0.82rem' }}>{err.message}</td>
                    <td>{err.webhook_event_id ?? '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmt(err.created_at)}</td>
                  </tr>
                ))}
                {errors.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--brs-gray-400)', padding: '2rem' }}>Nenhum erro registrado. 🎉</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {errors.length >= 50 ? (
            <div style={{ padding: '0.75rem', textAlign: 'center' }}>
              <button className="btn btn-outline" onClick={() => reloadErrors(true)} disabled={busy}>Carregar mais</button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
