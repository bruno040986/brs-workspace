'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, Coins, Loader2 } from 'lucide-react'
import { GATEWAY_CAMPOS, gatewayUsaTaxaPercentual } from '@/lib/gateways'
import { getGateways, limparCredencialGateway, saveGateway } from './actions'

type CredencialGateway = { key: string; preenchido: boolean; mascarado: string }

type Gateway = {
  id: string
  nome: string
  ativo: boolean
  modo: 'teste' | 'producao'
  taxa_percentual_bps: number | null
  taxa_fixa_centavos: number | null
  atualizado_em: string | null
  credenciais: CredencialGateway[]
}

type GatewayForm = {
  ativo: boolean
  modo: 'teste' | 'producao'
  taxa: string
  credenciais: Record<string, string>
  substituindo: string[]
}

type FeedbackMessage = { type: 'success' | 'error'; text: string }

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''
}

function percentFromBps(value: number | null) {
  return value === null ? '' : (value / 100).toFixed(2).replace('.', ',')
}

function reaisFromCentavos(value: number | null) {
  return value === null ? '' : (value / 100).toFixed(2).replace('.', ',')
}

function parseDecimal(value: string) {
  const parsed = Number.parseFloat(String(value || '').replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

function buildForm(gateway: Gateway): GatewayForm {
  return {
    ativo: gateway.ativo,
    modo: gateway.modo,
    taxa: gatewayUsaTaxaPercentual(gateway.id)
      ? percentFromBps(gateway.taxa_percentual_bps)
      : reaisFromCentavos(gateway.taxa_fixa_centavos),
    credenciais: {},
    substituindo: [],
  }
}

export default function GatewaysPagamentoPage() {
  const [items, setItems] = useState<Gateway[]>([])
  const [forms, setForms] = useState<Record<string, GatewayForm>>({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)

  async function loadData() {
    setLoading(true)
    try {
      const res = await getGateways()
      if (res.success) {
        const gateways = (res.items || []) as Gateway[]
        setItems(gateways)
        setForms(Object.fromEntries(gateways.map((gateway) => [gateway.id, buildForm(gateway)])))
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao carregar gateways.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar gateways.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const cards = useMemo(() => items.map((gateway) => ({ gateway, form: forms[gateway.id] || buildForm(gateway) })), [items, forms])

  function updateForm(id: string, patch: Partial<GatewayForm>) {
    setForms((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
  }

  function updateCredential(id: string, key: string, value: string) {
    const form = forms[id]
    if (!form) return
    updateForm(id, { credenciais: { ...form.credenciais, [key]: value } })
  }

  function startReplace(id: string, key: string) {
    const form = forms[id]
    if (!form || form.substituindo.includes(key)) return
    updateForm(id, { substituindo: [...form.substituindo, key] })
  }

  async function handleClear(id: string, key: string) {
    if (!confirm('Limpar esta credencial?')) return
    setBusyId(`${id}:${key}`)
    setMessage(null)
    try {
      const res = await limparCredencialGateway(id, key)
      if (res.success) {
        setMessage({ type: 'success', text: 'Credencial removida.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao limpar credencial.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao limpar credencial.' })
    } finally {
      setBusyId(null)
    }
  }

  async function handleSave(gateway: Gateway) {
    const form = forms[gateway.id]
    if (!form) return
    setBusyId(gateway.id)
    setMessage(null)
    try {
      const typedCredentials = Object.fromEntries(
        Object.entries(form.credenciais).filter(([, value]) => String(value || '').trim()),
      )
      const taxa = parseDecimal(form.taxa)
      const res = await saveGateway({
        id: gateway.id,
        ativo: form.ativo,
        modo: form.modo,
        taxa_percentual_bps: gatewayUsaTaxaPercentual(gateway.id) ? Math.round(taxa * 100) : null,
        taxa_fixa_centavos: gatewayUsaTaxaPercentual(gateway.id) ? null : Math.round(taxa * 100),
        credenciais: typedCredentials,
      })
      if (res.success) {
        setMessage({ type: 'success', text: 'Gateway salvo.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar gateway.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao salvar gateway.' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--brs-gray-800)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Coins size={20} />
          Gateways de Pagamento
        </h1>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
          Credenciais e taxas dos gateways Pix usados pelo Portal Parceiro. O gateway mais barato entre os ativos é escolhido automaticamente por cobrança.
        </p>
      </div>

      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10, border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`, background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2', color: message.type === 'success' ? '#065F46' : '#991B1B', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
        </div>
      ) : cards.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <div className="empty-state">
            <Coins size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
            <h3>Nenhum gateway encontrado</h3>
            <p>Cadastre os gateways disponíveis antes de configurar as credenciais.</p>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1rem' }}>
          {cards.map(({ gateway, form }) => {
            const campos = GATEWAY_CAMPOS[gateway.id] || []
            const usesPercent = gatewayUsaTaxaPercentual(gateway.id)

            return (
              <div key={gateway.id} className="card" style={{ padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>{gateway.nome}</div>
                      <span className={`badge ${gateway.ativo ? 'badge-success' : 'badge-gray'}`}>{gateway.ativo ? 'Ativo' : 'Inativo'}</span>
                      <span style={{ borderRadius: 999, padding: '0.25rem 0.625rem', fontSize: '0.75rem', fontWeight: 700, background: gateway.modo === 'producao' ? '#DBEAFE' : '#FEF3C7', color: gateway.modo === 'producao' ? '#1E40AF' : '#92400E' }}>
                        {gateway.modo === 'producao' ? 'Produção' : 'Teste'}
                      </span>
                    </div>
                    {gateway.atualizado_em ? (
                      <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.8rem', marginTop: '0.35rem' }}>
                        Atualizado em {formatDateTime(gateway.atualizado_em)}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div style={{ display: 'grid', gap: '1rem' }}>
                  {campos.map((campo) => {
                    const credencial = gateway.credenciais.find((item) => item.key === campo.key)
                    const replacing = form.substituindo.includes(campo.key)
                    const showInput = !credencial?.preenchido || replacing

                    return (
                      <div key={campo.key} className="form-group">
                        <label className="form-label">{campo.label}</label>
                        {showInput ? (
                          <input
                            type="password"
                            className="form-control"
                            placeholder="Cole a credencial"
                            value={form.credenciais[campo.key] || ''}
                            onChange={(e) => updateCredential(gateway.id, campo.key, e.target.value)}
                          />
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--brs-gray-700)' }}>{credencial?.mascarado || '••••'}</span>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => startReplace(gateway.id, campo.key)}>Substituir</button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleClear(gateway.id, campo.key)} disabled={busyId === `${gateway.id}:${campo.key}`}>
                              {busyId === `${gateway.id}:${campo.key}` ? <Loader2 size={16} className="spinner" /> : null}
                              Limpar
                            </button>
                          </div>
                        )}
                        {campo.dica ? <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.8rem', marginTop: '0.35rem' }}>{campo.dica}</div> : null}
                      </div>
                    )
                  })}

                  <div className="form-grid form-grid-2">
                    <div className="form-group">
                      <label className="form-label">{usesPercent ? 'Taxa (%)' : 'Taxa fixa (R$)'}</label>
                      <input
                        type="text"
                        className="form-control"
                        value={form.taxa}
                        onChange={(e) => updateForm(gateway.id, { taxa: e.target.value })}
                        placeholder={usesPercent ? 'Ex.: 1,99' : 'Ex.: 0,49'}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Modo</label>
                      <select className="form-control" value={form.modo} onChange={(e) => updateForm(gateway.id, { modo: e.target.value === 'producao' ? 'producao' : 'teste' })}>
                        <option value="teste">Teste</option>
                        <option value="producao">Produção</option>
                      </select>
                    </div>
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: 'var(--brs-gray-800)' }}>
                    <input type="checkbox" checked={form.ativo} onChange={(e) => updateForm(gateway.id, { ativo: e.target.checked })} />
                    Gateway ativo
                  </label>

                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-primary" onClick={() => handleSave(gateway)} disabled={busyId === gateway.id}>
                      {busyId === gateway.id ? <Loader2 size={16} className="spinner" /> : null}
                      Salvar
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
