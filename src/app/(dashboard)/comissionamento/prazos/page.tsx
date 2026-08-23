'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, Clock, Edit2, Loader2, Plus, Trash2 } from 'lucide-react'
import {
  calcularGradeComissionamento,
  formaPagamentoEmPercentual,
  type ContextoTabela,
  type LinhaGrade,
  type SpreadRow,
} from '@/lib/comissionamento'
import { excluirPrazoComissao, getComissionamentoLookups, getPrazosComissao, getSpreads, type PrazoComissaoPayload } from '../actions'

type Instituicao = { id: string; name: string; logo_url?: string | null; imposto_comissao_percent: number | null }
type TipoAgente = { id: string; name: string; codigo_arw: number | null; percentual_repasse: number | null }
type TabelaLookup = {
  id: string
  codigo: number | null
  nome: string
  codigo_tabela_banco: string | null
  institution_id: string
  forma_contrato_id: string
  convenio_id: string | null
  tipo_formalizacao_id: string | null
  promotora_id: string | null
  com_seguro: boolean | null
  is_active: boolean
  financial_institutions: Instituicao | null
  formas_contrato: { id: string; nome: string } | null
  convenios: { id: string; nome: string } | null
  promotoras: { id: string; razao_social: string | null; nome_fantasia: string | null } | null
}
type Prazo = PrazoComissaoPayload & {
  id: string
  codigo: number | null
  valor_inicial: number | null
  valor_final: number | null
  data_base: string | null
  data_bloqueio: string | null
  comissao: number | null
  emissao: number | null
  seguro: number | null
  forma_pagamento_seguro: string | null
  id_arw: string | null
  lote_importacao: string | null
  tabelas_comissao: TabelaLookup | null
}
type Lookups = { instituicoes: Instituicao[]; tabelasComissao: TabelaLookup[]; tiposAgente: TipoAgente[] }
type FeedbackMessage = { type: 'success' | 'error'; text: string }

const agenteColumns = ['Prata', 'Ouro', 'Bronze', 'Diamante', 'Rubi', 'Adamantium', 'Latão', 'Lojista/Empresa'] as const

function formatDate(value: string | null | undefined) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR') : '-'
}

function formatValor(value: number | null | undefined, emPercentual: boolean) {
  if (value === null || value === undefined) return '-'
  if (!emPercentual) return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

function seguroBadge(value: boolean | null | undefined) {
  if (value === true) return <span className="badge badge-success">Com</span>
  if (value === false) return <span className="badge badge-gray">Sem</span>
  return '-'
}

function promotoraLabel(item: TabelaLookup | null) {
  return item?.promotoras?.nome_fantasia || item?.promotoras?.razao_social || 'Direto'
}

function normalize(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function matchesAgente(label: string, tipoAgenteNome: string) {
  const nome = normalize(tipoAgenteNome)
  if (label === 'Latão') return nome.includes('latao')
  if (label === 'Lojista/Empresa') return nome.includes('lojista')
  return nome.includes(normalize(label))
}

export default function PrazosComissaoPage() {
  const [items, setItems] = useState<Prazo[]>([])
  const [lookups, setLookups] = useState<Lookups>({ instituicoes: [], tabelasComissao: [], tiposAgente: [] })
  const [spreads, setSpreads] = useState<SpreadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [tabelaFilter, setTabelaFilter] = useState('')

  async function loadData(nextTabela = tabelaFilter) {
    setLoading(true)
    try {
      const [itemsRes, lookupsRes, spreadsRes] = await Promise.all([
        getPrazosComissao(nextTabela || undefined),
        getComissionamentoLookups(),
        getSpreads(),
      ])
      if (itemsRes.success) setItems((itemsRes.items || []) as unknown as Prazo[])
      else setMessage({ type: 'error', text: itemsRes.error || 'Erro ao carregar prazos comissão.' })
      if (lookupsRes.success) {
        setLookups({
          instituicoes: (lookupsRes.instituicoes || []) as Instituicao[],
          tabelasComissao: (lookupsRes.tabelasComissao || []) as unknown as TabelaLookup[],
          tiposAgente: (lookupsRes.tiposAgente || []) as TipoAgente[],
        })
      }
      if (spreadsRes.success) setSpreads((spreadsRes.items || []) as unknown as SpreadRow[])
      else setMessage({ type: 'error', text: spreadsRes.error || 'Erro ao carregar spreads.' })
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

  const gradesPorPrazo = useMemo(() => {
    const tiposAgente = lookups.tiposAgente.filter((tipo) => tipo.percentual_repasse !== null)
    const map = new Map<string, LinhaGrade[]>()
    for (const item of items) {
      const tabela = item.tabelas_comissao
      const contexto: ContextoTabela | null = tabela ? {
        formaContratoId: tabela.forma_contrato_id,
        institutionId: tabela.institution_id,
        convenioId: tabela.convenio_id || null,
        tipoFormalizacaoId: tabela.tipo_formalizacao_id || null,
      } : null
      map.set(item.id, calcularGradeComissionamento({
        valorBase: item.comissao ?? null,
        impostoPercent: tabela?.financial_institutions?.imposto_comissao_percent ?? null,
        usarSpread: true,
        tiposAgente,
        spreads,
        contexto,
      }))
    }
    return map
  }, [items, lookups.tiposAgente, spreads])

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

  function repasseAgente(item: Prazo, label: string) {
    const linha = (gradesPorPrazo.get(item.id) || []).find((grade) => matchesAgente(label, grade.tipoAgenteNome))
    return formatValor(linha?.repasse ?? null, formaPagamentoEmPercentual(item.forma_pagamento))
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
                <th>Código</th>
                <th>Data Base</th>
                <th>Tabela de Comissão</th>
                <th>Prazo</th>
                <th>IF</th>
                <th>Promotora</th>
                <th>Forma Contrato</th>
                <th>Convênio</th>
                <th>Seguro</th>
                <th>Data Bloqueio</th>
                <th>Comissão Empresa</th>
                {agenteColumns.map((column) => <th key={column}>{column}</th>)}
                <th>Lote Importação</th>
                <th>Código ARW</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={22} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={22} style={{ textAlign: 'center', padding: '3rem' }}><div className="empty-state"><Clock size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} /><h3>Nenhum prazo encontrado</h3><p>Cadastre o primeiro prazo comissão.</p></div></td></tr>
              ) : items.map((item) => {
                const tabela = item.tabelas_comissao
                const emPercentual = formaPagamentoEmPercentual(item.forma_pagamento)
                return (
                  <tr key={item.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{item.codigo ?? '-'}</td>
                    <td>{formatDate(item.data_base)}</td>
                    <td style={{ fontWeight: 600 }}>{tabela?.nome || '-'}{tabela?.codigo_tabela_banco ? ` (${tabela.codigo_tabela_banco})` : ''}</td>
                    <td>{item.prazo_inicial} a {item.prazo_final}</td>
                    <td>{tabela?.financial_institutions?.name || '-'}</td>
                    <td>{promotoraLabel(tabela)}</td>
                    <td>{tabela?.formas_contrato?.nome || '-'}</td>
                    <td>{tabela?.convenios?.nome || '-'}</td>
                    <td>{seguroBadge(tabela?.com_seguro)}</td>
                    <td>{formatDate(item.data_bloqueio)}</td>
                    <td>{formatValor(item.comissao, emPercentual)}</td>
                    {agenteColumns.map((column) => <td key={column}>{repasseAgente(item, column)}</td>)}
                    <td>{item.lote_importacao || '-'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{item.id_arw || '-'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.35rem', flexWrap: 'nowrap', justifyContent: 'flex-end', whiteSpace: 'nowrap' }}>
                        <Link href={`/comissionamento/prazos/${item.id}`} className="btn btn-ghost btn-sm btn-acao" title="Editar" aria-label="Editar">
                          <Edit2 size={15} />
                        </Link>
                        <button type="button" className="btn btn-outline btn-sm btn-acao" onClick={() => handleDelete(item)} disabled={busyId === item.id} title="Excluir" aria-label="Excluir">
                          {busyId === item.id ? <Loader2 size={15} className="spinner" /> : <Trash2 size={15} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
