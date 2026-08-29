'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCheck, Inbox, Loader2, Maximize2, MessageCircle, Search, Send, UserCheck, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { assumirConversa, getAgentesChat, getConversas, getMensagens, resolverConversa, responderConversa } from '@/lib/central-conversas/actions'
import type { ChatwootConversa, ChatwootMensagem } from '@/lib/central-conversas/chatwoot'

type Aba = 'meus' | 'fila' | 'geral'
const ABAS: Array<{ id: Aba; rotulo: string; Icone: typeof MessageCircle }> = [
  { id: 'meus', rotulo: 'Meus', Icone: MessageCircle },
  { id: 'fila', rotulo: 'Fila', Icone: Inbox },
  { id: 'geral', rotulo: 'Geral', Icone: Users },
]

function hora(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export default function CentralConversasPanel({ compacto = false }: { compacto?: boolean }) {
  const [aba, setAba] = useState<Aba>('meus')
  const [busca, setBusca] = useState('')
  const [conversas, setConversas] = useState<ChatwootConversa[]>([])
  const [disponivel, setDisponivel] = useState(true)
  const [carregando, setCarregando] = useState(true)
  const [selecionada, setSelecionada] = useState<ChatwootConversa | null>(null)
  const [mensagens, setMensagens] = useState<ChatwootMensagem[]>([])
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [agentes, setAgentes] = useState<Array<{ id: number; name: string }>>([])
  const fimRef = useRef<HTMLDivElement>(null)

  const carregarLista = useCallback(async () => {
    try {
      const r = await getConversas({ aba, q: busca || undefined })
      setDisponivel(r.disponivel)
      setConversas(r.conversas || [])
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar conversas.')
    } finally {
      setCarregando(false)
    }
  }, [aba, busca])

  const carregarThread = useCallback(async (id: number) => {
    try {
      const r = await getMensagens(id)
      setMensagens((r.payload || []).filter((m) => m.message_type !== 2 || m.content))
      requestAnimationFrame(() => fimRef.current?.scrollIntoView({ block: 'end' }))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar mensagens.')
    }
  }, [])

  useEffect(() => {
    setCarregando(true)
    carregarLista()
    const t = setInterval(carregarLista, 12000)
    return () => clearInterval(t)
  }, [carregarLista])

  useEffect(() => {
    getAgentesChat().then((a) => setAgentes(a || [])).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!selecionada) return
    carregarThread(selecionada.id)
    const t = setInterval(() => carregarThread(selecionada.id), 6000)
    return () => clearInterval(t)
  }, [selecionada, carregarThread])

  // Tempo real: eventos do engine (mensagem recebida) → atualiza lista/thread na hora.
  useEffect(() => {
    const supabase = createClient()
    const canal = supabase
      .channel('chat-eventos-central')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_eventos' }, (payload) => {
        const ev = payload.new as { payload?: { conversation_id?: number } }
        carregarLista()
        if (selecionada && ev.payload?.conversation_id === selecionada.id) carregarThread(selecionada.id)
      })
      .subscribe()
    return () => {
      supabase.removeChannel(canal)
    }
  }, [carregarLista, carregarThread, selecionada])

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!selecionada || !texto.trim()) return
    setEnviando(true)
    setErro(null)
    try {
      await responderConversa(selecionada.id, texto)
      setTexto('')
      await carregarThread(selecionada.id)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao enviar.')
    } finally {
      setEnviando(false)
    }
  }

  const listaOrdenada = useMemo(() => [...conversas].sort((a, b) => (b.last_activity_at || 0) - (a.last_activity_at || 0)), [conversas])

  const Lista = (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ padding: '0.75rem 0.75rem 0.5rem' }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--color-ink-subtle)' }} />
          <input className="form-input" style={{ paddingLeft: 30 }} placeholder="Pesquisar por nome ou número…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', marginTop: 8 }}>
          {ABAS.map(({ id, rotulo, Icone }) => (
            <button key={id} type="button" onClick={() => setAba(id)} style={{ background: 'none', border: 'none', borderBottom: `2px solid ${aba === id ? 'var(--color-primary)' : 'transparent'}`, color: aba === id ? 'var(--color-primary)' : 'var(--color-ink-subtle)', fontWeight: 700, fontSize: 12.5, padding: '6px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }}>
              <Icone size={14} /> {rotulo}
            </button>
          ))}
        </div>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {!disponivel ? (
          <div style={{ padding: '2rem 1rem', textAlign: 'center', fontSize: 13, color: 'var(--color-ink-subtle)' }}>Chatwoot ainda não provisionado.</div>
        ) : carregando ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}><Loader2 size={18} className="spinner" /></div>
        ) : listaOrdenada.length === 0 ? (
          <div style={{ padding: '2rem 1rem', textAlign: 'center', fontSize: 13, color: 'var(--color-ink-subtle)' }}>Não existem conversas abertas</div>
        ) : (
          listaOrdenada.map((c) => {
            const ativa = selecionada?.id === c.id
            const ultima = c.last_non_activity_message?.content || (c.last_non_activity_message?.attachments?.length ? '[anexo]' : '')
            return (
              <button key={c.id} type="button" onClick={() => setSelecionada(c)} style={{ width: '100%', textAlign: 'left', background: ativa ? 'rgba(233,5,65,.08)' : 'none', border: 'none', borderBottom: '1px solid var(--color-line-soft)', padding: '10px 12px', cursor: 'pointer', display: 'flex', gap: 10 }}>
                <span style={{ width: 36, height: 36, borderRadius: 99, background: 'linear-gradient(135deg,#e90541,#2012be)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
                  {(c.meta.sender?.name || '?').trim().slice(0, 1).toUpperCase()}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                    <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.meta.sender?.name || 'Sem nome'}</strong>
                    <span style={{ fontSize: 11, color: 'var(--color-ink-subtle)', flexShrink: 0 }}>{c.last_activity_at ? hora(c.last_activity_at) : ''}</span>
                  </span>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12, color: 'var(--color-ink-subtle)' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ultima}</span>
                    {c.unread_count > 0 && <span style={{ background: 'var(--color-secondary)', color: '#fff', borderRadius: 99, padding: '0 6px', fontSize: 10, fontWeight: 700 }}>{c.unread_count}</span>}
                  </span>
                  {c.meta.assignee?.name && <span style={{ fontSize: 11, color: 'var(--color-ink-subtle)' }}>↳ {c.meta.assignee.name}</span>}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )

  const Thread = selecionada ? (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--color-line)' }}>
        {compacto && <button type="button" onClick={() => setSelecionada(null)} className="btn btn-secondary btn-sm"><ArrowLeft size={14} /></button>}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selecionada.meta.sender?.name || 'Sem nome'}</div>
          <div style={{ fontSize: 11, color: 'var(--color-ink-subtle)' }}>{selecionada.meta.sender?.phone_number || selecionada.meta.channel || ''}{selecionada.meta.assignee ? ` · ${selecionada.meta.assignee.name}` : ' · sem atendente'}</div>
        </div>
        <select className="form-input" style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }} value={selecionada.meta.assignee?.id || ''} onChange={async (e) => { await assumirConversa(selecionada.id, e.target.value ? Number(e.target.value) : null); carregarLista() }} title="Atribuir">
          <option value="">Sem atendente</option>
          {agentes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button type="button" className="btn btn-secondary btn-sm" title="Resolver" onClick={async () => { await resolverConversa(selecionada.id); setSelecionada(null); carregarLista() }}><CheckCheck size={14} /></button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, background: 'var(--color-surface-sunken)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {mensagens.map((m) => {
          const saida = m.message_type === 1 || m.message_type === 3
          return (
            <div key={m.id} style={{ alignSelf: saida ? 'flex-end' : 'flex-start', maxWidth: '82%', background: saida ? '#DCF8C6' : '#fff', color: '#111', borderRadius: 12, padding: '6px 10px', fontSize: 13, boxShadow: '0 1px 2px rgba(0,0,0,.08)' }}>
              {m.attachments?.map((a) => a.file_type === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={a.id} src={a.data_url} alt="" style={{ maxWidth: '100%', borderRadius: 8, marginBottom: 4 }} />
              ) : a.file_type === 'audio' ? (
                <audio key={a.id} controls src={a.data_url} style={{ maxWidth: '100%' }} />
              ) : (
                <a key={a.id} href={a.data_url} target="_blank" rel="noreferrer">📎 anexo</a>
              ))}
              {m.content && <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</div>}
              <div style={{ fontSize: 10, opacity: 0.6, textAlign: 'right' }}>{hora(m.created_at)}{m.private ? ' · nota' : ''}</div>
            </div>
          )
        })}
        <div ref={fimRef} />
      </div>
      <form onSubmit={enviar} style={{ display: 'flex', gap: 6, padding: 10, borderTop: '1px solid var(--color-line)' }}>
        <input className="form-input" placeholder="Digite uma mensagem…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={enviando || !texto.trim()}>{enviando ? <Loader2 size={16} className="spinner" /> : <Send size={16} />}</button>
      </form>
    </div>
  ) : (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--color-ink-subtle)' }}>
      <MessageCircle size={40} strokeWidth={1.3} />
      <span style={{ fontSize: 13, fontWeight: 600 }}>Selecione uma conversa</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {erro && <div className="alert alert-error" style={{ margin: '0.5rem', fontSize: 12 }}>{erro}</div>}
      {compacto ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0 }}>{selecionada ? Thread : Lista}</div>
          <Link href="/conversas" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8, fontSize: 12, fontWeight: 700, borderTop: '1px solid var(--color-line)', color: 'var(--color-primary)' }}>
            <Maximize2 size={14} /> Abrir em tela cheia
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', flex: 1, minHeight: 0 }}>
          <div style={{ borderRight: '1px solid var(--color-line)', minHeight: 0 }}>{Lista}</div>
          <div style={{ minHeight: 0 }}>{Thread}</div>
        </div>
      )}
      {!compacto && <div style={{ display: 'none' }}><UserCheck size={1} /></div>}
    </div>
  )
}
