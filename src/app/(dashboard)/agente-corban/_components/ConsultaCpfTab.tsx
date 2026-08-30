'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Loader2, Search, Sparkles, Wallet } from 'lucide-react'
import {
  getConsultaCpfConfig,
  higienizarIncompletosParceiro,
  salvarConsultaCpfConfig,
  type ConsultaCpfConfigView,
} from '../consulta-cpf-actions'

type Message = { type: 'success' | 'error'; text: string } | null

function brl(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function centavosParaInput(centavos: number | null): string {
  if (centavos === null) return ''
  return (centavos / 100).toFixed(2).replace('.', ',')
}

function inputParaCentavos(raw: string): number | null | undefined {
  const texto = raw.trim()
  if (!texto) return null
  const valor = Number(texto.replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(valor) || valor < 0) return undefined
  return Math.round(valor * 100)
}

export default function ConsultaCpfTab({ agenteParceiroId }: { agenteParceiroId: string }) {
  const [carregando, setCarregando] = useState(true)
  const [config, setConfig] = useState<ConsultaCpfConfigView | null>(null)
  const [message, setMessage] = useState<Message>(null)

  const [acordo, setAcordo] = useState('')
  const [faixaModo, setFaixaModo] = useState<'individual' | 'global'>('individual')
  const [cobraCache, setCobraCache] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [higienizando, setHigienizando] = useState(false)

  const loadData = useCallback(async () => {
    setCarregando(true)
    try {
      const res = await getConsultaCpfConfig(agenteParceiroId)
      if (res.success) {
        setConfig(res.config)
        setAcordo(centavosParaInput(res.config.acordoCentavos))
        setFaixaModo(res.config.faixaModo)
        setCobraCache(res.config.cobraCache)
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao carregar a configuração.' })
      }
    } finally {
      setCarregando(false)
    }
  }, [agenteParceiroId])

  useEffect(() => {
    // Carregamento inicial fora do corpo síncrono do effect (regra react-hooks/set-state-in-effect).
    const timer = setTimeout(() => { void loadData() }, 0)
    return () => clearTimeout(timer)
  }, [loadData])

  async function handleSalvar() {
    const acordoCentavos = inputParaCentavos(acordo)
    if (acordoCentavos === undefined) {
      setMessage({ type: 'error', text: 'Informe um valor válido para o acordo de preço (ex.: 0,10) ou deixe em branco.' })
      return
    }
    setSalvando(true)
    setMessage(null)
    try {
      const res = await salvarConsultaCpfConfig({ agenteParceiroId, acordoCentavos, faixaModo, cobraCache })
      if (res.success) {
        setMessage({ type: 'success', text: 'Regras de consulta de CPF salvas para este parceiro.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar.' })
      }
    } finally {
      setSalvando(false)
    }
  }

  async function handleHigienizar() {
    setHigienizando(true)
    setMessage(null)
    try {
      const res = await higienizarIncompletosParceiro(agenteParceiroId)
      if (res.success) {
        const partes = [
          `${res.total} lead(s) com CPF processado(s)`,
          `${res.ok} OK (${res.cache} do cache)`,
          `${res.erros} com erro`,
        ]
        setMessage({
          type: res.bloqueado ? 'error' : 'success',
          text: res.bloqueado ? `${partes.join(' · ')}. Interrompido: ${res.bloqueado}` : `${partes.join(' · ')}.`,
        })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao higienizar.' })
      }
    } finally {
      setHigienizando(false)
    }
  }

  if (carregando || !config) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem' }}>
        {carregando ? <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /> : null}
        {!carregando && message ? <span style={{ color: '#991B1B', fontSize: '0.875rem' }}>{message.text}</span> : null}
      </div>
    )
  }

  const cardStyle = { padding: '1rem', border: '1px solid var(--brs-gray-200)', borderRadius: 12 } as const
  const statStyle = { display: 'grid', gap: '0.2rem', minWidth: 160 } as const
  const statLabel = { fontSize: '0.75rem', color: 'var(--brs-gray-500)', fontWeight: 600, textTransform: 'uppercase' } as const
  const statValue = { fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)' } as const

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>
        <Search size={18} />
        Consulta de CPF (paga pelo parceiro)
      </div>
      <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.875rem', marginTop: '-0.5rem' }}>
        Regras internas da consulta unitária de CPF que o parceiro faz no CRM AlvoConsig, debitada da conta virtual.
        Custo BRS, margem e modo de faixa nunca são exibidos ao parceiro.
      </div>

      {message && (
        <div
          style={{
            padding: '0.875rem 1rem', borderRadius: 10,
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

      <div style={{ ...cardStyle, display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={statStyle}>
          <span style={statLabel}>Saldo da carteira</span>
          <span style={{ ...statValue, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Wallet size={16} /> {brl(config.saldoCentavos / 100)}
          </span>
          {!config.temCarteira && (
            <span style={{ fontSize: '0.75rem', color: '#92400E' }}>Parceiro ainda sem conta virtual (nasce no 1º crédito).</span>
          )}
        </div>
        <div style={statStyle}>
          <span style={statLabel}>Consultas no mês</span>
          <span style={statValue}>{config.consultasMes.toLocaleString('pt-BR')}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>Próxima: {brl(config.precoProximaCentavos / 100)}</span>
        </div>
        <div style={statStyle}>
          <span style={statLabel}>Leads com dados incompletos (7 dias)</span>
          <span style={statValue}>{config.incompletos7d.toLocaleString('pt-BR')}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>{config.incompletosComCpf.toLocaleString('pt-BR')} com CPF</span>
        </div>
        <button
          type="button"
          className="btn btn-outline"
          onClick={handleHigienizar}
          disabled={higienizando || config.incompletosComCpf === 0}
          title="Higieniza pela NVTI (custo da BRS, sem cobrar o parceiro) até 200 leads por clique"
        >
          {higienizando ? <Loader2 size={16} className="spinner" /> : <Sparkles size={16} />}
          Higienizar os que têm CPF
        </button>
      </div>

      <div style={cardStyle}>
        <div style={{ fontWeight: 700, color: 'var(--brs-gray-800)', marginBottom: '0.75rem' }}>Tabela de preços (cascata mensal)</div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Faixa</th>
              <th style={{ textAlign: 'right' }}>Custo BRS</th>
              <th style={{ textAlign: 'right' }}>Preço padrão parceiros</th>
              <th style={{ textAlign: 'right' }}>Margem</th>
            </tr>
          </thead>
          <tbody>
            {config.tiers.map((tier) => (
              <tr key={tier.faixa}>
                <td>{tier.faixa} consultas</td>
                <td style={{ textAlign: 'right' }}>{brl(tier.custoBrs)}</td>
                <td style={{ textAlign: 'right' }}>{brl(tier.precoParceiro)}</td>
                <td style={{ textAlign: 'right', color: tier.margemPercent !== null && tier.margemPercent < 0 ? '#991B1B' : undefined }}>
                  {tier.margemPercent === null ? '—' : `${tier.margemPercent.toLocaleString('pt-BR')}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ color: 'var(--brs-gray-400)', fontSize: '0.78rem', marginTop: '0.5rem' }}>
          A tabela é editada em Configurações → API Nova Vida TI. Aqui só o acordo deste parceiro.
        </div>
      </div>

      <div style={{ ...cardStyle, display: 'grid', gap: '0.9rem' }}>
        <div className="form-group" style={{ width: 320, margin: 0 }}>
          <label className="form-label">Acordo de preço deste parceiro (R$ por consulta)</label>
          <input
            type="text"
            className="form-control"
            value={acordo}
            onChange={(e) => setAcordo(e.target.value)}
            inputMode="decimal"
            placeholder="Em branco = usa a tabela"
          />
        </div>

        <div style={{ display: 'grid', gap: '0.4rem' }}>
          <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--brs-gray-800)' }}>Faixa da tabela (quando não há acordo)</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
            <input type="radio" name="faixaModo" checked={faixaModo === 'individual'} onChange={() => setFaixaModo('individual')} />
            Faixa pelo volume mensal individual (padrão)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
            <input type="radio" name="faixaModo" checked={faixaModo === 'global'} onChange={() => setFaixaModo('global')} />
            Faixa pelo volume global da BRS
          </label>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, color: 'var(--brs-gray-800)' }}>
          <input type="checkbox" checked={cobraCache} onChange={(e) => setCobraCache(e.target.checked)} />
          Cobrar consulta mesmo em cache de {config.cacheDays} dias (padrão)
        </label>

        <div>
          <button type="button" className="btn btn-primary" onClick={handleSalvar} disabled={salvando}>
            {salvando ? <Loader2 size={16} className="spinner" /> : null}
            Salvar regras de consulta
          </button>
        </div>
      </div>
    </div>
  )
}
