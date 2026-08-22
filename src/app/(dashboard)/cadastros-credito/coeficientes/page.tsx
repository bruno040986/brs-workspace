'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CalendarOff, CheckCircle, Loader2, Percent, Plus, Trash2, X } from 'lucide-react'
import { produtoLabel } from '@/lib/cadastros-credito'
import { createCoeficientes, encerrarCoeficiente, excluirCoeficiente, getCoeficientes, getCreditLookups } from '../actions'

type CoeficienteItem = {
  id: string
  tabela_id: string
  convenio_id: string
  prazo: number
  coeficiente: number
  vigencia_inicio: string
  vigencia_fim: string | null
  tabelas_credito?: {
    id: string
    nome: string
    codigo: string | null
    produto: string
    com_seguro: boolean
    institution_id: string
    financial_institutions?: { id: string; name: string } | null
  } | null
  convenios?: { id: string; nome: string; codigo: string | null } | null
}

type Convenio = { id: string; nome: string; codigo: string | null; is_active: boolean }
type Tabela = {
  id: string
  institution_id: string
  produto: string
  nome: string
  com_seguro: boolean
  prazos: number[]
  is_active: boolean
}
type Instituicao = { id: string; name: string; is_active: boolean }

type LinhaNova = { prazo: string; coeficiente: string }

type FeedbackMessage = { type: 'success' | 'error'; text: string }

function hojeISO() {
  return new Date().toISOString().slice(0, 10)
}

function formatDateBR(value: string | null) {
  if (!value) return '-'
  const [y, m, d] = String(value).slice(0, 10).split('-')
  if (!y || !m || !d) return value
  return `${d}/${m}/${y}`
}

export default function CoeficientesPage() {
  const [items, setItems] = useState<CoeficienteItem[]>([])
  const [convenios, setConvenios] = useState<Convenio[]>([])
  const [tabelas, setTabelas] = useState<Tabela[]>([])
  const [instituicoes, setInstituicoes] = useState<Instituicao[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)

  const [convenioFilter, setConvenioFilter] = useState('all')
  const [tabelaFilter, setTabelaFilter] = useState('all')
  const [apenasVigentes, setApenasVigentes] = useState(true)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [novoTabelaId, setNovoTabelaId] = useState('')
  const [novoConvenioId, setNovoConvenioId] = useState('')
  const [novoInicio, setNovoInicio] = useState(hojeISO())
  const [linhas, setLinhas] = useState<LinhaNova[]>([{ prazo: '', coeficiente: '' }])

  async function loadData() {
    setLoading(true)
    try {
      const [coefRes, lookupsRes] = await Promise.all([
        getCoeficientes({
          convenioId: convenioFilter === 'all' ? undefined : convenioFilter,
          tabelaId: tabelaFilter === 'all' ? undefined : tabelaFilter,
          apenasVigentes,
        }),
        getCreditLookups(),
      ])
      if (coefRes.success) setItems((coefRes.items || []) as unknown as CoeficienteItem[])
      else setMessage({ type: 'error', text: coefRes.error || 'Erro ao carregar os coeficientes.' })
      if (lookupsRes.success) {
        setConvenios((lookupsRes.convenios || []) as Convenio[])
        setTabelas((lookupsRes.tabelas || []) as Tabela[])
        setInstituicoes((lookupsRes.instituicoes || []) as Instituicao[])
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar os coeficientes.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convenioFilter, tabelaFilter, apenasVigentes])

  const instituicaoNome = useMemo(() => {
    const map = new Map(instituicoes.map((inst) => [inst.id, inst.name]))
    return (id: string | undefined) => (id ? map.get(id) || '-' : '-')
  }, [instituicoes])

  function tabelaDescricao(tabela: Tabela) {
    const seguro = tabela.com_seguro ? 'c/ seguro' : 's/ seguro'
    return `${instituicaoNome(tabela.institution_id)} — ${tabela.nome} (${produtoLabel(tabela.produto)}, ${seguro})`
  }

  function openNew() {
    setNovoTabelaId('')
    setNovoConvenioId(convenioFilter !== 'all' ? convenioFilter : '')
    setNovoInicio(hojeISO())
    setLinhas([{ prazo: '', coeficiente: '' }])
    setIsModalOpen(true)
  }

  function preencherPrazosDaTabela(tabelaId: string) {
    setNovoTabelaId(tabelaId)
    const tabela = tabelas.find((item) => item.id === tabelaId)
    if (tabela && (tabela.prazos || []).length > 0) {
      setLinhas(tabela.prazos.map((prazo) => ({ prazo: String(prazo), coeficiente: '' })))
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const res = await createCoeficientes({
        tabela_id: novoTabelaId,
        convenio_id: novoConvenioId,
        vigencia_inicio: novoInicio,
        itens: linhas
          .filter((linha) => linha.prazo.trim() && linha.coeficiente.trim())
          .map((linha) => ({
            prazo: Number.parseInt(linha.prazo, 10),
            coeficiente: Number(String(linha.coeficiente).replace(',', '.')),
          })),
      })
      if (res.success) {
        setIsModalOpen(false)
        setMessage({ type: 'success', text: `${res.inseridos} coeficiente(s) lançado(s). Vigências anteriores encerradas automaticamente.` })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao lançar os coeficientes.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao lançar os coeficientes.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleEncerrar(item: CoeficienteItem) {
    setBusyId(item.id)
    setMessage(null)
    try {
      const res = await encerrarCoeficiente(item.id, hojeISO())
      if (res.success) {
        setMessage({ type: 'success', text: 'Vigência encerrada hoje.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao encerrar a vigência.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao encerrar a vigência.' })
    } finally {
      setBusyId(null)
    }
  }

  async function handleExcluir(item: CoeficienteItem) {
    if (!window.confirm('Excluir este coeficiente? Use apenas para corrigir lançamentos errados — para troca normal de coeficiente, lance um novo (a vigência anterior encerra sozinha).')) return
    setBusyId(item.id)
    setMessage(null)
    try {
      const res = await excluirCoeficiente(item.id)
      if (res.success) {
        setMessage({ type: 'success', text: 'Coeficiente excluído.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao excluir.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao excluir.' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Percent size={18} />
            Coeficientes
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Coeficientes por tabela × convênio × prazo, com vigência. Oferta = margem × coeficiente.
          </div>
        </div>

        <button type="button" className="btn btn-primary" onClick={openNew}>
          <Plus size={16} />
          Lançar Coeficientes
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
        <select className="form-control" style={{ width: 240 }} value={convenioFilter} onChange={(e) => setConvenioFilter(e.target.value)}>
          <option value="all">Todos os convênios</option>
          {convenios.map((conv) => (
            <option key={conv.id} value={conv.id}>{conv.nome}{conv.codigo ? ` (${conv.codigo})` : ''}</option>
          ))}
        </select>
        <select className="form-control" style={{ width: 320 }} value={tabelaFilter} onChange={(e) => setTabelaFilter(e.target.value)}>
          <option value="all">Todas as tabelas</option>
          {tabelas.map((tab) => (
            <option key={tab.id} value={tab.id}>{tabelaDescricao(tab)}</option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--brs-gray-600)', cursor: 'pointer' }}>
          <input type="checkbox" checked={apenasVigentes} onChange={(e) => setApenasVigentes(e.target.checked)} />
          Apenas vigentes
        </label>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Instituição / Tabela</th>
                <th>Convênio</th>
                <th>Prazo</th>
                <th>Coeficiente</th>
                <th>Vigência</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '3rem' }}>
                    <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '3rem' }}>
                    <div className="empty-state">
                      <Percent size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                      <h3>Nenhum coeficiente encontrado</h3>
                      <p>Lance os coeficientes de uma tabela para um convênio.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const vigente = !item.vigencia_fim || item.vigencia_fim >= hojeISO()
                  return (
                    <tr key={item.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{item.tabelas_credito?.financial_institutions?.name || '-'}</div>
                        <div style={{ fontSize: '0.82rem', color: 'var(--brs-gray-500)' }}>
                          {item.tabelas_credito?.nome || '-'} · {produtoLabel(item.tabelas_credito?.produto)} · {item.tabelas_credito?.com_seguro ? 'c/ seguro' : 's/ seguro'}
                        </div>
                      </td>
                      <td>{item.convenios?.nome || '-'}</td>
                      <td>{item.prazo}x</td>
                      <td style={{ fontFamily: 'monospace' }}>{Number(item.coeficiente).toFixed(8).replace(/0+$/, '').replace(/\.$/, '')}</td>
                      <td style={{ fontSize: '0.85rem' }}>
                        {formatDateBR(item.vigencia_inicio)} → {item.vigencia_fim ? formatDateBR(item.vigencia_fim) : 'aberta'}
                      </td>
                      <td>
                        <span className={`badge ${vigente ? 'badge-success' : 'badge-gray'}`}>
                          {vigente ? 'Vigente' : 'Encerrado'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          {!item.vigencia_fim && (
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              onClick={() => handleEncerrar(item)}
                              disabled={busyId === item.id}
                            >
                              {busyId === item.id ? <Loader2 size={16} className="spinner" /> : <CalendarOff size={16} />}
                              Encerrar vigência
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleExcluir(item)}
                            disabled={busyId === item.id}
                            title="Excluir (apenas correção de lançamento errado)"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSave}>
              <div className="modal-header">
                <h3 className="modal-title">Lançar Coeficientes</h3>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label className="form-label">Tabela de Crédito <span className="required">*</span></label>
                    <select className="form-control" required value={novoTabelaId} onChange={(e) => preencherPrazosDaTabela(e.target.value)}>
                      <option value="">Selecione...</option>
                      {tabelas.filter((tab) => tab.is_active).map((tab) => (
                        <option key={tab.id} value={tab.id}>{tabelaDescricao(tab)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Convênio <span className="required">*</span></label>
                    <select className="form-control" required value={novoConvenioId} onChange={(e) => setNovoConvenioId(e.target.value)}>
                      <option value="">Selecione...</option>
                      {convenios.filter((conv) => conv.is_active).map((conv) => (
                        <option key={conv.id} value={conv.id}>{conv.nome}{conv.codigo ? ` (${conv.codigo})` : ''}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-group" style={{ marginTop: '1rem', maxWidth: 220 }}>
                  <label className="form-label">Início da vigência <span className="required">*</span></label>
                  <input type="date" className="form-control" required value={novoInicio} onChange={(e) => setNovoInicio(e.target.value)} />
                  <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-400)', marginTop: '0.25rem' }}>
                    Vigências abertas anteriores (mesma tabela/convênio/prazo) são encerradas automaticamente no dia anterior.
                  </div>
                </div>

                <div style={{ marginTop: '1rem' }}>
                  <label className="form-label">Prazos e coeficientes <span className="required">*</span></label>
                  {linhas.map((linha, index) => (
                    <div key={index} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                      <input
                        type="number"
                        min={1}
                        className="form-control"
                        placeholder="Prazo (ex.: 96)"
                        style={{ width: 140 }}
                        value={linha.prazo}
                        onChange={(e) => {
                          const next = [...linhas]
                          next[index] = { ...next[index], prazo: e.target.value }
                          setLinhas(next)
                        }}
                      />
                      <input
                        type="text"
                        inputMode="decimal"
                        className="form-control"
                        placeholder="Coeficiente (ex.: 0,03456789)"
                        style={{ width: 220 }}
                        value={linha.coeficiente}
                        onChange={(e) => {
                          const next = [...linhas]
                          next[index] = { ...next[index], coeficiente: e.target.value }
                          setLinhas(next)
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon"
                        onClick={() => setLinhas(linhas.filter((_, i) => i !== index))}
                        disabled={linhas.length === 1}
                        title="Remover linha"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setLinhas([...linhas, { prazo: '', coeficiente: '' }])}>
                    <Plus size={14} />
                    Adicionar prazo
                  </button>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <Loader2 size={16} className="spinner" /> : null}
                  Lançar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
