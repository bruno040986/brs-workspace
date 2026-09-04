'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, Edit2, Loader2, Plus, Power, PowerOff, Ruler, Search, X } from 'lucide-react'
import { listarFormatos, salvarFormato, setFormatoStatus, type Formato } from '@/lib/marketing/taxonomia-actions'

type FeedbackMessage = { type: 'success' | 'error'; text: string }
type FormatoDraft = { id?: string; rotulo: string; largura_px: string; altura_px: string }

export default function FormatosPage() {
  const [items, setItems] = useState<Formato[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<FormatoDraft | null>(null)
  const [saving, setSaving] = useState(false)

  async function loadData() {
    setLoading(true)
    try {
      const res = await listarFormatos()
      if (res.success) setItems(res.data || [])
      else setMessage({ type: 'error', text: res.error || 'Erro ao carregar os formatos.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar os formatos.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return items.filter((item) => !query || String(item.rotulo || '').toLowerCase().includes(query))
  }, [items, searchQuery])

  // Placeholder sugerido para o rótulo a partir das dimensões digitadas.
  const rotuloPlaceholder = useMemo(() => {
    const l = Math.round(Number(editing?.largura_px))
    const a = Math.round(Number(editing?.altura_px))
    return l > 0 && a > 0 ? `${l}x${a}px` : 'auto: 1080x1920px se vazio'
  }, [editing?.largura_px, editing?.altura_px])

  function openNew() {
    setEditing({ rotulo: '', largura_px: '', altura_px: '' })
    setIsModalOpen(true)
  }

  function openEdit(item: Formato) {
    setEditing({ id: item.id, rotulo: item.rotulo || '', largura_px: String(item.largura_px), altura_px: String(item.altura_px) })
    setIsModalOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    const largura = Math.round(Number(editing.largura_px))
    const altura = Math.round(Number(editing.altura_px))
    if (!largura || !altura || largura < 1 || altura < 1) {
      setMessage({ type: 'error', text: 'Informe largura e altura em pixels.' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const res = await salvarFormato({ id: editing.id, rotulo: String(editing.rotulo || ''), largura_px: largura, altura_px: altura })
      if (res.success) {
        setIsModalOpen(false)
        setEditing(null)
        setMessage({ type: 'success', text: editing.id ? 'Formato atualizado.' : 'Formato criado.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar o formato.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao salvar o formato.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(item: Formato) {
    setBusyId(item.id)
    setMessage(null)
    try {
      const nextActive = !item.is_active
      const res = await setFormatoStatus(item.id, nextActive)
      if (res.success) {
        setMessage({ type: 'success', text: nextActive ? 'Formato reativado.' : 'Formato inativado.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao alterar status.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao alterar status.' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Ruler size={18} />
            Formatos
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Dimensões das artes em pixels (ex.: 1080x1920px).
          </div>
        </div>

        <button type="button" className="btn btn-primary" onClick={openNew}>
          <Plus size={16} />
          Novo Formato
        </button>
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

      <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
          <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }}>
            <Search size={16} />
          </span>
          <input
            type="text"
            className="form-control"
            placeholder="Buscar por rótulo..."
            style={{ paddingLeft: '2.25rem', width: '100%' }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Rótulo</th>
                <th>Largura</th>
                <th>Altura</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '3rem' }}>
                    <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '3rem' }}>
                    <div className="empty-state">
                      <Ruler size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                      <h3>Nenhum formato encontrado</h3>
                      <p>Cadastre o primeiro formato (dimensões em pixels).</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.rotulo}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{item.largura_px}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{item.altura_px}</td>
                    <td>
                      <span className={`badge ${item.is_active ? 'badge-success' : 'badge-gray'}`}>
                        {item.is_active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-ghost btn-sm btn-acao" onClick={() => openEdit(item)} title="Editar" aria-label="Editar">
                          <Edit2 size={15} />
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm btn-acao ${item.is_active ? 'btn-outline' : 'btn-primary'}`}
                          onClick={() => handleToggle(item)}
                          disabled={busyId === item.id}
                          title={item.is_active ? 'Inativar' : 'Ativar'}
                          aria-label={item.is_active ? 'Inativar' : 'Ativar'}
                        >
                          {busyId === item.id ? <Loader2 size={15} className="spinner" /> : item.is_active ? <PowerOff size={15} /> : <Power size={15} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && editing && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSave}>
              <div className="modal-header">
                <h3 className="modal-title">{editing.id ? 'Editar Formato' : 'Novo Formato'}</h3>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Rótulo</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder={rotuloPlaceholder}
                    value={editing.rotulo}
                    onChange={(e) => setEditing({ ...editing, rotulo: e.target.value })}
                  />
                </div>
                <div className="form-grid form-grid-2" style={{ marginTop: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Largura (px) <span className="required">*</span></label>
                    <input
                      type="number"
                      className="form-control"
                      required
                      min={1}
                      placeholder="Ex.: 1080"
                      value={editing.largura_px}
                      onChange={(e) => setEditing({ ...editing, largura_px: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Altura (px) <span className="required">*</span></label>
                    <input
                      type="number"
                      className="form-control"
                      required
                      min={1}
                      placeholder="Ex.: 1920"
                      value={editing.altura_px}
                      onChange={(e) => setEditing({ ...editing, altura_px: e.target.value })}
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <Loader2 size={16} className="spinner" /> : null}
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
