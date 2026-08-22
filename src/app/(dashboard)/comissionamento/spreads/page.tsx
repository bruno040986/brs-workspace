'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Loader2, Percent, Plus, X } from 'lucide-react'
import { encerrarSpread, getComissionamentoLookups, getSpreads, saveSpread, type SpreadPayload } from '../actions'

type Instituicao = { id: string; name: string }
type Lookup = { id: string; nome: string; codigo?: string | null }
type TipoAgente = { id: string; name: string; codigo_arw: number | null; percentual_repasse?: number | null }
type Spread = SpreadPayload & {
  id: string
  convenio_id: string | null
  tipo_formalizacao_id: string | null
  vigencia_inicio: string
  vigencia_fim: string | null
  formas_contrato: Lookup | null
  agente_corban_tipos_agente: TipoAgente | null
  financial_institutions: Instituicao | null
  convenios: Lookup | null
  tipos_formalizacao: Lookup | null
}
type Lookups = { instituicoes: Instituicao[]; formasContrato: Lookup[]; convenios: Lookup[]; tiposFormalizacao: Lookup[]; tiposAgente: TipoAgente[] }
type FeedbackMessage = { type: 'success' | 'error'; text: string }

const today = () => new Date().toISOString().slice(0, 10)
const numberValue = (value: unknown) => {
  const parsed = Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}
const formatDate = (value: string | null | undefined) => (value ? new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR') : 'aberta')

export default function SpreadsPage() {
  const [items, setItems] = useState<Spread[]>([])
  const [lookups, setLookups] = useState<Lookups>({ instituicoes: [], formasContrato: [], convenios: [], tiposFormalizacao: [], tiposAgente: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [institutionFilter, setInstitutionFilter] = useState('')
  const [formaFilter, setFormaFilter] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<Partial<SpreadPayload> | null>(null)

  async function loadData(nextInstitution = institutionFilter, nextForma = formaFilter) {
    setLoading(true)
    try {
      const [itemsRes, lookupsRes] = await Promise.all([getSpreads({ institutionId: nextInstitution || undefined, formaContratoId: nextForma || undefined }), getComissionamentoLookups()])
      if (itemsRes.success) setItems((itemsRes.items || []) as unknown as Spread[])
      else setMessage({ type: 'error', text: itemsRes.error || 'Erro ao carregar spreads.' })
      if (lookupsRes.success) {
        setLookups({
          instituicoes: (lookupsRes.instituicoes || []) as Instituicao[],
          formasContrato: (lookupsRes.formasContrato || []) as Lookup[],
          convenios: (lookupsRes.convenios || []) as Lookup[],
          tiposFormalizacao: (lookupsRes.tiposFormalizacao || []) as Lookup[],
          tiposAgente: (lookupsRes.tiposAgente || []) as TipoAgente[],
        })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar spreads.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData('', '')
  }, [])

  async function setFilter(type: 'institution' | 'forma', value: string) {
    const nextInstitution = type === 'institution' ? value : institutionFilter
    const nextForma = type === 'forma' ? value : formaFilter
    setInstitutionFilter(nextInstitution)
    setFormaFilter(nextForma)
    await loadData(nextInstitution, nextForma)
  }

  function openNew() {
    setEditing({ forma_contrato_id: '', tipo_agente_id: '', institution_id: '', convenio_id: '', tipo_formalizacao_id: '', pontos: 0, vigencia_inicio: today() })
    setIsModalOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const res = await saveSpread({
        forma_contrato_id: String(editing?.forma_contrato_id || ''),
        tipo_agente_id: String(editing?.tipo_agente_id || ''),
        institution_id: String(editing?.institution_id || ''),
        convenio_id: editing?.convenio_id || null,
        tipo_formalizacao_id: editing?.tipo_formalizacao_id || null,
        pontos: numberValue(editing?.pontos),
        vigencia_inicio: editing?.vigencia_inicio || today(),
      })
      if (res.success) {
        setIsModalOpen(false)
        setEditing(null)
        setMessage({ type: 'success', text: 'Spread lançado.' })
        await loadData()
      } else setMessage({ type: 'error', text: res.error || 'Erro ao lançar spread.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao lançar spread.' })
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
      } else setMessage({ type: 'error', text: res.error || 'Erro ao encerrar vigência.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao encerrar vigência.' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div><div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Percent size={18} />Spreads (Margem Mínima)</div><div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>Cadastro de pontos mínimos por instituição, forma de contrato e tipo de agente.</div></div>
        <button type="button" className="btn btn-primary" onClick={openNew}><Plus size={16} />Novo Spread</button>
      </div>
      {message && <div style={{ marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10, border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`, background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2', color: message.type === 'success' ? '#065F46' : '#991B1B', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>{message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}<span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span></div>}
      <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <select className="form-control" style={{ width: 260 }} value={institutionFilter} onChange={(e) => setFilter('institution', e.target.value)}><option value="">Todas as instituições</option>{lookups.instituicoes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select className="form-control" style={{ width: 260 }} value={formaFilter} onChange={(e) => setFilter('forma', e.target.value)}><option value="">Todas as formas</option>{lookups.formasContrato.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select>
      </div>
      <div className="card"><div className="table-wrapper"><table className="data-table"><thead><tr><th>Instituição</th><th>Forma de Contrato</th><th>Tipo de Agente</th><th>Convênio</th><th>Formalização</th><th>Pontos</th><th>Vigência</th><th>Status</th><th style={{ textAlign: 'right' }}>Ações</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={9} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr> : items.length === 0 ? <tr><td colSpan={9} style={{ textAlign: 'center', padding: '3rem' }}><div className="empty-state"><Percent size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} /><h3>Nenhum spread encontrado</h3><p>Lance o primeiro spread para controlar a margem mínima.</p></div></td></tr> : items.map((item) => <tr key={item.id}>
          <td style={{ fontWeight: 600 }}>{item.financial_institutions?.name || '-'}</td>
          <td>{item.formas_contrato?.nome || '-'}</td>
          <td>{item.agente_corban_tipos_agente?.codigo_arw ?? '-'} - {item.agente_corban_tipos_agente?.name || '-'}</td>
          <td>{item.convenios?.nome || '-'}</td>
          <td>{item.tipos_formalizacao?.nome || '-'}</td>
          <td>{Number(item.pontos).toFixed(4)} p.p.</td>
          <td>{formatDate(item.vigencia_inicio)} → {formatDate(item.vigencia_fim)}</td>
          <td><span className={`badge ${item.vigencia_fim ? 'badge-gray' : 'badge-success'}`}>{item.vigencia_fim ? 'Encerrado' : 'Vigente'}</span></td>
          <td style={{ textAlign: 'right' }}>{item.vigencia_fim ? '-' : <button type="button" className="btn btn-outline btn-sm" onClick={() => handleClose(item)} disabled={busyId === item.id}>{busyId === item.id ? <Loader2 size={16} className="spinner" /> : null}Encerrar vigência</button>}</td>
        </tr>)}
      </tbody></table></div></div>
      {isModalOpen && <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}><div className="modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}><form onSubmit={handleSave}>
        <div className="modal-header"><h3 className="modal-title">Lançar Spread</h3><button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}><X size={20} /></button></div>
        <div className="modal-body">
          <div className="form-grid form-grid-2">
            <div className="form-group"><label className="form-label">Forma de Contrato <span className="required">*</span></label><select className="form-control" required value={editing?.forma_contrato_id || ''} onChange={(e) => setEditing({ ...editing, forma_contrato_id: e.target.value })}><option value="">Selecione</option>{lookups.formasContrato.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Tipo de Agente <span className="required">*</span></label><select className="form-control" required value={editing?.tipo_agente_id || ''} onChange={(e) => setEditing({ ...editing, tipo_agente_id: e.target.value })}><option value="">Selecione</option>{lookups.tiposAgente.map((item) => <option key={item.id} value={item.id}>{item.codigo_arw ?? '-'} - {item.name}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Instituição <span className="required">*</span></label><select className="form-control" required value={editing?.institution_id || ''} onChange={(e) => setEditing({ ...editing, institution_id: e.target.value })}><option value="">Selecione</option>{lookups.instituicoes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Convênio</label><select className="form-control" value={editing?.convenio_id || ''} onChange={(e) => setEditing({ ...editing, convenio_id: e.target.value })}><option value="">Sem convênio</option>{lookups.convenios.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Formalização</label><select className="form-control" value={editing?.tipo_formalizacao_id || ''} onChange={(e) => setEditing({ ...editing, tipo_formalizacao_id: e.target.value })}><option value="">Sem formalização</option>{lookups.tiposFormalizacao.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Pontos <span className="required">*</span></label><input type="number" step="0.0001" className="form-control" required value={editing?.pontos ?? ''} onChange={(e) => setEditing({ ...editing, pontos: numberValue(e.target.value) })} /></div>
            <div className="form-group"><label className="form-label">Vigência Início</label><input type="date" className="form-control" value={editing?.vigencia_inicio || today()} onChange={(e) => setEditing({ ...editing, vigencia_inicio: e.target.value })} /></div>
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem', marginTop: '1rem' }}>Lançar um novo spread para a mesma combinação encerra automaticamente a vigência anterior.</div>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>Cancelar</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <Loader2 size={16} className="spinner" /> : null}Salvar</button></div>
      </form></div></div>}
    </div>
  )
}
