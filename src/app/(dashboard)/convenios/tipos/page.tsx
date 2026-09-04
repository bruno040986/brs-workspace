'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, Edit2, Layers, Loader2, Plus, Power, PowerOff, Search, X } from 'lucide-react'
import { getTiposConvenio, salvarTipoConvenio, setTipoConvenioStatus, getEsferasAtivas, type TipoConvenio, type Esfera } from '../cadastros-actions'

type FeedbackMessage = { type: 'success' | 'error'; text: string }

export default function TiposConvenioPage() {
  const [items, setItems] = useState<TipoConvenio[]>([])
  const [esferas, setEsferas] = useState<Esfera[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<Partial<TipoConvenio> | null>(null)
  const [saving, setSaving] = useState(false)

  async function loadData() {
    setLoading(true)
    try {
      const res = await getTiposConvenio()
      if (res.success) setItems(res.items || [])
      else setMessage({ type: 'error', text: res.error || 'Erro ao carregar os tipos de convênio.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar os tipos de convênio.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    getEsferasAtivas().then(setEsferas).catch(() => setEsferas([]))
  }, [])

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return items.filter((item) => {
      return (
        !query ||
        String(item.nome || '').toLowerCase().includes(query) ||
        String(item.esfera_nome || '').toLowerCase().includes(query)
      )
    })
  }, [items, searchQuery])

  function openNew() {
    setEditing({ nome: '', esfera_id: '' })
    setIsModalOpen(true)
  }

  function openEdit(item: TipoConvenio) {
    setEditing({ id: item.id, nome: item.nome, esfera_id: item.esfera_id })
    setIsModalOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editing?.nome?.trim()) return
    if (!editing?.esfera_id) {
      setMessage({ type: 'error', text: 'Selecione a esfera.' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const res = await salvarTipoConvenio({ id: editing.id, nome: String(editing.nome || ''), esfera_id: String(editing.esfera_id || '') })
      if (res.success) {
        setIsModalOpen(false)
        setEditing(null)
        setMessage({ type: 'success', text: editing.id ? 'Tipo atualizado.' : 'Tipo criado.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar o tipo de convênio.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao salvar o tipo de convênio.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(item: TipoConvenio) {
    setBusyId(item.id)
    setMessage(null)
    try {
      const nextActive = !item.is_active
      const res = await setTipoConvenioStatus(item.id, nextActive)
      if (res.success) {
        setMessage({ type: 'success', text: nextActive ? 'Tipo reativado.' : 'Tipo inativado.' })
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
            <Layers size={18} />
            Tipos de Convênio
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Cada tipo pertence a uma Esfera (obrigatória). O convênio escolhe um tipo e herda a esfera.
          </div>
        </div>

        <button type="button" className="btn btn-primary" onClick={openNew}>
          <Plus size={16} />
          Novo Tipo
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
            placeholder="Buscar por nome ou esfera..."
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
                <th>Nome</th>
                <th>Esfera</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '3rem' }}>
                    <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '3rem' }}>
                    <div className="empty-state">
                      <Layers size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                      <h3>Nenhum tipo de convênio encontrado</h3>
                      <p>Cadastre o primeiro tipo de convênio, vinculado a uma esfera.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.nome}</td>
                    <td>{item.esfera_nome || '-'}</td>
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

      {isModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSave}>
              <div className="modal-header">
                <h3 className="modal-title">{editing?.id ? 'Editar Tipo' : 'Novo Tipo'}</h3>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Nome <span className="required">*</span></label>
                  <input
                    type="text"
                    className="form-control"
                    required
                    placeholder="Ex.: Prefeitura, Câmara, Autarquia…"
                    value={editing?.nome || ''}
                    onChange={(e) => setEditing({ ...editing, nome: e.target.value })}
                  />
                </div>
                <div className="form-group" style={{ marginTop: '1rem' }}>
                  <label className="form-label">Esfera <span className="required">*</span></label>
                  <select
                    className="form-control"
                    required
                    value={editing?.esfera_id || ''}
                    onChange={(e) => setEditing({ ...editing, esfera_id: e.target.value })}
                  >
                    <option value="">Selecione…</option>
                    {esferas.map((esf) => (
                      <option key={esf.id} value={esf.id}>{esf.nome}</option>
                    ))}
                  </select>
                  {esferas.length === 0 && (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>
                      Cadastre uma Esfera primeiro em <strong>Convênios › Esferas</strong>.
                    </div>
                  )}
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
