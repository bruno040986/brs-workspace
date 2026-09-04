'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, Link2, Loader2, Plus, Power, PowerOff, Trash2, X } from 'lucide-react'
import {
  listarAssociacoes,
  salvarAssociacao,
  setAssociacaoStatus,
  excluirAssociacao,
  getTaxonomiaLookups,
  type Associacao,
  type Grupo,
  type Categoria,
  type Formato,
} from '@/lib/marketing/taxonomia-actions'

type FeedbackMessage = { type: 'success' | 'error'; text: string }
type AssociacaoDraft = { grupo_id: string; categoria_id: string; formato_id: string }

export default function AssociacoesPage() {
  const [items, setItems] = useState<Associacao[]>([])
  const [grupos, setGrupos] = useState<Grupo[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [formatos, setFormatos] = useState<Formato[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [grupoFilter, setGrupoFilter] = useState('all')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<AssociacaoDraft | null>(null)
  const [saving, setSaving] = useState(false)

  async function loadData() {
    setLoading(true)
    try {
      const res = await listarAssociacoes()
      if (res.success) setItems(res.data || [])
      else setMessage({ type: 'error', text: res.error || 'Erro ao carregar as associações.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar as associações.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    getTaxonomiaLookups()
      .then((lk) => {
        setGrupos(lk.grupos || [])
        setCategorias(lk.categorias || [])
        setFormatos(lk.formatos || [])
      })
      .catch(() => {
        setGrupos([])
        setCategorias([])
        setFormatos([])
      })
  }, [])

  const gruposDisponiveis = useMemo(() => {
    return [...new Set(items.map((i) => i.grupo_nome || '').filter(Boolean))].sort()
  }, [items])

  const filteredItems = useMemo(() => {
    return items.filter((item) => grupoFilter === 'all' || (item.grupo_nome || '') === grupoFilter)
  }, [items, grupoFilter])

  function openNew() {
    setEditing({ grupo_id: '', categoria_id: '', formato_id: '' })
    setIsModalOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.grupo_id || !editing.categoria_id || !editing.formato_id) {
      setMessage({ type: 'error', text: 'Selecione grupo, categoria e formato.' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const res = await salvarAssociacao({ grupo_id: editing.grupo_id, categoria_id: editing.categoria_id, formato_id: editing.formato_id })
      if (res.success) {
        setIsModalOpen(false)
        setEditing(null)
        setMessage({ type: 'success', text: 'Associação criada.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar a associação.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao salvar a associação.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(item: Associacao) {
    setBusyId(item.id)
    setMessage(null)
    try {
      const nextActive = !item.is_active
      const res = await setAssociacaoStatus(item.id, nextActive)
      if (res.success) {
        setMessage({ type: 'success', text: nextActive ? 'Associação reativada.' : 'Associação inativada.' })
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

  async function handleDelete(item: Associacao) {
    if (!window.confirm(`Excluir a associação ${item.grupo_nome} · ${item.categoria_nome} · ${item.formato_rotulo}?`)) return
    setBusyId(item.id)
    setMessage(null)
    try {
      const res = await excluirAssociacao(item.id)
      if (res.success) {
        setMessage({ type: 'success', text: 'Associação excluída.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao excluir a associação.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao excluir a associação.' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Link2 size={18} />
            Associações
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Combinações válidas: escolher Grupo + Categoria restringe os Formatos possíveis na criação de artes.
          </div>
        </div>

        <button type="button" className="btn btn-primary" onClick={openNew}>
          <Plus size={16} />
          Nova Associação
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
        <select className="form-control" style={{ width: '220px' }} value={grupoFilter} onChange={(e) => setGrupoFilter(e.target.value)}>
          <option value="all">Todos os grupos</option>
          {gruposDisponiveis.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Grupo</th>
                <th>Categoria</th>
                <th>Formato</th>
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
                      <Link2 size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                      <h3>Nenhuma associação encontrada</h3>
                      <p>Combine grupo, categoria e formato para liberar essa opção na criação de artes.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.grupo_nome || '-'}</td>
                    <td>{item.categoria_nome || '-'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{item.formato_rotulo || '-'}</td>
                    <td>
                      <span className={`badge ${item.is_active ? 'badge-success' : 'badge-gray'}`}>
                        {item.is_active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-acao"
                          onClick={() => handleDelete(item)}
                          disabled={busyId === item.id}
                          title="Excluir"
                          aria-label="Excluir"
                        >
                          <Trash2 size={15} />
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
                <h3 className="modal-title">Nova Associação</h3>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Grupo <span className="required">*</span></label>
                  <select
                    className="form-control"
                    required
                    value={editing.grupo_id}
                    onChange={(e) => setEditing({ ...editing, grupo_id: e.target.value })}
                  >
                    <option value="">Selecione…</option>
                    {grupos.map((g) => (
                      <option key={g.id} value={g.id}>{g.nome}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ marginTop: '1rem' }}>
                  <label className="form-label">Categoria <span className="required">*</span></label>
                  <select
                    className="form-control"
                    required
                    value={editing.categoria_id}
                    onChange={(e) => setEditing({ ...editing, categoria_id: e.target.value })}
                  >
                    <option value="">Selecione…</option>
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ marginTop: '1rem' }}>
                  <label className="form-label">Formato <span className="required">*</span></label>
                  <select
                    className="form-control"
                    required
                    value={editing.formato_id}
                    onChange={(e) => setEditing({ ...editing, formato_id: e.target.value })}
                  >
                    <option value="">Selecione…</option>
                    {formatos.map((f) => (
                      <option key={f.id} value={f.id}>{f.rotulo}</option>
                    ))}
                  </select>
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
