'use client'

import { useState } from 'react'
import { AlertCircle, Bell, CheckCircle, Loader2, Save } from 'lucide-react'
import { updateMonitoramentoConfig, type MonitoramentoConfigView } from './actions'

type FeedbackMessage = { type: 'success' | 'error'; text: string }

export function MonitoramentoConfigForm({ config }: { config: MonitoramentoConfigView }) {
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)

  const [telefone, setTelefone] = useState(config.telefone || '')
  const [mensagemDegradado, setMensagemDegradado] = useState(config.mensagemDegradado)
  const [mensagemRecuperado, setMensagemRecuperado] = useState(config.mensagemRecuperado)

  const canEdit = config.can_edit !== false

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
      formData.set('telefone', telefone)
      formData.set('mensagem_degradado', mensagemDegradado)
      formData.set('mensagem_recuperado', mensagemRecuperado)
      await updateMonitoramentoConfig(formData)
      setMessage({ type: 'success', text: 'Configuração de monitoramento salva com sucesso.' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao salvar a configuração.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <div className="card" style={{ padding: '1rem 1.25rem', border: '1px solid var(--brs-gray-100)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{ background: 'rgba(234, 88, 12, 0.12)', color: '#c2410c', padding: '0.5rem', borderRadius: 12 }}>
            <Bell size={22} />
          </div>
          <div>
            <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>Alerta por WhatsApp</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)' }}>
              Enviado pela instância Z-API padrão do Workspace.
            </div>
          </div>
        </div>

        <fieldset disabled={!canEdit} style={{ display: 'contents' }}>
          <div className="form-group">
            <label className="form-label">Telefone (DDI+DDD+número, só dígitos)</label>
            <input
              type="text"
              className="form-control"
              placeholder="5511999999999"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
            />
          </div>

          <div className="form-group" style={{ marginTop: '1rem' }}>
            <label className="form-label">Mensagem — serviço degradado</label>
            <textarea
              className="form-control"
              rows={3}
              value={mensagemDegradado}
              onChange={(e) => setMensagemDegradado(e.target.value)}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)', marginTop: '0.25rem' }}>
              Use <code>{'{sistema}'}</code> e <code>{'{data}'}</code> — são substituídos automaticamente.
            </p>
          </div>

          <div className="form-group" style={{ marginTop: '1rem' }}>
            <label className="form-label">Mensagem — serviço normalizado</label>
            <textarea
              className="form-control"
              rows={3}
              value={mensagemRecuperado}
              onChange={(e) => setMensagemRecuperado(e.target.value)}
            />
          </div>
        </fieldset>

        {message && (
          <div
            className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-error'}`}
            style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            {message.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            {message.text}
          </div>
        )}

        {canEdit && (
          <button type="submit" className="btn btn-primary" disabled={saving} style={{ marginTop: '1rem' }}>
            {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        )}
      </div>
    </form>
  )
}
