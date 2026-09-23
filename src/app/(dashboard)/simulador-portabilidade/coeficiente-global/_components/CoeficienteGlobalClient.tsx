'use client'

import { useState } from 'react'
import { Calculator, CheckCircle2, RefreshCw, Save } from 'lucide-react'
import { DEFAULT_PORT_COEFF } from '@/lib/portability/evaluator'
import { saveCoeficienteGlobalPortabilidade } from '../../actions'

interface Props {
  defaultPortCoeff: number
}

export default function CoeficienteGlobalClient({ defaultPortCoeff }: Props) {
  const [coeff, setCoeff] = useState<number>(defaultPortCoeff || DEFAULT_PORT_COEFF)
  const [isSaving, setIsSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function handleSave() {
    setIsSaving(true)
    const res = await saveCoeficienteGlobalPortabilidade(coeff)
    setIsSaving(false)
    if (res.success) {
      showToast('Coeficiente Global salvo com sucesso!')
    } else {
      alert(`Erro ao salvar coeficiente global: ${res.error}`)
    }
  }

  return (
    <div style={{ maxWidth: '750px', paddingBottom: '3rem' }}>
      {/* Toast Notification */}
      {toast && (
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
          {toast}
        </div>
      )}

      {/* Header */}
      <div
        style={{
          background: 'linear-gradient(135deg, #17384B 0%, #2A5268 100%)',
          color: '#fff',
          borderRadius: '16px',
          padding: '1.25rem 1.5rem',
          boxShadow: '0 8px 24px rgba(23,56,75,0.12)',
          marginBottom: '1.25rem',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Calculator size={24} color="#D97706" />
          Coeficiente Global da Portabilidade
        </h1>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#DCE6EF' }}>
          Defina o coeficiente padrão utilizado para o cálculo de portabilidade em instituições financeiras que não possuem coeficiente específico cadastrado.
        </p>
      </div>

      {/* Form Card */}
      <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--brs-navy)' }}>
            Coeficiente Padrão de Portabilidade
          </label>
          <input
            type="number"
            step="0.00001"
            className="form-control"
            style={{ fontSize: '1.1rem', fontWeight: 800, padding: '0.75rem 1rem' }}
            value={coeff}
            onChange={(e) => setCoeff(parseFloat(e.target.value) || DEFAULT_PORT_COEFF)}
          />
          <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)', marginTop: '0.4rem' }}>
            Valor padrão do sistema: <strong>{DEFAULT_PORT_COEFF}</strong> (0.02251)
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setCoeff(DEFAULT_PORT_COEFF)}
          >
            Restaurar Padrão
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={isSaving}
            onClick={handleSave}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1.5rem', fontWeight: 800 }}
          >
            {isSaving ? <RefreshCw className="spin" size={16} /> : <Save size={16} />}
            {isSaving ? 'Salvando...' : 'Salvar Coeficiente Global'}
          </button>
        </div>
      </div>
    </div>
  )
}
