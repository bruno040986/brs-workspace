'use client'

/**
 * Cadastros › Operadoras de Telefonia — nome + logotipo quadrado 500×500
 * (data URL, mesmo padrão das averbadoras). O CRM AlvoConsig mostra o
 * logotipo no card de cada instância de WhatsApp (plano v3 §3, 13/09/2026).
 */
import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, Edit2, Loader2, Plus, Power, PowerOff, RadioTower, Search, X } from 'lucide-react'
import { EditableFilePreview } from '@/app/(dashboard)/promotoras/_components/PromotoraEditor'
import { getOperadoras, salvarOperadora, setOperadoraStatus, type OperadoraTelefonia } from './actions'

type Editing = { id?: string; nome: string; logo_url: string }
type FeedbackMessage = { type: 'success' | 'error'; text: string }

export default function OperadorasTelefoniaPage() {
  const [items, setItems] = useState<OperadoraTelefonia[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [saving, setSaving] = useState(false)

  // Sem setLoading(true) aqui: o estado já nasce true e a chamada roda
  // síncrona dentro do efeito de montagem (lint react-hooks/set-state-in-effect).
  async function loadData() {
    try {
      const res = await getOperadoras()
      if (res.success) setItems(res.items || [])
      else setMessage({ type: 'error', text: res.error || 'Erro ao carregar as operadoras.' })
    } catch (error) {
      setMessage({ type: 'error', text: (error instanceof Error && error.message) || 'Erro ao carregar as operadoras.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Carga inicial fora do corpo síncrono do efeito (react-hooks/set-state-in-effect).
    void Promise.resolve().then(loadData)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só no mount
  }, [])

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return items.filter((item) => !query || String(item.nome || '').toLowerCase().includes(query))
  }, [items, searchQuery])

  function openNew() {
    setEditing({ nome: '', logo_url: '' })
    setIsModalOpen(true)
  }

  function openEdit(item: OperadoraTelefonia) {
    setEditing({ id: item.id, nome: item.nome || '', logo_url: item.logo_url || '' })
    setIsModalOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.nome.trim()) {
      setMessage({ type: 'error', text: 'Informe o nome da operadora.' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const res = await salvarOperadora({ id: editing.id, nome: editing.nome, logo_url: editing.logo_url || null })
      if (res.success) {
        setIsModalOpen(false)
        setEditing(null)
        setMessage({ type: 'success', text: editing.id ? 'Operadora atualizada.' : 'Operadora criada.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar a operadora.' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: (error instanceof Error && error.message) || 'Erro ao salvar a operadora.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(item: OperadoraTelefonia) {
    setBusyId(item.id)
    setMessage(null)
    try {
      const nextActive = !item.is_active
      const res = await setOperadoraStatus(item.id, nextActive)
      if (res.success) {
        setMessage({ type: 'success', text: nextActive ? 'Operadora reativada.' : 'Operadora inativada.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao alterar status.' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: (error instanceof Error && error.message) || 'Erro ao alterar status.' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <RadioTower size={18} />
            Operadoras de Telefonia
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Operadoras dos chips das instâncias de WhatsApp — o logotipo aparece no card de cada número no CRM AlvoConsig.
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={openNew}>
          <Plus size={16} />
          Nova Operadora
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
          <input type="text" className="form-control" placeholder="Buscar por nome..." style={{ paddingLeft: '2.25rem', width: '100%' }} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th></th>
                <th>Operadora</th>
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
                      <RadioTower size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                      <h3>Nenhuma operadora encontrada</h3>
                      <p>Cadastre as operadoras dos chips (Vivo, Claro, TIM, Oi, virtuais…) para vincular às instâncias de WhatsApp.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div style={{ width: 32, height: 32, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--brs-gray-200)', background: '#fff', display: 'grid', placeItems: 'center' }}>
                        {item.logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- data URL, mesmo padrão das averbadoras
                          <img src={item.logo_url} alt={`Logotipo de ${item.nome}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <RadioTower size={16} style={{ color: 'var(--brs-gray-300)' }} />
                        )}
                      </div>
                    </td>
                    <td style={{ fontWeight: 600 }}>{item.nome}</td>
                    <td>
                      <span className={`badge ${item.is_active ? 'badge-success' : 'badge-gray'}`}>{item.is_active ? 'Ativo' : 'Inativo'}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-ghost btn-sm btn-acao" onClick={() => openEdit(item)} title="Editar" aria-label="Editar">
                          <Edit2 size={15} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-acao"
                          onClick={() => handleToggle(item)}
                          disabled={busyId === item.id}
                          title={item.is_active ? 'Inativar' : 'Reativar'}
                          aria-label={item.is_active ? 'Inativar' : 'Reativar'}
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
                <h3 className="modal-title">{editing.id ? 'Editar Operadora' : 'Nova Operadora'}</h3>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Nome *</label>
                  <input className="form-control" placeholder="Ex.: Vivo" value={editing.nome} onChange={(e) => setEditing((prev) => (prev ? { ...prev, nome: e.target.value } : prev))} autoFocus />
                </div>
                <div style={{ marginTop: '0.75rem' }}>
                  <EditableFilePreview label="Logotipo quadrado 500x500px" value={editing.logo_url} disabled={false} onChange={(next) => setEditing((prev) => (prev ? { ...prev, logo_url: next } : prev))} />
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
