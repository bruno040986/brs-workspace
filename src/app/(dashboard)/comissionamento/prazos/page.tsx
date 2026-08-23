'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Clock, Edit2, Loader2, Plus, Trash2 } from 'lucide-react'
import { formaPagamentoEmPercentual, formaPagamentoLabel, formaPagamentoUsaFaixa } from '@/lib/comissionamento'
import { excluirPrazoComissao, getComissionamentoLookups, getPrazosComissao, type PrazoComissaoPayload } from '../actions'

type Instituicao = { id: string; name: string; logo_url?: string | null; imposto_comissao_percent: number | null }
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
type Lookups = { instituicoes: Instituicao[]; tabelasComissao: TabelaLookup[] }
type FeedbackMessage = { type: 'success' | 'error'; text: string }

export default function PrazosComissaoPage() {
  const [items, setItems] = useState<Prazo[]>([])
  const [lookups, setLookups] = useState<Lookups>({ instituicoes: [], tabelasComissao: [] })
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [tabelaFilter, setTabelaFilter] = useState('')

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

  function tabelaLabel(item: TabelaLookup) {
    const inst = lookups.instituicoes.find((instituicao) => instituicao.id === item.institution_id)
    return `${inst?.name || 'Instituição'} - ${item.nome}${item.codigo_tabela_banco ? ` (${item.codigo_tabela_banco})` : ''}`
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
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Clock size={18} />
            Prazos Comissão
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>Espelho dos prazos e comissões configurados no ARW.</div>
        </div>
        <Link href="/comissionamento/prazos/novo" className="btn btn-primary">
          <Plus size={16} />
          Novo Prazo
        </Link>
      </div>

      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10, border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`, background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2', color: message.type === 'success' ? '#065F46' : '#991B1B', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem' }}>
        <select className="form-control" style={{ maxWidth: 520 }} value={tabelaFilter} onChange={(e) => handleFilterChange(e.target.value)}>
          <option value="">Todas as tabelas de comissão</option>
          {lookups.tabelasComissao.map((item) => <option key={item.id} value={item.id}>{tabelaLabel(item)}</option>)}
        </select>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Tabela</th>
                <th>Forma de Pagamento</th>
                <th>Faixa</th>
                <th>Prazo</th>
                <th>Comissão</th>
                <th>Data Base</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '3rem' }}><div className="empty-state"><Clock size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} /><h3>Nenhum prazo encontrado</h3><p>Cadastre o primeiro prazo comissão.</p></div></td></tr>
              ) : items.map((item) => (
                <tr key={item.id}>
          <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{(item as any).codigo}</td>
                  <td><div style={{ fontWeight: 600 }}>{item.tabelas_comissao?.nome || '-'}</div><div style={{ color: 'var(--brs-gray-500)', fontSize: '0.8rem' }}>{item.tabelas_comissao?.financial_institutions?.name || '-'}</div></td>
                  <td>{formaPagamentoLabel(item.forma_pagamento)}</td>
                  <td>{formaPagamentoUsaFaixa(item.forma_pagamento) ? `${item.valor_inicial ?? '-'} - ${item.valor_final ?? '-'}` : '-'}</td>
                  <td>{item.prazo_inicial}/{item.prazo_final}</td>
                  <td>{item.comissao ?? '-'}{item.comissao !== null ? (formaPagamentoEmPercentual(item.forma_pagamento) ? '%' : ' R$') : ''}</td>
                  <td>{item.data_base ? new Date(`${item.data_base}T12:00:00`).toLocaleDateString('pt-BR') : '-'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <Link href={`/comissionamento/prazos/${item.id}`} className="btn btn-ghost btn-sm btn-acao" title="Editar" aria-label="Editar">
                        <Edit2 size={15} />
                      </Link>
                      <button type="button" className="btn btn-outline btn-sm btn-acao" onClick={() => handleDelete(item)} disabled={busyId === item.id} title="Excluir" aria-label="Excluir">
                        {busyId === item.id ? <Loader2 size={15} className="spinner" /> : <Trash2 size={15} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
