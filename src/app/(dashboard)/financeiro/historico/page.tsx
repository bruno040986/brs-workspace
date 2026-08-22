'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, History, Loader2, Search } from 'lucide-react'
import { getHistorico } from '../actions'

type Parceiro = { codigo: string; nome: string }
type Lancamento = {
  id: string
  criado_em: string
  tipo: 'credito' | 'debito'
  valor_centavos: number
  motivo: string | null
  saldo_apos_centavos: number
  criado_por_nome: string
  parceiro: Parceiro
}
type SaqueResolvido = {
  id: string
  criado_em: string
  resolvido_em: string | null
  valor_centavos: number
  chave_pix: string
  status: 'pago' | 'recusado' | 'cancelado'
  observacao: string | null
  resolvido_por_nome: string
  parceiro: Parceiro
}
type FeedbackMessage = { type: 'success' | 'error'; text: string }

function formatMoney(centavos: number) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '-'
}

function saqueStatusClass(status: string) {
  if (status === 'pago') return 'badge-success'
  if (status === 'recusado') return 'badge-danger'
  return 'badge-gray'
}

export default function HistoricoFinanceiroPage() {
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([])
  const [saques, setSaques] = useState<SaqueResolvido[]>([])
  const [codigoParceiro, setCodigoParceiro] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)

  async function loadData(filters = { codigoParceiro, dataInicio, dataFim }) {
    setLoading(true)
    setMessage(null)
    try {
      const res = await getHistorico({
        codigoParceiro: filters.codigoParceiro || undefined,
        dataInicio: filters.dataInicio || undefined,
        dataFim: filters.dataFim || undefined,
      })
      if (res.success) {
        setLancamentos((res.lancamentos || []) as unknown as Lancamento[])
        setSaques((res.saques || []) as unknown as SaqueResolvido[])
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao carregar histórico.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar histórico.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData({ codigoParceiro: '', dataInicio: '', dataFim: '' })
  }, [])

  async function handleFilter(e: React.FormEvent) {
    e.preventDefault()
    await loadData()
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <History size={18} />
            Histórico
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>Consulta de ajustes manuais e saques resolvidos da conta virtual.</div>
        </div>
      </div>

      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10, border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`, background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2', color: message.type === 'success' ? '#065F46' : '#991B1B', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      <form onSubmit={handleFilter} className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ minWidth: 220, flex: 1 }}>
          <label className="form-label">Código ARW</label>
          <input type="text" className="form-control" value={codigoParceiro} onChange={(e) => setCodigoParceiro(e.target.value)} placeholder="Opcional" />
        </div>
        <div className="form-group">
          <label className="form-label">Data início</label>
          <input type="date" className="form-control" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Data fim</label>
          <input type="date" className="form-control" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? <Loader2 size={16} className="spinner" /> : <Search size={16} />}
          Filtrar
        </button>
      </form>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ padding: '1rem', borderBottom: '1px solid var(--brs-gray-200)', fontWeight: 800 }}>Ajustes manuais</div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Código</th>
                <th>Parceiro</th>
                <th>Tipo</th>
                <th>Valor</th>
                <th>Motivo</th>
                <th>Saldo após</th>
                <th>Feito por</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr>
              ) : lancamentos.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>Nenhum ajuste manual encontrado.</td></tr>
              ) : (
                lancamentos.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.criado_em)}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{item.parceiro.codigo.toUpperCase() || '-'}</td>
                    <td style={{ fontWeight: 600 }}>{item.parceiro.nome || '-'}</td>
                    <td><span className={`badge ${item.tipo === 'credito' ? 'badge-success' : 'badge-gray'}`}>{item.tipo === 'credito' ? 'Crédito' : 'Débito'}</span></td>
                    <td>{formatMoney(item.valor_centavos)}</td>
                    <td>{item.motivo || '-'}</td>
                    <td>{formatMoney(item.saldo_apos_centavos)}</td>
                    <td>{item.criado_por_nome || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div style={{ padding: '1rem', borderBottom: '1px solid var(--brs-gray-200)', fontWeight: 800 }}>Saques resolvidos</div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Data pedido</th>
                <th>Resolvido em</th>
                <th>Código</th>
                <th>Parceiro</th>
                <th>Valor</th>
                <th>Chave Pix</th>
                <th>Status</th>
                <th>Observação</th>
                <th>Resolvido por</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr>
              ) : saques.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2rem' }}>Nenhum saque resolvido encontrado.</td></tr>
              ) : (
                saques.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.criado_em)}</td>
                    <td>{formatDateTime(item.resolvido_em)}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{item.parceiro.codigo.toUpperCase() || '-'}</td>
                    <td style={{ fontWeight: 600 }}>{item.parceiro.nome || '-'}</td>
                    <td>{formatMoney(item.valor_centavos)}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem', whiteSpace: 'normal', wordBreak: 'break-word' }}>{item.chave_pix || '-'}</td>
                    <td><span className={`badge ${saqueStatusClass(item.status)}`}>{item.status}</span></td>
                    <td>{item.observacao || '-'}</td>
                    <td>{item.resolvido_por_nome || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
