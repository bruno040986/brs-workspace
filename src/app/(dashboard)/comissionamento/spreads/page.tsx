'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CalendarOff, CheckCircle, Edit2, Loader2, Percent, Plus, X } from 'lucide-react'
import { encerrarSpread, getComissionamentoLookups, getSpreads, saveSpread, type SpreadPayload } from '../actions'

type Instituicao = { id: string; name: string }
type FormaContrato = { id: string; nome: string }
type Convenio = { id: string; nome: string; codigo?: string | null }
type TipoFormalizacao = { id: string; nome: string }
type TipoAgente = { id: string; name: string; codigo_arw: number | null; percentual_repasse?: number | null }

type Spread = {
  id: string
  forma_contrato_id: string
  tipos_agente: string[]
  instituicoes: string[]
  convenios: string[]
  tipos_formalizacao: string[]
  pontos: number
  vigencia_inicio: string
  vigencia_fim: string | null
  formas_contrato: FormaContrato | null
}

type Lookups = {
  instituicoes: Instituicao[]
  formasContrato: FormaContrato[]
  convenios: Convenio[]
  tiposFormalizacao: TipoFormalizacao[]
  tiposAgente: TipoAgente[]
}

type FeedbackMessage = { type: 'success' | 'error'; text: string }

type MultiSelectGroupProps = {
  label: string
  selectedIds: string[]
  items: Array<{ id: string; label: string }>
  onChange: (ids: string[]) => void
}

const emptyLookups: Lookups = {
  instituicoes: [],
  formasContrato: [],
  convenios: [],
  tiposFormalizacao: [],
  tiposAgente: [],
}

const today = () => new Date().toISOString().slice(0, 10)
const numberValue = (value: unknown) => {
  const parsed = Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}
const formatDate = (value: string | null | undefined) => (value ? new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR') : 'aberta')
const asArray = (value: string[] | null | undefined) => (Array.isArray(value) ? value : [])

function MultiSelectGroup({ label, selectedIds, items, onChange }: MultiSelectGroupProps) {
  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id])
  }

  return (
    <div className="form-group">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', marginBottom: '0.35rem' }}>
        <label className="form-label" style={{ marginBottom: 0 }}>
          {label} {selectedIds.length > 0 ? `- ${selectedIds.length} selecionada(s)` : '- Todas'}
        </label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([])}>
          Limpar
        </button>
      </div>
      <div style={{ border: '1px solid var(--brs-gray-200)', borderRadius: 10, maxHeight: 160, overflowY: 'auto', padding: '0.5rem' }}>
        {items.length === 0 ? (
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem', padding: '0.5rem' }}>Nenhum item disponível.</div>
        ) : (
          items.map((item) => (
            <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.375rem 0.25rem', fontSize: '0.875rem' }}>
              <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggle(item.id)} />
              <span>{item.label}</span>
            </label>
          ))
        )}
      </div>
      <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.8rem', marginTop: '0.35rem' }}>Nenhum selecionado = vale para todos</div>
    </div>
  )
}

function ArraySummary({ ids, labelsById }: { ids: string[]; labelsById: Map<string, string> }) {
  if (ids.length === 0) return <span className="badge badge-gray">Todos</span>

  const labels = ids.map((id) => labelsById.get(id) || id)
  const visible = labels.slice(0, 2)
  const remaining = labels.length - visible.length

  return (
    <span title={labels.join(', ')}>
      {visible.join(', ')}
      {remaining > 0 ? ` +${remaining}` : ''}
    </span>
  )
}

export default function SpreadsPage() {
  const [items, setItems] = useState<Spread[]>([])
  const [lookups, setLookups] = useState<Lookups>(emptyLookups)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [institutionFilter, setInstitutionFilter] = useState('')
  const [formaFilter, setFormaFilter] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<Partial<SpreadPayload> | null>(null)

  async function loadData(nextForma = formaFilter) {
    setLoading(true)
    try {
      const [itemsRes, lookupsRes] = await Promise.all([
        getSpreads({ formaContratoId: nextForma || undefined }),
        getComissionamentoLookups(),
      ])
      if (itemsRes.success) setItems((itemsRes.items || []) as unknown as Spread[])
      else setMessage({ type: 'error', text: itemsRes.error || 'Erro ao carregar spreads.' })

      if (lookupsRes.success) {
        setLookups({
          instituicoes: (lookupsRes.instituicoes || []) as Instituicao[],
          formasContrato: (lookupsRes.formasContrato || []) as FormaContrato[],
          convenios: (lookupsRes.convenios || []) as Convenio[],
          tiposFormalizacao: (lookupsRes.tiposFormalizacao || []) as TipoFormalizacao[],
          tiposAgente: (lookupsRes.tiposAgente || []) as TipoAgente[],
        })
      } else {
        setMessage({ type: 'error', text: lookupsRes.error || 'Erro ao carregar filtros de spreads.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar spreads.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData('')
  }, [])

  const labels = useMemo(() => ({
    instituicoes: new Map(lookups.instituicoes.map((item) => [item.id, item.name])),
    formasContrato: new Map(lookups.formasContrato.map((item) => [item.id, item.nome])),
    convenios: new Map(lookups.convenios.map((item) => [item.id, item.nome])),
    tiposFormalizacao: new Map(lookups.tiposFormalizacao.map((item) => [item.id, item.nome])),
    tiposAgente: new Map(lookups.tiposAgente.map((item) => [item.id, `${item.codigo_arw ?? '-'} - ${item.name}`])),
  }), [lookups])

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const instituicoes = asArray(item.instituicoes)
      return !institutionFilter || instituicoes.length === 0 || instituicoes.includes(institutionFilter)
    })
  }, [items, institutionFilter])

  async function handleFormaFilter(value: string) {
    setFormaFilter(value)
    await loadData(value)
  }

  function openNew() {
    setEditing({
      forma_contrato_id: '',
      tipos_agente: [],
      instituicoes: [],
      convenios: [],
      tipos_formalizacao: [],
      pontos: 0,
      vigencia_inicio: today(),
    })
    setIsModalOpen(true)
  }

  function openEdit(item: Spread) {
    setEditing({
      id: item.id,
      forma_contrato_id: item.forma_contrato_id,
      tipos_agente: asArray(item.tipos_agente),
      instituicoes: asArray(item.instituicoes),
      convenios: asArray(item.convenios),
      tipos_formalizacao: asArray(item.tipos_formalizacao),
      pontos: item.pontos,
      vigencia_inicio: item.vigencia_inicio || today(),
    })
    setIsModalOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const res = await saveSpread({
        id: editing?.id,
        forma_contrato_id: String(editing?.forma_contrato_id || ''),
        tipos_agente: asArray(editing?.tipos_agente),
        instituicoes: asArray(editing?.instituicoes),
        convenios: asArray(editing?.convenios),
        tipos_formalizacao: asArray(editing?.tipos_formalizacao),
        pontos: numberValue(editing?.pontos),
        vigencia_inicio: editing?.vigencia_inicio || today(),
      })
      if (res.success) {
        setIsModalOpen(false)
        setEditing(null)
        setMessage({ type: 'success', text: editing?.id ? 'Spread atualizado.' : 'Spread lançado.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar spread.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao salvar spread.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleClose(item: Spread) {
    setBusyId(item.id)
    setMessage(null)
    try {
      const res = await encerrarSpread(item.id, today())
      if (res.success) {
        setMessage({ type: 'success', text: 'Vigência encerrada.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao encerrar vigência.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao encerrar vigência.' })
    } finally {
      setBusyId(null)
    }
  }

  const selectedTiposAgente = asArray(editing?.tipos_agente)
  const selectedInstituicoes = asArray(editing?.instituicoes)
  const selectedConvenios = asArray(editing?.convenios)
  const selectedTiposFormalizacao = asArray(editing?.tipos_formalizacao)

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Percent size={18} />
            Spreads (Margem Mínima)
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Cadastro de pontos mínimos por forma de contrato com regras opcionais por grupo.
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={openNew}>
          <Plus size={16} />
          Novo Spread
        </button>
      </div>

      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10, border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`, background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2', color: message.type === 'success' ? '#065F46' : '#991B1B', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <select className="form-control" style={{ width: 280 }} value={formaFilter} onChange={(e) => handleFormaFilter(e.target.value)}>
          <option value="">Todas as formas de contrato</option>
          {lookups.formasContrato.map((item) => (
            <option key={item.id} value={item.id}>{item.nome}</option>
          ))}
        </select>
        <select className="form-control" style={{ width: 280 }} value={institutionFilter} onChange={(e) => setInstitutionFilter(e.target.value)}>
          <option value="">Todas as instituições</option>
          {lookups.instituicoes.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Forma de Contrato</th>
                <th>Tipos de Agente</th>
                <th>Instituições</th>
                <th>Convênios</th>
                <th>Formalizações</th>
                <th>Pontos</th>
                <th>Vigência</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '3rem' }}>
                    <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '3rem' }}>
                    <div className="empty-state">
                      <Percent size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                      <h3>Nenhum spread encontrado</h3>
                      <p>Lance o primeiro spread para controlar a margem mínima.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.formas_contrato?.nome || labels.formasContrato.get(item.forma_contrato_id) || '-'}</td>
                    <td><ArraySummary ids={asArray(item.tipos_agente)} labelsById={labels.tiposAgente} /></td>
                    <td><ArraySummary ids={asArray(item.instituicoes)} labelsById={labels.instituicoes} /></td>
                    <td><ArraySummary ids={asArray(item.convenios)} labelsById={labels.convenios} /></td>
                    <td><ArraySummary ids={asArray(item.tipos_formalizacao)} labelsById={labels.tiposFormalizacao} /></td>
                    <td>{Number(item.pontos).toFixed(4)} p.p.</td>
                    <td>{formatDate(item.vigencia_inicio)} - {formatDate(item.vigencia_fim)}</td>
                    <td><span className={`badge ${item.vigencia_fim ? 'badge-gray' : 'badge-success'}`}>{item.vigencia_fim ? 'Encerrado' : 'Vigente'}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-ghost btn-sm btn-acao" onClick={() => openEdit(item)} title="Editar" aria-label="Editar">
                          <Edit2 size={15} />
                        </button>
                        {item.vigencia_fim ? null : (
                          <button type="button" className="btn btn-outline btn-sm btn-acao" onClick={() => handleClose(item)} disabled={busyId === item.id} title="Encerrar vigência" aria-label="Encerrar vigência">
                            {busyId === item.id ? <Loader2 size={15} className="spinner" /> : <CalendarOff size={15} />}
                          </button>
                        )}
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
          <div className="modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSave}>
              <div className="modal-header">
                <h3 className="modal-title">{editing?.id ? 'Editar Spread' : 'Lançar Spread'}</h3>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label className="form-label">Forma de Contrato <span className="required">*</span></label>
                    <select className="form-control" required value={editing?.forma_contrato_id || ''} onChange={(e) => setEditing({ ...editing, forma_contrato_id: e.target.value })}>
                      <option value="">Selecione</option>
                      {lookups.formasContrato.map((item) => (
                        <option key={item.id} value={item.id}>{item.nome}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Pontos <span className="required">*</span></label>
                    <input type="number" step="0.0001" className="form-control" required value={editing?.pontos ?? ''} onChange={(e) => setEditing({ ...editing, pontos: numberValue(e.target.value) })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Vigência Início</label>
                    <input type="date" className="form-control" value={editing?.vigencia_inicio || today()} onChange={(e) => setEditing({ ...editing, vigencia_inicio: e.target.value })} />
                  </div>
                </div>

                <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
                  <MultiSelectGroup
                    label="Tipos de Agente"
                    selectedIds={selectedTiposAgente}
                    items={lookups.tiposAgente.map((item) => ({ id: item.id, label: `${item.codigo_arw ?? '-'} - ${item.name}` }))}
                    onChange={(ids) => setEditing({ ...editing, tipos_agente: ids })}
                  />
                  <MultiSelectGroup
                    label="Instituições"
                    selectedIds={selectedInstituicoes}
                    items={lookups.instituicoes.map((item) => ({ id: item.id, label: item.name }))}
                    onChange={(ids) => setEditing({ ...editing, instituicoes: ids })}
                  />
                  <MultiSelectGroup
                    label="Convênios"
                    selectedIds={selectedConvenios}
                    items={lookups.convenios.map((item) => ({ id: item.id, label: item.nome }))}
                    onChange={(ids) => setEditing({ ...editing, convenios: ids })}
                  />
                  <MultiSelectGroup
                    label="Formalizações"
                    selectedIds={selectedTiposFormalizacao}
                    items={lookups.tiposFormalizacao.map((item) => ({ id: item.id, label: item.nome }))}
                    onChange={(ids) => setEditing({ ...editing, tipos_formalizacao: ids })}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>Cancelar</button>
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
