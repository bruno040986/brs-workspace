'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, Clock, Edit2, Loader2, Plus, Trash2, X } from 'lucide-react'
import { calcularRepasses, formaPagamentoEmPercentual, formaPagamentoLabel, formaPagamentoUsaFaixa, FORMAS_PAGAMENTO_PRAZO } from '@/lib/comissionamento'
import { excluirPrazoComissao, getComissionamentoLookups, getPrazosComissao, savePrazoComissao, type PrazoComissaoPayload } from '../actions'

type Instituicao = { id: string; name: string; logo_url?: string | null; imposto_comissao_percent: number | null }
type TipoAgente = { id: string; name: string; codigo_arw: number | null; percentual_repasse: number | null }
type TabelaLookup = { id: string; nome: string; codigo_tabela_banco: string | null; institution_id: string; forma_contrato_id: string; convenio_id: string | null; com_seguro: boolean | null; is_active: boolean }
type Prazo = PrazoComissaoPayload & {
  id: string
  valor_inicial: number | null
  valor_final: number | null
  data_base: string | null
  comissao: number | null
  emissao: number | null
  seguro: number | null
  forma_pagamento_seguro: string | null
  id_arw: string | null
  tabelas_comissao: (TabelaLookup & { financial_institutions: Instituicao | null }) | null
}
type Lookups = { instituicoes: Instituicao[]; tabelasComissao: TabelaLookup[]; tiposAgente: TipoAgente[] }
type FeedbackMessage = { type: 'success' | 'error'; text: string }

const today = () => new Date().toISOString().slice(0, 10)
const numberOrNull = (value: unknown) => {
  const parsed = Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}
const intOrZero = (value: unknown) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

export default function PrazosComissaoPage() {
  const [items, setItems] = useState<Prazo[]>([])
  const [lookups, setLookups] = useState<Lookups>({ instituicoes: [], tabelasComissao: [], tiposAgente: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [tabelaFilter, setTabelaFilter] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<Partial<PrazoComissaoPayload> | null>(null)

  async function loadData(nextTabela = tabelaFilter) {
    setLoading(true)
    try {
      const [itemsRes, lookupsRes] = await Promise.all([getPrazosComissao(nextTabela || undefined), getComissionamentoLookups()])
      if (itemsRes.success) setItems((itemsRes.items || []) as unknown as Prazo[])
      else setMessage({ type: 'error', text: itemsRes.error || 'Erro ao carregar prazos comissão.' })
      if (lookupsRes.success) {
        setLookups({
          instituicoes: (lookupsRes.instituicoes || []) as Instituicao[],
          tabelasComissao: (lookupsRes.tabelasComissao || []) as TabelaLookup[],
          tiposAgente: (lookupsRes.tiposAgente || []) as TipoAgente[],
        })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar prazos comissão.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData('')
  }, [])

  async function handleFilterChange(value: string) {
    setTabelaFilter(value)
    await loadData(value)
  }

  const selectedTabela = useMemo(() => lookups.tabelasComissao.find((item) => item.id === editing?.tabela_comissao_id) || null, [editing?.tabela_comissao_id, lookups.tabelasComissao])
  const selectedInstitution = useMemo(() => lookups.instituicoes.find((item) => item.id === selectedTabela?.institution_id) || null, [lookups.instituicoes, selectedTabela])
  const preview = useMemo(() => {
    const tiposAgente = lookups.tiposAgente.filter((tipo) => tipo.percentual_repasse !== null)
    const spreadPorTipoAgente = new Map<string, number>(tiposAgente.map((tipo) => [tipo.id, 0]))
    return calcularRepasses({ comissao: numberOrNull(editing?.comissao), impostoPercent: selectedInstitution?.imposto_comissao_percent ?? null, tiposAgente, spreadPorTipoAgente })
  }, [editing?.comissao, lookups.tiposAgente, selectedInstitution])
  const usaFaixa = formaPagamentoUsaFaixa(editing?.forma_pagamento)

  function tabelaLabel(item: TabelaLookup) {
    const inst = lookups.instituicoes.find((instituicao) => instituicao.id === item.institution_id)
    return `${inst?.name || 'Instituição'} - ${item.nome}${item.codigo_tabela_banco ? ` (${item.codigo_tabela_banco})` : ''}`
  }

  function openNew() {
    setEditing({ tabela_comissao_id: tabelaFilter || '', forma_pagamento: 'percentual', prazo_inicial: 1, prazo_final: 1, data_base: today(), manter_enquadramento: true, comissao: null, emissao: null, seguro: null, forma_pagamento_seguro: '', id_arw: '' })
    setIsModalOpen(true)
  }

  function openEdit(item: Prazo) {
    setEditing({ id: item.id, tabela_comissao_id: item.tabela_comissao_id, forma_pagamento: item.forma_pagamento, valor_inicial: item.valor_inicial, valor_final: item.valor_final, prazo_inicial: item.prazo_inicial, prazo_final: item.prazo_final, data_base: item.data_base || '', manter_enquadramento: item.manter_enquadramento, comissao: item.comissao, emissao: item.emissao, seguro: item.seguro, forma_pagamento_seguro: item.forma_pagamento_seguro || '', id_arw: item.id_arw || '' })
    setIsModalOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const res = await savePrazoComissao({
        id: editing?.id,
        tabela_comissao_id: String(editing?.tabela_comissao_id || ''),
        forma_pagamento: String(editing?.forma_pagamento || 'percentual'),
        valor_inicial: numberOrNull(editing?.valor_inicial),
        valor_final: numberOrNull(editing?.valor_final),
        prazo_inicial: intOrZero(editing?.prazo_inicial),
        prazo_final: intOrZero(editing?.prazo_final),
        data_base: editing?.data_base || null,
        manter_enquadramento: editing?.manter_enquadramento !== false,
        comissao: numberOrNull(editing?.comissao),
        emissao: numberOrNull(editing?.emissao),
        seguro: numberOrNull(editing?.seguro),
        forma_pagamento_seguro: editing?.forma_pagamento_seguro || null,
        id_arw: editing?.id_arw || null,
      })
      if (res.success) {
        setIsModalOpen(false)
        setEditing(null)
        setMessage({ type: 'success', text: editing?.id ? 'Prazo comissão atualizado.' : 'Prazo comissão criado.' })
        await loadData()
      } else setMessage({ type: 'error', text: res.error || 'Erro ao salvar prazo comissão.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao salvar prazo comissão.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(item: Prazo) {
    if (!confirm('Excluir este prazo comissão?')) return
    setBusyId(item.id)
    setMessage(null)
    try {
      const res = await excluirPrazoComissao(item.id)
      if (res.success) {
        setMessage({ type: 'success', text: 'Prazo comissão excluído.' })
        await loadData()
      } else setMessage({ type: 'error', text: res.error || 'Erro ao excluir prazo comissão.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao excluir prazo comissão.' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div><div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Clock size={18} />Prazos Comissão</div><div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>Espelho dos prazos e comissões configurados no ARW.</div></div>
        <button type="button" className="btn btn-primary" onClick={openNew}><Plus size={16} />Novo Prazo</button>
      </div>
      {message && <div style={{ marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10, border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`, background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2', color: message.type === 'success' ? '#065F46' : '#991B1B', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>{message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}<span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span></div>}
      <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem' }}><select className="form-control" style={{ maxWidth: 520 }} value={tabelaFilter} onChange={(e) => handleFilterChange(e.target.value)}><option value="">Todas as tabelas de comissão</option>{lookups.tabelasComissao.map((item) => <option key={item.id} value={item.id}>{tabelaLabel(item)}</option>)}</select></div>

      <div className="card"><div className="table-wrapper"><table className="data-table"><thead><tr><th>Tabela</th><th>Forma de Pagamento</th><th>Faixa</th><th>Prazo</th><th>Comissão</th><th>Data Base</th><th style={{ textAlign: 'right' }}>Ações</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr> : items.length === 0 ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: '3rem' }}><div className="empty-state"><Clock size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} /><h3>Nenhum prazo encontrado</h3><p>Cadastre o primeiro prazo comissão.</p></div></td></tr> : items.map((item) => <tr key={item.id}>
          <td><div style={{ fontWeight: 600 }}>{item.tabelas_comissao?.nome || '-'}</div><div style={{ color: 'var(--brs-gray-500)', fontSize: '0.8rem' }}>{item.tabelas_comissao?.financial_institutions?.name || '-'}</div></td>
          <td>{formaPagamentoLabel(item.forma_pagamento)}</td>
          <td>{formaPagamentoUsaFaixa(item.forma_pagamento) ? `${item.valor_inicial ?? '-'} - ${item.valor_final ?? '-'}` : '-'}</td>
          <td>{item.prazo_inicial}/{item.prazo_final}</td>
          <td>{item.comissao ?? '-'}{item.comissao !== null ? (formaPagamentoEmPercentual(item.forma_pagamento) ? '%' : ' R$') : ''}</td>
          <td>{item.data_base ? new Date(`${item.data_base}T12:00:00`).toLocaleDateString('pt-BR') : '-'}</td>
          <td style={{ textAlign: 'right' }}><div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}><button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(item)}><Edit2 size={16} />Editar</button><button type="button" className="btn btn-outline btn-sm" onClick={() => handleDelete(item)} disabled={busyId === item.id}>{busyId === item.id ? <Loader2 size={16} className="spinner" /> : <Trash2 size={16} />}Excluir</button></div></td>
        </tr>)}
      </tbody></table></div></div>

      {isModalOpen && <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}><div className="modal" style={{ maxWidth: 900 }} onClick={(e) => e.stopPropagation()}><form onSubmit={handleSave}>
        <div className="modal-header"><h3 className="modal-title">{editing?.id ? 'Editar Prazo Comissão' : 'Novo Prazo Comissão'}</h3><button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}><X size={20} /></button></div>
        <div className="modal-body">
          <div className="form-group"><label className="form-label">Tabela de Comissão <span className="required">*</span></label><select className="form-control" required value={editing?.tabela_comissao_id || ''} onChange={(e) => setEditing({ ...editing, tabela_comissao_id: e.target.value })}><option value="">Selecione</option>{lookups.tabelasComissao.map((item) => <option key={item.id} value={item.id}>{tabelaLabel(item)}</option>)}</select></div>
          <div className="form-grid form-grid-2" style={{ marginTop: '1rem' }}>
            <div className="form-group"><label className="form-label">Forma de Pagamento</label><select className="form-control" value={editing?.forma_pagamento || 'percentual'} onChange={(e) => setEditing({ ...editing, forma_pagamento: e.target.value })}>{FORMAS_PAGAMENTO_PRAZO.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Data Base</label><input type="date" className="form-control" value={editing?.data_base || ''} onChange={(e) => setEditing({ ...editing, data_base: e.target.value })} /></div>
            {usaFaixa && <><div className="form-group"><label className="form-label">Valor Inicial</label><input type="number" step="0.01" className="form-control" value={editing?.valor_inicial ?? ''} onChange={(e) => setEditing({ ...editing, valor_inicial: numberOrNull(e.target.value) })} /></div><div className="form-group"><label className="form-label">Valor Final</label><input type="number" step="0.01" className="form-control" value={editing?.valor_final ?? ''} onChange={(e) => setEditing({ ...editing, valor_final: numberOrNull(e.target.value) })} /></div></>}
            <div className="form-group"><label className="form-label">Prazo Inicial <span className="required">*</span></label><input type="number" className="form-control" required value={editing?.prazo_inicial ?? ''} onChange={(e) => setEditing({ ...editing, prazo_inicial: intOrZero(e.target.value) })} /></div>
            <div className="form-group"><label className="form-label">Prazo Final <span className="required">*</span></label><input type="number" className="form-control" required value={editing?.prazo_final ?? ''} onChange={(e) => setEditing({ ...editing, prazo_final: intOrZero(e.target.value) })} /></div>
            <div className="form-group"><label className="form-label">Comissão</label><input type="number" step="0.01" className="form-control" value={editing?.comissao ?? ''} onChange={(e) => setEditing({ ...editing, comissao: numberOrNull(e.target.value) })} /></div>
            <div className="form-group"><label className="form-label">Emissão</label><input type="number" step="0.01" className="form-control" value={editing?.emissao ?? ''} onChange={(e) => setEditing({ ...editing, emissao: numberOrNull(e.target.value) })} /></div>
            <div className="form-group"><label className="form-label">Seguro</label><input type="number" step="0.01" className="form-control" value={editing?.seguro ?? ''} onChange={(e) => setEditing({ ...editing, seguro: numberOrNull(e.target.value) })} /></div>
            <div className="form-group"><label className="form-label">Forma Pagamento Seguro</label><select className="form-control" value={editing?.forma_pagamento_seguro || ''} onChange={(e) => setEditing({ ...editing, forma_pagamento_seguro: e.target.value })}><option value="">Não informado</option><option value="percentual">Percentual</option><option value="fixo">Fixo</option></select></div>
            <div className="form-group"><label className="form-label">ID no ARW</label><input type="text" className="form-control" value={editing?.id_arw || ''} onChange={(e) => setEditing({ ...editing, id_arw: e.target.value })} /></div>
            <label className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1.7rem' }}><input type="checkbox" checked={editing?.manter_enquadramento !== false} onChange={(e) => setEditing({ ...editing, manter_enquadramento: e.target.checked })} />Manter enquadramento</label>
          </div>
          <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--brs-gray-200)', paddingTop: '1rem' }}>
            <div style={{ fontWeight: 800, marginBottom: '0.35rem' }}>Comissionamento (prévia de repasses)</div>
            <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>Prévia considera spread 0 quando não cadastrado — os spreads reais vêm do cadastro de Spreads</div>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>Imposto: {selectedInstitution?.imposto_comissao_percent ?? 0}% · Líquido: {preview.liquido ?? '-'}%</div>
            <div className="table-wrapper"><table className="data-table"><thead><tr><th>Tipo de Agente</th><th>% Repasse</th><th>Repasse</th></tr></thead><tbody>{preview.repasses.length === 0 ? <tr><td colSpan={3} style={{ textAlign: 'center', padding: '1rem' }}>Nenhum tipo de agente com percentual cadastrado.</td></tr> : preview.repasses.map((repasse) => <tr key={repasse.tipoAgenteId}><td>{repasse.codigoArw ?? '-'} - {repasse.tipoAgenteNome}</td><td>{repasse.percentualRepasse ?? '-'}%</td><td>{repasse.repasse === null ? '-' : repasse.repasse.toFixed(2)}</td></tr>)}</tbody></table></div>
          </div>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>Cancelar</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <Loader2 size={16} className="spinner" /> : null}Salvar</button></div>
      </form></div></div>}
    </div>
  )
}
