'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Edit2, FileText, Loader2, Plus, X } from 'lucide-react'
import { ORIGENS_MARGEM, origemMargemLabel } from '@/lib/comissionamento'
import { getComissionamentoLookups, saveFormaContrato, setFormaContratoAtiva } from '../actions'

type FormaContrato = { id: string; nome: string; codigo_arw: string | null; origem_margem: string; is_active: boolean }
type FeedbackMessage = { type: 'success' | 'error'; text: string }

export default function FormasContratoPage() {
  const [items, setItems] = useState<FormaContrato[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<Partial<FormaContrato> | null>(null)
  const [saving, setSaving] = useState(false)

  async function loadData() {
    setLoading(true)
    try {
      const res = await getComissionamentoLookups()
      if (res.success) setItems((res.formasContrato || []) as FormaContrato[])
      else setMessage({ type: 'error', text: res.error || 'Erro ao carregar formas de contrato.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar formas de contrato.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  function openNew() {
    setEditing({ nome: '', codigo_arw: '', origem_margem: 'nenhuma' })
    setIsModalOpen(true)
  }

  function openEdit(item: FormaContrato) {
    setEditing({ id: item.id, nome: item.nome, codigo_arw: item.codigo_arw || '', origem_margem: item.origem_margem })
    setIsModalOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editing?.nome?.trim()) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await saveFormaContrato({
        id: editing.id,
        nome: String(editing.nome || ''),
        codigo_arw: String(editing.codigo_arw || ''),
        origem_margem: String(editing.origem_margem || 'nenhuma'),
      })
      if (res.success) {
        setIsModalOpen(false)
        setEditing(null)
        setMessage({ type: 'success', text: editing.id ? 'Forma de contrato atualizada.' : 'Forma de contrato criada.' })
        await loadData()
      } else setMessage({ type: 'error', text: res.error || 'Erro ao salvar forma de contrato.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao salvar forma de contrato.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(item: FormaContrato) {
    setBusyId(item.id)
    setMessage(null)
    try {
      const nextActive = !item.is_active
      const res = await setFormaContratoAtiva(item.id, nextActive)
      if (res.success) {
        setMessage({ type: 'success', text: nextActive ? 'Forma de contrato reativada.' : 'Forma de contrato inativada.' })
        await loadData()
      } else setMessage({ type: 'error', text: res.error || 'Erro ao alterar status.' })
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
            <FileText size={18} />
            Formas de Contrato
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>Cadastro de formas de contrato do espelho ARW.</div>
        </div>
        <button type="button" className="btn btn-primary" onClick={openNew}>
          <Plus size={16} />
          Nova Forma
        </button>
      </div>

      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10, border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`, background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2', color: message.type === 'success' ? '#065F46' : '#991B1B', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Código ARW</th>
                <th>Origem da Margem</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '3rem' }}><div className="empty-state"><FileText size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} /><h3>Nenhuma forma encontrada</h3><p>Cadastre a primeira forma de contrato.</p></div></td></tr>
              ) : items.map((item) => (
                <tr key={item.id}>
                  <td style={{ fontWeight: 600 }}>{item.nome}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{item.codigo_arw || '-'}</td>
                  <td>{origemMargemLabel(item.origem_margem)}</td>
                  <td><span className={`badge ${item.is_active ? 'badge-success' : 'badge-gray'}`}>{item.is_active ? 'Ativo' : 'Inativo'}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(item)}><Edit2 size={16} />Editar</button>
                      <button type="button" className={`btn btn-sm ${item.is_active ? 'btn-outline' : 'btn-primary'}`} onClick={() => handleToggle(item)} disabled={busyId === item.id}>
                        {busyId === item.id ? <Loader2 size={16} className="spinner" /> : null}
                        {item.is_active ? 'Inativar' : 'Ativar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSave}>
              <div className="modal-header">
                <h3 className="modal-title">{editing?.id ? 'Editar Forma de Contrato' : 'Nova Forma de Contrato'}</h3>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}><X size={20} /></button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Nome <span className="required">*</span></label>
                  <input type="text" className="form-control" required value={editing?.nome || ''} onChange={(e) => setEditing({ ...editing, nome: e.target.value })} />
                </div>
                <div className="form-grid form-grid-2" style={{ marginTop: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Código ARW</label>
                    <input type="text" className="form-control" value={editing?.codigo_arw || ''} onChange={(e) => setEditing({ ...editing, codigo_arw: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Origem da Margem</label>
                    <select className="form-control" value={editing?.origem_margem || 'nenhuma'} onChange={(e) => setEditing({ ...editing, origem_margem: e.target.value })}>
                      {ORIGENS_MARGEM.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <Loader2 size={16} className="spinner" /> : null}Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
