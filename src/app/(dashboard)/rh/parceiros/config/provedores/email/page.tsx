'use client'

import { useState, useEffect } from 'react'
import { getProvedoresConfig, saveProvedoresConfig } from '../../../actions'
import { Mail, Key, Save, Loader2, CheckCircle, AlertCircle } from 'lucide-react'

export default function EmailConfigPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Resend State
  const [resendId, setResendId] = useState('')
  const [resendApiKey, setResendApiKey] = useState('')
  const [resendHasApiKey, setResendHasApiKey] = useState(false)
  const [resendFromEmail, setResendFromEmail] = useState('')
  const [resendActive, setResendActive] = useState(false)

  useEffect(() => {
    async function loadConfig() {
      setLoading(true)
      const res = await getProvedoresConfig()
      if (res.success && res.resend) {
        setResendId(res.resend.id || '')
        // O servidor nunca devolve a chave em claro (ver actions.ts) — o campo
        // fica em branco de propósito; `has_api_key` é o único sinal de que já
        // existe uma chave salva.
        setResendApiKey('')
        setResendHasApiKey(!!res.resend.has_api_key)
        setResendFromEmail(res.resend.from_email || '')
        setResendActive(res.resend.is_active ?? false)
      } else {
        setMessage({ type: 'error', text: 'Erro ao carregar configurações de e-mail.' })
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
      resend: {
        id: resendId || undefined,
        api_key: resendApiKey,
        from_email: resendFromEmail,
        is_active: resendActive
      }
    }

    const res = await saveProvedoresConfig(payload)
    if (res.success) {
      setMessage({ type: 'success', text: 'Configurações de e-mail salvas com sucesso!' })
      // Sempre recarrega do servidor: limpa o campo da chave (nunca volta em
      // claro) e atualiza o "chave já configurada" com o estado real salvo.
      const configReload = await getProvedoresConfig()
      if (configReload.success && configReload.resend) {
        setResendId(configReload.resend.id || '')
        setResendApiKey('')
        setResendHasApiKey(!!configReload.resend.has_api_key)
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
          Configurações de API - E-mail
        </h1>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
          Configure os provedores de disparos de e-mails transacionais do sistema
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
        {/* Provedor de E-mail: Resend */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#EF4444', padding: '0.5rem', borderRadius: '8px' }}>
              <Mail size={24} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--brs-gray-800)' }}>Resend</h3>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>Serviço oficial de e-mails da plataforma</p>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">
              API Key do Resend
              {resendHasApiKey && (
                <span style={{ marginLeft: '0.5rem', fontWeight: 400, fontSize: '0.75rem', color: '#059669' }}>
                  ✓ chave já configurada — deixe em branco para mantê-la
                </span>
              )}
            </label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }}>
                <Key size={16} />
              </span>
              <input
                type="password"
                className="form-control"
                style={{ paddingLeft: '2.25rem' }}
                placeholder={resendHasApiKey ? '••••••••••••••••••••' : 're_xxxxxxxxxxxxxxxxxxxxxxxx'}
                value={resendApiKey}
                onChange={e => setResendApiKey(e.target.value)}
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                data-form-type="other"
              />
            </div>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>
              Campo sempre em branco por segurança (a chave salva nunca volta pra tela). Preencha só quando for
              TROCAR a chave — um gerenciador de senhas do navegador pode sugerir preencher este campo sozinho;
              confira o que está escrito aqui antes de salvar.
            </p>
          </div>

          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label className="form-label">E-mail Remetente Oficial (Custom Domain)</label>
            <input 
              type="text" 
              className="form-control" 
              placeholder="BRS Promotora <cadastro@brspromotora.com.br>"
              value={resendFromEmail}
              onChange={e => setResendFromEmail(e.target.value)}
            />
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>
              Precisa ser um domínio configurado e verificado na sua conta do Resend.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
            <input 
              type="checkbox" 
              id="resendActive" 
              checked={resendActive}
              onChange={e => setResendActive(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="resendActive" style={{ fontSize: '0.875rem', color: 'var(--brs-gray-700)', cursor: 'pointer', userSelect: 'none' }}>
              Ativar disparos de e-mail (Resend)
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
