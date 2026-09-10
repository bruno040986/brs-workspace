'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Loader2, Save } from 'lucide-react'
import { salvarConvenioBcGeral, salvarConvenioBcSecao, type ConvenioBc, type ConvenioBcGeral } from '../../bc-actions'
import type { PublicoAtendido } from '../../cadastros-actions'

export default function PublicoTab({
  convenioId,
  bc,
  publicosAtivos,
  onSaved,
}: {
  convenioId: string
  bc: ConvenioBc
  publicosAtivos: PublicoAtendido[]
  onSaved: () => void
}) {
  const [geral, setGeral] = useState<ConvenioBcGeral>(bc.geral)
  const [selecionados, setSelecionados] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string; detalhes?: string[] } | null>(null)

  useEffect(() => {
    setGeral(bc.geral)
    const map: Record<string, string> = {}
    for (const p of bc.publicos) map[p.publico_id] = p.observacao || ''
    setSelecionados(map)
  }, [bc])

  function toggle(publicoId: string) {
    setSelecionados((prev) => {
      const next = { ...prev }
      if (publicoId in next) delete next[publicoId]
      else next[publicoId] = ''
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    try {
      const resGeral = await salvarConvenioBcGeral(convenioId, geral)
      if (!resGeral.success) {
        setMessage({ type: 'error', text: resGeral.error || 'Erro ao salvar.', detalhes: resGeral.inconsistencias })
        return
      }
      const payload = Object.entries(selecionados).map(([publico_id, observacao]) => ({ publico_id, observacao: observacao || null }))
      const resPub = await salvarConvenioBcSecao(convenioId, 'publicos', payload)
      if (!resPub.success) {
        setMessage({ type: 'error', text: resPub.error || 'Erro ao salvar os públicos.' })
        return
      }
      setMessage({ type: 'success', text: 'Teto/prazos e públicos salvos.' })
      onSaved()
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao salvar.' })
    } finally {
      setSaving(false)
    }
  }

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
          }}
        >
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.875rem', fontWeight: 600 }}>
            {message.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            {message.text}
          </div>
          {message.detalhes && message.detalhes.length > 0 && (
            <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.4rem', fontSize: '0.8rem' }}>
              {message.detalhes.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="card" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 800, marginBottom: '0.75rem' }}>Dados Gerais do Convênio</div>
        <div className="form-grid form-grid-2" style={{ marginBottom: '0.75rem' }}>
          <div className="form-group">
            <label className="form-label">Abrangência</label>
            <select
              className="form-control"
              value={geral.abrangencia || 'nacional'}
              onChange={(e) => setGeral((prev) => ({ ...prev, abrangencia: e.target.value }))}
            >
              <option value="municipal">Municipal</option>
              <option value="estadual">Estadual</option>
              <option value="nacional">Nacional</option>
            </select>
            <div style={{ marginTop: '0.3rem', fontSize: '0.78rem', color: 'var(--brs-gray-500)' }}>
              Define se o agente de IA usa o regionalismo do cliente ou o da cidade do convênio.
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Número de Servidores</label>
            <input
              type="number"
              min={0}
              className="form-control"
              value={geral.numero_servidores ?? ''}
              onChange={(e) => setGeral((prev) => ({ ...prev, numero_servidores: e.target.value === '' ? null : Number(e.target.value) }))}
            />
          </div>
        </div>
        <div className="form-grid form-grid-3">
          <div className="form-group">
            <label className="form-label">Teto de Comprometimento Salarial (%)</label>
            <input
              type="number"
              step="0.01"
              min={0}
              max={100}
              className="form-control"
              value={geral.max_comprometimento_salarial ?? ''}
              onChange={(e) => setGeral((prev) => ({ ...prev, max_comprometimento_salarial: e.target.value === '' ? null : Number(e.target.value) }))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Prazo Mínimo Geral (meses)</label>
            <input
              type="number"
              min={1}
              className="form-control"
              value={geral.prazo_minimo_geral ?? ''}
              onChange={(e) => setGeral((prev) => ({ ...prev, prazo_minimo_geral: e.target.value === '' ? null : Number(e.target.value) }))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Prazo Máximo Geral (meses)</label>
            <input
              type="number"
              min={1}
              className="form-control"
              value={geral.prazo_maximo_geral ?? ''}
              onChange={(e) => setGeral((prev) => ({ ...prev, prazo_maximo_geral: e.target.value === '' ? null : Number(e.target.value) }))}
            />
          </div>
        </div>
        <div className="form-group" style={{ marginTop: '0.75rem' }}>
          <label className="form-label">Observações da Base de Conhecimento</label>
          <textarea
            className="form-control"
            rows={2}
            value={geral.bc_observacoes || ''}
            onChange={(e) => setGeral((prev) => ({ ...prev, bc_observacoes: e.target.value }))}
          />
        </div>
      </div>

      <div className="card" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 800, marginBottom: '0.75rem' }}>Públicos Elegíveis</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)', marginBottom: '0.75rem' }}>
          Públicos que o decreto/norma do convênio permite atender.
        </div>
        {publicosAtivos.length === 0 ? (
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem' }}>
            Nenhum público cadastrado. Crie em <strong>Convênios › Públicos Atendidos</strong>.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {publicosAtivos.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 180, fontWeight: 600 }}>
                  <input type="checkbox" checked={p.id in selecionados} onChange={() => toggle(p.id)} />
                  {p.nome}
                </label>
                {p.id in selecionados && (
                  <input
                    className="form-control"
                    style={{ flex: 1, minWidth: 200 }}
                    placeholder="Observação (opcional)"
                    value={selecionados[p.id] || ''}
                    onChange={(e) => setSelecionados((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>
        )}
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
