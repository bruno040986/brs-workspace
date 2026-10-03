'use client'

import { useCallback, useState } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, Trophy } from 'lucide-react'
import { apurarSorteio, decidirSorteio, getSorteio } from '@/lib/promocoes/sorteio-actions'
import { Aviso, Selo, Titulo, brData, useCarga, type Feedback } from '../../_components/ui'

const SITU: Record<string, string> = {
  nao_distribuido: 'Não distribuído',
  bloqueado: 'Titular bloqueado/cancelado',
  desconsiderado: 'Desconsiderado',
  contemplado: 'CONTEMPLADO',
}

export default function SorteioPage() {
  const { slug } = useParams<{ slug: string }>()
  const loader = useCallback(() => getSorteio(slug), [slug])
  const { data, erro, carregando, recarregar } = useCarga(loader)
  const [numero, setNumero] = useState('')
  const [dataExt, setDataExt] = useState('')
  const [fb, setFb] = useState<Feedback>(null)
  const [busy, setBusy] = useState(false)
  const s = data?.sorteio

  async function apurar(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const r = await apurarSorteio(slug, numero, dataExt || data?.dataSorteio || '')
    setBusy(false)
    setFb(r.ok ? { type: 'success', text: 'Apuração gravada. Confira a cadeia e valide.' } : { type: 'error', text: r.error })
    if (r.ok) recarregar()
  }

  async function decidir(acao: 'validar' | 'anular') {
    const obs = window.prompt(acao === 'validar' ? 'Observação da validação (identidade, CPF, operações, regras de cartão, fraude):' : 'Motivo da anulação:') ?? null
    if (obs === null || (acao === 'anular' && !obs.trim())) return
    setBusy(true)
    const r = await decidirSorteio(slug, acao, obs)
    setBusy(false)
    setFb(r.ok ? { type: 'success', text: acao === 'validar' ? 'Sorteio validado.' : 'Sorteio anulado.' } : { type: 'error', text: r.error })
    if (r.ok) recarregar()
  }

  return (
    <div className="page-content">
      <Titulo icon={<Trophy size={18} />} titulo="Sorteio" sub={`1º prêmio da Loteria Federal (5 algarismos). Sem o número distribuído, vale a aproximação circular: superior, inferior, 2º superior... (equidistantes: o superior). Data prevista: ${data ? brData(data.dataSorteio) : '—'}.`} />
      <Aviso f={fb || (erro ? { type: 'error', text: erro } : null)} />
      {carregando && <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />}

      <form className="card" onSubmit={apurar} style={{ padding: '1rem', marginBottom: '1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-group">
          <label className="form-label">Número extraído (1º prêmio) *</label>
          <input className="form-control" inputMode="numeric" placeholder="12345" value={numero} onChange={(e) => setNumero(e.target.value)} required />
        </div>
        <div className="form-group">
          <label className="form-label">Data da extração *</label>
          <input type="date" className="form-control" value={dataExt || data?.dataSorteio || ''} onChange={(e) => setDataExt(e.target.value)} required />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || s?.status === 'validado'}>
          {busy ? <Loader2 size={16} className="spinner" /> : null} Apurar
        </button>
      </form>

      {s && (
        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.8rem' }}>
                Extração de {brData(s.dataExtracao)} · número {s.numeroExtraido} · <Selo valor={s.status} />
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, marginTop: '0.25rem' }}>
                {s.contemplado ? `Número contemplado: ${s.contemplado}` : 'Nenhum número válido distribuído'}
              </div>
              {s.contemplado && (
                <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}>
                  {s.direcao === 'exato' ? 'Número exato' : `${s.direcao} · distância ${s.distancia}`}
                </div>
              )}
            </div>
            {s.status === 'apurado' && (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decidir('validar')}>
                  Validar
                </button>
                <button type="button" className="btn btn-outline" disabled={busy} onClick={() => decidir('anular')}>
                  Anular
                </button>
              </div>
            )}
            {s.status === 'validado' && (
              <button type="button" className="btn btn-outline" disabled={busy} onClick={() => decidir('anular')}>
                Anular
              </button>
            )}
          </div>
          {s.ganhador && (
            <div style={{ marginTop: '0.75rem', padding: '0.75rem', borderRadius: 10, background: 'var(--brs-gray-50, #F8FAFC)' }}>
              <b>{s.ganhador.nome}</b> · CPF {s.ganhador.cpf} · {s.ganhador.telefone} · {s.ganhador.tipo === 'indicador' ? 'indicador' : 'servidor'}
              <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-500)' }}>Antes de entregar o prêmio: validar identidade, CPF, operações, créditos, regra de cartão e fraude. Para divulgar, só primeiro nome, sobrenome, cidade e número.</div>
            </div>
          )}
          {s.cadeia.length > 0 && (
            <div className="table-wrapper" style={{ marginTop: '1rem', maxHeight: 360, overflow: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tentativa</th>
                    <th>Número</th>
                    <th>Direção</th>
                    <th>Distância</th>
                    <th>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {s.cadeia.map((t: { numero: string; direcao: string; distancia: number; situacao: string }, i: number) => (
                    <tr key={i} style={t.situacao === 'contemplado' ? { fontWeight: 800 } : undefined}>
                      <td>{i + 1}</td>
                      <td>{t.numero}</td>
                      <td>{t.direcao}</td>
                      <td>{t.distancia}</td>
                      <td>{SITU[t.situacao]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
