'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  buscarParceirosAtendimento, getConfigAtendimento, listarInstanciasDoParceiro, salvarConfigAtendimento, statusInstanciasAtendimento,
  type ConfigAtendimento, type InstanciaOpcao, type ParceiroOpcao,
} from '@/lib/promocoes/atendimento-config-actions'
import type { EstadoAtendimento } from '@/lib/promocoes/atendimento-config-regras'
import { Aviso, useDebounce, type Feedback } from '../../_components/ui'

const dtLocal = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T').slice(0, 16) : '')

const ESTADO: Record<EstadoAtendimento, { texto: string; cor: string }> = {
  pronto: { texto: 'Atendimento pronto', cor: '#065F46' },
  pausado: { texto: 'Atendimento pausado', cor: '#991B1B' },
  aguardando_liberacao: { texto: 'Aguardando liberação', cor: '#92400E' },
  sem_instancia: { texto: 'Sem instância conectada', cor: '#991B1B' },
}

const rotuloInst = (i: InstanciaOpcao) => `${i.nome || 'Instância'} · ${i.papel || '—'} · ${i.status} · ${i.numeroMascarado}${i.inbox ? ` · inbox ${i.inbox}` : ''}`

export default function AtendimentoCard({ slug, podeEditar }: { slug: string; podeEditar: boolean }) {
  const [cfg, setCfg] = useState<ConfigAtendimento | null>(null)
  const [ausentes, setAusentes] = useState(false)
  const [libera, setLibera] = useState('')
  const [parceiro, setParceiro] = useState<ParceiroOpcao | null>(null)
  const [instancias, setInstancias] = useState<InstanciaOpcao[]>([])
  const [estado, setEstado] = useState<EstadoAtendimento | null>(null)
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState<ParceiroOpcao[]>([])
  const [fb, setFb] = useState<Feedback>(null)
  const [saving, setSaving] = useState(false)
  const termo = useDebounce(busca)

  const carregar = useCallback(async () => {
    const r = await getConfigAtendimento(slug)
    if (!r.ok) return setFb({ type: 'error', text: r.error })
    setCfg(r.config)
    setLibera(dtLocal(r.config.atendimento_liberado_em))
    setAusentes(r.colunasAusentes)
    setParceiro(r.parceiro)
    setInstancias(r.instancias)
    setEstado(r.estado)
  }, [slug])

  useEffect(() => {
    void Promise.resolve().then(carregar)
  }, [carregar])

  useEffect(() => {
    if (!podeEditar || !termo.trim()) return void Promise.resolve().then(() => setAchados([]))
    void buscarParceirosAtendimento(slug, termo).then((r) => setAchados(r.ok ? r.parceiros : []))
  }, [slug, termo, podeEditar])

  // polling leve do status das instâncias salvas
  useEffect(() => {
    const t = setInterval(() => {
      void statusInstanciasAtendimento(slug).then((r) => {
        if (!r.ok) return
        setEstado(r.estado)
        setInstancias((l) => l.map((i) => (i.id === r.principal?.id ? r.principal : i.id === r.reserva?.id ? r.reserva : i)))
      })
    }, 10000)
    return () => clearInterval(t)
  }, [slug])

  async function escolherParceiro(p: ParceiroOpcao) {
    setParceiro(p)
    setBusca('')
    setAchados([])
    setCfg((c) => c && { ...c, parceiro_atendimento_id: p.id, instancia_atendimento_id: null, instancia_atendimento_reserva_id: null })
    const r = await listarInstanciasDoParceiro(slug, p.id)
    setInstancias(r.ok ? r.instancias : [])
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!cfg) return
    setSaving(true)
    const r = await salvarConfigAtendimento(slug, { ...cfg, atendimento_liberado_em: libera ? `${libera}:00-03:00` : null })
    setSaving(false)
    setFb(r.ok ? { type: 'success', text: 'Atendimento salvo.' } : { type: 'error', text: r.error })
    if (r.ok) void carregar()
  }

  if (!cfg) return <div className="card" style={{ padding: '1rem' }}>{fb ? <Aviso f={fb} /> : <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />}</div>

  const sel = (id: string | null) => id || ''
  // só conectadas + as já gravadas (mesmo caídas) aparecem para escolha
  const opcoes = instancias.filter((i) => i.status === 'conectada' || i.id === cfg.instancia_atendimento_id || i.id === cfg.instancia_atendimento_reserva_id)
  const desc = (cur: string | null, outra: string | null) => (
    <>
      <option value="">— nenhuma —</option>
      {opcoes.filter((i) => i.id !== outra || i.id === cur).map((i) => (
        <option key={i.id} value={i.id}>{rotuloInst(i)}</option>
      ))}
    </>
  )
  const num = (k: 'limite_atendimento_indicador_hora' | 'limite_atendimento_instancia_hora' | 'limite_atendimento_instancia_dia', label: string) => (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input className="form-control" type="number" min={1} disabled={!podeEditar} value={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: Number(e.target.value) })} />
    </div>
  )
  const e = estado ? ESTADO[estado] : null

  return (
    <form onSubmit={salvar} className="card" style={{ padding: '1rem', marginTop: '1.25rem' }}>
      <div style={{ fontWeight: 700 }}>Atendimento (NuAzul chama o lead)</div>
      <div style={{ fontSize: 12, color: 'var(--brs-gray-500)', marginBottom: '0.75rem' }}>
        Conexão e pareamento desta instância são feitos no CRM do parceiro.
      </div>
      {e && <div style={{ fontWeight: 700, color: e.cor, marginBottom: '0.75rem' }}>{e.texto}</div>}
      {ausentes && <Aviso f={{ type: 'error', text: 'As colunas do atendimento ainda não existem no banco (migration não aplicada). Valores abaixo são padrões e não podem ser salvos.' }} />}
      <Aviso f={fb} />
      {!cfg.atendimento_liberado_em && !libera && <div style={{ fontSize: 13, color: '#92400E', marginBottom: '0.75rem' }}>Botão da empresa desligado até liberar.</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem' }}>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Parceiro</label>
          <div style={{ fontSize: 13, marginBottom: 4 }}>{parceiro ? `${parceiro.arw_code || '—'} — ${parceiro.nome}` : 'Nenhum parceiro escolhido.'}</div>
          {podeEditar && (
            <>
              <input className="form-control" placeholder="Buscar por código ARW (ex.: GO337) ou nome" value={busca} onChange={(ev) => setBusca(ev.target.value)} />
              {achados.length > 0 && (
                <div style={{ border: '1px solid var(--brs-gray-200)', borderRadius: 8, marginTop: 4 }}>
                  {achados.map((p) => (
                    <button key={p.id} type="button" className="btn btn-secondary btn-sm" style={{ display: 'block', width: '100%', textAlign: 'left', border: 0 }} onClick={() => void escolherParceiro(p)}>
                      {p.arw_code || '—'} — {p.nome}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Instância principal</label>
          <select className="form-control" disabled={!podeEditar || !parceiro} value={sel(cfg.instancia_atendimento_id)} onChange={(ev) => setCfg({ ...cfg, instancia_atendimento_id: ev.target.value || null })}>
            {desc(cfg.instancia_atendimento_id, cfg.instancia_atendimento_reserva_id)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Instância reserva</label>
          <select className="form-control" disabled={!podeEditar || !parceiro} value={sel(cfg.instancia_atendimento_reserva_id)} onChange={(ev) => setCfg({ ...cfg, instancia_atendimento_reserva_id: ev.target.value || null })}>
            {desc(cfg.instancia_atendimento_reserva_id, cfg.instancia_atendimento_id)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Liberada para uso a partir de</label>
          <input className="form-control" type="datetime-local" disabled={!podeEditar} value={libera} onChange={(ev) => setLibera(ev.target.value)} />
          <small style={{ color: 'var(--brs-gray-500)' }}>Horário de Brasília. Vazio = não liberada (fim do aquecimento é decisão manual).</small>
        </div>
        <div className="form-group">
          <label className="form-label">Pausar envios da empresa</label>
          <input type="checkbox" disabled={!podeEditar} checked={cfg.atendimento_pausado} onChange={(ev) => setCfg({ ...cfg, atendimento_pausado: ev.target.checked })} />
        </div>
        {num('limite_atendimento_indicador_hora', 'Limite por indicador / hora')}
        {num('limite_atendimento_instancia_hora', 'Limite por instância / hora')}
        {num('limite_atendimento_instancia_dia', 'Limite por instância / 24 h')}
      </div>

      {podeEditar && (
        <button type="submit" className="btn btn-primary" style={{ marginTop: '0.75rem' }} disabled={saving || ausentes}>
          {saving ? <Loader2 size={16} className="spinner" /> : null} Salvar atendimento
        </button>
      )}
    </form>
  )
}
