'use client'

import { useState } from 'react'
import { AlertCircle, CheckCircle, Database, Loader2, PlugZap, Save } from 'lucide-react'
import { testarConexaoNvti, updateNvtiConfig, type NvtiConfigView } from './actions'
import type { NvtiPriceTier } from '@/lib/nvti/types'

type FeedbackMessage = {
  type: 'success' | 'error'
  text: string
}

function tierLabel(tier: NvtiPriceTier, index: number, tiers: NvtiPriceTier[]): string {
  const previous = index === 0 ? 0 : tiers[index - 1].up_to || 0
  if (tier.up_to === null) return `Acima de ${previous.toLocaleString('pt-BR')}`
  return `${(previous + 1).toLocaleString('pt-BR')} a ${tier.up_to.toLocaleString('pt-BR')}`
}

export function NvtiConfigForm({ config }: { config: NvtiConfigView }) {
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [showSenha, setShowSenha] = useState(false)

  const [usuario, setUsuario] = useState(config.usuario || '')
  const [senha, setSenha] = useState('')
  const [cliente, setCliente] = useState(config.cliente || '')
  const [metodo, setMetodo] = useState(config.metodo)
  const [cacheDays, setCacheDays] = useState(String(config.cache_days ?? 30))
  const [isActive, setIsActive] = useState(config.is_active)
  const [tiers, setTiers] = useState<NvtiPriceTier[]>(config.price_tiers)

  const canEdit = config.can_edit !== false
  const hasSaved = Boolean(config.has_credentials)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canEdit) {
      setMessage({ type: 'error', text: 'Sem permissão para editar esta configuração.' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const formData = new FormData()
      formData.set('id', config.id || '')
      formData.set('usuario', usuario)
      formData.set('senha', senha)
      formData.set('cliente', cliente)
      formData.set('metodo', metodo)
      formData.set('cache_days', cacheDays)
      formData.set('is_active', String(isActive))
      formData.set('price_tiers', JSON.stringify(tiers))
      await updateNvtiConfig(formData)
      setSenha('')
      setMessage({ type: 'success', text: 'Configuração da Nova Vida TI salva com sucesso.' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao salvar a configuração.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setMessage(null)
    try {
      const result = await testarConexaoNvti()
      setMessage({ type: result.ok ? 'success' : 'error', text: result.message })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao testar a conexão.' })
    } finally {
      setTesting(false)
    }
  }

  function updateTierUnit(index: number, raw: string) {
    const unit = Number(raw.replace(',', '.'))
    setTiers((current) => current.map((tier, i) => (i === index ? { ...tier, unit: Number.isFinite(unit) ? unit : tier.unit } : tier)))
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="card" style={{ padding: '1rem 1.25rem', border: '1px solid var(--brs-gray-100)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
          <div style={{ background: 'rgba(201, 168, 76, 0.12)', color: '#8B6914', padding: '0.5rem', borderRadius: 12 }}>
            <Database size={22} />
          </div>
          <div>
            <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>API Nova Vida TI</div>
            <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.875rem' }}>
              Credenciais do web service de higienização de CPF (NVBOOK CEL OBG). Cobrança pós-paga por consulta.
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: '1rem',
            padding: '0.875rem 1rem',
            borderRadius: 12,
            border: `1px solid ${hasSaved ? '#A7F3D0' : '#FDE68A'}`,
            background: hasSaved ? '#ECFDF5' : '#FFFBEB',
            color: hasSaved ? '#065F46' : '#92400E',
          }}
        >
          <strong>{hasSaved ? 'Configuração ativa.' : 'Aguardando credenciais.'}</strong>
          <div style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
            {hasSaved
              ? `A senha já está salva e não será exibida novamente.${config.token_generated_at ? ` Último token gerado em ${new Date(config.token_generated_at).toLocaleString('pt-BR')}.` : ''}`
              : 'Preencha usuário, senha e cliente fornecidos pela Nova Vida TI.'}
          </div>
        </div>
      </div>

      {message && (
        <div
          style={{
            padding: '1rem',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: message.type === 'success' ? '#065F46' : '#991B1B',
            border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
          }}
        >
          {message.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="card" style={{ padding: '1.5rem' }}>
          <div className="form-grid form-grid-2">
            <div className="form-group">
              <label className="form-label">Usuário</label>
              <input type="text" className="form-control" value={usuario} onChange={(e) => setUsuario(e.target.value)} required disabled={!canEdit} autoComplete="off" />
            </div>
            <div className="form-group">
              <label className="form-label">Cliente</label>
              <input type="text" className="form-control" value={cliente} onChange={(e) => setCliente(e.target.value)} required disabled={!canEdit} autoComplete="off" />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">Senha</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showSenha ? 'text' : 'password'}
                className="form-control"
                placeholder={hasSaved ? 'Deixe em branco para manter a senha atual' : 'Senha fornecida pela Nova Vida TI'}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required={!hasSaved}
                disabled={!canEdit}
                style={{ paddingRight: '5.5rem' }}
                autoComplete="new-password"
              />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowSenha((v) => !v)} disabled={!canEdit} style={{ position: 'absolute', right: 8, top: 8 }}>
                {showSenha ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
          </div>

          <div className="form-grid form-grid-2">
            <div className="form-group">
              <label className="form-label">Método contratado</label>
              <select className="form-control" value={metodo} onChange={(e) => setMetodo(e.target.value === 'NvBookCelObWhats' ? 'NvBookCelObWhats' : 'NVBOOK_CEL_OBG')} disabled={!canEdit}>
                <option value="NVBOOK_CEL_OBG">NVBOOK CEL OBG</option>
                <option value="NvBookCelObWhats">NVBOOK CEL OBG WHATS</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Cache de reaproveitamento (dias)</label>
              <input type="number" min={0} step={1} className="form-control" value={cacheDays} onChange={(e) => setCacheDays(e.target.value)} disabled={!canEdit} />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">Integração</label>
            <select className="form-control" value={isActive ? 'true' : 'false'} onChange={(e) => setIsActive(e.target.value === 'true')} disabled={!canEdit}>
              <option value="true">Ativa</option>
              <option value="false">Inativa (bloqueia novas consultas)</option>
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">Tabela de preço (cascata mensal)</label>
            <div style={{ display: 'grid', gap: '0.4rem' }}>
              {tiers.map((tier, index) => (
                <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <div style={{ flex: 1, fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}>{tierLabel(tier, index, tiers)} consultas</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>R$</span>
                    <input
                      type="text"
                      className="form-control"
                      style={{ width: 90 }}
                      value={String(tier.unit)}
                      onChange={(e) => updateTierUnit(index, e.target.value)}
                      disabled={!canEdit}
                      inputMode="decimal"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ color: 'var(--brs-gray-400)', fontSize: '0.78rem', marginTop: '0.35rem' }}>
              Os tetos de gasto (global e por usuário) são ajustados na tela de Higienização de CPF NVTI, aba
              Consumo e limites.
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1.25rem' }}>
            <button type="button" className="btn btn-outline" disabled={testing} onClick={() => void handleTest()} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {testing ? <Loader2 size={16} className="spinner" /> : <PlugZap size={16} />}
              Testar conexão
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving || !canEdit} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
              Salvar
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
