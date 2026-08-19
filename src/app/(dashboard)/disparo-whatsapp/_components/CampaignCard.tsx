'use client'

import Link from 'next/link'
import { Play, Pause, Square, List, RefreshCw, Loader2, Trash2, Clock, CheckCircle2 } from 'lucide-react'
import { CAMPAIGN_STATUS_LABELS, SOURCE_TYPE_LABELS, type CampaignRecord } from '@/lib/disparo-whatsapp'
import type { ZapiInstancePublic } from '@/lib/zapi'

export function statusBadgeClass(status: CampaignRecord['status']): string {
  switch (status) {
    case 'running': return 'badge-success'
    case 'scheduled': return 'badge-info'
    case 'paused': return 'badge-warning'
    case 'completed': return 'badge-navy'
    case 'cancelled': return 'badge-gray'
    case 'failed': return 'badge-danger'
    default: return 'badge-gray'
  }
}

export function campaignProgress(c: CampaignRecord): number {
  const done = c.total_count - c.pending_count - c.sending_count
  return c.total_count > 0 ? Math.round((done / c.total_count) * 100) : 0
}

const counterStyle = (bg: string, color: string): React.CSSProperties => ({
  background: bg, color, borderRadius: 10, padding: '0.6rem 0.5rem', textAlign: 'center', border: '1px solid rgba(0,0,0,0.04)',
})

export function CounterTiles({ c, dense }: { c: CampaignRecord; dense?: boolean }) {
  const delivered = c.delivered_count + c.read_count
  const enviadas = c.sent_count + delivered
  const tiles = [
    { label: 'Total', value: c.total_count, bg: 'var(--brs-gray-50)', color: 'var(--brs-gray-800)' },
    { label: 'Enviadas', value: enviadas, bg: 'rgba(22,163,74,0.08)', color: '#15803d' },
    { label: 'Entregues', value: delivered, bg: 'rgba(2,132,199,0.08)', color: '#0369a1' },
    { label: 'Lidas', value: c.read_count, bg: 'rgba(27,58,107,0.08)', color: 'var(--brs-navy)' },
    { label: 'Falhas', value: c.failed_count, bg: 'rgba(220,38,38,0.08)', color: '#b91c1c' },
    { label: 'Pendentes', value: c.pending_count + c.sending_count, bg: 'rgba(217,119,6,0.08)', color: '#b45309' },
  ]
  const extra = c.optout_count + c.skipped_count + c.cancelled_count
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${dense ? 3 : 6}, minmax(0,1fr))`, gap: '0.5rem' }}>
        {tiles.map((t) => (
          <div key={t.label} style={counterStyle(t.bg, t.color)}>
            <div style={{ fontSize: dense ? '1.05rem' : '1.25rem', fontWeight: 800 }}>{t.value}</div>
            <div style={{ fontSize: '0.7rem', opacity: 0.85 }}>{t.label}</div>
          </div>
        ))}
      </div>
      {extra > 0 && (
        <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-500)', marginTop: 4 }}>
          {c.optout_count > 0 && <span>Opt-out: {c.optout_count} · </span>}
          {c.skipped_count > 0 && <span>Ignoradas: {c.skipped_count} · </span>}
          {c.cancelled_count > 0 && <span>Canceladas: {c.cancelled_count}</span>}
        </div>
      )}
    </div>
  )
}

export default function CampaignCard({
  campaign: c,
  instance,
  busy,
  onStart,
  onPause,
  onCancel,
  onRefresh,
  onDelete,
}: {
  campaign: CampaignRecord
  instance?: ZapiInstancePublic | null
  busy: boolean
  onStart: () => void
  onPause: () => void
  onCancel: () => void
  onRefresh: () => void
  onDelete: () => void
}) {
  const pct = campaignProgress(c)
  const canStart = ['draft', 'scheduled', 'paused'].includes(c.status)
  const canPause = ['running', 'scheduled'].includes(c.status)
  const canCancel = ['draft', 'scheduled', 'running', 'paused'].includes(c.status)
  const canDelete = ['draft', 'completed', 'cancelled', 'failed', 'paused'].includes(c.status)

  return (
    <div className="card" style={{ padding: '1.1rem 1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <Link href={`/disparo-whatsapp/${c.id}`} style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--brs-gray-900)', textDecoration: 'none' }}>{c.name}</Link>
          <span className={`badge ${statusBadgeClass(c.status)}`}>
            {c.status === 'running' && <Loader2 size={11} className="spinner" />}
            {c.status === 'scheduled' && <Clock size={11} />}
            {c.status === 'completed' && <CheckCircle2 size={11} />}
            {CAMPAIGN_STATUS_LABELS[c.status]}
          </span>
          <span className="badge badge-gray">{SOURCE_TYPE_LABELS[c.source_type]}</span>
          {instance && <span className="badge badge-gray">{instance.name}</span>}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-500)', textAlign: 'right' }}>
          <div>{new Date(c.created_at).toLocaleDateString('pt-BR')}</div>
          {c.status === 'scheduled' && c.next_run_at && <div>Início: {new Date(c.next_run_at).toLocaleString('pt-BR', { timeZone: c.timezone })}</div>}
          {c.status === 'running' && c.next_run_at && new Date(c.next_run_at).getTime() > Date.now() + 60_000 && (
            <div>Aguardando janela: {new Date(c.next_run_at).toLocaleString('pt-BR', { timeZone: c.timezone })}</div>
          )}
        </div>
      </div>

      {c.last_error && (c.status === 'paused' || c.status === 'failed') && (
        <div style={{ marginTop: 6, fontSize: '0.75rem', color: '#b45309' }}>⚠ {c.last_error}</div>
      )}

      <div style={{ margin: '0.75rem 0 0.6rem', position: 'relative', height: 10, background: 'var(--brs-gray-100)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: 'linear-gradient(90deg,#22c55e,#16a34a)', transition: 'width .4s' }} />
        <div style={{ position: 'absolute', inset: 0, textAlign: 'center', fontSize: '0.6rem', lineHeight: '10px', color: pct > 55 ? '#fff' : 'var(--brs-gray-700)', fontWeight: 700 }}>{pct}%</div>
      </div>

      <CounterTiles c={c} />

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
        {canStart && (
          <button type="button" className="btn btn-success" disabled={busy} onClick={onStart} style={{ flex: 1, minWidth: 160 }}>
            {busy ? <Loader2 size={16} className="spinner" /> : <Play size={16} />} {c.status === 'paused' ? 'Retomar' : c.status === 'scheduled' ? 'Iniciar agora' : 'Iniciar agora'}
          </button>
        )}
        {canPause && (
          <button type="button" className="btn btn-outline" disabled={busy} onClick={onPause}><Pause size={16} /> Pausar</button>
        )}
        <Link href={`/disparo-whatsapp/${c.id}`} className="btn btn-outline" title="Detalhes"><List size={16} /></Link>
        <button type="button" className="btn btn-outline" disabled={busy} onClick={onRefresh} title="Atualizar"><RefreshCw size={16} /></button>
        {canCancel && (
          <button type="button" className="btn btn-outline" disabled={busy} onClick={onCancel} title="Cancelar" style={{ color: '#b91c1c' }}><Square size={16} /></button>
        )}
        {canDelete && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onDelete} title="Excluir" style={{ color: '#b91c1c' }}><Trash2 size={16} /></button>
        )}
      </div>
    </div>
  )
}
