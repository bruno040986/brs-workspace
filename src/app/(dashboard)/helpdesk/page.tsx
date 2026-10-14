'use client'

/**
 * HelpDesk do grupo (Tecnologia) — registro central de bugs/pedidos de
 * qualquer sistema, substituindo a planilha. Kanban pela máquina de estados:
 * aberto → plano_proposto → aprovado → em_execucao → concluido (rejeitado a
 * qualquer momento). Quem investiga e executa é a sessão Claude agendada
 * (fora daqui); esta tela abre tickets e aprova/rejeita planos.
 */
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, LifeBuoy, Loader2, Plus, Search, X } from 'lucide-react'
import NovoTicketModal from '@/components/helpdesk/NovoTicketModal'
import {
  decidirHelpdeskPlano,
  getMeuIdHelpdesk,
  listarHelpdeskTickets,
  rejeitarHelpdeskTicket,
} from '@/lib/helpdesk/actions'
import {
  HELPDESK_PRIORIDADES,
  HELPDESK_SISTEMAS,
  HELPDESK_TIPOS,
  type HelpdeskStatus,
  type HelpdeskTicket,
} from '@/lib/helpdesk/tipos'

const COLUNAS: Array<{ id: HelpdeskStatus; label: string; cor: string }> = [
  { id: 'aberto', label: 'Abertos', cor: '#0284c7' },
  { id: 'plano_proposto', label: 'Plano proposto', cor: '#d97706' },
  { id: 'aprovado', label: 'Aprovados', cor: '#7c3aed' },
  { id: 'em_execucao', label: 'Em execução', cor: '#2563eb' },
  { id: 'concluido', label: 'Concluídos', cor: '#16a34a' },
  { id: 'rejeitado', label: 'Rejeitados', cor: '#6b7280' },
]

const SISTEMA_LABEL = new Map(HELPDESK_SISTEMAS.map((s) => [s.id, s.label]))
const TIPO = new Map(HELPDESK_TIPOS.map((t) => [t.id as string, t]))
const PRIORIDADE = new Map(HELPDESK_PRIORIDADES.map((p) => [p.id as string, p]))
const BADGE = { fontSize: '0.6rem', fontWeight: 700, borderRadius: 99, padding: '0.12rem 0.5rem' } as const
const CONTEXTO_LABEL: Record<string, string> = {
  url: 'URL',
  pathname: 'Rota',
  titulo: 'Título da página',
  user_agent: 'Navegador',
  viewport: 'Tela',
  timestamp_cliente: 'Horário no navegador',
}

/** Badges de tipo e prioridade (cards e detalhe). */
function BadgesTicket({ t }: { t: HelpdeskTicket }) {
  const tipo = TIPO.get(t.tipo)
  const prio = PRIORIDADE.get(t.prioridade)
  return (
    <>
      {tipo && <span style={{ ...BADGE, background: 'var(--brs-gray-100)', color: 'inherit', border: '1px solid var(--brs-gray-200)' }}>{tipo.emoji} {tipo.label}</span>}
      {prio && <span style={{ ...BADGE, background: prio.cor, color: '#fff' }}>{prio.label}</span>}
    </>
  )
}

export default function HelpdeskPage() {
  const [tickets, setTickets] = useState<HelpdeskTicket[]>([])
  const [podeAprovar, setPodeAprovar] = useState(false)
  const [meuId, setMeuId] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [novo, setNovo] = useState(false)
  const [detalhe, setDetalhe] = useState<HelpdeskTicket | null>(null)
  const [decidindo, setDecidindo] = useState(false)
  const [ampliada, setAmpliada] = useState<{ url: string; nome: string } | null>(null)
  const [filtro, setFiltro] = useState({ busca: '', tipo: '', area: '', prioridade: '' })

  async function carregar() {
    setErro('')
    try {
      const [res, id] = await Promise.all([listarHelpdeskTickets(), getMeuIdHelpdesk()])
      if (!res.success) throw new Error(res.error)
      setTickets(res.data || [])
      setPodeAprovar(Boolean(res.podeAprovar))
      setMeuId(id)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao carregar o HelpDesk.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial + polling de 60s
    carregar()
    const t = window.setInterval(carregar, 60_000)
    return () => window.clearInterval(t)
  }, [])

  // Esc fecha a imagem ampliada e, depois, o detalhe
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (ampliada) setAmpliada(null)
      else setDetalhe(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ampliada])

  const areas = useMemo(() => [...new Set(tickets.map((t) => t.area).filter(Boolean))].sort(), [tickets])

  const porColuna = useMemo(() => {
    const busca = filtro.busca.trim().toLowerCase()
    const mapa = new Map<HelpdeskStatus, HelpdeskTicket[]>()
    for (const c of COLUNAS) mapa.set(c.id, [])
    for (const t of tickets) {
      if (filtro.tipo && t.tipo !== filtro.tipo) continue
      if (filtro.area && t.area !== filtro.area) continue
      if (filtro.prioridade && t.prioridade !== filtro.prioridade) continue
      if (busca && !`${t.titulo}\n${t.descricao}`.toLowerCase().includes(busca)) continue
      mapa.get(t.status)?.push(t)
    }
    return mapa
  }, [tickets, filtro])

  async function decidir(ticket: HelpdeskTicket, decisao: 'aprovar' | 'rejeitar') {
    if (decidindo) return
    setDecidindo(true)
    setErro('')
    try {
      const res =
        ticket.status === 'plano_proposto'
          ? await decidirHelpdeskPlano({ ticketId: ticket.id, decisao })
          : await rejeitarHelpdeskTicket(ticket.id)
      if (!res.success) throw new Error(res.error)
      setDetalhe(null)
      await carregar()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao registrar decisão.')
    } finally {
      setDecidindo(false)
    }
  }

  const dataFmt = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.1rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <LifeBuoy size={22} /> HelpDesk
        </h1>
        <span style={{ color: 'var(--brs-gray-400)', fontSize: '0.85rem' }}>
          Bugs e pedidos de qualquer sistema do grupo. O Claude investiga os abertos, propõe um plano e executa após aprovação.
        </span>
        <button className="btn btn-primary" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => setNovo(true)}>
          <Plus size={16} /> Novo Ticket
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 360 }}>
          <Search size={14} aria-hidden style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }} />
          <input className="form-control" aria-label="Buscar tickets" placeholder="Buscar no título ou descrição…" value={filtro.busca} onChange={(e) => setFiltro({ ...filtro, busca: e.target.value })} style={{ paddingLeft: 30 }} />
        </div>
        <select className="form-control" aria-label="Filtrar por tipo" value={filtro.tipo} onChange={(e) => setFiltro({ ...filtro, tipo: e.target.value })} style={{ width: 'auto' }}>
          <option value="">Todos os tipos</option>
          {HELPDESK_TIPOS.map((t) => <option key={t.id} value={t.id}>{t.emoji} {t.label}</option>)}
        </select>
        <select className="form-control" aria-label="Filtrar por área" value={filtro.area} onChange={(e) => setFiltro({ ...filtro, area: e.target.value })} style={{ width: 'auto', maxWidth: 260 }}>
          <option value="">Todas as áreas</option>
          {areas.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="form-control" aria-label="Filtrar por prioridade" value={filtro.prioridade} onChange={(e) => setFiltro({ ...filtro, prioridade: e.target.value })} style={{ width: 'auto' }}>
          <option value="">Todas as prioridades</option>
          {HELPDESK_PRIORIDADES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>

      {erro && (
        <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>
          {erro}
        </div>
      )}

      {carregando ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '2rem 0' }}>
          <Loader2 size={18} className="animate-spin" /> Carregando…
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0.8rem', alignItems: 'start' }}>
          {COLUNAS.map((col) => {
            const itens = porColuna.get(col.id) || []
            return (
              <div key={col.id} style={{ background: 'var(--brs-gray-100)', borderRadius: 12, padding: '0.6rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.55rem', padding: '0 0.2rem' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: col.cor }} />
                  <strong style={{ fontSize: '0.78rem' }}>{col.label}</strong>
                  <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--brs-gray-400)', fontWeight: 700 }}>{itens.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {itens.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setDetalhe(t)}
                      className="card"
                      style={{ padding: '0.6rem 0.7rem', textAlign: 'left', cursor: 'pointer', border: 'none', borderLeft: `3px solid ${t.urgente ? 'var(--brs-danger)' : col.cor}`, width: '100%' }}
                    >
                      <div style={{ fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.3 }}>
                        {t.urgente && <AlertTriangle size={12} style={{ color: 'var(--brs-danger)', marginRight: 4, verticalAlign: -1 }} />}
                        {t.titulo}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <BadgesTicket t={t} />
                        <span style={{ ...BADGE, background: 'var(--brs-navy)', color: '#fff' }}>
                          {SISTEMA_LABEL.get(t.sistema) || t.sistema}
                        </span>
                        <span style={{ fontSize: '0.66rem', color: 'var(--brs-gray-400)' }}>
                          {t.aberto_por === meuId ? 'você' : t.aberto_por_nome.split(' ')[0]} · {dataFmt(t.created_at)}
                        </span>
                      </div>
                    </button>
                  ))}
                  {itens.length === 0 && <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', padding: '0.4rem 0.2rem' }}>Nenhum ticket.</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {novo && <NovoTicketModal onFechar={() => setNovo(false)} onCriado={() => void carregar()} />}

      {/* modal: detalhe do ticket */}
      {detalhe && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div role="dialog" aria-modal="true" aria-label={detalhe.titulo} className="card" style={{ width: 'min(640px, 100%)', maxHeight: '90dvh', overflow: 'auto', padding: '1.1rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: '0.6rem' }}>
              <strong style={{ fontSize: '1rem', lineHeight: 1.3 }}>
                {detalhe.urgente && <AlertTriangle size={15} style={{ color: 'var(--brs-danger)', marginRight: 5, verticalAlign: -2 }} />}
                {detalhe.titulo}
              </strong>
              <button className="btn btn-ghost btn-icon" style={{ marginLeft: 'auto', flexShrink: 0 }} onClick={() => setDetalhe(null)} aria-label="Fechar"><X size={16} /></button>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '0.8rem', fontSize: '0.72rem', color: 'var(--brs-gray-400)' }}>
              <BadgesTicket t={detalhe} />
              <span style={{ ...BADGE, background: 'var(--brs-navy)', color: '#fff' }}>{SISTEMA_LABEL.get(detalhe.sistema)}</span>
              {detalhe.area && <span>{detalhe.area}</span>}
              <span>aberto por {detalhe.aberto_por_nome} em {dataFmt(detalhe.created_at)}</span>
              {detalhe.menu_contexto && <span>· {detalhe.menu_contexto}</span>}
              {detalhe.url && (
                <a href={detalhe.url} target="_blank" rel="noreferrer" style={{ color: 'var(--brs-navy-light)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  abrir tela <ExternalLink size={11} />
                </a>
              )}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem', lineHeight: 1.5, marginBottom: '1rem' }}>{detalhe.descricao || '(sem descrição)'}</div>

            {detalhe.anexos.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '1rem' }}>
                {detalhe.anexos.map((a) => (
                  <button key={a.id} type="button" onClick={() => setAmpliada({ url: a.url, nome: a.nome })} aria-label={`Ampliar ${a.nome || 'imagem'}`} style={{ width: 96, height: 96, padding: 0, border: '1px solid var(--brs-gray-200)', borderRadius: 8, overflow: 'hidden', cursor: 'zoom-in', background: 'none' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada do bucket privado */}
                    <img src={a.url} alt={a.nome} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </button>
                ))}
              </div>
            )}

            {detalhe.contexto_tecnico && (
              <details style={{ marginBottom: '1rem', fontSize: '0.72rem', color: 'var(--brs-gray-400)' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Contexto técnico</summary>
                <dl style={{ margin: '0.4rem 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.2rem 0.7rem' }}>
                  {Object.entries(detalhe.contexto_tecnico).map(([k, v]) => (
                    <div key={k} style={{ display: 'contents' }}>
                      <dt style={{ fontWeight: 700 }}>{CONTEXTO_LABEL[k] || k}</dt>
                      <dd style={{ margin: 0, wordBreak: 'break-all' }}>{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}

            {detalhe.plano_proposto && (
              <div className="card" style={{ padding: '0.9rem', background: 'var(--brs-gray-50)', marginBottom: '0.9rem' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#d97706', marginBottom: '0.4rem' }}>
                  Plano proposto {detalhe.plano_em ? `· ${dataFmt(detalhe.plano_em)}` : ''}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.83rem', lineHeight: 1.5 }}>{detalhe.plano_proposto}</div>
              </div>
            )}
            {detalhe.comentario_solucao && (
              <div className="card" style={{ padding: '0.9rem', background: 'var(--brs-gray-50)', marginBottom: '0.9rem' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--brs-success)', marginBottom: '0.4rem' }}>
                  Solução {detalhe.concluido_em ? `· ${dataFmt(detalhe.concluido_em)}` : ''}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.83rem', lineHeight: 1.5 }}>{detalhe.comentario_solucao}</div>
              </div>
            )}

            {podeAprovar && detalhe.status === 'plano_proposto' && (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-outline" onClick={() => decidir(detalhe, 'rejeitar')} disabled={decidindo} style={{ color: 'var(--brs-danger)' }}>
                  <X size={14} /> Rejeitar plano
                </button>
                <button className="btn btn-primary" onClick={() => decidir(detalhe, 'aprovar')} disabled={decidindo}>
                  <Check size={14} /> Aprovar plano
                </button>
              </div>
            )}
            {podeAprovar && ['aberto', 'aprovado', 'em_execucao'].includes(detalhe.status) && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-outline" onClick={() => decidir(detalhe, 'rejeitar')} disabled={decidindo} style={{ color: 'var(--brs-danger)' }}>
                  <X size={14} /> Rejeitar ticket
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* imagem ampliada */}
      {ampliada && (
        <div role="dialog" aria-modal="true" aria-label={ampliada.nome || 'Imagem anexada'} onClick={() => setAmpliada(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 210, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', cursor: 'zoom-out' }}>
          <button className="btn btn-ghost btn-icon" autoFocus aria-label="Fechar imagem" onClick={() => setAmpliada(null)} style={{ position: 'absolute', top: 12, right: 12, color: '#fff' }}><X size={20} /></button>
          {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada do bucket privado */}
          <img src={ampliada.url} alt={ampliada.nome} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </div>
      )}
    </div>
  )
}
