'use client'

/**
 * Chat do projeto: polling de 5 s com cursor incremental (`ouvirChat`).
 * `useChat` roda na página inteira (para contar não lidas em outra aba);
 * `ChatPainel` é só a aba.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Bot, Send, User } from 'lucide-react'
import { enviarChat, ouvirChat } from '@/lib/projetos/actions'
import { MAX_CHAT } from '@/lib/projetos/puro'
import type { Mensagem } from '@/lib/projetos/tipos'
import { Aviso, dataFmt, erroMsg } from './ui'

const POLL_MS = 5_000

export function useChat(codigo: string, ativo: boolean) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [naoLidas, setNaoLidas] = useState(0)
  const [erro, setErro] = useState('')
  const cursor = useRef<string | null>(null)
  const carregado = useRef(false)
  const emVoo = useRef(false)
  const deNovo = useRef(false)
  const ativoRef = useRef(ativo)

  useEffect(() => {
    ativoRef.current = ativo
  }, [ativo])

  async function buscar(): Promise<void> {
    // Uma busca por vez (o cursor é sequencial); quem chega durante uma busca agenda outra logo depois.
    if (emVoo.current) {
      deNovo.current = true
      return
    }
    emVoo.current = true
    try {
      const primeira = !carregado.current
      const res = await ouvirChat({ codigo, desde: cursor.current, limite: 50 })
      if (!res.success) throw new Error(res.error)
      const { mensagens: novas, cursor: c } = res.data
      cursor.current = c
      carregado.current = true
      setErro('')
      if (!novas.length) return
      setMensagens((atual) => {
        const ids = new Set(atual.map((m) => m.id))
        return [...atual, ...novas.filter((m) => !ids.has(m.id))]
      })
      if (!primeira && !ativoRef.current) setNaoLidas((n) => n + novas.length)
    } catch (err) {
      setErro(erroMsg(err, 'Erro ao carregar o chat.'))
    } finally {
      emVoo.current = false
      if (deNovo.current) {
        deNovo.current = false
        void buscar()
      }
    }
  }

  useEffect(() => {
    void Promise.resolve().then(buscar)
    const t = window.setInterval(() => {
      if (!document.hidden) void buscar()
    }, POLL_MS)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigo])

  /** Lança Error se falhar (o painel mostra). */
  async function enviar(conteudo: string) {
    const res = await enviarChat({ codigo, conteudo })
    if (!res.success) throw new Error(res.error)
    await buscar()
  }

  return { mensagens, naoLidas, erro, enviar, zerarNaoLidas: () => setNaoLidas(0) }
}

const horaFmt = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

export function ChatPainel({ mensagens, erro, enviar }: Pick<ReturnType<typeof useChat>, 'mensagens' | 'erro' | 'enviar'>) {
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erroEnvio, setErroEnvio] = useState('')
  const lista = useRef<HTMLDivElement>(null)
  const noFim = useRef(true)

  // Autoscroll só se o usuário já estava no fim (não puxa quem está lendo o histórico).
  useLayoutEffect(() => {
    const el = lista.current
    if (el && noFim.current) el.scrollTop = el.scrollHeight
  }, [mensagens.length])

  async function mandar() {
    const conteudo = texto.trim()
    if (!conteudo || enviando) return
    setEnviando(true)
    setErroEnvio('')
    try {
      noFim.current = true
      await enviar(conteudo)
      setTexto('')
    } catch (err) {
      setErroEnvio(erroMsg(err, 'Erro ao enviar mensagem.'))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '60vh', minHeight: 320, overflow: 'hidden' }}>
      <div
        ref={lista}
        onScroll={(e) => {
          const el = e.currentTarget
          noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        style={{ flex: 1, overflowY: 'auto', padding: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}
      >
        {mensagens.length === 0 && (
          <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)', margin: 'auto', textAlign: 'center' }}>
            Nenhuma mensagem no chat ainda. As IAs leem o chat quando chamam <code>chat_ouvir</code>.
          </div>
        )}
        {mensagens.map((m) => {
          const ia = m.autorTipo === 'agente'
          return (
            <div key={m.id} style={{ alignSelf: ia ? 'flex-start' : 'flex-end', maxWidth: 'min(85%, 640px)' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', color: 'var(--brs-gray-600)', marginBottom: 2, justifyContent: ia ? 'flex-start' : 'flex-end' }}
              >
                {ia ? <Bot size={13} /> : <User size={13} />}
                <strong>{m.autorNome}</strong>
                <span title={dataFmt(m.createdAt)} style={{ color: 'var(--brs-gray-400)' }}>{horaFmt(m.createdAt)}</span>
              </div>
              <div
                style={{
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  fontSize: '0.85rem',
                  lineHeight: 1.45,
                  padding: '0.5rem 0.75rem',
                  borderRadius: 12,
                  background: ia ? 'var(--brs-gray-100)' : 'var(--brs-navy)',
                  color: ia ? 'inherit' : '#fff',
                }}
              >
                {m.conteudo}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ borderTop: '1px solid var(--brs-gray-100)', padding: '0.6rem' }}>
        <Aviso erro={erroEnvio || erro} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            className="form-control"
            rows={2}
            maxLength={MAX_CHAT}
            value={texto}
            readOnly={enviando}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void mandar()
              }
            }}
            placeholder="Mensagem (Enter envia, Shift+Enter quebra linha)"
            style={{ flex: 1, resize: 'none' }}
          />
          <button className="btn btn-primary" onClick={mandar} disabled={enviando || !texto.trim()}>
            <Send size={14} /> {enviando ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  )
}
