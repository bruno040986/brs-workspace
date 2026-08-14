'use client'

import { useState, useEffect } from 'react'
import { getProvedoresConfig, saveProvedoresConfig } from '../../../actions'
import { MessageSquare, Key, Save, Loader2, CheckCircle, AlertCircle } from 'lucide-react'

export default function WhatsappConfigPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Z-API State
  const [zapiId, setZapiId] = useState('')
  const [zapiInstanceId, setZapiInstanceId] = useState('')
  const [zapiToken, setZapiToken] = useState('')
  const [zapiClientKey, setZapiClientKey] = useState('')
  const [zapiActive, setZapiActive] = useState(false)

  useEffect(() => {
    async function loadConfig() {
      setLoading(true)
      const res = await getProvedoresConfig()
      if (res.success && res.zapi) {
        setZapiId(res.zapi.id || '')
        setZapiInstanceId(res.zapi.instance_id || '')
        setZapiToken(res.zapi.token || '')
        setZapiClientKey(res.zapi.client_key || '')
        setZapiActive(res.zapi.is_active ?? false)
      } else {
        setMessage({ type: 'error', text: 'Erro ao carregar configurações de WhatsApp.' })
      }
      setLoading(false)
    }

    loadConfig()
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)

    const payload = {
      zapi: {
        id: zapiId || undefined,
        instance_id: zapiInstanceId,
        token: zapiToken,
        client_key: zapiClientKey,
        is_active: zapiActive
      }
    }

    const res = await saveProvedoresConfig(payload)
    if (res.success) {
      setMessage({ type: 'success', text: 'Configurações de WhatsApp salvas com sucesso!' })
      if (!zapiId) {
        const configReload = await getProvedoresConfig()
        if (configReload.success && configReload.zapi) {
          setZapiId(configReload.zapi.id || '')
        }
      }
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao salvar configurações.' })
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="page-content" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
      </div>
    )
  }

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--brs-gray-800)', margin: 0 }}>
          Configurações de API - WhatsApp
        </h1>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
          Configure os provedores de disparos automáticos e notificações de WhatsApp
        </p>
      </div>

      {message && (
        <div 
          style={{ 
            padding: '1rem', 
            borderRadius: '8px', 
            marginBottom: '1.5rem', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.75rem',
            background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: message.type === 'success' ? '#065F46' : '#991B1B',
            border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`
          }}
        >
          {message.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      <form onSubmit={handleSave} style={{ maxWidth: '600px' }}>
        {/* Provedor de WhatsApp: Z-API */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <div style={{ backgroundColor: 'rgba(34, 197, 94, 0.1)', color: '#22C55E', padding: '0.5rem', borderRadius: '8px' }}>
              <MessageSquare size={24} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--brs-gray-800)' }}>Z-API</h3>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>API oficial para disparos automáticos via WhatsApp</p>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">ID da Instância (Z-API)</label>
            <input 
              type="text" 
              className="form-control" 
              placeholder="3Cxxxxxxxxxxxxxxxxxxxxxx"
              value={zapiInstanceId}
              onChange={e => setZapiInstanceId(e.target.value)}
              required
            />
          </div>

          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">Token da Instância (Z-API)</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }}>
                <Key size={16} />
              </span>
              <input
                type="password"
                className="form-control"
                style={{ paddingLeft: '2.25rem' }}
                placeholder="Deixe em branco para manter o token atual"
                value={zapiToken}
                onChange={e => setZapiToken(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label className="form-label">Client Key (Opcional)</label>
            <input 
              type="text" 
              className="form-control" 
              placeholder="Identificação opcional do cliente"
              value={zapiClientKey}
              onChange={e => setZapiClientKey(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
            <input 
              type="checkbox" 
              id="zapiActive" 
              checked={zapiActive}
              onChange={e => setZapiActive(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="zapiActive" style={{ fontSize: '0.875rem', color: 'var(--brs-gray-700)', cursor: 'pointer', userSelect: 'none' }}>
              Ativar disparos de WhatsApp (Z-API)
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
              Salvar Configurações
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
