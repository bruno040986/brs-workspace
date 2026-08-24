'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Loader2, ShieldCheck } from 'lucide-react'
import { certificarCliente, getContatosPendentesCertificacao } from '../actions'

type Pendente = {
  id: string
  cpf: string | null
  nome: string
  telefone: string | null
  funil_estagio: string | null
  convenios?: { id: string; nome: string } | null
  agentes_parceiros?: { id: string; name: string; fantasy_name: string | null } | null
}

type FeedbackMessage = { type: 'success' | 'error'; text: string }

function maskCpf(value: string | null) {
  if (!value) return '-'
  return value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
}

export default function CertificacaoPage() {
  const [items, setItems] = useState<Pendente[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [selecionado, setSelecionado] = useState<Pendente | null>(null)
  const [produto, setProduto] = useState('')
  const [valor, setValor] = useState('')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function loadData() {
    setLoading(true)
    try {
      const res = await getContatosPendentesCertificacao()
      if (res.success) setItems((res.items || []) as unknown as Pendente[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  function abrirCertificacao(item: Pendente) {
    setSelecionado(item)
    setProduto('')
    setValor('')
    setObservacao('')
    setMessage(null)
  }

  async function confirmarCertificacao(e: React.FormEvent) {
    e.preventDefault()
    if (!selecionado) return
    setSalvando(true)
    setMessage(null)
    try {
      const res = await certificarCliente({
        contatoId: selecionado.id,
        produto: produto || undefined,
        valor: valor ? Number.parseFloat(valor.replace(/\./g, '').replace(',', '.')) : null,
        observacao: observacao || undefined,
      })
      if (res.success) {
        setMessage({ type: 'success', text: `${selecionado.nome || 'Cliente'} certificado — tag de cliente aplicada no WeSales.` })
        setSelecionado(null)
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao certificar.' })
      }
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ShieldCheck size={18} />
          Certificação de Clientes
        </div>
        <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Confirma a concretização de uma venda: aplica a tag permanente de cliente no WeSales (o lead nunca mais é realocado a outro parceiro) e registra a carteira do parceiro.
        </div>
      </div>

      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10, border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`, background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2', color: message.type === 'success' ? '#065F46' : '#991B1B', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      {selecionado && (
        <form onSubmit={confirmarCertificacao} className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>
            Certificar {selecionado.nome || maskCpf(selecionado.cpf)} — {selecionado.agentes_parceiros?.fantasy_name || selecionado.agentes_parceiros?.name}
          </div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ minWidth: 200 }}>
              <label className="form-label">Produto</label>
              <input type="text" className="form-control" placeholder="Ex.: Refinanciamento" value={produto} onChange={(e) => setProduto(e.target.value)} />
            </div>
            <div className="form-group" style={{ width: 180 }}>
              <label className="form-label">Valor</label>
              <input type="text" className="form-control" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
            </div>
            <div className="form-group" style={{ flex: 1, minWidth: 220 }}>
              <label className="form-label">Observação</label>
              <input type="text" className="form-control" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" className="btn btn-primary" disabled={salvando}>
                {salvando ? <Loader2 size={16} className="spinner" /> : <ShieldCheck size={16} />}
                Confirmar certificação
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setSelecionado(null)} disabled={salvando}>Cancelar</button>
            </div>
          </div>
        </form>
      )}

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Parceiro</th>
                <th>Nome</th>
                <th>CPF</th>
                <th>Convênio</th>
                <th>Estágio</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '3rem' }}>
                    <div className="empty-state">
                      <ShieldCheck size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                      <h3>Nenhuma certificação pendente</h3>
                      <p>Aparecem aqui os leads movidos para o estágio final no CRM do parceiro.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.agentes_parceiros?.fantasy_name || item.agentes_parceiros?.name || '-'}</td>
                    <td>{item.nome || '-'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{maskCpf(item.cpf)}</td>
                    <td>{item.convenios?.nome || '-'}</td>
                    <td>{item.funil_estagio || '-'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => abrirCertificacao(item)}>Certificar</button>
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
