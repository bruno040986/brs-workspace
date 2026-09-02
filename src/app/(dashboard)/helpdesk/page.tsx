'use client'

/**
 * HelpDesk do grupo (Tecnologia) — registro central de bugs/pedidos de
 * qualquer sistema, substituindo a planilha. Kanban pela máquina de estados:
 * aberto → plano_proposto → aprovado → em_execucao → concluido (rejeitado a
 * qualquer momento). Quem investiga e executa é a sessão Claude agendada
 * (fora daqui); esta tela abre tickets e aprova/rejeita planos.
 */
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, LifeBuoy, Loader2, Plus, X } from 'lucide-react'
import {
  HELPDESK_SISTEMAS,
  abrirHelpdeskTicket,
  decidirHelpdeskPlano,
  getMeuIdHelpdesk,
  listarHelpdeskTickets,
  rejeitarHelpdeskTicket,
  type HelpdeskSistema,
  type HelpdeskStatus,
  type HelpdeskTicket,
} from '@/lib/helpdesk/actions'

const COLUNAS: Array<{ id: HelpdeskStatus; label: string; cor: string }> = [
  { id: 'aberto', label: 'Abertos', cor: '#0284c7' },
  { id: 'plano_proposto', label: 'Plano proposto', cor: '#d97706' },
  { id: 'aprovado', label: 'Aprovados', cor: '#7c3aed' },
  { id: 'em_execucao', label: 'Em execução', cor: '#2563eb' },
  { id: 'concluido', label: 'Concluídos', cor: '#16a34a' },
  { id: 'rejeitado', label: 'Rejeitados', cor: '#6b7280' },
]

const SISTEMA_LABEL = new Map(HELPDESK_SISTEMAS.map((s) => [s.id, s.label]))

const FORM_VAZIO = { titulo: '', descricao: '', url: '', menu_contexto: '', sistema: '' as HelpdeskSistema | '', urgente: false }

export default function HelpdeskPage() {
  const [tickets, setTickets] = useState<HelpdeskTicket[]>([])
  const [podeAprovar, setPodeAprovar] = useState(false)
  const [meuId, setMeuId] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [form, setForm] = useState<typeof FORM_VAZIO | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [detalhe, setDetalhe] = useState<HelpdeskTicket | null>(null)
  const [decidindo, setDecidindo] = useState(false)

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
    carregar()
    const t = window.setInterval(carregar, 60_000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const porColuna = useMemo(() => {
    const mapa = new Map<HelpdeskStatus, HelpdeskTicket[]>()
    for (const c of COLUNAS) mapa.set(c.id, [])
    for (const t of tickets) mapa.get(t.status)?.push(t)
    return mapa
  }, [tickets])

  async function enviarForm() {
    if (!form || salvando) return
    if (!form.titulo.trim()) return setErro('Dê um título ao ticket.')
    if (!form.sistema) return setErro('Escolha o sistema.')
    setSalvando(true)
    setErro('')
    try {
      const res = await abrirHelpdeskTicket({ ...form, sistema: form.sistema })
      if (!res.success) throw new Error(res.error)
      setForm(null)
      await carregar()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao abrir ticket.')
    } finally {
      setSalvando(false)
    }
  }

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
        <button className="btn btn-primary" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => setForm({ ...FORM_VAZIO })}>
          <Plus size={16} /> Novo Ticket
        </button>
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
                        <span style={{ fontSize: '0.6rem', fontWeight: 700, background: 'var(--brs-navy)', color: '#fff', borderRadius: 99, padding: '0.12rem 0.5rem' }}>
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

      {/* modal: novo ticket */}
      {form && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="card" style={{ width: 'min(560px, 100%)', maxHeight: '90dvh', overflow: 'auto', padding: '1.1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.9rem' }}>
              <strong>Novo Ticket</strong>
              <button className="btn btn-ghost btn-icon" style={{ marginLeft: 'auto' }} onClick={() => setForm(null)}><X size={16} /></button>
            </div>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>Título *</label>
            <input className="form-control" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Resumo curto do problema ou pedido" style={{ margin: '0.25rem 0 0.8rem' }} />
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>Descrição *</label>
            <textarea className="form-control" rows={4} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="O que aconteceu, o que era esperado, passos para reproduzir…" style={{ margin: '0.25rem 0 0.8rem' }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>Sistema *</label>
                <select className="form-control" value={form.sistema} onChange={(e) => setForm({ ...form, sistema: e.target.value as HelpdeskSistema })} style={{ marginTop: '0.25rem' }}>
                  <option value="">— Escolha —</option>
                  {HELPDESK_SISTEMAS.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>Menu / contexto</label>
                <input className="form-control" value={form.menu_contexto} onChange={(e) => setForm({ ...form, menu_contexto: e.target.value })} placeholder="Ex.: Configurações → Usuários" style={{ marginTop: '0.25rem' }} />
              </div>
            </div>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginTop: '0.8rem' }}>URL da tela</label>
            <input className="form-control" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" style={{ margin: '0.25rem 0 0.8rem' }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.urgente} onChange={(e) => setForm({ ...form, urgente: e.target.checked })} />
              <AlertTriangle size={14} style={{ color: 'var(--brs-danger)' }} /> Urgente
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: '1rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setForm(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={enviarForm} disabled={salvando}>{salvando ? 'Abrindo…' : 'Abrir Ticket'}</button>
            </div>
          </div>
        </div>
      )}

      {/* modal: detalhe do ticket */}
      {detalhe && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="card" style={{ width: 'min(640px, 100%)', maxHeight: '90dvh', overflow: 'auto', padding: '1.1rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: '0.6rem' }}>
              <strong style={{ fontSize: '1rem', lineHeight: 1.3 }}>
                {detalhe.urgente && <AlertTriangle size={15} style={{ color: 'var(--brs-danger)', marginRight: 5, verticalAlign: -2 }} />}
                {detalhe.titulo}
              </strong>
              <button className="btn btn-ghost btn-icon" style={{ marginLeft: 'auto', flexShrink: 0 }} onClick={() => setDetalhe(null)}><X size={16} /></button>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '0.8rem', fontSize: '0.72rem', color: 'var(--brs-gray-400)' }}>
              <span style={{ fontWeight: 700, background: 'var(--brs-navy)', color: '#fff', borderRadius: 99, padding: '0.15rem 0.6rem' }}>{SISTEMA_LABEL.get(detalhe.sistema)}</span>
              <span>aberto por {detalhe.aberto_por_nome} em {dataFmt(detalhe.created_at)}</span>
              {detalhe.menu_contexto && <span>· {detalhe.menu_contexto}</span>}
              {detalhe.url && (
                <a href={detalhe.url} target="_blank" rel="noreferrer" style={{ color: 'var(--brs-navy-light)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  abrir tela <ExternalLink size={11} />
                </a>
              )}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem', lineHeight: 1.5, marginBottom: '1rem' }}>{detalhe.descricao || '(sem descrição)'}</div>

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
    </div>
  )
}
