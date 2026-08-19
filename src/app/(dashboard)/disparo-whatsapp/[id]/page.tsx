'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Loader2, RefreshCw, Play, Pause, Square, RotateCcw, Search, AlertCircle, X, Copy } from 'lucide-react'
import {
  getCampaign, listCampaignRecipients, startCampaign, pauseCampaign, cancelCampaign, retryFailedRecipients, refreshCampaignCounters,
  type CampaignDetail,
} from '../actions'
import { CounterTiles, campaignProgress, statusBadgeClass } from '../_components/CampaignCard'
import WhatsappPreview from '@/components/whatsapp/WhatsappPreview'
import { fillPreviewVariables } from '@/components/whatsapp/whatsapp-format'
import { formatBrPhone } from '@/lib/zapi/phone'
import {
  CAMPAIGN_STATUS_LABELS, RECIPIENT_STATUS_LABELS, SOURCE_TYPE_LABELS, WEEKDAY_LABELS,
  describeDirectSchedule, type CampaignRecipientRecord, type RecipientStatus,
} from '@/lib/disparo-whatsapp'

const RECIP_BADGE: Record<RecipientStatus, string> = {
  pending: 'badge-warning', sending: 'badge-info', sent: 'badge-success', delivered: 'badge-info', read: 'badge-navy',
  failed: 'badge-danger', skipped: 'badge-gray', optout: 'badge-gray', cancelled: 'badge-gray',
}

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>()
  const id = String(params?.id || '')
  const [detail, setDetail] = useState<CampaignDetail | null>(null)
  const [recips, setRecips] = useState<CampaignRecipientRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<RecipientStatus | 'all'>('all')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const pageSize = 100

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const [d, r] = await Promise.all([getCampaign(id), listCampaignRecipients(id, { page, pageSize, status, q })])
    if (d.success) setDetail(d.detail)
    else setError(d.error)
    if (r.success) { setRecips(r.items); setTotal(r.total) }
    if (!silent) setLoading(false)
  }, [id, page, status, q])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (timer.current) clearInterval(timer.current)
    if (detail?.campaign.status === 'running' || detail?.campaign.status === 'scheduled') timer.current = setInterval(() => load(true), 15000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [detail?.campaign.status, load])

  async function run(fn: () => Promise<{ success: boolean; error?: string }>) {
    setBusy(true)
    const res = await fn()
    if (!res.success) setError(res.error || 'Falha na operação.')
    await load(true)
    setBusy(false)
  }

  if (loading && !detail) {
    return <div className="page-content" style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--brs-gray-600)' }}><Loader2 className="spinner" size={16} /> Carregando…</div>
  }
  if (!detail) {
    return <div className="page-content"><div className="alert alert-error">{error || 'Campanha não encontrada.'}</div><Link href="/disparo-whatsapp" className="btn btn-outline" style={{ marginTop: 12 }}><ArrowLeft size={16} /> Voltar</Link></div>
  }

  const c = detail.campaign
  const pct = campaignProgress(c)
  const canStart = ['draft', 'scheduled', 'paused'].includes(c.status)
  const canPause = ['running', 'scheduled'].includes(c.status)
  const canCancel = ['draft', 'scheduled', 'running', 'paused'].includes(c.status)
  const sampleVars: Record<string, string> = recips[0]?.variables ? { ...(recips[0].variables as any), nome: (recips[0].variables as any)?.nome ?? recips[0].name ?? '' } : {}
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link href="/disparo-whatsapp" className="btn btn-ghost" style={{ padding: '6px 10px' }}><ArrowLeft size={16} /> Voltar</Link>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--brs-gray-900)', margin: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {c.name} <span className={`badge ${statusBadgeClass(c.status)}`}>{CAMPAIGN_STATUS_LABELS[c.status]}</span>
            </h1>
            <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>
              {SOURCE_TYPE_LABELS[c.source_type]} · Instância: {detail.instance?.name || '—'} · Criada em {new Date(c.created_at).toLocaleString('pt-BR')}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {canStart && <button type="button" className="btn btn-success" disabled={busy} onClick={() => run(() => startCampaign(c.id))}><Play size={16} /> {c.status === 'paused' ? 'Retomar' : 'Iniciar agora'}</button>}
          {canPause && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => run(() => pauseCampaign(c.id))}><Pause size={16} /> Pausar</button>}
          {canCancel && <button type="button" className="btn btn-outline" disabled={busy} style={{ color: '#b91c1c' }} onClick={() => { if (window.confirm('Cancelar a campanha? Os pendentes não serão enviados.')) run(() => cancelCampaign(c.id)) }}><Square size={16} /> Cancelar</button>}
          {c.failed_count > 0 && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => run(() => retryFailedRecipients(c.id))}><RotateCcw size={16} /> Reenviar falhas ({c.failed_count})</button>}
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => run(() => refreshCampaignCounters(c.id))} title="Recontar"><RefreshCw size={16} /></button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
          <AlertCircle size={16} /> <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setError(null)}><X size={14} /></button>
        </div>
      )}
      {c.last_error && ['paused', 'failed'].includes(c.status) && <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>⚠ {c.last_error}</div>}

      <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1rem' }}>
        <div style={{ margin: '0 0 0.75rem', position: 'relative', height: 10, background: 'var(--brs-gray-100)', borderRadius: 999, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: 'linear-gradient(90deg,#22c55e,#16a34a)' }} />
        </div>
        <CounterTiles c={c} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Configuração de envio</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-700)', display: 'grid', gap: 4 }}>
            <div>Delay entre mensagens: <strong>{c.delay_min_seconds}s – {c.delay_max_seconds}s</strong> (aleatório)</div>
            <div>Rotação de blocos: <strong>{c.rotate_templates ? (c.rotation_mode === 'random' ? 'aleatória' : 'sequencial') : 'desligada'}</strong> · {detail.templates.length} bloco(s)</div>
            <div>Botão anti-ban: <strong>{c.antiban ? 'ativo' : 'desligado'}</strong></div>
            <div>Agendamento: <strong>{c.schedule_mode === 'batches' ? 'Lotes' : 'Direto'}</strong>{c.schedule_mode === 'direct' ? ` — ${describeDirectSchedule(c)}` : ''}</div>
            {c.schedule_mode === 'batches' && detail.slots.length > 0 && (
              <ul style={{ margin: '4px 0 0', paddingLeft: '1.1rem' }}>
                {detail.slots.map((s) => (
                  <li key={s.id}>{new Date(s.run_at).toLocaleString('pt-BR', { timeZone: c.timezone })} — {s.sent_count}/{s.quantity} disparos</li>
                ))}
              </ul>
            )}
            <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.75rem' }}>Dias: {c.allowed_weekdays.map((d) => WEEKDAY_LABELS[d]).join(', ')}</div>
          </div>
        </div>
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Blocos de mensagem</div>
          <div style={{ display: 'grid', gap: '0.75rem', maxHeight: 420, overflowY: 'auto' }}>
            {detail.templates.map((t, i) => (
              <div key={t.id || i}>
                <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-500)', marginBottom: 4 }}>Bloco {i + 1}</div>
                <WhatsappPreview
                  compact
                  body={fillPreviewVariables(t.body, sampleVars)}
                  media={t.media ? { type: t.media.type, url: t.media.preview_url, file_name: t.media.file_name, size: t.media.size } : null}
                  contact={t.contact}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.75rem 1rem', borderBottom: '1px solid var(--brs-gray-100)', flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 700, flex: 1 }}>Destinatários ({total})</div>
          <select className="form-control" style={{ width: 170 }} value={status} onChange={(e) => { setStatus(e.target.value as any); setPage(1) }}>
            <option value="all">Todos os status</option>
            {(Object.keys(RECIPIENT_STATUS_LABELS) as RecipientStatus[]).map((s) => <option key={s} value={s}>{RECIPIENT_STATUS_LABELS[s]}</option>)}
          </select>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 8, top: 10, color: 'var(--brs-gray-400)' }} />
            <input className="form-control" style={{ paddingLeft: 28, width: 220 }} placeholder="Nome ou telefone" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
          </div>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>#</th><th>Telefone</th><th>Nome</th><th>Status</th><th>Bloco</th><th>Enviado em</th><th>Erro</th><th></th></tr>
            </thead>
            <tbody>
              {recips.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--brs-gray-500)', padding: '1.5rem' }}>Nenhum destinatário.</td></tr>
              ) : recips.map((r) => (
                <tr key={r.id}>
                  <td style={{ color: 'var(--brs-gray-400)' }}>{r.position + 1}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{formatBrPhone(r.phone)}</td>
                  <td>{r.name || (r.variables as any)?.nome || '—'}</td>
                  <td><span className={`badge ${RECIP_BADGE[r.status]}`}>{RECIPIENT_STATUS_LABELS[r.status]}</span></td>
                  <td>{r.template_index !== null ? r.template_index + 1 : '—'}</td>
                  <td style={{ fontSize: '0.8rem' }}>{r.sent_at ? new Date(r.sent_at).toLocaleString('pt-BR') : '—'}</td>
                  <td style={{ fontSize: '0.75rem', color: '#b91c1c', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.error || ''}>{r.error || ''}</td>
                  <td>
                    {r.status === 'failed' && (
                      <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => run(() => retryFailedRecipients(c.id, [r.id]))} title="Reenviar"><RotateCcw size={12} /></button>
                    )}
                    {r.message_id && (
                      <button type="button" className="btn btn-ghost btn-sm" title={`messageId ${r.message_id}`} onClick={() => navigator.clipboard?.writeText(r.message_id!)}><Copy size={12} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="pagination" style={{ padding: '0.6rem 1rem' }}>
            <span className="pagination-info">Página {page} de {totalPages}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
              <button type="button" className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
