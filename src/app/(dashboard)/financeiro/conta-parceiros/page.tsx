'use client'

import { useState } from 'react'
import { AlertCircle, CheckCircle, Loader2, Search, Wallet } from 'lucide-react'
import { lancarManual, resolverParceiro, type ParceiroResolvido } from '../actions'

type FeedbackMessage = { type: 'success' | 'error'; text: string }

function formatMoney(centavos: number) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function parseReaisToCentavos(value: string) {
  const parsed = Number.parseFloat(value.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}

export default function ContaParceirosPage() {
  const [codigo, setCodigo] = useState('')
  const [parceiro, setParceiro] = useState<ParceiroResolvido | null>(null)
  const [tipo, setTipo] = useState<'credito' | 'debito'>('credito')
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setSearching(true)
    setMessage(null)
    setParceiro(null)
    try {
      const res = await resolverParceiro(codigo)
      if (res.success && res.parceiro) {
        setParceiro(res.parceiro)
      } else {
        setMessage({ type: 'error', text: res.error || 'Parceiro não encontrado.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao buscar parceiro.' })
    } finally {
      setSearching(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!parceiro) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await lancarManual({
        userId: parceiro.userId,
        tipo,
        valorCentavos: parseReaisToCentavos(valor),
        motivo,
      })
      if (res.success) {
        const saldoCentavos = Number(res.saldoCentavos || 0)
        setParceiro({ ...parceiro, saldoCentavos })
        setValor('')
        setMotivo('')
        setMessage({ type: 'success', text: `Lançamento registrado. Novo saldo: ${formatMoney(saldoCentavos)}.` })
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao registrar lançamento.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao registrar lançamento.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Wallet size={18} />
            Lançamentos Manuais
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Ajustes de crédito e débito na conta virtual de parceiros.
          </div>
        </div>
      </div>

      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10, border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`, background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2', color: message.type === 'success' ? '#065F46' : '#991B1B', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      <form onSubmit={handleSearch} className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ flex: 1, minWidth: 240 }}>
          <label className="form-label">Código ARW do parceiro</label>
          <input type="text" className="form-control" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ex.: ABC123" />
        </div>
        <button type="submit" className="btn btn-primary" disabled={searching}>
          {searching ? <Loader2 size={16} className="spinner" /> : <Search size={16} />}
          Buscar
        </button>
      </form>

      {parceiro && (
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
            <div>
              <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)', fontSize: '1rem' }}>{parceiro.nome}</div>
              <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--brs-gray-500)', marginTop: '0.25rem' }}>{parceiro.codigo.toUpperCase()}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.8rem', fontWeight: 700 }}>SALDO ATUAL</div>
              <div style={{ color: parceiro.saldoCentavos > 0 ? '#065F46' : 'var(--brs-gray-900)', fontWeight: 900, fontSize: '1.5rem', marginTop: '0.2rem' }}>
                {formatMoney(parceiro.saldoCentavos)}
              </div>
            </div>
          </div>

          <form onSubmit={handleSave}>
            <div className="form-group">
              <label className="form-label">Tipo</label>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}><input type="radio" checked={tipo === 'credito'} onChange={() => setTipo('credito')} />Crédito</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}><input type="radio" checked={tipo === 'debito'} onChange={() => setTipo('debito')} />Débito</label>
              </div>
            </div>
            <div className="form-grid form-grid-2" style={{ marginTop: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Valor em reais <span className="required">*</span></label>
                <input type="text" className="form-control" required value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Ex.: 1.250,50" />
              </div>
              <div className="form-group">
                <label className="form-label">Motivo <span className="required">*</span></label>
                <textarea className="form-control" required rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem', marginTop: '0.35rem' }}>O motivo aparece no extrato do parceiro</div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <Loader2 size={16} className="spinner" /> : null}
                Registrar lançamento
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
