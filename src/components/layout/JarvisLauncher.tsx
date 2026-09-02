'use client'

/**
 * Jarvis na topbar — botão "🤖 <nome do agente>" que abre o chat da IA do
 * Workspace. O nome vem da configuração (Configurações › IA do Workspace);
 * a conversa mais recente é retomada automaticamente (histórico por
 * usuário). Resposta em streaming via /api/ia/chat — a credencial do
 * provedor nunca chega ao navegador. Também atende ao evento global
 * `brs-jarvis-abrir` (usado pelo contato Jarvis no BRS Messenger).
 */
import { useEffect, useRef, useState } from 'react'
import { Bot, Loader2, Plus, Send } from 'lucide-react'
import { getIaIdentidade, getIaMensagens, listarIaConversas } from '@/lib/ia/actions'

type Msg = { role: 'user' | 'assistant'; content: string }

export default function JarvisLauncher() {
  const [visivel, setVisivel] = useState(false)
  const [nome, setNome] = useState('Jarvis')
  const [saudacao, setSaudacao] = useState('')
  const [habilitado, setHabilitado] = useState(true)
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [conversaId, setConversaId] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [carregouHistorico, setCarregouHistorico] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let ativo = true
    getIaIdentidade()
      .then((idn) => {
        if (!ativo) return
        setNome(idn.nome || 'Jarvis')
        setSaudacao(idn.saudacao || '')
        setHabilitado(idn.habilitado)
        setVisivel(true) // permissão workspace-ia ok (a action falha sem ela)
      })
      .catch(() => setVisivel(false))
    return () => {
      ativo = false
    }
  }, [])

  useEffect(() => {
    const abrir = () => {
      setOpen(true)
    }
    window.addEventListener('brs-jarvis-abrir', abrir)
    return () => window.removeEventListener('brs-jarvis-abrir', abrir)
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [msgs, open])

  // Retoma a conversa mais recente na primeira abertura.
  useEffect(() => {
    if (!open || carregouHistorico) return
    setCarregouHistorico(true)
    ;(async () => {
      try {
        const lista = await listarIaConversas()
        const ultima = lista.success ? lista.data?.[0] : null
        if (!ultima) return
        const hist = await getIaMensagens(ultima.id)
        if (hist.success && hist.data?.length) {
          setConversaId(ultima.id)
          setMsgs(hist.data.map((m) => ({ role: m.role, content: m.content })))
        }
      } catch {
        // sem histórico, começa do zero
      }
    })()
  }, [open, carregouHistorico])

  async function enviar() {
    const pergunta = texto.trim()
    if (!pergunta || enviando) return
    setTexto('')
    setEnviando(true)
    setMsgs((prev) => [...prev, { role: 'user', content: pergunta }, { role: 'assistant', content: '' }])
    try {
      const res = await fetch('/api/ia/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversaId, mensagem: pergunta }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || `Erro ${res.status}`)
      }
      const novaConversa = res.headers.get('X-Ia-Conversa')
      if (novaConversa) setConversaId(novaConversa)
      const reader = res.body?.getReader()
      if (!reader) throw new Error('Sem resposta.')
      const decoder = new TextDecoder()
      let acumulado = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        acumulado += decoder.decode(value, { stream: true })
        const parcial = acumulado
        setMsgs((prev) => {
          const copia = [...prev]
          copia[copia.length - 1] = { role: 'assistant', content: parcial }
          return copia
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao falar com a IA.'
      setMsgs((prev) => {
        const copia = [...prev]
        copia[copia.length - 1] = { role: 'assistant', content: `⚠️ ${msg}` }
        return copia
      })
    } finally {
      setEnviando(false)
    }
  }

  function novaConversa() {
    setConversaId(null)
    setMsgs([])
  }

  if (!visivel) return null

  const saudacaoRender = saudacao ? saudacao.replace('{nome}', '') : `E aí! Sou o ${nome}, precisa de uma força?`

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        className="icon-button"
        onClick={() => setOpen((v) => !v)}
        title={`Conversar com ${nome} (IA do Workspace)`}
        style={{ width: 'auto', padding: '0 0.8rem', gap: 6, display: 'inline-flex', alignItems: 'center', fontWeight: 700, fontSize: '0.82rem' }}
      >
        <Bot size={17} /> {nome}
      </button>
      {open && (
        <div
          data-brs-messenger-ignore-close="true"
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 10px)', width: 'min(430px, 92vw)',
            height: 'min(540px, calc(100dvh - 110px))',
            background: 'var(--brs-surface)', border: '1px solid var(--brs-gray-200)', borderRadius: 14,
            boxShadow: '0 14px 40px rgba(15,35,71,0.22)', zIndex: 120,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.65rem 0.85rem', borderBottom: '1px solid var(--brs-gray-100)', fontWeight: 800, fontSize: '0.88rem', color: 'var(--brs-gray-800)' }}>
            <Bot size={18} style={{ color: 'var(--brs-navy-light)' }} /> {nome}
            <span style={{ fontWeight: 500, color: 'var(--brs-gray-400)', fontSize: '0.72rem' }}>— colega de equipe (IA)</span>
            <button
              onClick={novaConversa}
              title="Nova conversa"
              style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--brs-gray-200)', background: 'var(--brs-gray-50)', color: 'var(--brs-gray-600)', borderRadius: 8, padding: '0.25rem 0.55rem', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}
            >
              <Plus size={12} /> Nova
            </button>
          </div>
          <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {!habilitado && (
              <div style={{ border: '1px dashed var(--brs-gray-200)', borderRadius: 10, padding: '0.7rem', fontSize: '0.76rem', color: 'var(--brs-gray-400)' }}>
                A IA do Workspace ainda não foi configurada. Um administrador precisa cadastrar a credencial e os modelos em
                {' '}<a href="/ia-workspace" style={{ color: 'var(--brs-navy-light)' }}>Configurações › IA do Workspace</a>.
              </div>
            )}
            {habilitado && msgs.length === 0 && (
              <div style={{ border: '1px dashed var(--brs-gray-200)', borderRadius: 10, padding: '0.7rem', fontSize: '0.78rem', color: 'var(--brs-gray-400)' }}>
                {saudacaoRender}
              </div>
            )}
            {msgs.map((m, i) => (
              <div
                key={i}
                style={{
                  maxWidth: '88%', borderRadius: 10, padding: '0.5rem 0.65rem', fontSize: '0.8rem', lineHeight: 1.45,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  background: m.role === 'user' ? 'var(--brs-navy)' : 'var(--brs-gray-100)',
                  color: m.role === 'user' ? '#fff' : 'var(--brs-gray-800)',
                  border: m.role === 'user' ? 'none' : '1px solid var(--brs-gray-200)',
                }}
              >
                {m.content || (enviando && i === msgs.length - 1 ? 'Pensando…' : '')}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, padding: '0.6rem', borderTop: '1px solid var(--brs-gray-100)' }}>
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  enviar()
                }
              }}
              disabled={!habilitado}
              placeholder={habilitado ? `Pergunte algo ao ${nome}…` : 'IA não configurada'}
              style={{ flex: 1, minWidth: 0, border: '1px solid var(--brs-gray-200)', borderRadius: 9, background: 'var(--brs-gray-50)', color: 'var(--brs-gray-800)', fontFamily: 'inherit', fontSize: '0.82rem', padding: '0.5rem 0.65rem' }}
            />
            <button
              onClick={enviar}
              disabled={enviando || !habilitado || !texto.trim()}
              style={{ border: 'none', borderRadius: 9, background: 'var(--brs-navy)', color: '#fff', width: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: enviando || !habilitado ? 0.6 : 1 }}
              title="Enviar"
            >
              {enviando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
