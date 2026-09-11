'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Loader2, Save } from 'lucide-react'
import { salvarConvenioBcGeral, salvarConvenioBcSecao, type ConvenioBc, type ConvenioBcGeral, type ModoData } from '../../bc-actions'
import type { PublicoAtendido } from '../../cadastros-actions'

/** Um dia/fechamento de folha pode ser "dia X", "Nº dia útil" ou uma regra em texto — cada convênio tem a sua. */
function SeletorModoData({
  titulo,
  ajuda,
  modo,
  dia,
  diaUtil,
  texto,
  onChange,
}: {
  titulo: string
  ajuda: string
  modo: ModoData | null
  dia: number | null
  diaUtil: number | null
  texto: string | null
  onChange: (next: { modo: ModoData | null; dia: number | null; diaUtil: number | null; texto: string | null }) => void
}) {
  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.3rem' }}>{titulo}</div>
      <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)', marginBottom: '0.5rem' }}>{ajuda}</div>
      <div className="form-grid form-grid-2" style={{ gap: '0.6rem' }}>
        <div className="form-group">
          <label className="form-label">Como informar</label>
          <select
            className="form-control"
            value={modo || ''}
            onChange={(e) => {
              const novoModo = (e.target.value || null) as ModoData | null
              onChange({ modo: novoModo, dia: null, diaUtil: null, texto: null })
            }}
          >
            <option value="">Não informado</option>
            <option value="dia_fixo">Dia fixo do mês</option>
            <option value="dia_util">Dia útil (contado do início do mês)</option>
            <option value="texto_livre">Regra em texto</option>
          </select>
        </div>
        {modo === 'dia_fixo' && (
          <div className="form-group">
            <label className="form-label">Dia do mês</label>
            <input
              type="number"
              min={1}
              max={31}
              className="form-control"
              value={dia ?? ''}
              onChange={(e) => onChange({ modo, dia: e.target.value === '' ? null : Number(e.target.value), diaUtil: null, texto: null })}
            />
          </div>
        )}
        {modo === 'dia_util' && (
          <div className="form-group">
            <label className="form-label">Nº do dia útil</label>
            <input
              type="number"
              min={1}
              className="form-control"
              value={diaUtil ?? ''}
              onChange={(e) => onChange({ modo, dia: null, diaUtil: e.target.value === '' ? null : Number(e.target.value), texto: null })}
            />
          </div>
        )}
        {modo === 'texto_livre' && (
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label className="form-label">Regra</label>
            <input
              type="text"
              className="form-control"
              placeholder="Ex.: todo dia 20, ou o próximo dia útil se cair em fim de semana"
              value={texto || ''}
              onChange={(e) => onChange({ modo, dia: null, diaUtil: null, texto: e.target.value })}
            />
          </div>
        )}
      </div>
    </div>
  )
}

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
        <div style={{ fontWeight: 800, marginBottom: '0.25rem' }}>Calendário de Pagamento</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)', marginBottom: '0.9rem' }}>
          Cada convênio tem sua própria regra — escolha o formato que descreve melhor este.
        </div>
        <div style={{ display: 'grid', gap: '1rem' }}>
          <SeletorModoData
            titulo="Data de Pagamento"
            ajuda="Quando o servidor recebe o salário."
            modo={geral.pagamento_modo}
            dia={geral.pagamento_dia}
            diaUtil={geral.pagamento_dia_util}
            texto={geral.pagamento_texto}
            onChange={(next) =>
              setGeral((prev) => ({
                ...prev,
                pagamento_modo: next.modo,
                pagamento_dia: next.dia,
                pagamento_dia_util: next.diaUtil,
                pagamento_texto: next.texto,
              }))
            }
          />
          <SeletorModoData
            titulo="Fechamento da Folha"
            ajuda="Prazo limite para enviar descontos de consignação e entrarem na folha do mês."
            modo={geral.fechamento_folha_modo}
            dia={geral.fechamento_folha_dia}
            diaUtil={geral.fechamento_folha_dia_util}
            texto={geral.fechamento_folha_texto}
            onChange={(next) =>
              setGeral((prev) => ({
                ...prev,
                fechamento_folha_modo: next.modo,
                fechamento_folha_dia: next.dia,
                fechamento_folha_dia_util: next.diaUtil,
                fechamento_folha_texto: next.texto,
              }))
            }
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
