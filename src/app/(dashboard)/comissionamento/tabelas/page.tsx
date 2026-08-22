'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, Edit2, Loader2, Plus, Search, Table2, X } from 'lucide-react'
import { getComissionamentoLookups, getTabelasComissao, saveTabelaComissao, setTabelaComissaoAtiva, type TabelaComissaoPayload } from '../actions'

type Instituicao = { id: string; name: string; logo_url: string | null; is_active?: boolean; imposto_comissao_percent?: number | null }
type Lookup = { id: string; nome: string; codigo?: string | null; is_active?: boolean; origem_margem?: string }
type TabelaComissao = {
  id: string
  codigo_tabela_banco: string | null
  nome: string
  institution_id: string
  forma_contrato_id: string
  convenio_id: string | null
  tipo_formalizacao_id: string | null
  com_seguro: boolean | null
  observacao: string | null
  id_arw: string | null
  is_active: boolean
  financial_institutions: Instituicao | null
  formas_contrato: Lookup | null
  convenios: Lookup | null
  tipos_formalizacao: Lookup | null
  prazos_comissao: Array<{ id: string }>
}
type Lookups = { instituicoes: Instituicao[]; formasContrato: Lookup[]; convenios: Lookup[]; tiposFormalizacao: Lookup[] }
type FeedbackMessage = { type: 'success' | 'error'; text: string }

const emptyLookups: Lookups = { instituicoes: [], formasContrato: [], convenios: [], tiposFormalizacao: [] }

function seguroLabel(value: boolean | null | undefined) {
  if (value === true) return 'Com seguro'
  if (value === false) return 'Sem seguro'
  return '-'
}

export default function TabelasComissaoPage() {
  const [items, setItems] = useState<TabelaComissao[]>([])
  const [lookups, setLookups] = useState<Lookups>(emptyLookups)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [institutionFilter, setInstitutionFilter] = useState('all')
  const [formaFilter, setFormaFilter] = useState('all')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<Partial<TabelaComissaoPayload> | null>(null)
  const [saving, setSaving] = useState(false)

  async function loadData() {
    setLoading(true)
    try {
      const [tablesRes, lookupsRes] = await Promise.all([getTabelasComissao(), getComissionamentoLookups()])
      if (tablesRes.success) setItems((tablesRes.items || []) as unknown as TabelaComissao[])
      else setMessage({ type: 'error', text: tablesRes.error || 'Erro ao carregar tabelas de comissão.' })
      if (lookupsRes.success) {
        setLookups({
          instituicoes: (lookupsRes.instituicoes || []) as Instituicao[],
          formasContrato: (lookupsRes.formasContrato || []) as Lookup[],
          convenios: (lookupsRes.convenios || []) as Lookup[],
          tiposFormalizacao: (lookupsRes.tiposFormalizacao || []) as Lookup[],
        })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar tabelas de comissão.' })
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
      const matchesSearch = !query || String(item.nome || '').toLowerCase().includes(query) || String(item.codigo_tabela_banco || '').toLowerCase().includes(query) || String(item.financial_institutions?.name || '').toLowerCase().includes(query)
      const matchesInstitution = institutionFilter === 'all' || item.institution_id === institutionFilter
      const matchesForma = formaFilter === 'all' || item.forma_contrato_id === formaFilter
      return matchesSearch && matchesInstitution && matchesForma
    })
  }, [items, searchQuery, institutionFilter, formaFilter])

  function openNew() {
    setEditing({ codigo_tabela_banco: '', nome: '', institution_id: '', forma_contrato_id: '', convenio_id: '', tipo_formalizacao_id: '', com_seguro: null, observacao: '', id_arw: '' })
    setIsModalOpen(true)
  }

  function openEdit(item: TabelaComissao) {
    setEditing({
      id: item.id,
      codigo_tabela_banco: item.codigo_tabela_banco || '',
      nome: item.nome,
      institution_id: item.institution_id,
      forma_contrato_id: item.forma_contrato_id,
      convenio_id: item.convenio_id || '',
      tipo_formalizacao_id: item.tipo_formalizacao_id || '',
      com_seguro: item.com_seguro,
      observacao: item.observacao || '',
      id_arw: item.id_arw || '',
    })
    setIsModalOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editing?.nome?.trim()) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await saveTabelaComissao({
        id: editing.id,
        codigo_tabela_banco: editing.codigo_tabela_banco || null,
        nome: String(editing.nome || ''),
        institution_id: String(editing.institution_id || ''),
        forma_contrato_id: String(editing.forma_contrato_id || ''),
        convenio_id: editing.convenio_id || null,
        tipo_formalizacao_id: editing.tipo_formalizacao_id || null,
        com_seguro: editing.com_seguro ?? null,
        observacao: String(editing.observacao || ''),
        id_arw: editing.id_arw || null,
      })
      if (res.success) {
        setIsModalOpen(false)
        setEditing(null)
        setMessage({ type: 'success', text: editing.id ? 'Tabela de comissão atualizada.' : 'Tabela de comissão criada.' })
        await loadData()
      } else setMessage({ type: 'error', text: res.error || 'Erro ao salvar tabela de comissão.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao salvar tabela de comissão.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(item: TabelaComissao) {
    setBusyId(item.id)
    setMessage(null)
    try {
      const nextActive = !item.is_active
      const res = await setTabelaComissaoAtiva(item.id, nextActive)
      if (res.success) {
        setMessage({ type: 'success', text: nextActive ? 'Tabela reativada.' : 'Tabela inativada.' })
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
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Table2 size={18} />Tabelas de Comissão</div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>Cadastro de tabelas de comissão por instituição, forma de contrato e convênio.</div>
        </div>
        <button type="button" className="btn btn-primary" onClick={openNew}><Plus size={16} />Nova Tabela</button>
      </div>

      {message && <div style={{ marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10, border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`, background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2', color: message.type === 'success' ? '#065F46' : '#991B1B', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>{message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}<span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span></div>}

      <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
          <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }}><Search size={16} /></span>
          <input type="text" className="form-control" placeholder="Buscar por nome, código ou instituição..." style={{ paddingLeft: '2.25rem', width: '100%' }} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <select className="form-control" style={{ width: 220 }} value={institutionFilter} onChange={(e) => setInstitutionFilter(e.target.value)}>
          <option value="all">Todas as instituições</option>
          {lookups.instituicoes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select className="form-control" style={{ width: 220 }} value={formaFilter} onChange={(e) => setFormaFilter(e.target.value)}>
          <option value="all">Todas as formas</option>
          {lookups.formasContrato.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
        </select>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead><tr><th>Instituição</th><th>Código no Banco</th><th>Nome</th><th>Forma de Contrato</th><th>Convênio</th><th>Formalização</th><th>Seguro</th><th>Qtd. Prazos</th><th>Status</th><th style={{ textAlign: 'right' }}>Ações</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr>
              ) : filteredItems.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: '3rem' }}><div className="empty-state"><Table2 size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} /><h3>Nenhuma tabela encontrada</h3><p>Cadastre a primeira tabela de comissão.</p></div></td></tr>
              ) : filteredItems.map((item) => (
                <tr key={item.id}>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}><div style={{ width: 32, height: 32, border: '1px solid var(--brs-gray-200)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#fff' }}>{item.financial_institutions?.logo_url ? <img src={item.financial_institutions.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <Table2 size={16} style={{ color: 'var(--brs-gray-400)' }} />}</div><span style={{ fontWeight: 600 }}>{item.financial_institutions?.name || '-'}</span></div></td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{item.codigo_tabela_banco || '-'}</td>
                  <td style={{ fontWeight: 600 }}>{item.nome}</td>
                  <td>{item.formas_contrato?.nome || '-'}</td>
                  <td>{item.convenios?.nome || '-'}</td>
                  <td>{item.tipos_formalizacao?.nome || '-'}</td>
                  <td>{seguroLabel(item.com_seguro)}</td>
                  <td>{item.prazos_comissao?.length || 0}</td>
                  <td><span className={`badge ${item.is_active ? 'badge-success' : 'badge-gray'}`}>{item.is_active ? 'Ativo' : 'Inativo'}</span></td>
                  <td style={{ textAlign: 'right' }}><div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}><button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(item)}><Edit2 size={16} />Editar</button><button type="button" className={`btn btn-sm ${item.is_active ? 'btn-outline' : 'btn-primary'}`} onClick={() => handleToggle(item)} disabled={busyId === item.id}>{busyId === item.id ? <Loader2 size={16} className="spinner" /> : null}{item.is_active ? 'Inativar' : 'Ativar'}</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSave}>
              <div className="modal-header"><h3 className="modal-title">{editing?.id ? 'Editar Tabela de Comissão' : 'Nova Tabela de Comissão'}</h3><button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}><X size={20} /></button></div>
              <div className="modal-body">
                <div className="form-grid form-grid-2">
                  <div className="form-group"><label className="form-label">Código no Banco</label><input type="text" className="form-control" value={editing?.codigo_tabela_banco || ''} onChange={(e) => setEditing({ ...editing, codigo_tabela_banco: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label">Nome <span className="required">*</span></label><input type="text" className="form-control" required value={editing?.nome || ''} onChange={(e) => setEditing({ ...editing, nome: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label">Instituição <span className="required">*</span></label><select className="form-control" required value={editing?.institution_id || ''} onChange={(e) => setEditing({ ...editing, institution_id: e.target.value })}><option value="">Selecione</option>{lookups.instituicoes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
                  <div className="form-group"><label className="form-label">Forma de Contrato <span className="required">*</span></label><select className="form-control" required value={editing?.forma_contrato_id || ''} onChange={(e) => setEditing({ ...editing, forma_contrato_id: e.target.value })}><option value="">Selecione</option>{lookups.formasContrato.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></div>
                  <div className="form-group"><label className="form-label">Convênio</label><select className="form-control" value={editing?.convenio_id || ''} onChange={(e) => setEditing({ ...editing, convenio_id: e.target.value })}><option value="">Sem convênio</option>{lookups.convenios.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></div>
                  <div className="form-group"><label className="form-label">Tipo de Formalização</label><select className="form-control" value={editing?.tipo_formalizacao_id || ''} onChange={(e) => setEditing({ ...editing, tipo_formalizacao_id: e.target.value })}><option value="">Sem formalização</option>{lookups.tiposFormalizacao.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></div>
                  <div className="form-group"><label className="form-label">Seguro</label><select className="form-control" value={editing?.com_seguro === true ? 'true' : editing?.com_seguro === false ? 'false' : ''} onChange={(e) => setEditing({ ...editing, com_seguro: e.target.value === '' ? null : e.target.value === 'true' })}><option value="">Não informado</option><option value="true">Com seguro</option><option value="false">Sem seguro</option></select></div>
                  <div className="form-group"><label className="form-label">ID no ARW</label><input type="text" className="form-control" value={editing?.id_arw || ''} onChange={(e) => setEditing({ ...editing, id_arw: e.target.value })} /></div>
                </div>
                <div className="form-group" style={{ marginTop: '1rem' }}><label className="form-label">Observação</label><textarea className="form-control" rows={3} value={editing?.observacao || ''} onChange={(e) => setEditing({ ...editing, observacao: e.target.value })} /></div>
              </div>
              <div className="modal-footer"><button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>Cancelar</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <Loader2 size={16} className="spinner" /> : null}Salvar</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
