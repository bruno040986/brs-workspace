'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Building2, CheckCircle, Edit2, Loader2, Plus, Search, Table2, X } from 'lucide-react'
import { PRODUTOS_CREDITO, produtoLabel } from '@/lib/cadastros-credito'
import { getCreditLookups, getTabelasCredito, saveTabelaCredito, setTabelaCreditoStatus } from '../actions'

type TabelaItem = {
  id: string
  institution_id: string
  produto: string
  nome: string
  codigo: string | null
  com_seguro: boolean
  prazos: number[]
  is_active: boolean
  financial_institutions?: { id: string; name: string; logo_url?: string | null } | null
}

type Instituicao = { id: string; name: string; is_active: boolean }

type EditingTabela = {
  id?: string
  institution_id: string
  produto: string
  nome: string
  codigo: string
  com_seguro: boolean
  prazosTexto: string
}

type FeedbackMessage = { type: 'success' | 'error'; text: string }

function parsePrazosTexto(texto: string): number[] {
  return texto
    .split(/[,;\s]+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0)
}

export default function TabelasCreditoPage() {
  const [items, setItems] = useState<TabelaItem[]>([])
  const [instituicoes, setInstituicoes] = useState<Instituicao[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [produtoFilter, setProdutoFilter] = useState('all')
  const [instituicaoFilter, setInstituicaoFilter] = useState('all')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<EditingTabela | null>(null)
  const [saving, setSaving] = useState(false)

  async function loadData() {
    setLoading(true)
    try {
      const [tabelasRes, lookupsRes] = await Promise.all([getTabelasCredito(), getCreditLookups()])
      if (tabelasRes.success) setItems((tabelasRes.items || []) as unknown as TabelaItem[])
      else setMessage({ type: 'error', text: tabelasRes.error || 'Erro ao carregar as tabelas.' })
      if (lookupsRes.success) setInstituicoes((lookupsRes.instituicoes || []) as Instituicao[])
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar as tabelas.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return items.filter((item) => {
      const matchesSearch =
        !query ||
        String(item.nome || '').toLowerCase().includes(query) ||
        String(item.codigo || '').toLowerCase().includes(query) ||
        String(item.financial_institutions?.name || '').toLowerCase().includes(query)
      const matchesProduto = produtoFilter === 'all' || item.produto === produtoFilter
      const matchesInstituicao = instituicaoFilter === 'all' || item.institution_id === instituicaoFilter
      return matchesSearch && matchesProduto && matchesInstituicao
    })
  }, [items, searchQuery, produtoFilter, instituicaoFilter])

  function openNew() {
    setEditing({
      institution_id: '',
      produto: 'novo',
      nome: '',
      codigo: '',
      com_seguro: false,
      prazosTexto: '',
    })
    setIsModalOpen(true)
  }

  function openEdit(item: TabelaItem) {
    setEditing({
      id: item.id,
      institution_id: item.institution_id,
      produto: item.produto,
      nome: item.nome,
      codigo: item.codigo || '',
      com_seguro: item.com_seguro,
      prazosTexto: (item.prazos || []).join(', '),
    })
    setIsModalOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await saveTabelaCredito({
        id: editing.id,
        institution_id: editing.institution_id,
        produto: editing.produto,
        nome: editing.nome,
        codigo: editing.codigo,
        com_seguro: editing.com_seguro,
        prazos: parsePrazosTexto(editing.prazosTexto),
      })
      if (res.success) {
        setIsModalOpen(false)
        setEditing(null)
        setMessage({ type: 'success', text: editing.id ? 'Tabela atualizada.' : 'Tabela criada.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar a tabela.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao salvar a tabela.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(item: TabelaItem) {
    setBusyId(item.id)
    setMessage(null)
    try {
      const nextActive = !item.is_active
      const res = await setTabelaCreditoStatus(item.id, nextActive)
      if (res.success) {
        setMessage({ type: 'success', text: nextActive ? 'Tabela reativada.' : 'Tabela inativada.' })
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
            <Table2 size={18} />
            Tabelas de Crédito
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Tabelas por instituição financeira e produto (Novo, Refin, Cartão RMC/RCC), com e sem seguro.
          </div>
        </div>

        <button type="button" className="btn btn-primary" onClick={openNew}>
          <Plus size={16} />
          Nova Tabela
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
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }}>
            <Search size={16} />
          </span>
          <input
            type="text"
            className="form-control"
            placeholder="Buscar por nome, código ou instituição..."
            style={{ paddingLeft: '2.25rem', width: '100%' }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select className="form-control" style={{ width: 220 }} value={instituicaoFilter} onChange={(e) => setInstituicaoFilter(e.target.value)}>
          <option value="all">Todas as instituições</option>
          {instituicoes.map((inst) => (
            <option key={inst.id} value={inst.id}>{inst.name}</option>
          ))}
        </select>
        <select className="form-control" style={{ width: 200 }} value={produtoFilter} onChange={(e) => setProdutoFilter(e.target.value)}>
          <option value="all">Todos os produtos</option>
          {PRODUTOS_CREDITO.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Instituição</th>
                <th>Produto</th>
                <th>Tabela</th>
                <th>Código</th>
                <th>Seguro</th>
                <th>Prazos</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '3rem' }}>
                    <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '3rem' }}>
                    <div className="empty-state">
                      <Table2 size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                      <h3>Nenhuma tabela encontrada</h3>
                      <p>Cadastre a primeira tabela de crédito de uma instituição parceira.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--brs-gray-200)', background: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                          {item.financial_institutions?.logo_url ? (
                            <img src={item.financial_institutions.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                          ) : (
                            <Building2 size={14} color="var(--brs-gray-400)" />
                          )}
                        </div>
                        <span style={{ fontWeight: 600 }}>{item.financial_institutions?.name || '-'}</span>
                      </div>
                    </td>
                    <td>{produtoLabel(item.produto)}</td>
                    <td>{item.nome}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{item.codigo || '-'}</td>
                    <td>
                      <span className={`badge ${item.com_seguro ? 'badge-success' : 'badge-gray'}`}>
                        {item.com_seguro ? 'Com seguro' : 'Sem seguro'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.85rem', maxWidth: 180 }}>{(item.prazos || []).join(', ') || '-'}</td>
                    <td>
                      <span className={`badge ${item.is_active ? 'badge-success' : 'badge-gray'}`}>
                        {item.is_active ? 'Ativa' : 'Inativa'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(item)}>
                          <Edit2 size={16} />
                          Editar
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm ${item.is_active ? 'btn-outline' : 'btn-primary'}`}
                          onClick={() => handleToggle(item)}
                          disabled={busyId === item.id}
                        >
                          {busyId === item.id ? <Loader2 size={16} className="spinner" /> : null}
                          {item.is_active ? 'Inativar' : 'Ativar'}
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
          <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSave}>
              <div className="modal-header">
                <h3 className="modal-title">{editing.id ? 'Editar Tabela' : 'Nova Tabela'}</h3>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label className="form-label">Instituição Financeira <span className="required">*</span></label>
                    <select
                      className="form-control"
                      required
                      value={editing.institution_id}
                      onChange={(e) => setEditing({ ...editing, institution_id: e.target.value })}
                    >
                      <option value="">Selecione...</option>
                      {instituicoes.filter((inst) => inst.is_active || inst.id === editing.institution_id).map((inst) => (
                        <option key={inst.id} value={inst.id}>{inst.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Produto <span className="required">*</span></label>
                    <select
                      className="form-control"
                      required
                      value={editing.produto}
                      onChange={(e) => setEditing({ ...editing, produto: e.target.value })}
                    >
                      {PRODUTOS_CREDITO.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-grid form-grid-2" style={{ marginTop: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Nome da Tabela <span className="required">*</span></label>
                    <input
                      type="text"
                      className="form-control"
                      required
                      placeholder="Ex.: Tabela Ouro 96x"
                      value={editing.nome}
                      onChange={(e) => setEditing({ ...editing, nome: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Código</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Código da tabela no banco"
                      value={editing.codigo}
                      onChange={(e) => setEditing({ ...editing, codigo: e.target.value })}
                    />
                  </div>
                </div>
                <div className="form-grid form-grid-2" style={{ marginTop: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Prazos aceitos</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Ex.: 12, 24, 36, 48, 60, 72, 84, 96"
                      value={editing.prazosTexto}
                      onChange={(e) => setEditing({ ...editing, prazosTexto: e.target.value })}
                    />
                    <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-400)', marginTop: '0.25rem' }}>
                      Separe por vírgula. Usados como sugestão ao lançar coeficientes.
                    </div>
                  </div>
                  <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1.6rem' }}>
                    <input
                      id="com-seguro"
                      type="checkbox"
                      checked={editing.com_seguro}
                      onChange={(e) => setEditing({ ...editing, com_seguro: e.target.checked })}
                    />
                    <label htmlFor="com-seguro" className="form-label" style={{ margin: 0, cursor: 'pointer' }}>
                      Tabela com seguro
                    </label>
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
