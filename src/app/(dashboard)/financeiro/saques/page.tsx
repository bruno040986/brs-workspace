'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Banknote, CheckCircle, Download, Loader2 } from 'lucide-react'
import { aprovarSaque, getSaques, recusarSaque } from '../actions'

type SaqueStatus = 'pendente' | 'pago' | 'recusado' | 'cancelado'
type Saque = {
  id: string
  user_id: string
  valor_centavos: number
  chave_pix: string
  status: SaqueStatus
  observacao: string | null
  criado_em: string
  resolvido_em?: string | null
  parceiro: { codigo: string; nome: string }
}
type FeedbackMessage = { type: 'success' | 'error'; text: string }

const tabs: Array<{ label: string; value: SaqueStatus | '' }> = [
  { label: 'Pendentes', value: 'pendente' },
  { label: 'Pagos', value: 'pago' },
  { label: 'Recusados', value: 'recusado' },
  { label: 'Todos', value: '' },
]

function formatMoney(centavos: number) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '-'
}

function tipoChavePix(chave: string) {
  const clean = String(chave || '').trim()
  const digits = clean.replace(/\D/g, '')
  if (/^\d{11}$/.test(digits) && /^\d+$/.test(clean)) return 'CPF'
  if (/^\d{14}$/.test(digits) && /^\d+$/.test(clean)) return 'CNPJ'
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)) return 'Aleatória'
  if (clean.includes('/ Ag ')) return 'Dados bancários'
  return 'Chave'
}

function statusClass(status: string) {
  if (status === 'pago') return 'badge-success'
  if (status === 'recusado') return 'badge-danger'
  return 'badge-gray'
}

function csvEscape(value: string) {
  const normalized = value.replace(/\r?\n/g, ' ')
  return /[;"]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized
}

export default function SaquesPage() {
  const [items, setItems] = useState<Saque[]>([])
  const [status, setStatus] = useState<SaqueStatus | ''>('pendente')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)

  async function loadData(nextStatus = status) {
    setLoading(true)
    try {
      const res = await getSaques(nextStatus || undefined)
      if (res.success) {
        setItems((res.items || []) as unknown as Saque[])
        setSelectedIds([])
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao carregar pedidos de saque.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar pedidos de saque.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData('pendente')
  }, [])

  const selectedItems = useMemo(() => items.filter((item) => selectedIds.includes(item.id)), [items, selectedIds])
  const pendingItems = useMemo(() => items.filter((item) => item.status === 'pendente'), [items])

  async function setTab(nextStatus: SaqueStatus | '') {
    setStatus(nextStatus)
    await loadData(nextStatus)
  }

  function toggleSelected(id: string) {
    setSelectedIds(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id])
  }

  function toggleAllPending(checked: boolean) {
    setSelectedIds(checked ? pendingItems.map((item) => item.id) : [])
  }

  async function handleApprove(item: Saque) {
    const ok = confirm(`Confirmar pagamento de ${formatMoney(item.valor_centavos)} para a chave ${item.chave_pix}?`)
    if (!ok) return
    const obs = window.prompt('Observação (opcional):')
    setBusyId(item.id)
    setMessage(null)
    try {
      const res = await aprovarSaque(item.id, obs === null ? undefined : obs)
      if (res.success) {
        setMessage({ type: 'success', text: 'Saque aprovado e marcado como pago.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao aprovar saque.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao aprovar saque.' })
    } finally {
      setBusyId(null)
    }
  }

  async function handleReject(item: Saque) {
    const obs = window.prompt('Motivo da recusa (recomendado):')
    if (obs === null) return
    setBusyId(item.id)
    setMessage(null)
    try {
      const res = await recusarSaque(item.id, obs)
      if (res.success) {
        setMessage({ type: 'success', text: 'Saque recusado.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao recusar saque.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao recusar saque.' })
    } finally {
      setBusyId(null)
    }
  }

  function exportCsv() {
    if (selectedItems.length === 0) {
      setMessage({ type: 'error', text: 'Selecione ao menos um saque pendente para exportar.' })
      return
    }
    const rows = selectedItems.map((item) => [
      formatDateTime(item.criado_em),
      item.parceiro.codigo.toUpperCase(),
      item.parceiro.nome,
      (item.valor_centavos / 100).toFixed(2).replace('.', ','),
      tipoChavePix(item.chave_pix),
      item.chave_pix,
    ])
    const csv = [
      'data_pedido;codigo;parceiro;valor_reais;tipo_chave;chave_pix',
      ...rows.map((row) => row.map((cell) => csvEscape(String(cell))).join(';')),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `remessa-saques-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Banknote size={18} />
            Pedidos de Saque
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>Aprovação, recusa e exportação dos saques solicitados por parceiros.</div>
        </div>
        <button type="button" className="btn btn-primary" onClick={exportCsv}>
          <Download size={16} />
          Exportar remessa CSV (selecionados)
        </button>
      </div>

      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10, border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`, background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2', color: message.type === 'success' ? '#065F46' : '#991B1B', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {tabs.map((tab) => (
          <button key={tab.label} type="button" className={`btn btn-sm ${status === tab.value ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab(tab.value)}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th><input type="checkbox" checked={pendingItems.length > 0 && pendingItems.every((item) => selectedIds.includes(item.id))} onChange={(e) => toggleAllPending(e.target.checked)} /></th>
                <th>Data do pedido</th>
                <th>Código</th>
                <th>Parceiro</th>
                <th>Valor</th>
                <th>Tipo da chave</th>
                <th>Chave Pix</th>
                <th>Status</th>
                <th>Observação</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: '3rem' }}><div className="empty-state"><Banknote size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} /><h3>Nenhum saque encontrado</h3><p>Não há pedidos para o filtro selecionado.</p></div></td></tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.status === 'pendente' ? <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelected(item.id)} /> : null}</td>
                    <td>{formatDateTime(item.criado_em)}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{item.parceiro.codigo.toUpperCase() || '-'}</td>
                    <td style={{ fontWeight: 600 }}>{item.parceiro.nome || '-'}</td>
                    <td>{formatMoney(item.valor_centavos)}</td>
                    <td>{tipoChavePix(item.chave_pix)}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem', whiteSpace: 'normal', wordBreak: 'break-word', minWidth: 180 }}>{item.chave_pix || '-'}</td>
                    <td><span className={`badge ${statusClass(item.status)}`}>{item.status}</span></td>
                    <td>{item.observacao || '-'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {item.status === 'pendente' ? (
                        <div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => handleApprove(item)} disabled={busyId === item.id}>
                            {busyId === item.id ? <Loader2 size={16} className="spinner" /> : null}
                            Aprovar e pagar
                          </button>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => handleReject(item)} disabled={busyId === item.id}>
                            Recusar
                          </button>
                        </div>
                      ) : '-'}
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
