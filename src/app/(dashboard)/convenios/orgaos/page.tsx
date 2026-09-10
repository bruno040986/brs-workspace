'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AlertCircle, Briefcase, CheckCircle, Edit2, Loader2, Plus, Power, PowerOff, Search, X } from 'lucide-react'
import { maskCnpj, onlyDigits } from '@/lib/company-bank-accounts'
import { normalizeCnpjWsCompleto } from '@/lib/cnpj-consulta'
import { getOrgaos, salvarOrgao, setOrgaoStatus, type OrgaoEmpregador } from '../cadastros-actions'
import { getConvenios } from '../actions'

type EditingOrgao = {
  id?: string
  convenio_id: string
  nome: string
  cnpj: string
  observacao: string
}

type FeedbackMessage = { type: 'success' | 'error'; text: string }
type ConvenioOption = { id: string; nome: string }

function OrgaosEmpregadoresContent() {
  const searchParams = useSearchParams()
  const convenioIdParam = searchParams?.get('convenio') || ''

  const [items, setItems] = useState<OrgaoEmpregador[]>([])
  const [convenios, setConvenios] = useState<ConvenioOption[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [convenioFilter, setConvenioFilter] = useState(convenioIdParam)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<EditingOrgao | null>(null)
  const [saving, setSaving] = useState(false)
  const [consultandoCnpj, setConsultandoCnpj] = useState(false)

  async function loadData() {
    setLoading(true)
    try {
      const res = await getOrgaos()
      if (res.success) setItems(res.items || [])
      else setMessage({ type: 'error', text: res.error || 'Erro ao carregar os órgãos.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar os órgãos.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    getConvenios().then((res) => {
      if (res.success) setConvenios((res.items || []).map((c: any) => ({ id: c.id, nome: c.nome })))
    })
  }, [])

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return items.filter((item) => {
      const matchesSearch =
        !query ||
        String(item.nome || '').toLowerCase().includes(query) ||
        onlyDigits(item.cnpj || '').includes(onlyDigits(query))
      const matchesConvenio = !convenioFilter || item.convenio_id === convenioFilter
      return matchesSearch && matchesConvenio
    })
  }, [items, searchQuery, convenioFilter])

  function openNew() {
    setEditing({ convenio_id: convenioFilter || '', nome: '', cnpj: '', observacao: '' })
    setIsModalOpen(true)
  }

  function openEdit(item: OrgaoEmpregador) {
    setEditing({
      id: item.id,
      convenio_id: item.convenio_id,
      nome: item.nome,
      cnpj: item.cnpj || '',
      observacao: item.observacao || '',
    })
    setIsModalOpen(true)
  }

  async function fillByCnpj() {
    if (!editing) return
    const cnpj = onlyDigits(editing.cnpj || '')
    if (cnpj.length !== 14) {
      setMessage({ type: 'error', text: 'Informe um CNPJ válido para consulta.' })
      return
    }
    setConsultandoCnpj(true)
    try {
      const res = await fetch(`/api/cnpjws/cnpj/${cnpj}`, { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.razao_social) throw new Error(data?.error || data?.message || 'CNPJ não encontrado.')
      const rica = normalizeCnpjWsCompleto(data)
      setEditing((prev) =>
        prev ? { ...prev, cnpj, nome: prev.nome.trim() || rica.razao_social || prev.nome } : prev,
      )
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Falha ao consultar o CNPJ.' })
    } finally {
      setConsultandoCnpj(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editing?.nome.trim()) {
      setMessage({ type: 'error', text: 'Informe o nome do órgão.' })
      return
    }
    if (!editing.convenio_id) {
      setMessage({ type: 'error', text: 'Selecione o convênio-pai.' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const res = await salvarOrgao(editing)
      if (res.success) {
        setIsModalOpen(false)
        setEditing(null)
        setMessage({ type: 'success', text: editing.id ? 'Órgão atualizado.' : 'Órgão criado.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar o órgão.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao salvar o órgão.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(item: OrgaoEmpregador) {
    setBusyId(item.id)
    setMessage(null)
    try {
      const nextActive = !item.is_active
      const res = await setOrgaoStatus(item.id, nextActive)
      if (res.success) {
        setMessage({ type: 'success', text: nextActive ? 'Órgão reativado.' : 'Órgão inativado.' })
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
            <Briefcase size={18} />
            Órgãos / Empregadores
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            "Sub-convênios" de exceção (ex.: Embrapa dentro do SIAPE) — cadastre só o que aparece numa restrição de instituição financeira.
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={openNew}>
          <Plus size={16} />
          Novo Órgão
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
            placeholder="Buscar por nome ou CNPJ..."
            style={{ paddingLeft: '2.25rem', width: '100%' }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select className="form-control" style={{ width: '260px' }} value={convenioFilter} onChange={(e) => setConvenioFilter(e.target.value)}>
          <option value="">Todos os convênios</option>
          {convenios.map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </select>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Convênio-Pai</th>
                <th>CNPJ</th>
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
                      <Briefcase size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                      <h3>Nenhum órgão cadastrado</h3>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.nome}</td>
                    <td>{item.convenio_nome || '-'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{item.cnpj ? maskCnpj(item.cnpj) : '-'}</td>
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
                <h3 className="modal-title">{editing?.id ? 'Editar Órgão' : 'Novo Órgão'}</h3>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Convênio-Pai <span className="required">*</span></label>
                  <select
                    className="form-control"
                    required
                    disabled={!!editing?.id}
                    value={editing?.convenio_id || ''}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, convenio_id: e.target.value } : prev))}
                  >
                    <option value="">Selecione…</option>
                    {convenios.map((c) => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label className="form-label">Nome do Órgão <span className="required">*</span></label>
                  <input
                    type="text"
                    className="form-control"
                    required
                    placeholder="Ex.: Embrapa, Fundação Nacional do Índio..."
                    value={editing?.nome || ''}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, nome: e.target.value } : prev))}
                  />
                </div>
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label className="form-label">CNPJ (opcional)</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="00.000.000/0000-00"
                      value={maskCnpj(editing?.cnpj || '')}
                      onChange={(e) => setEditing((prev) => (prev ? { ...prev, cnpj: onlyDigits(e.target.value) } : prev))}
                      style={{ flex: 1 }}
                    />
                    <button type="button" className="btn btn-outline btn-sm" onClick={fillByCnpj} disabled={consultandoCnpj}>
                      {consultandoCnpj ? <Loader2 size={15} className="spinner" /> : 'Buscar'}
                    </button>
                  </div>
                </div>
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label className="form-label">Observação</label>
                  <textarea
                    className="form-control"
                    rows={2}
                    value={editing?.observacao || ''}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, observacao: e.target.value } : prev))}
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

export default function OrgaosEmpregadoresPage() {
  return (
    <Suspense fallback={<div className="page-content"><div className="card" style={{ padding: '3rem', textAlign: 'center' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></div></div>}>
      <OrgaosEmpregadoresContent />
    </Suspense>
  )
}
