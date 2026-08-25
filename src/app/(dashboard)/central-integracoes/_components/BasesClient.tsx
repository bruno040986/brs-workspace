'use client'

/**
 * Upload de base higienizada (motor de crédito Vende.AI) e histórico.
 *
 * O arquivo é parseado no Workspace (/api/central/upload) e repassado em
 * chunks ao orquestrador, que aplica as regras de elegibilidade (as mesmas do
 * import CLI) e sobe/atualiza os contatos no WeSales com a tag da base.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle, FileUp, Loader2, RefreshCw } from 'lucide-react'
import { listCentralJobs } from '../actions'
import { JOB_STATUS_LABEL, type CentralJob } from '../types'

function fmt(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function BasesClient({ slug, initialJobs, jobsError }: {
  slug: string
  initialJobs: CentralJob[]
  jobsError: string | null
}) {
  const [jobs, setJobs] = useState(initialJobs)
  const [error, setError] = useState<string | null>(jobsError)
  const [success, setSuccess] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setBusy(true)
    const res = await listCentralJobs(slug)
    if (res.ok) setJobs(res.data.jobs.filter((j) => j.action === 'credit_base_import'))
    else setError(res.error)
    setBusy(false)
  }, [slug])

  const hasActive = jobs.some((j) => ['loading', 'queued', 'materializing', 'running'].includes(j.status))
  useEffect(() => {
    if (!hasActive) return
    const timer = setInterval(refresh, 10_000)
    return () => clearInterval(timer)
  }, [hasActive, refresh])

  const upload = useCallback(async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) { setError('Escolha um arquivo CSV ou XLSX.'); return }
    if (!label.trim()) { setError('Dê um nome para a base (vira a tag no WeSales).'); return }
    setUploading(true)
    setError(null)
    setSuccess(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('label', label.trim())
      formData.append('orchestrator', slug)
      const res = await fetch('/api/central/upload', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok) {
        setError(String(json.error ?? 'Falha no upload.'))
      } else {
        setSuccess(`Base enviada: ${json.total} linha(s). Tag no WeSales: ${json.baseTag}. O processamento começou.`)
        setLabel('')
        if (fileRef.current) fileRef.current.value = ''
        await refresh()
      }
    } catch {
      setError('Falha de rede no upload.')
    }
    setUploading(false)
  }, [label, slug, refresh])

  return (
    <div>
      {error ? (
        <div style={{ padding: '0.75rem 1rem', borderRadius: 10, background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA', marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.875rem' }}>
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}
      {success ? (
        <div style={{ padding: '0.75rem 1rem', borderRadius: 10, background: '#ECFDF5', color: '#065F46', border: '1px solid #A7F3D0', marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.875rem' }}>
          <CheckCircle size={16} /> {success}
        </div>
      ) : null}

      <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
        <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)', marginBottom: '0.75rem' }}>Enviar nova base</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 320px) minmax(260px, 380px) auto', gap: '1rem', alignItems: 'end' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Nome da base<span className="required">*</span></label>
            <input className="form-control" placeholder="ex.: motor-agosto-2" value={label} onChange={(e) => setLabel(e.target.value)} />
            <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', marginTop: 4 }}>Vira a tag <code>base-{label ? label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || '…'}</code> no WeSales</div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Arquivo (CSV ou XLSX)<span className="required">*</span></label>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.txt" className="form-control" style={{ padding: '0.45rem 0.75rem' }} />
            <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', marginTop: 4 }}>Export do motor de crédito da Vende.AI, com cabeçalho</div>
          </div>
          <button className="btn btn-primary" disabled={uploading} onClick={upload} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: '1.25rem' }}>
            {uploading ? <Loader2 size={15} className="spinner" /> : <FileUp size={15} />} Enviar base
          </button>
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-400)', marginTop: '0.6rem' }}>
          Formato: o export do motor de crédito da Vende.AI (colunas CPF, Nome, Telefone, Data de
          nascimento e as colunas por banco “— base offline” / “— simulação”). Só a coluna CPF é obrigatória.
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.6rem' }}>
        <button className="btn btn-outline" onClick={refresh} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {busy ? <Loader2 size={15} className="spinner" /> : <RefreshCw size={15} />} Atualizar
        </button>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Base</th>
                <th>Tag</th>
                <th>Status</th>
                <th>Progresso</th>
                <th>OK / Erro / Pulados</th>
                <th>Enviada</th>
                <th>Por</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const st = JOB_STATUS_LABEL[job.status] ?? { label: job.status, badge: 'badge-gray' }
                const pct = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0
                const tag = String((job.params as { baseTag?: string } | null)?.baseTag ?? '—')
                return (
                  <tr key={job.id}>
                    <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }}>{job.label ?? job.id.slice(0, 8)}</td>
                    <td><span className="badge badge-gold">{tag}</span></td>
                    <td>
                      <span className={`badge ${st.badge}`}>{st.label}</span>
                      {job.note ? <div style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)', marginTop: 2 }}>{job.note}</div> : null}
                    </td>
                    <td style={{ minWidth: 140 }}>
                      <div style={{ fontSize: '0.8rem' }}>{job.processed}/{job.total} ({pct}%)</div>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--brs-gray-100)', marginTop: 3 }}>
                        <div style={{ height: 6, borderRadius: 3, width: `${pct}%`, background: job.status === 'error' ? '#dc2626' : 'var(--brs-navy)' }} />
                      </div>
                    </td>
                    <td style={{ fontSize: '0.82rem' }}>
                      <span style={{ color: '#16a34a' }}>{job.succeeded}</span> / <span style={{ color: '#dc2626' }}>{job.failed}</span> / <span style={{ color: 'var(--brs-gray-400)' }}>{job.skipped}</span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{fmt(job.created_at)}</td>
                    <td style={{ fontSize: '0.8rem', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.created_by ?? '—'}</td>
                  </tr>
                )
              })}
              {jobs.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--brs-gray-400)', padding: '2rem' }}>Nenhuma base enviada ainda.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
