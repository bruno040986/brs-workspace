'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, Loader2, Save } from 'lucide-react'
import { salvarConvenioBcSecao, type ConvenioBc, type ConvenioBcForma, type FormaContratoAtiva } from '../../bc-actions'

export default function FormasTab({
  convenioId,
  bc,
  formasAtivas,
  onSaved,
}: {
  convenioId: string
  bc: ConvenioBc
  formasAtivas: FormaContratoAtiva[]
  onSaved: () => void
}) {
  const [linhas, setLinhas] = useState<Record<string, { percentual: string; observacao: string }>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    const map: Record<string, { percentual: string; observacao: string }> = {}
    for (const f of bc.formas) {
      map[f.forma_contrato_id] = { percentual: f.percentual_margem != null ? String(f.percentual_margem) : '', observacao: f.observacao || '' }
    }
    setLinhas(map)
  }, [bc])

  const teto = bc.geral.max_comprometimento_salarial

  const soma = useMemo(() => Object.values(linhas).reduce((s, l) => s + (Number(l.percentual) || 0), 0), [linhas])

  function toggle(formaId: string) {
    setLinhas((prev) => {
      const next = { ...prev }
      if (formaId in next) delete next[formaId]
      else next[formaId] = { percentual: '', observacao: '' }
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    try {
      const payload: ConvenioBcForma[] = Object.entries(linhas).map(([forma_contrato_id, l]) => ({
        forma_contrato_id,
        percentual_margem: l.percentual === '' ? null : Number(l.percentual),
        observacao: l.observacao || null,
      }))
      const res = await salvarConvenioBcSecao(convenioId, 'formas', payload)
      if (res.success) {
        setMessage({ type: 'success', text: 'Formas & margens salvas.' })
        onSaved()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar.' })
      }
    } finally {
      setSaving(false)
    }
  }

  const excedeu = teto != null && soma > teto

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {message && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: 10,
            border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
            background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: message.type === 'success' ? '#065F46' : '#991B1B',
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
            fontSize: '0.875rem',
            fontWeight: 600,
          }}
        >
          {message.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {message.text}
        </div>
      )}
      {teto == null && (
        <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>
          Defina o teto de comprometimento salarial na aba <strong>Público</strong> para validar a soma das margens ao vivo.
        </div>
      )}
      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>
                <th>Forma de Contrato</th>
                <th style={{ width: 140 }}>Margem (%)</th>
                <th>Observação</th>
              </tr>
            </thead>
            <tbody>
              {formasAtivas.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '2rem', color: 'var(--brs-gray-500)' }}>
                    Nenhuma forma de contrato ativa.
                  </td>
                </tr>
              ) : (
                formasAtivas.map((f) => {
                  const marcada = f.id in linhas
                  return (
                    <tr key={f.id}>
                      <td>
                        <input type="checkbox" checked={marcada} onChange={() => toggle(f.id)} />
                      </td>
                      <td style={{ fontWeight: 600 }}>{f.nome}</td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          className="form-control"
                          disabled={!marcada}
                          value={linhas[f.id]?.percentual || ''}
                          onChange={(e) => setLinhas((prev) => ({ ...prev, [f.id]: { ...prev[f.id], percentual: e.target.value } }))}
                        />
                      </td>
                      <td>
                        <input
                          className="form-control"
                          disabled={!marcada}
                          value={linhas[f.id]?.observacao || ''}
                          onChange={(e) => setLinhas((prev) => ({ ...prev, [f.id]: { ...prev[f.id], observacao: e.target.value } }))}
                        />
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--brs-gray-100)', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, color: excedeu ? '#991B1B' : 'var(--brs-gray-700)' }}>
            Soma: {soma.toFixed(2)}% {teto != null ? `/ Teto: ${teto}%` : ''}
          </span>
        </div>
      </div>
      <div>
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
          Salvar
        </button>
      </div>
    </div>
  )
}
