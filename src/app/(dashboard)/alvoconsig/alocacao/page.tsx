'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Loader2, Send, Undo2 } from 'lucide-react'
import {
  contarContatosParaAlocacao,
  criarLote,
  getConveniosAtivos,
  getLotes,
  getParceirosHabilitados,
  revogarLote,
  type FiltrosAlocacao,
} from '../actions'

type Parceiro = { agenteParceiroId: string; nome: string; cpfCnpj: string }
type Convenio = { id: string; nome: string; codigo: string | null }
type Lote = {
  id: string
  descricao: string
  qtd_contatos: number
  liberado_em: string
  revogado_em: string | null
  agentes_parceiros?: { id: string; name: string; fantasy_name: string | null } | null
}

type FeedbackMessage = { type: 'success' | 'error'; text: string }

function formatDateTimeBR(value: string) {
  try {
    return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return value
  }
}

export default function AlocacaoPage() {
  const [parceiros, setParceiros] = useState<Parceiro[]>([])
  const [convenios, setConvenios] = useState<Convenio[]>([])
  const [lotes, setLotes] = useState<Lote[]>([])
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [parceiroId, setParceiroId] = useState('')
  const [convenioId, setConvenioId] = useState('')
  const [comMargem, setComMargem] = useState(false)
  const [comTroco, setComTroco] = useState(false)
  const [quantidade, setQuantidade] = useState('1000')
  const [descricao, setDescricao] = useState('')
  const [disponiveis, setDisponiveis] = useState<number | null>(null)
  const [criando, setCriando] = useState(false)

  const filtros: FiltrosAlocacao = {
    convenioId: convenioId || undefined,
    comMargem: comMargem || undefined,
    comTroco: comTroco || undefined,
  }

  async function loadData() {
    setLoading(true)
    try {
      const [parceirosRes, conveniosRes, lotesRes] = await Promise.all([
        getParceirosHabilitados(),
        getConveniosAtivos(),
        getLotes(),
      ])
      if (parceirosRes.success) setParceiros((parceirosRes.items || []) as Parceiro[])
      if (conveniosRes.success) setConvenios((conveniosRes.items || []) as Convenio[])
      if (lotesRes.success) setLotes((lotesRes.items || []) as unknown as Lote[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const atualizarDisponiveis = useCallback(async () => {
    setDisponiveis(null)
    const res = await contarContatosParaAlocacao({
      convenioId: convenioId || undefined,
      comMargem: comMargem || undefined,
      comTroco: comTroco || undefined,
    })
    if (res.success) setDisponiveis(res.disponiveis ?? 0)
  }, [convenioId, comMargem, comTroco])

  useEffect(() => {
    atualizarDisponiveis()
  }, [atualizarDisponiveis])

  async function handleCriarLote(e: React.FormEvent) {
    e.preventDefault()
    setCriando(true)
    setMessage(null)
    try {
      const res = await criarLote({
        agenteParceiroId: parceiroId,
        quantidade: Number.parseInt(quantidade, 10),
        descricao,
        filtros,
      })
      if (res.success) {
        setMessage({ type: 'success', text: `Lote criado: ${Number(res.alocados).toLocaleString('pt-BR')} contato(s) liberado(s) para o parceiro.` })
        setDescricao('')
        await Promise.all([loadData(), atualizarDisponiveis()])
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao criar o lote.' })
      }
    } finally {
      setCriando(false)
    }
  }

  async function handleRevogar(lote: Lote) {
    if (!window.confirm(`Revogar o lote de ${lote.qtd_contatos.toLocaleString('pt-BR')} contato(s)? O parceiro perde o acesso aos leads deste lote (o histórico de tabulações permanece).`)) return
    setBusyId(lote.id)
    setMessage(null)
    try {
      const res = await revogarLote(lote.id)
      if (res.success) {
        setMessage({ type: 'success', text: 'Lote revogado. Contatos voltaram para a base disponível.' })
        await Promise.all([loadData(), atualizarDisponiveis()])
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao revogar o lote.' })
      }
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Send size={18} />
          Alocação de Lotes
        </div>
        <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Libere contatos da base para um parceiro habilitado. O dono é definido no nível do contato e pode ser revogado por lote.
        </div>
      </div>

      {message && (
        <div
          style={{
            marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10,
            border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
            background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: message.type === 'success' ? '#065F46' : '#991B1B',
            display: 'flex', gap: '0.5rem', alignItems: 'center',
          }}
        >
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      <form onSubmit={handleCriarLote} className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ minWidth: 240 }}>
            <label className="form-label">Parceiro <span className="required">*</span></label>
            <select className="form-control" required value={parceiroId} onChange={(e) => setParceiroId(e.target.value)}>
              <option value="">Selecione...</option>
              {parceiros.map((parceiro) => (
                <option key={parceiro.agenteParceiroId} value={parceiro.agenteParceiroId}>{parceiro.nome}</option>
              ))}
            </select>
            {parceiros.length === 0 && !loading && (
              <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-400)', marginTop: '0.25rem' }}>
                Nenhum parceiro com AlvoConsig habilitado (aba AlvoConsig no Agente Corban).
              </div>
            )}
          </div>
          <div className="form-group" style={{ minWidth: 200 }}>
            <label className="form-label">Convênio</label>
            <select className="form-control" value={convenioId} onChange={(e) => setConvenioId(e.target.value)}>
              <option value="">Todos</option>
              {convenios.map((conv) => (
                <option key={conv.id} value={conv.id}>{conv.nome}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ width: 140 }}>
            <label className="form-label">Quantidade <span className="required">*</span></label>
            <input type="number" min={1} max={50000} className="form-control" required value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 200 }}>
            <label className="form-label">Descrição</label>
            <input type="text" className="form-control" placeholder="Ex.: Prefeitura SP — 1º lote" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--brs-gray-600)', cursor: 'pointer' }}>
            <input type="checkbox" checked={comMargem} onChange={(e) => setComMargem(e.target.checked)} />
            Apenas com margem
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--brs-gray-600)', cursor: 'pointer' }}>
            <input type="checkbox" checked={comTroco} onChange={(e) => setComTroco(e.target.checked)} />
            Apenas com troco REFIN
          </label>
          <span style={{ fontSize: '0.875rem', color: 'var(--brs-gray-500)' }}>
            Disponíveis com esses filtros:{' '}
            <strong style={{ color: 'var(--brs-gray-800)' }}>
              {disponiveis === null ? '…' : disponiveis.toLocaleString('pt-BR')}
            </strong>
          </span>
          <div style={{ marginLeft: 'auto' }}>
            <button type="submit" className="btn btn-primary" disabled={criando || !parceiroId}>
              {criando ? <Loader2 size={16} className="spinner" /> : <Send size={16} />}
              Liberar lote
            </button>
          </div>
        </div>
      </form>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Parceiro</th>
                <th>Descrição</th>
                <th>Contatos</th>
                <th>Liberado em</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr>
              ) : lotes.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '3rem' }}>
                    <div className="empty-state">
                      <Send size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                      <h3>Nenhum lote liberado</h3>
                      <p>Libere o primeiro lote de contatos para um parceiro.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                lotes.map((lote) => (
                  <tr key={lote.id}>
                    <td style={{ fontWeight: 600 }}>{lote.agentes_parceiros?.fantasy_name || lote.agentes_parceiros?.name || '-'}</td>
                    <td>{lote.descricao || '-'}</td>
                    <td>{lote.qtd_contatos.toLocaleString('pt-BR')}</td>
                    <td style={{ fontSize: '0.85rem' }}>{formatDateTimeBR(lote.liberado_em)}</td>
                    <td>
                      <span className={`badge ${lote.revogado_em ? 'badge-gray' : 'badge-success'}`}>
                        {lote.revogado_em ? 'Revogado' : 'Ativo'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {!lote.revogado_em && (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm btn-acao"
                          onClick={() => handleRevogar(lote)}
                          disabled={busyId === lote.id}
                          title="Revogar"
                          aria-label="Revogar"
                        >
                          {busyId === lote.id ? <Loader2 size={15} className="spinner" /> : <Undo2 size={15} />}
                        </button>
                      )}
                    </td>
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
