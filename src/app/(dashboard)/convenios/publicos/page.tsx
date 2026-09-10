'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, Edit2, Loader2, Plus, Power, PowerOff, Search, Users, X } from 'lucide-react'
import {
  getPublicos,
  getPublicosSugestoes,
  salvarPublico,
  setPublicoStatus,
  type PublicoAtendido,
} from '../cadastros-actions'

type EditingPublico = {
  id?: string
  nome: string
  situacao_funcional: string
  regime_juridico: string
  tipo_provimento: string
  descricao: string
}

type FeedbackMessage = { type: 'success' | 'error'; text: string }

export default function PublicosAtendidosPage() {
  const [items, setItems] = useState<PublicoAtendido[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sugestoes, setSugestoes] = useState<{ situacoes: string[]; regimes: string[]; provimentos: string[] }>({
    situacoes: [],
    regimes: [],
    provimentos: [],
  })
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<EditingPublico | null>(null)
  const [saving, setSaving] = useState(false)

  async function loadData() {
    setLoading(true)
    try {
      const res = await getPublicos()
      if (res.success) setItems(res.items || [])
      else setMessage({ type: 'error', text: res.error || 'Erro ao carregar os públicos atendidos.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar os públicos atendidos.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    getPublicosSugestoes().then(setSugestoes).catch(() => {})
  }, [])

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return items
    return items.filter((item) =>
      String(item.nome || '').toLowerCase().includes(query) ||
      String(item.situacao_funcional || '').toLowerCase().includes(query) ||
      String(item.regime_juridico || '').toLowerCase().includes(query) ||
      String(item.tipo_provimento || '').toLowerCase().includes(query),
    )
  }, [items, searchQuery])

  function openNew() {
    setEditing({ nome: '', situacao_funcional: '', regime_juridico: '', tipo_provimento: '', descricao: '' })
    setIsModalOpen(true)
  }

  function openEdit(item: PublicoAtendido) {
    setEditing({
      id: item.id,
      nome: item.nome,
      situacao_funcional: item.situacao_funcional || '',
      regime_juridico: item.regime_juridico || '',
      tipo_provimento: item.tipo_provimento || '',
      descricao: item.descricao || '',
    })
    setIsModalOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editing?.nome.trim()) {
      setMessage({ type: 'error', text: 'Informe o nome do público.' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const res = await salvarPublico(editing)
      if (res.success) {
        setIsModalOpen(false)
        setEditing(null)
        setMessage({ type: 'success', text: editing.id ? 'Público atualizado.' : 'Público criado.' })
        await loadData()
        getPublicosSugestoes().then(setSugestoes).catch(() => {})
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar o público.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao salvar o público.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(item: PublicoAtendido) {
    setBusyId(item.id)
    setMessage(null)
    try {
      const nextActive = !item.is_active
      const res = await setPublicoStatus(item.id, nextActive)
      if (res.success) {
        setMessage({ type: 'success', text: nextActive ? 'Público reativado.' : 'Público inativado.' })
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
            <Users size={18} />
            Públicos Atendidos
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Categorias de pessoas elegíveis ao consignado (Aposentado, Efetivo, Pensionista...) — cadastro global, sem vínculo a esfera ou tipo de convênio.
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={openNew}>
          <Plus size={16} />
          Novo Público
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

      <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ position: 'relative', maxWidth: 360 }}>
          <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }}>
            <Search size={16} />
          </span>
          <input
            type="text"
            className="form-control"
            placeholder="Buscar..."
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
                <th>Situação Funcional</th>
                <th>Regime Jurídico</th>
                <th>Tipo de Provimento</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '3rem' }}>
                    <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '3rem' }}>
                    <div className="empty-state">
                      <Users size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                      <h3>Nenhum público cadastrado</h3>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.nome}</td>
                    <td>{item.situacao_funcional || '-'}</td>
                    <td>{item.regime_juridico || '-'}</td>
                    <td>{item.tipo_provimento || '-'}</td>
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
          <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSave}>
              <div className="modal-header">
                <h3 className="modal-title">{editing?.id ? 'Editar Público' : 'Novo Público'}</h3>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Nome do Público <span className="required">*</span></label>
                  <input
                    type="text"
                    className="form-control"
                    required
                    placeholder="Ex.: Aposentado, Efetivo, Comissionado..."
                    value={editing?.nome || ''}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, nome: e.target.value } : prev))}
                  />
                </div>
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label className="form-label">Situação Funcional / Status do Vínculo</label>
                  <input
                    type="text"
                    className="form-control"
                    list="situacoes-sugestoes"
                    placeholder="Momento atual da pessoa (ativo, aposentado...)"
                    value={editing?.situacao_funcional || ''}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, situacao_funcional: e.target.value } : prev))}
                  />
                  <datalist id="situacoes-sugestoes">
                    {sugestoes.situacoes.map((s) => <option key={s} value={s} />)}
                  </datalist>
                </div>
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label className="form-label">Regime Jurídico</label>
                  <input
                    type="text"
                    className="form-control"
                    list="regimes-sugestoes"
                    placeholder="Lei que rege o vínculo (estatutário, celetista...)"
                    value={editing?.regime_juridico || ''}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, regime_juridico: e.target.value } : prev))}
                  />
                  <datalist id="regimes-sugestoes">
                    {sugestoes.regimes.map((s) => <option key={s} value={s} />)}
                  </datalist>
                </div>
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label className="form-label">Tipo de Provimento / Forma de Ingresso</label>
                  <input
                    type="text"
                    className="form-control"
                    list="provimentos-sugestoes"
                    placeholder="Como entrou (concurso, nomeação, contrato...)"
                    value={editing?.tipo_provimento || ''}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, tipo_provimento: e.target.value } : prev))}
                  />
                  <datalist id="provimentos-sugestoes">
                    {sugestoes.provimentos.map((s) => <option key={s} value={s} />)}
                  </datalist>
                </div>
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label className="form-label">Descrição</label>
                  <textarea
                    className="form-control"
                    rows={2}
                    value={editing?.descricao || ''}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, descricao: e.target.value } : prev))}
                  />
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
