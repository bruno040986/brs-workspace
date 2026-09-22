'use client'

import { useMemo, useState } from 'react'
import {
  AlertCircle,
  Building2,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  HelpCircle,
  Info,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react'
import { parseClient, parseLoans } from '@/lib/portability/parser'
import {
  DEFAULT_BANK_RULES,
  DEFAULT_GENERAL_RULES,
  DEFAULT_PORT_COEFF,
  evalAll,
} from '@/lib/portability/evaluator'
import {
  ClientePortabilidade,
  ConfiguracoesGeraisPortabilidade,
  ContratoPortabilidade,
  ConvenioTipo,
  RegraBancoPortabilidade,
} from '@/lib/portability/types'

interface Props {
  convenios: Array<{ id: string; nome: string; codigo: string }>
  financialInstitutions: Array<{ id: string; name: string; logo_url?: string }>
  initialRules: RegraBancoPortabilidade[]
  initialGeneralConfig: ConfiguracoesGeraisPortabilidade
}

function formatCPF(cpf: string) {
  const d = cpf.replace(/\D/g, '')
  if (d.length !== 11) return cpf
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

function formatNB(nb: string) {
  const d = nb.replace(/\D/g, '')
  if (d.length === 10) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  }
  return nb
}

function formatPhone(phone: string) {
  if (!phone) return '—'
  const d = phone.replace(/\D/g, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return phone
}

function money(v: number | null | undefined) {
  if (v == null || !isFinite(v)) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function pct(v: number | null | undefined) {
  if (v == null || !isFinite(v)) return '—'
  return `${v.toFixed(2).replace('.', ',')}%`
}

export default function SimuladorPortabilidadeClient({
  convenios,
  financialInstitutions,
  initialRules,
  initialGeneralConfig,
}: Props) {
  const [selectedConvenio, setSelectedConvenio] = useState<ConvenioTipo>('INSS')
  const [inputText, setInputText] = useState('')
  const [rules, setRules] = useState<RegraBancoPortabilidade[]>(initialRules)
  const [generalConfig, setGeneralConfig] = useState<ConfiguracoesGeraisPortabilidade>(initialGeneralConfig)
  const [portCoeff, setPortCoeff] = useState<number>(DEFAULT_PORT_COEFF)
  const [newCoeffs, setNewCoeffs] = useState<Record<string, number>>({ FACTA: 0.023896, BMG: 0.02245 })

  const [client, setClient] = useState<ClientePortabilidade | null>(null)
  const [loans, setLoans] = useState<ContratoPortabilidade[]>([])
  const [selectedNewBank, setSelectedNewBank] = useState<string>('FACTA')

  const [selections, setSelections] = useState<{
    newContract: boolean
    ports: Record<string, boolean>
  }>({
    newContract: true,
    ports: {},
  })

  const [isConfigOpen, setIsConfigOpen] = useState(false)
  const [copyToast, setCopyToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setCopyToast(msg)
    setTimeout(() => setCopyToast(null), 2500)
  }

  function handleAnalisar() {
    if (!inputText.trim()) return
    const parsedClient = parseClient(inputText, selectedConvenio)
    const parsedLoans = parseLoans(inputText)

    setClient(parsedClient)
    setLoans(parsedLoans)

    // Inicializar seleções
    const initialPorts: Record<string, boolean> = {}
    parsedLoans.forEach((l, i) => {
      initialPorts[l.contract || String(i)] = true
    })
    setSelections({
      newContract: true,
      ports: initialPorts,
    })
  }

  function handleLimpar() {
    setInputText('')
    setClient(null)
    setLoans([])
    setSelections({ newContract: true, ports: {} })
  }

  const bundles = useMemo(() => {
    if (!client || !loans.length) return []
    return evalAll(loans, client, rules, { ...generalConfig, defaultPortCoeff: portCoeff })
  }, [client, loans, rules, generalConfig, portCoeff])

  const newContractCoeff = newCoeffs[selectedNewBank] || 0.023896
  const newContractValue = useMemo(() => {
    if (!client?.margin || !newContractCoeff) return null
    return client.margin / newContractCoeff
  }, [client, newContractCoeff])

  function handleCopyProposal() {
    if (!client) return
    const lines: string[] = [
      `*BRS GESTÃO — SIMULAÇÃO DE PORTABILIDADE*`,
      `*Convênio:* ${selectedConvenio}`,
      `*Cliente:* ${client.name}`,
      `*CPF:* ${client.cpf ? formatCPF(client.cpf) : '—'}`,
      '',
    ]

    if (selections.newContract && newContractValue && newContractValue > 0) {
      lines.push('*MARGEM NOVA*')
      lines.push(`Banco: ${selectedNewBank}`)
      lines.push(`Parcela: ${money(client.margin)}`)
      lines.push(`Prazo: 84x / 108x`)
      lines.push(`Valor liberado: ${money(newContractValue)}`)
      lines.push('----------------')
    }

    bundles.forEach((b, idx) => {
      const key = b.loan.contract || String(idx)
      if (!selections.ports[key]) return

      const best = b.results
        .filter((x) => x.evaluation.status === 'ok' && x.evaluation.release != null && x.evaluation.release > 0)
        .sort((a, z) => (z.evaluation.release || 0) - (a.evaluation.release || 0))[0]

      if (!best) return

      lines.push('*PORTABILIDADE*')
      lines.push(`Banco de Origem: ${b.loan.originLabel || b.loan.origin}`)
      lines.push(`Contrato: ${b.loan.contract || '—'}`)
      lines.push(`Parcela: ${money(b.loan.installment)}`)
      lines.push(`Saldo Devedor: ${money(b.loan.debt)}`)
      lines.push(`Melhor Opção: ${best.bank.name}`)
      lines.push(`Valor Liberado (Troco): ${money(best.evaluation.release)}`)
      lines.push('----------------')
    })

    if (lines[lines.length - 1] === '----------------') lines.pop()

    const textToCopy = lines.join('\n')
    navigator.clipboard.writeText(textToCopy).then(() => {
      showToast('Simulação copiada para a área de transferência!')
    })
  }

  function handleCopyCPF() {
    if (!client?.cpf) return
    navigator.clipboard.writeText(formatCPF(client.cpf)).then(() => {
      showToast('CPF copiado!')
    })
  }

  return (
    <div style={{ paddingBottom: '3rem' }}>
      {/* Toast Notification */}
      {copyToast && (
        <div
          style={{
            position: 'fixed',
            bottom: '1.5rem',
            right: '1.5rem',
            background: 'var(--brs-navy, #17384B)',
            color: '#fff',
            padding: '0.75rem 1.25rem',
            borderRadius: '999px',
            fontSize: '0.875rem',
            fontWeight: 700,
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <CheckCircle2 size={18} color="#10B981" />
          {copyToast}
        </div>
      )}

      {/* Top Header */}
      <div
        style={{
          background: 'linear-gradient(135deg, #17384B 0%, #2A5268 100%)',
          color: '#fff',
          borderRadius: '16px',
          padding: '1.25rem 1.5rem',
          boxShadow: '0 8px 24px rgba(23,56,75,0.12)',
          marginBottom: '1.25rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Calculator size={24} color="#D97706" />
            Simulador de Portabilidade BRS
          </h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#DCE6EF' }}>
            Cole a consulta de benefício, identifique o cliente e analise em tempo real os bancos elegíveis para portabilidade e margem livre.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            type="button"
            className="btn"
            style={{
              background: 'rgba(255,255,255,0.12)',
              border: '1px solid rgba(255,255,255,0.25)',
              color: '#fff',
              fontSize: '0.85rem',
              fontWeight: 700,
              padding: '0.6rem 1rem',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              cursor: 'pointer',
            }}
            onClick={() => setIsConfigOpen(true)}
          >
            <Settings size={16} />
            Regras & Coeficientes
          </button>
        </div>
      </div>

      {/* Top Controls Grid */}
      <div className="grid-2-col" style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
        {/* Step 1: Input Panel */}
        <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--brs-navy, #17384B)' }}>
              1. Cole aqui o extrato ou consulta
            </h2>

            {/* Convênio Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>Convênio:</span>
              <select
                className="form-control"
                style={{ width: '130px', padding: '0.35rem 0.6rem', fontSize: '0.85rem', fontWeight: 700 }}
                value={selectedConvenio}
                onChange={(e) => setSelectedConvenio(e.target.value as ConvenioTipo)}
              >
                <option value="INSS">INSS</option>
                <option value="SIAPE">SIAPE</option>
                <option value="OUTROS">OUTROS</option>
              </select>
            </div>
          </div>

          <textarea
            className="form-control"
            style={{
              height: '160px',
              fontFamily: 'ui-monospace, monospace',
              fontSize: '0.82rem',
              lineHeight: 1.4,
              resize: 'vertical',
            }}
            placeholder="Cole o texto da consulta do extrato (INSS / SIAPE / Vanguard / Promosys)..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
          />

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>
              {loans.length > 0 ? `${loans.length} contrato(s) identificado(s)` : 'Aguardando consulta'}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="btn btn-outline" onClick={handleLimpar}>
                Limpar
              </button>
              <button type="button" className="btn btn-primary" onClick={handleAnalisar} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Sparkles size={16} />
                Analisar Portabilidade
              </button>
            </div>
          </div>
        </div>

        {/* Step 2: Client Summary Card */}
        <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--brs-navy, #17384B)' }}>
              2. Pré-Cadastro do Cliente
            </h2>
            {client?.cpf && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleCopyCPF}
                style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <Copy size={14} /> Copiar CPF
              </button>
            )}
          </div>

          {!client ? (
            <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--brs-gray-400)', fontSize: '0.875rem' }}>
              Cole uma consulta ao lado e clique em **Analisar Portabilidade** para visualizar os dados do cliente.
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.6rem' }}>
                <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '0.5rem 0.75rem' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--brs-gray-500)', fontWeight: 700, textTransform: 'uppercase' }}>Cliente</span>
                  <strong style={{ display: 'block', fontSize: '0.875rem', color: 'var(--brs-navy)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {client.name}
                  </strong>
                </div>

                <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '0.5rem 0.75rem' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--brs-gray-500)', fontWeight: 700, textTransform: 'uppercase' }}>CPF</span>
                  <strong style={{ display: 'block', fontSize: '0.875rem', color: 'var(--brs-navy)' }}>
                    {client.cpf ? formatCPF(client.cpf) : '—'}
                  </strong>
                </div>

                <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '0.5rem 0.75rem' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--brs-gray-500)', fontWeight: 700, textTransform: 'uppercase' }}>Benefício / Matrícula</span>
                  <strong style={{ display: 'block', fontSize: '0.875rem', color: 'var(--brs-navy)' }}>
                    {client.nb ? formatNB(client.nb) : '—'}
                  </strong>
                </div>

                <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '0.5rem 0.75rem' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--brs-gray-500)', fontWeight: 700, textTransform: 'uppercase' }}>Nascimento / Idade</span>
                  <strong style={{ display: 'block', fontSize: '0.875rem', color: 'var(--brs-navy)' }}>
                    {client.dob} {client.age != null ? `• ${client.age} anos` : ''}
                  </strong>
                </div>

                <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '0.5rem 0.75rem', gridColumn: 'span 2' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--brs-gray-500)', fontWeight: 700, textTransform: 'uppercase' }}>Espécie / Cargo</span>
                  <strong style={{ display: 'block', fontSize: '0.85rem', color: 'var(--brs-navy)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {client.species}
                  </strong>
                </div>
              </div>

              {/* Novo Contrato / Margem Extra */}
              <div
                style={{
                  background: '#F0FDF4',
                  border: '1px solid #BBF7D0',
                  borderRadius: '12px',
                  padding: '0.75rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase' }}>Margem Livre Disponível</span>
                  <div style={{ fontSize: '1.15rem', fontWeight: 900, color: '#15803D' }}>
                    {money(client.margin)}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>Novo Liberado:</span>
                  <div style={{ fontSize: '1.15rem', fontWeight: 900, color: '#15803D' }}>
                    {money(newContractValue)}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Results Header & Actions */}
      {bundles.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--brs-navy)' }}>
            3. Resultado dos Bancos por Contrato ({bundles.length})
          </h2>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleCopyProposal}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.2rem', fontWeight: 700 }}
          >
            <Copy size={16} />
            Copiar Simulação Formatada para WhatsApp
          </button>
        </div>
      )}

      {/* Loans & Banks List */}
      <div style={{ display: 'grid', gap: '1rem' }}>
        {bundles.map((bundle, idx) => {
          const l = bundle.loan
          const key = l.contract || String(idx)
          const isSelected = selections.ports[key] ?? true
          const shownResults = bundle.results.slice(0, 8)

          const positives = bundle.results.filter(
            (x) => x.evaluation.status === 'ok' && x.evaluation.release != null && x.evaluation.release > 0
          )
          const bestObj = positives.sort((a, b) => (b.evaluation.release || 0) - (a.evaluation.release || 0))[0] || null
          const bestRelease = bestObj ? bestObj.evaluation.release : null

          return (
            <div
              key={l.id}
              className="card"
              style={{
                padding: '1rem 1.25rem',
                borderLeft: '5px solid #2A5268',
                boxShadow: '0 4px 14px rgba(0,0,0,0.04)',
              }}
            >
              {/* Loan Identity Header */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.4fr repeat(5, minmax(90px, 1fr))',
                  gap: '0.75rem',
                  alignItems: 'center',
                  paddingBottom: '0.85rem',
                  borderBottom: '1px solid #E2E8F0',
                  marginBottom: '0.85rem',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => setSelections({ ...selections, ports: { ...selections.ports, [key]: e.target.checked } })}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <strong style={{ fontSize: '1rem', color: 'var(--brs-navy)' }}>
                      {idx + 1}. {l.originLabel || l.origin}
                    </strong>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)', marginTop: '0.2rem' }}>
                    Contrato: {l.contract || '—'}
                  </div>
                </div>

                <div style={{ background: '#F8FAFC', padding: '0.4rem 0.6rem', borderRadius: '8px' }}>
                  <span style={{ fontSize: '0.68rem', color: 'var(--brs-gray-500)', textTransform: 'uppercase', fontWeight: 700 }}>Parcela</span>
                  <div style={{ fontSize: '0.95rem', fontWeight: 900, color: 'var(--brs-navy)' }}>{money(l.installment)}</div>
                </div>

                <div style={{ background: '#F8FAFC', padding: '0.4rem 0.6rem', borderRadius: '8px' }}>
                  <span style={{ fontSize: '0.68rem', color: 'var(--brs-gray-500)', textTransform: 'uppercase', fontWeight: 700 }}>Saldo Devedor</span>
                  <div style={{ fontSize: '0.95rem', fontWeight: 900, color: '#DC2626' }}>{money(l.debt)}</div>
                </div>

                <div style={{ background: '#F8FAFC', padding: '0.4rem 0.6rem', borderRadius: '8px' }}>
                  <span style={{ fontSize: '0.68rem', color: 'var(--brs-gray-500)', textTransform: 'uppercase', fontWeight: 700 }}>Pagas / Total</span>
                  <div style={{ fontSize: '0.88rem', fontWeight: 800 }}>
                    {l.paid ?? '—'} / {l.total ?? '—'}
                  </div>
                </div>

                <div style={{ background: '#F8FAFC', padding: '0.4rem 0.6rem', borderRadius: '8px' }}>
                  <span style={{ fontSize: '0.68rem', color: 'var(--brs-gray-500)', textTransform: 'uppercase', fontWeight: 700 }}>Taxa Original</span>
                  <div style={{ fontSize: '0.88rem', fontWeight: 800 }}>{pct(l.rate)}</div>
                </div>

                <div
                  style={{
                    background: bestRelease && bestRelease > 0 ? '#ECFDF5' : '#FEF2F2',
                    border: `1px solid ${bestRelease && bestRelease > 0 ? '#A7F3D0' : '#FECACA'}`,
                    padding: '0.4rem 0.6rem',
                    borderRadius: '8px',
                  }}
                >
                  <span style={{ fontSize: '0.68rem', color: bestRelease && bestRelease > 0 ? '#065F46' : '#991B1B', textTransform: 'uppercase', fontWeight: 700 }}>
                    Melhor Liberado
                  </span>
                  <div style={{ fontSize: '1.05rem', fontWeight: 900, color: bestRelease && bestRelease > 0 ? '#059669' : '#DC2626' }}>
                    {money(bestRelease)}
                  </div>
                </div>
              </div>

              {/* Bank Grid Badges */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '0.5rem' }}>
                {shownResults.map(({ bank, evaluation }) => {
                  const isOk = evaluation.status === 'ok'
                  const isPending = evaluation.status === 'pending'

                  return (
                    <div
                      key={bank.id}
                      style={{
                        background: isOk ? '#F0FDF4' : isPending ? '#FFFBEB' : '#FEF2F2',
                        border: `1px solid ${isOk ? '#BBF7D0' : isPending ? '#FDE68A' : '#FECACA'}`,
                        borderRadius: '10px',
                        padding: '0.45rem 0.6rem',
                        fontSize: '0.78rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                        <strong style={{ fontSize: '0.78rem', color: 'var(--brs-navy)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {bank.name}
                        </strong>
                        {isOk ? (
                          <span style={{ color: '#16A34A', fontWeight: 900, fontSize: '0.75rem' }}>✓ SIM</span>
                        ) : isPending ? (
                          <span style={{ color: '#D97706', fontWeight: 900, fontSize: '0.72rem' }}>! CONF</span>
                        ) : (
                          <span style={{ color: '#DC2626', fontWeight: 900, fontSize: '0.75rem' }}>× NÃO</span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: '0.68rem',
                          color: isOk ? '#15803D' : isPending ? '#B45309' : '#B91C1C',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={evaluation.reason}
                      >
                        {isOk ? (evaluation.release ? money(evaluation.release) : 'Aprovado') : evaluation.reason}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Settings Modal */}
      {isConfigOpen && (
        <div className="modal-backdrop" onClick={() => setIsConfigOpen(false)}>
          <div className="modal" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Settings size={20} /> Configuração de Coeficientes & Regras
              </h3>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsConfigOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'grid', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Coeficiente Padrão de Portabilidade</label>
                <input
                  type="number"
                  step="0.00001"
                  className="form-control"
                  value={portCoeff}
                  onChange={(e) => setPortCoeff(parseFloat(e.target.value) || DEFAULT_PORT_COEFF)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Coeficiente Novo Facta</label>
                <input
                  type="number"
                  step="0.00001"
                  className="form-control"
                  value={newCoeffs.FACTA || 0.023896}
                  onChange={(e) => setNewCoeffs({ ...newCoeffs, FACTA: parseFloat(e.target.value) || 0.023896 })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Coeficiente Novo BMG</label>
                <input
                  type="number"
                  step="0.00001"
                  className="form-control"
                  value={newCoeffs.BMG || 0.02245}
                  onChange={(e) => setNewCoeffs({ ...newCoeffs, BMG: parseFloat(e.target.value) || 0.02245 })}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-primary" onClick={() => setIsConfigOpen(false)}>
                Salvar Regras
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
