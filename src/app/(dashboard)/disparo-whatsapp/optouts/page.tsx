'use client'

import { useCallback, useEffect, useState } from 'react'
import { Ban, Loader2, Plus, Trash2, Search, Download, X, AlertCircle } from 'lucide-react'
import { listOptouts, addOptouts, removeOptout, type OptoutRecord } from '../actions'
import { formatBrPhone } from '@/lib/zapi/phone'

const SOURCE_LABEL: Record<OptoutRecord['source'], string> = { button: 'Botão anti-ban', text: 'Resposta por texto', manual: 'Manual' }

export default function OptoutsPage() {
  const [items, setItems] = useState<OptoutRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listOptouts(q)
    if (res.success) setItems(res.items)
    else setError(res.error || 'Erro ao carregar.')
    setLoading(false)
  }, [q])

  useEffect(() => { load() }, [load])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const phones = text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
    const res = await addOptouts(phones, reason)
    if (res.success) { setAdding(false); setText(''); setReason(''); await load() }
    else setError(res.error || 'Falha ao adicionar.')
    setBusy(false)
  }

  async function handleRemove(item: OptoutRecord) {
    if (!window.confirm(`Remover ${formatBrPhone(item.phone)} da lista de opt-out? O número voltará a receber campanhas.`)) return
    setBusy(true)
    const res = await removeOptout(item.id)
    if (!res.success) setError(res.error || 'Falha ao remover.')
    await load()
    setBusy(false)
  }

  function exportCsv() {
    const rows = ['telefone;origem;motivo;data', ...items.map((i) => `${i.phone};${SOURCE_LABEL[i.source]};${(i.reason || '').replace(/;/g, ',')};${new Date(i.created_at).toLocaleString('pt-BR')}`)]
    const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'optouts-whatsapp.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--brs-gray-800)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Ban size={22} /> Opt-outs</h1>
          <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>Números que pediram para não receber. Campanhas pulam esses contatos automaticamente.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="btn btn-outline" onClick={exportCsv} disabled={!items.length}><Download size={16} /> Exportar CSV</button>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> Adicionar</button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
          <AlertCircle size={16} /> <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setError(null)}><X size={14} /></button>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--brs-gray-100)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
            <Search size={14} style={{ position: 'absolute', left: 8, top: 10, color: 'var(--brs-gray-400)' }} />
            <input className="form-control" style={{ paddingLeft: 28 }} placeholder="Buscar telefone" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>{items.length} número(s)</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead><tr><th>Telefone</th><th>Origem</th><th>Motivo</th><th>Data</th><th></th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ padding: '1.5rem' }}><Loader2 className="spinner" size={16} /> Carregando…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--brs-gray-500)', padding: '1.5rem' }}>Nenhum opt-out registrado.</td></tr>
              ) : items.map((i) => (
                <tr key={i.id}>
                  <td style={{ fontFamily: 'monospace' }}>{formatBrPhone(i.phone)}</td>
                  <td><span className="badge badge-gray">{SOURCE_LABEL[i.source]}</span></td>
                  <td style={{ fontSize: '0.8rem' }}>{i.reason || '—'}</td>
                  <td style={{ fontSize: '0.8rem' }}>{new Date(i.created_at).toLocaleString('pt-BR')}</td>
                  <td><button type="button" className="btn btn-ghost btn-sm" disabled={busy} style={{ color: '#b91c1c' }} onClick={() => handleRemove(i)}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {adding && (
        <div className="modal-backdrop" onClick={() => !busy && setAdding(false)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleAdd}>
              <div className="modal-header"><h3 className="modal-title">Adicionar opt-out</h3><button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}><X size={16} /></button></div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Telefones (um por linha, ou separados por vírgula)</label>
                  <textarea className="form-control" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={'(11) 99999-9999\n11988887777'} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Motivo (opcional)</label>
                  <input className="form-control" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: pediu por telefone" />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? <Loader2 size={16} className="spinner" /> : <Plus size={16} />} Adicionar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
