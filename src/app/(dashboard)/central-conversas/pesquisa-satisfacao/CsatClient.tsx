'use client'

/**
 * Pesquisa de satisfação (D4): texto e ativação por caixa de entrada + relatório de notas.
 * O Chatwoot dispara a pesquisa ao resolver a conversa. ATENÇÃO: enquanto o engine não enviar a
 * mensagem `input_csat` com o link (docs/RECADO-ENGINE-CSAT-2026-09-26.md), o cliente do WhatsApp
 * recebe só o texto e não consegue responder.
 * Permissão: central-conversas.
 */
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { listarCsat, respostasCsat, salvarCsat, type CsatCaixa } from '@/lib/central-conversas/csat-actions'
import { CSAT_TIPOS, type RespostaCsat, type ResumoCsat } from '@/lib/central-conversas/csat'

export default function CsatClient() {
  const [caixas, setCaixas] = useState<CsatCaixa[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [salvando, setSalvando] = useState<number | null>(null)
  const [dias, setDias] = useState(30)
  const [respostas, setRespostas] = useState<RespostaCsat[]>([])
  const [resumo, setResumo] = useState<ResumoCsat | null>(null)
  const [carregandoResp, setCarregandoResp] = useState(false)

  async function carregar() {
    setCarregando(true)
    const r = await listarCsat().catch(() => ({ ok: false as const, error: 'Falha ao carregar.' }))
    if (r.ok) {
      setCaixas(r.caixas)
      setErro('')
    } else setErro(r.error)
    setCarregando(false)
  }

  async function carregarRespostas() {
    setCarregandoResp(true)
    const r = await respostasCsat(dias).catch(() => ({ ok: false as const, error: 'Falha ao carregar respostas.' }))
    if (r.ok) {
      setRespostas(r.respostas)
      setResumo(r.resumo)
    } else setErro(r.error)
    setCarregandoResp(false)
  }

  useEffect(() => {
    void carregar()
  }, [])
  useEffect(() => {
    void carregarRespostas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dias])

  const edit = (id: number, p: Partial<CsatCaixa>) => setCaixas((l) => l.map((c) => (c.id === id ? { ...c, ...p } : c)))

  async function salvar(c: CsatCaixa) {
    setSalvando(c.id)
    setErro('')
    setAviso('')
    const r = await salvarCsat(c.id, { ativa: c.ativa, tipo: c.tipo, mensagem: c.mensagem, botao: c.botao }).catch(() => ({ ok: false as const, error: 'Falha ao salvar.' }))
    setSalvando(null)
    if (!r.ok) return setErro(r.error)
    setAviso(`Pesquisa da caixa "${c.nome}" salva.`)
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Pesquisa de satisfação</h1>
      <div style={{ fontSize: 13, color: 'var(--color-ink-subtle)', marginBottom: 12 }}>
        Ao resolver a conversa, o Chatwoot pergunta ao cliente como foi o atendimento. Configure o texto por caixa de entrada e acompanhe as notas abaixo.
      </div>
      {erro && <div style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{erro}</div>}
      {aviso && <div style={{ color: 'var(--color-success, #16a34a)', fontSize: 13, marginBottom: 8 }}>{aviso}</div>}

      {carregando ? (
        <Loader2 className="spinner" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {caixas.map((c) => (
            <div key={c.id} className="card" style={{ padding: '0.9rem 1rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong>{c.nome}</strong>
                <label style={{ fontSize: 13 }}><input type="checkbox" checked={c.ativa} onChange={(e) => edit(c.id, { ativa: e.target.checked })} /> Pesquisa ativa</label>
              </div>
              <textarea className="input" rows={2} maxLength={300} placeholder="Texto da pesquisa" value={c.mensagem} onChange={(e) => edit(c.id, { mensagem: e.target.value })} />
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" style={{ flex: 1 }} maxLength={40} placeholder="Texto do botão" value={c.botao} onChange={(e) => edit(c.id, { botao: e.target.value })} />
                <select className="input" value={c.tipo} onChange={(e) => edit(c.id, { tipo: e.target.value })}>
                  {CSAT_TIPOS.map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
                </select>
                <button type="button" className="btn btn-primary" disabled={salvando === c.id} onClick={() => void salvar(c)}>{salvando === c.id ? 'Salvando…' : 'Salvar'}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Resultados</h2>
        <select className="input" value={dias} onChange={(e) => setDias(Number(e.target.value))}>
          <option value={7}>Últimos 7 dias</option>
          <option value={30}>Últimos 30 dias</option>
          <option value={90}>Últimos 90 dias</option>
        </select>
      </div>
      {carregandoResp ? (
        <Loader2 className="spinner" />
      ) : !resumo || resumo.total === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--color-ink-subtle)' }}>Nenhuma resposta no período.</div>
      ) : (
        <>
          <div className="card" style={{ padding: '0.8rem 1rem', marginBottom: 10, display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
            <div><div style={{ fontSize: 22, fontWeight: 700 }}>{resumo.media.toFixed(2)}</div>nota média ({resumo.total} respostas)</div>
            <div>{([5, 4, 3, 2, 1] as const).map((n) => <div key={n}>{'★'.repeat(n)} {resumo.distribuicao[n]}</div>)}</div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Por atendente</div>
              {resumo.porAtendente.map((a) => <div key={a.nome}>{a.nome}: {a.media.toFixed(2)} ({a.total})</div>)}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {respostas.filter((r) => r.feedback_message).map((r) => (
              <div key={r.id} className="card" style={{ padding: '0.5rem 0.9rem', fontSize: 13 }}>
                <strong>{'★'.repeat(r.rating)}</strong> {r.assigned_agent?.name ? `· ${r.assigned_agent.name}` : ''} {r.contact?.name ? `· ${r.contact.name}` : ''}
                <div style={{ color: 'var(--color-ink-subtle)' }}>{r.feedback_message}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
