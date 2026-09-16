'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  CornerUpRight,
  Download,
  Info,
  Loader2,
  Mic,
  Paperclip,
  Pin,
  Reply,
  RotateCw,
  Search,
  Send,
  Share2,
  Smile,
  Square,
  Star,
  StickyNote,
  Trash2,
  User,
  UserCog,
  UserPlus,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import EmojiPicker from './EmojiPicker'
import AvatarContato from './AvatarContato'
import AudioPlayer from './AudioPlayer'
import { ATRIBUTO_CHAVE_ROLAGEM, useRolagemThread } from './useRolagemThread'
import { VINCULO_COR, VINCULO_LABEL, dataCurta, dataHoraCompleta, ehGrupo, type AgenteChat, type ConversaAtendimento, type MensagemComExtras, type RespostaRapida, type RespostaRapidaRow } from './types'
import { getMeuAgente, type DepartamentoResumo } from '@/lib/central-conversas/actions'
import { getGrupo } from '@/lib/central-conversas/grupos-actions'
import type { MembroGrupo } from '@/lib/central-conversas/engine'

const MIME_ANEXO_ACEITOS = '.pdf,.png,.jpg,.jpeg,.webp,.mp3,.ogg,.opus,.mp4,.xlsx,.csv'

/** Função top-level (referencialmente estável entre renders — exigência do useRolagemThread). */
function chaveMensagem(m: MensagemComExtras): string {
  return String(m.id)
}

// Uma resolução por carregamento de página, não por conversa aberta
let meuAgentePromise: Promise<{ id: number; name: string } | null> | null = null
function resolverMeuAgente() {
  if (!meuAgentePromise) {
    meuAgentePromise = getMeuAgente().catch(() => {
      meuAgentePromise = null
      return null
    })
  }
  return meuAgentePromise
}

type Props = {
  conversa: ConversaAtendimento
  mensagens: MensagemComExtras[]
  carregando: boolean
  agentes: AgenteChat[]
  respostasRapidas: RespostaRapida[] | null
  respostasVisiveis: RespostaRapidaRow[]
  citacao: MensagemComExtras | null
  onCitar: (m: MensagemComExtras | null) => void
  departamento: string | null
  nomeInstancia?: string
  departamentos: DepartamentoResumo[]
  enviando: boolean
  compacto?: boolean
  onVoltar?: () => void
  onAbrirPainel?: () => void
  onEnviarTexto: (texto: string, mentions?: string[]) => Promise<void>
  onEnviarNota: (texto: string) => Promise<void>
  onEnviarAnexo: (file: File, legenda?: string) => Promise<void>
  onEnviarAudio: (blob: Blob) => Promise<void>
  /** Resposta rápida COM anexo: o servidor baixa o arquivo do bucket e manda com o texto como legenda (Fase B §d). */
  onEnviarRespostaRapida: (respostaId: string) => Promise<void>
  onTransferir: (input: { departamentoId: string; agenteId?: number | null; comentario?: string }) => Promise<void>
  onEncerrar: (motivo?: string) => Promise<void>
  conversas?: ConversaAtendimento[]
  onReagirMensagem?: (messageId: number, emoji: string) => Promise<void>
  onApagarMensagem?: (messageId: number) => Promise<void>
  onEncaminharMensagem?: (sourceMessage: MensagemComExtras, targetConversationId: number) => Promise<void>
  onSelecionarConversa?: (c: ConversaAtendimento | null) => void
  onNovaConversa?: (input: { instanciaId: string; telefone: string; texto: string; operationId: string }) => Promise<any>
}

type SenderGrupo = { jid?: string; numero?: string | null; nome?: string | null }

function formatarContatoMencao(m: MembroGrupo | null | undefined): string {
  if (!m) return ''
  const nome = String(m.nome || '').trim()
  if (nome && !nome.includes('@lid') && !nome.includes('@s.whatsapp.net')) return nome
  const num = String(m.numero || m.jid || '').replace(/@.*$/, '').replace(/[^0-9]/g, '')
  if (num.length >= 10) {
    if (num.startsWith('55') && num.length >= 12) {
      const ddd = num.slice(2, 4)
      const rest = num.slice(4)
      return `+55 (${ddd}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`
    }
    return `+${num}`
  }
  return m.nome || m.numero || 'Membro'
}

/**
  Remetente de mensagem recebida em GRUPO.
 */
function remetenteDeGrupo(m: MensagemComExtras): { nome: string; conteudo: string | null; jid?: string; numero?: string } | null {
  const bruto = m.content_attributes?.sender
  const s: SenderGrupo | null = bruto && typeof bruto === 'object' ? (bruto as SenderGrupo) : typeof bruto === 'string' ? { nome: bruto } : null
  const conteudo = m.content
  const prefixo = conteudo?.match(/^\*(.+?):\*\s?([\s\S]*)$/)
  const nome = String(s?.nome || s?.numero || prefixo?.[1] || '').trim()
  if (!nome) return null
  const tiraPrefixo = prefixo && (!s?.nome || prefixo[1] === s.nome)
  return { nome, conteudo: tiraPrefixo ? prefixo[2] : conteudo, jid: s?.jid, numero: s?.numero || undefined }
}

/** Destaca tokens `@algo` no texto */
function TextoComMencoes({ texto, temMencoes }: { texto: string; temMencoes: boolean }) {
  if (!temMencoes) return <>{texto}</>
  const partes = texto.split(/(@[^\s@]+)/g)
  return (
    <>
      {partes.map((p, i) =>
        p.startsWith('@') && p.length > 1 ? (
          <strong key={i} style={{ color: 'var(--msn-accent)' }}>
            {p}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

function tempoGravacao(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function ThreadConversa({
  conversa,
  mensagens,
  carregando,
  agentes,
  respostasRapidas,
  respostasVisiveis,
  citacao,
  onCitar,
  departamento,
  nomeInstancia,
  departamentos,
  enviando,
  compacto,
  onVoltar,
  onAbrirPainel,
  onEnviarTexto,
  onEnviarNota,
  onEnviarAnexo,
  onEnviarAudio,
  onEnviarRespostaRapida,
  onTransferir,
  onEncerrar,
  conversas,
  onReagirMensagem,
  onApagarMensagem,
  onEncaminharMensagem,
  onSelecionarConversa,
  onNovaConversa,
}: Props) {
  const [texto, setTexto] = useState('')
  const [notaInterna, setNotaInterna] = useState(false)
  const [emojiAberto, setEmojiAberto] = useState(false)
  const [buscaAberta, setBuscaAberta] = useState(false)
  const [buscaTexto, setBuscaTexto] = useState('')
  const [modalTransferir, setModalTransferir] = useState(false)
  const [transfDepartamentoId, setTransfDepartamentoId] = useState('')
  const [transfAgenteId, setTransfAgenteId] = useState('')
  const [transfComentario, setTransfComentario] = useState('')
  const [popoverEncerrar, setPopoverEncerrar] = useState(false)
  const [motivoEncerrar, setMotivoEncerrar] = useState('')
  const [gravando, setGravando] = useState<'idle' | 'gravando' | 'pronto'>('idle')
  const [duracaoMs, setDuracaoMs] = useState(0)
  const [alterando, setAlterando] = useState<'assumindo' | 'transferindo' | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [meuAgente, setMeuAgente] = useState<{ id: number; name: string } | null | undefined>(undefined)
  const [membrosGrupo, setMembrosGrupo] = useState<MembroGrupo[]>([])
  const [mencoesAtuais, setMencoesAtuais] = useState<Map<string, string>>(new Map())
  
  // Novos estados para recursos interativos (Ctrl+V, Lightbox, Menu de Ações, Fixar, Favoritar)
  const [modalPastePreview, setModalPastePreview] = useState<{ file: File; url: string; legenda: string } | null>(null)
  const [modalLightbox, setModalLightbox] = useState<{ url: string; nome?: string; mensagem?: MensagemComExtras } | null>(null)
  const [zoomScale, setZoomScale] = useState(1)
  const [hoverMessageId, setHoverMessageId] = useState<number | null>(null)
  const [menuMensagemId, setMenuMensagemId] = useState<number | null>(null)
  const [modalEncaminhar, setModalEncaminhar] = useState<MensagemComExtras | null>(null)
  const [filtroEncaminhar, setFiltroEncaminhar] = useState('')
  const [mensagensFixadas, setMensagensFixadas] = useState<Set<number>>(new Set())
  const [mensagensFavoritas, setMensagensFavoritas] = useState<Set<number>>(new Set())
  const [mensagensApagadasLocal, setMensagensApagadasLocal] = useState<Set<number>>(new Set())

  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const gravacaoBlobRef = useRef<Blob | null>(null)
  const cronometroRef = useRef<number | null>(null)
  const inicioGravacaoRef = useRef(0)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let vivo = true
    void resolverMeuAgente().then((r) => {
      if (vivo) setMeuAgente(r)
    })
    return () => {
      vivo = false
    }
  }, [])

  function exibirToast(textoMsg: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast(textoMsg)
    toastTimerRef.current = setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
  }, [])

  const mensagensFiltradas = useMemo(() => {
    if (!buscaAberta || !buscaTexto.trim()) return mensagens
    const alvo = buscaTexto.trim().toLowerCase()
    return mensagens.filter((m) => (m.content || '').toLowerCase().includes(alvo))
  }, [mensagens, buscaAberta, buscaTexto])

  const [mensagensCongeladas, setMensagensCongeladas] = useState<MensagemComExtras[]>(mensagens)
  const [buscaAbertaAnterior, setBuscaAbertaAnterior] = useState(buscaAberta)
  if (buscaAberta !== buscaAbertaAnterior) {
    setBuscaAbertaAnterior(buscaAberta)
    if (buscaAberta) setMensagensCongeladas(mensagens)
  }
  const threadRolagem = buscaAberta ? mensagensCongeladas : mensagens
  const { containerRef, novasNaoLidas, aoRolarMensagens, irParaOFim, irParaMensagemEnviada, aoMidiaCarregar } = useRolagemThread(threadRolagem, chaveMensagem)

  const mensagensPorId = useMemo(() => new Map(mensagens.map((m) => [m.id, m])), [mensagens])

  const chipsResposta = useMemo<Array<{ id: string; atalho: string; conteudo: string; arquivoPath: string | null }>>(
    () =>
      respostasVisiveis.length > 0
        ? respostasVisiveis.map((r) => ({ id: r.id, atalho: r.atalho, conteudo: r.texto, arquivoPath: r.arquivoPath }))
        : (respostasRapidas || []).map((r) => ({ id: String(r.id), atalho: r.atalho, conteudo: r.conteudo, arquivoPath: null })),
    [respostasVisiveis, respostasRapidas],
  )

  function usarResposta(r: { id: string; conteudo: string; arquivoPath: string | null }) {
    if (r.arquivoPath) {
      setTexto('')
      void onEnviarRespostaRapida(r.id).then(() => irParaMensagemEnviada())
      return
    }
    setTexto((prev) => (prev && !prev.trim().startsWith('/') ? `${prev} ${r.conteudo}` : r.conteudo))
  }

  const sugestoesPicker = useMemo(() => {
    const termo = texto.trim()
    if (!termo.startsWith('/') || termo.length < 1) return []
    const alvo = termo.slice(1).toLowerCase()
    return chipsResposta.filter((r) => r.atalho.replace(/^\//, '').toLowerCase().startsWith(alvo)).slice(0, 6)
  }, [texto, chipsResposta])

  const grupo = ehGrupo(conversa)
  const entidade = conversa.atendimentoMeta?.entidade

  useEffect(() => {
    setMencoesAtuais(new Map())
    setMembrosGrupo([])
    if (!grupo) return
    let vivo = true
    void getGrupo(conversa.id)
      .then((r) => {
        if (vivo && r.ok) setMembrosGrupo(r.grupo.membros)
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [conversa.id, grupo])

  const termoMencao = useMemo(() => {
    if (!grupo) return null
    const m = texto.match(/(?:^|\s)@([^\s@]*)$/)
    return m ? m[1] : null
  }, [texto, grupo])

  const sugestoesMencao = useMemo(() => {
    if (termoMencao === null) return []
    const alvo = termoMencao.toLowerCase()
    return (membrosGrupo || [])
      .filter((m) => {
        if (!m) return false
        const rotulo = formatarContatoMencao(m)
        return rotulo.toLowerCase().includes(alvo)
      })
      .slice(0, 6)
  }, [termoMencao, membrosGrupo])

  function escolherMencao(m: MembroGrupo) {
    if (!m) return
    const rotulo = formatarContatoMencao(m)
    setTexto((prev) => prev.replace(/(?:^|\s)@([^\s@]*)$/, (match) => `${match.startsWith(' ') ? ' ' : ''}@${rotulo} `))
    setMencoesAtuais((prev) => {
      const novo = new Map(prev)
      if (m.jid) novo.set(rotulo, m.jid)
      return novo
    })
  }

  const departamentoAtualId = departamentos.find((d) => d.chatwootTeamId != null && d.chatwootTeamId === (conversa.meta.team?.id ?? null))?.id
  const podeAssumirParaMim = Boolean(meuAgente && departamentoAtualId && conversa.meta.assignee?.id !== meuAgente.id)

  async function assumirParaMim() {
    if (!meuAgente || !departamentoAtualId || alterando) return
    setAlterando('assumindo')
    try {
      await onTransferir({ departamentoId: departamentoAtualId, agenteId: meuAgente.id })
      exibirToast('Atendimento assumido')
    } catch {
    } finally {
      setAlterando(null)
    }
  }

  async function salvarTransferencia() {
    if (!transfDepartamentoId || alterando) return
    setModalTransferir(false)
    setAlterando('transferindo')
    const departamentoNome = departamentos.find((d) => d.id === transfDepartamentoId)?.nome
    const agenteNome = transfAgenteId ? agentes.find((a) => String(a.id) === transfAgenteId)?.name : null
    try {
      await onTransferir({ departamentoId: transfDepartamentoId, agenteId: transfAgenteId ? Number(transfAgenteId) : null, comentario: transfComentario.trim() || undefined })
      setTransfComentario('')
      exibirToast(agenteNome ? `Transferido para ${agenteNome}` : `Transferido para ${departamentoNome || 'o departamento'}`)
    } catch {
    } finally {
      setAlterando(null)
    }
  }

  async function enviar() {
    const valor = texto.trim()
    if (!valor) return
    const mentions = [...mencoesAtuais.entries()].filter(([nome]) => valor.includes(`@${nome}`)).map(([, jid]) => jid)
    setTexto('')
    setMencoesAtuais(new Map())
    try {
      if (notaInterna) await onEnviarNota(valor)
      else await onEnviarTexto(valor, mentions.length ? mentions : undefined)
      irParaMensagemEnviada()
    } catch {
      setTexto(valor)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!enviando) void enviar()
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = e.clipboardData?.files
    if (files && files.length > 0) {
      const file = files[0]
      if (file.type.startsWith('image/')) {
        e.preventDefault()
        const url = URL.createObjectURL(file)
        setModalPastePreview({ file, url, legenda: '' })
      }
    }
  }

  async function onEscolherArquivo(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    if (file.size > 15 * 1024 * 1024) {
      alert('Arquivo excede 15MB.')
      return
    }
    await onEnviarAnexo(file)
    irParaMensagemEnviada()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function iniciarGravacao() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const tipo = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : 'audio/webm;codecs=opus'
      const rec = new MediaRecorder(stream, { mimeType: tipo })
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        gravacaoBlobRef.current = new Blob(chunksRef.current, { type: tipo })
        stream.getTracks().forEach((t) => t.stop())
      }
      mediaRecorderRef.current = rec
      rec.start()
      inicioGravacaoRef.current = Date.now()
      setDuracaoMs(0)
      setGravando('gravando')
      cronometroRef.current = window.setInterval(() => setDuracaoMs(Date.now() - inicioGravacaoRef.current), 250)
    } catch {
      alert('Não foi possível acessar o microfone.')
    }
  }

  function pararGravacao() {
    mediaRecorderRef.current?.stop()
    if (cronometroRef.current) window.clearInterval(cronometroRef.current)
    setGravando('pronto')
  }

  function cancelarGravacao() {
    mediaRecorderRef.current?.stop()
    if (cronometroRef.current) window.clearInterval(cronometroRef.current)
    gravacaoBlobRef.current = null
    setGravando('idle')
    setDuracaoMs(0)
  }

  async function confirmarEnvioAudio() {
    const blob = gravacaoBlobRef.current
    if (!blob) return
    setGravando('idle')
    setDuracaoMs(0)
    await onEnviarAudio(blob)
    irParaMensagemEnviada()
  }

  async function responderEmParticular(remetente: { jid?: string; numero?: string; nome?: string }, m: MensagemComExtras) {
    setMenuMensagemId(null)
    const tel = remetente.numero || (remetente.jid ? remetente.jid.replace(/@.*$/, '').replace(/[^0-9]/g, '') : '')
    if (!tel) return
    const encontrada = conversas?.find((c) => c.meta?.sender?.phone_number?.includes(tel) || c.meta?.sender?.identifier?.includes(tel))
    if (encontrada && onSelecionarConversa) {
      onSelecionarConversa(encontrada)
      onCitar(m)
      exibirToast(`Respondendo em particular para ${remetente.nome || tel}`)
    } else if (onNovaConversa) {
      const opId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `op-${Date.now()}`
      const instId = conversa.inbox_id ? String(conversa.inbox_id) : '1'
      await onNovaConversa({ instanciaId: instId, telefone: tel, texto: `Olá ${remetente.nome || ''}, em relação à mensagem: "${(m.content || '').slice(0, 40)}"`, operationId: opId })
      exibirToast(`Iniciada conversa com ${remetente.nome || tel}`)
    }
  }

  async function conversarComContato(remetente: { jid?: string; numero?: string; nome?: string }) {
    setMenuMensagemId(null)
    const tel = remetente.numero || (remetente.jid ? remetente.jid.replace(/@.*$/, '').replace(/[^0-9]/g, '') : '')
    if (!tel) return
    const encontrada = conversas?.find((c) => c.meta?.sender?.phone_number?.includes(tel) || c.meta?.sender?.identifier?.includes(tel))
    if (encontrada && onSelecionarConversa) {
      onSelecionarConversa(encontrada)
    } else if (onNovaConversa) {
      const opId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `op-${Date.now()}`
      const instId = conversa.inbox_id ? String(conversa.inbox_id) : '1'
      await onNovaConversa({ instanciaId: instId, telefone: tel, texto: 'Olá!', operationId: opId })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', background: 'var(--msn-surface)' }}>
      {/* Cabeçalho do Chat */}
      <div className="brs-messenger-chat-head" style={{ position: 'relative', height: 'auto', minHeight: 36, display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px' }}>
        {compacto && onVoltar && (
          <button type="button" onClick={onVoltar} className="brs-messenger-toolbar-btn" style={{ padding: 6 }}>
            <ArrowLeft size={14} />
          </button>
        )}
        <AvatarContato thumbnail={conversa.meta.sender?.thumbnail} nome={conversa.meta.sender?.name} tamanho={32} fontSize={12} raio={grupo ? 9 : 99} canal={conversa.meta?.channel || 'whatsapp'} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conversa.meta.sender?.name || 'Sem nome'}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
            {grupo && membrosGrupo.length > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'var(--msn-surface-alt)', border: '1px solid var(--msn-soft-border)', color: 'var(--msn-muted)' }}>
                {membrosGrupo.length} membros
              </span>
            )}
            {nomeInstancia && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'rgba(37,99,235,0.12)', color: '#1d4ed8' }}>{nomeInstancia}</span>
            )}
            {departamento && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'rgba(22,163,74,0.14)', color: '#15803d' }}>{departamento}</span>
            )}
            {entidade && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: VINCULO_COR[entidade.tipo].bg, color: VINCULO_COR[entidade.tipo].text }}>
                {VINCULO_LABEL[entidade.tipo]}: {entidade.nome}
              </span>
            )}
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--msn-meta-text)' }}>{conversa.meta.assignee ? `↳ ${conversa.meta.assignee.name}` : 'sem atendente'}</span>
          </div>
        </div>
        {toast && (
          <div style={{ position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: 'var(--msn-accent)', color: '#fff', zIndex: 70, whiteSpace: 'nowrap' }}>
            {toast}
          </div>
        )}
        {podeAssumirParaMim && (
          <button
            type="button"
            onClick={() => void assumirParaMim()}
            disabled={Boolean(alterando)}
            title="Assumir para mim"
            className="brs-messenger-pill-btn"
            style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', opacity: alterando ? 0.7 : 1 }}
          >
            {alterando === 'assumindo' ? <Loader2 size={13} className="spinner" /> : <UserPlus size={13} />}
            {alterando === 'assumindo' ? 'Assumindo…' : 'Assumir para mim'}
          </button>
        )}
        <button type="button" onClick={() => setBuscaAberta((v) => !v)} title="Buscar na conversa" className="brs-messenger-toolbar-btn" style={{ width: 34, height: 34, background: buscaAberta ? 'var(--msn-item-active)' : undefined }}>
          <Search size={18} />
        </button>
        <button
          type="button"
          onClick={() => {
            setTransfDepartamentoId('')
            setTransfAgenteId('')
            setTransfComentario('')
            setModalTransferir(true)
          }}
          title="Transferir"
          disabled={Boolean(alterando)}
          className="brs-messenger-toolbar-btn"
          style={{ width: alterando === 'transferindo' ? 'auto' : 34, height: 34, padding: alterando === 'transferindo' ? '0 8px' : undefined, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', opacity: alterando ? 0.7 : 1 }}
        >
          {alterando === 'transferindo' ? (
            <>
              <Loader2 size={14} className="spinner" /> Transferindo…
            </>
          ) : (
            <UserCog size={18} />
          )}
        </button>
        <div style={{ position: 'relative' }}>
          <button type="button" onClick={() => setPopoverEncerrar((v) => !v)} title="Encerrar" className="brs-messenger-toolbar-btn" style={{ width: 34, height: 34 }}>
            <CheckCheck size={18} />
          </button>
          {popoverEncerrar && (
            <div className="brs-messenger" style={{ position: 'absolute', right: 0, top: '110%', borderRadius: 6, width: 220, zIndex: 60, padding: 10, background: 'var(--msn-surface)', boxShadow: '0 4px 16px rgba(0,0,0,.18)' }} data-brs-messenger-ignore-close="true">
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--msn-muted)', marginBottom: 6 }}>Encerrar conversa</div>
              <textarea
                className="brs-messenger-composer-input"
                style={{ width: '100%', minHeight: 50, fontSize: 12 }}
                placeholder="Motivo (opcional)"
                value={motivoEncerrar}
                onChange={(e) => setMotivoEncerrar(e.target.value)}
              />
              <button
                type="button"
                className="brs-messenger-primary-button"
                style={{ width: '100%', marginTop: 6, padding: '5px 0' }}
                onClick={async () => {
                  setPopoverEncerrar(false)
                  const motivo = motivoEncerrar
                  setMotivoEncerrar('')
                  await onEncerrar(motivo || undefined)
                }}
              >
                Encerrar
              </button>
            </div>
          )}
        </div>
        {onAbrirPainel && (
          <button type="button" onClick={onAbrirPainel} title="Dados do contato" className="brs-messenger-toolbar-btn" style={{ width: 34, height: 34 }}>
            <Info size={18} />
          </button>
        )}
      </div>

      {buscaAberta && (
        <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--msn-border)', background: 'var(--msn-surface-alt)' }}>
          <input
            autoFocus
            className="brs-messenger-search-input"
            placeholder="Buscar nas mensagens carregadas…"
            value={buscaTexto}
            onChange={(e) => setBuscaTexto(e.target.value)}
          />
        </div>
      )}

      {/* Thread de Mensagens */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div
          ref={containerRef}
          onScroll={aoRolarMensagens}
          className="brs-messenger-chat-scroll"
          style={{ height: '100%', overflowY: 'auto', padding: 12, background: 'var(--msn-shell-bg)', display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          {carregando ? (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <Loader2 size={16} className="spinner" />
            </div>
          ) : mensagensFiltradas.length === 0 ? (
            <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--msn-muted)', padding: 20 }}>Nenhuma mensagem.</div>
          ) : (
            (() => {
              let dataAnterior: string | null = null
              return mensagensFiltradas.map((m) => {
                const atributoChave = { [ATRIBUTO_CHAVE_ROLAGEM]: chaveMensagem(m) }
                const dataMsg = dataCurta(m.created_at)
                const separador = dataMsg !== dataAnterior
                dataAnterior = dataMsg
                const separadorEl = separador && (
                  <div style={{ alignSelf: 'center', fontSize: 10.5, fontWeight: 700, color: 'var(--msn-muted)', background: 'var(--msn-surface-alt)', border: '1px solid var(--msn-soft-border)', borderRadius: 99, padding: '2px 10px', margin: '6px 0 2px' }}>
                    {dataMsg}
                  </div>
                )
                if (m.message_type === 2) {
                  return (
                    <Fragment key={m.id}>
                      {separadorEl}
                      <div {...atributoChave} style={{ alignSelf: 'center', fontSize: 11, color: 'var(--msn-muted)', background: 'var(--msn-surface-alt)', border: '1px solid var(--msn-soft-border)', borderRadius: 12, padding: '3px 12px', margin: '4px 0', maxWidth: '85%', wordBreak: 'break-word', overflowWrap: 'anywhere', textAlign: 'center' }}>
                        {m.content}
                      </div>
                    </Fragment>
                  )
                }
                const saida = m.message_type === 1 || m.message_type === 3
                const nota = Boolean(m.private)
                const aparelho = m.content_attributes?.origem === 'aparelho'
                const remetente = grupo && !saida ? remetenteDeGrupo(m) : null
                let conteudo = remetente ? remetente.conteudo : m.content

                const ehRevogada = Boolean(
                  m.content_attributes?.revoked ||
                    m.content_attributes?.deleted ||
                    m.content_attributes?.is_deleted ||
                    mensagensApagadasLocal.has(m.id) ||
                    (conteudo && conteudo.includes('🚫 Mensagem apagada')),
                )
                const reactionAttr = m.content_attributes?.reaction as { emoji?: string } | undefined
                const ehReacao = Boolean(reactionAttr?.emoji || (conteudo && (conteudo.startsWith('Reagiu ') || conteudo.startsWith('Reagiu com '))))
                if (ehReacao && (!conteudo || conteudo === '[sem conteúdo]' || conteudo.startsWith('Reagiu '))) {
                  const emoji = reactionAttr?.emoji || conteudo?.replace(/^Reagiu\s*(com)?\s*/, '') || '❤️'
                  conteudo = `${saida ? 'Você' : remetente?.nome || 'O contato'} reagiu com ${emoji}`
                }

                const temAudioAnexo = m.attachments?.some((a) => a.file_type === 'audio' || a.file_type === 'voice')
                const ehNomeRawAudio =
                  conteudo &&
                  (/^audio\.(ogg|mp3|wav|m4a|opus)$/i.test(conteudo.trim()) ||
                    /\.(ogg|mp3|wav|m4a|opus)$/i.test(conteudo.trim()) ||
                    conteudo === '[sem conteúdo]' ||
                    conteudo === 'audio')
                const exibirTexto = conteudo && (!temAudioAnexo || !ehNomeRawAudio)

                const inReplyTo = m.content_attributes?.in_reply_to as number | undefined
                const citada = inReplyTo ? mensagensPorId.get(inReplyTo) : undefined

                const ehFixada = mensagensFixadas.has(m.id)
                const ehFavorita = mensagensFavoritas.has(m.id)

                return (
                  <Fragment key={m.id}>
                    {separadorEl}
                    <div
                      {...atributoChave}
                      onMouseEnter={() => setHoverMessageId(m.id)}
                      onMouseLeave={() => setHoverMessageId(null)}
                      style={{ alignSelf: saida ? 'flex-end' : 'flex-start', maxWidth: '78%', display: 'flex', alignItems: 'flex-end', gap: 3, position: 'relative' }}
                    >
                      {!saida && (
                        <button type="button" onClick={() => onCitar(m)} className="brs-messenger-toolbar-btn" style={{ padding: 4, opacity: 0.55, flexShrink: 0 }} title="Responder citando">
                          <Reply size={12} />
                        </button>
                      )}

                      <div
                        className={`brs-messenger-message-bubble ${nota ? 'is-nota' : saida ? 'is-mine' : 'is-theirs'}`}
                        style={{
                          ...(ehRevogada ? { opacity: 0.65, filter: 'grayscale(0.3)' } : {}),
                          ...(ehFixada ? { borderTop: '2px solid #eab308' } : {}),
                          position: 'relative',
                        }}
                      >
                        {(ehFixada || ehFavorita) && (
                          <div style={{ display: 'flex', gap: 4, fontSize: 10, color: '#ca8a04', marginBottom: 2, fontWeight: 700 }}>
                            {ehFixada && <span>📌 Fixada</span>}
                            {ehFavorita && <span>⭐ Favorita</span>}
                          </div>
                        )}
                        {remetente && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--msn-accent)', marginBottom: 2 }}>{remetente.nome}</div>}
                        {ehRevogada && (
                          <div style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--msn-muted)', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                            🚫 Mensagem apagada (mantida no histórico)
                          </div>
                        )}
                        {inReplyTo && (
                          <div style={{ borderLeft: '3px solid var(--msn-accent)', padding: '3px 6px', marginBottom: 4, background: 'rgba(0,0,0,.04)', borderRadius: 4, fontSize: 11.5, color: 'var(--msn-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {citada?.content || (citada?.attachments?.length ? '📎 anexo' : 'mensagem citada')}
                          </div>
                        )}
                        {m.attachments?.map((a) =>
                          a.file_type === 'image' ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={a.id}
                              src={a.data_url}
                              alt=""
                              onLoad={aoMidiaCarregar}
                              onClick={() => { setModalLightbox({ url: a.data_url, nome: `imagem_${a.id}.png`, mensagem: m }); setZoomScale(1) }}
                              style={{ maxWidth: '100%', borderRadius: 6, marginBottom: 4, display: 'block', opacity: ehRevogada ? 0.4 : 1, cursor: 'pointer' }}
                              title="Clique para ampliar no Lightbox"
                            />
                          ) : a.file_type === 'audio' || a.file_type === 'voice' ? (
                            <AudioPlayer key={a.id} src={a.data_url} onLoadedData={aoMidiaCarregar} isMine={saida} />
                          ) : (
                            <a key={a.id} href={a.data_url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, marginBottom: 4, color: 'var(--msn-link)' }}>
                              <Download size={12} /> anexo
                            </a>
                          ),
                        )}
                        {exibirTexto && (
                          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, textDecoration: ehRevogada ? 'line-through' : undefined }}>
                            <TextoComMencoes texto={conteudo || ''} temMencoes={Boolean((m.content_attributes?.mentions as string[] | undefined)?.length)} />
                          </div>
                        )}
                        {m.reacoes.length > 0 && (
                          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 3 }}>
                            {Object.entries(m.reacoes.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.emoji]: (acc[r.emoji] || 0) + 1 }), {})).map(([emoji, qtd]) => (
                              <span key={emoji} style={{ fontSize: 12, background: 'var(--msn-surface-alt)', border: '1px solid var(--msn-soft-border)', borderRadius: 99, padding: '0 5px' }}>
                                {emoji}
                                {qtd > 1 ? ` ${qtd}` : ''}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="brs-messenger-message-meta" style={{ fontSize: 10, textAlign: 'right', marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3 }}>
                          {aparelho && <span style={{ fontStyle: 'italic' }}>Dispositivo externo · </span>}
                          {nota && <StickyNote size={9} style={{ verticalAlign: 'middle' }} />}
                          {dataHoraCompleta(m.created_at)}
                          {nota ? ' · nota interna' : ''}
                          {saida && !nota && (
                            <span title={m.status === 'falhou' ? 'Falha no envio' : m.status === 'lido' ? 'Lido por todos' : m.status === 'entregue' ? 'Entregue' : 'Enviado'}>
                              {m.status === 'falhou' ? (
                                <span style={{ color: '#dc2626', fontWeight: 700 }}>
                                  !
                                </span>
                              ) : m.status === 'lido' ? (
                                <CheckCheck size={13} style={{ color: '#53bdeb' }} />
                              ) : m.status === 'entregue' ? (
                                <CheckCheck size={13} style={{ color: 'var(--msn-meta-text, #8696a0)' }} />
                              ) : (
                                <Check size={13} style={{ color: 'var(--msn-meta-text, #8696a0)' }} />
                              )}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Botão Chevron / Barra Flutuante de Ações na mensagem */}
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 2 }}>
                        {(hoverMessageId === m.id || menuMensagemId === m.id) && (
                          <div style={{ display: 'flex', alignItems: 'center', background: 'var(--msn-surface)', border: '1px solid var(--msn-soft-border)', borderRadius: 99, padding: '2px 4px', boxShadow: '0 2px 6px rgba(0,0,0,0.12)' }}>
                            <button
                              type="button"
                              onClick={() => setMenuMensagemId((prev) => (prev === m.id ? null : m.id))}
                              className="brs-messenger-toolbar-btn"
                              style={{ padding: 3 }}
                              title="Opções da mensagem"
                            >
                              <ChevronDown size={13} />
                            </button>
                          </div>
                        )}

                        {/* Dropdown Menu da Mensagem */}
                        {menuMensagemId === m.id && (
                          <div
                            className="brs-messenger"
                            style={{
                              position: 'absolute',
                              top: '100%',
                              right: saida ? 0 : 'auto',
                              left: saida ? 'auto' : 0,
                              marginTop: 4,
                              width: 220,
                              borderRadius: 8,
                              background: 'var(--msn-surface)',
                              boxShadow: '0 6px 20px rgba(0,0,0,0.2)',
                              zIndex: 120,
                              padding: 4,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 2,
                            }}
                          >
                            {/* Reações Rápida */}
                            <div style={{ display: 'flex', gap: 4, padding: '4px 6px', borderBottom: '1px solid var(--msn-soft-border)', justifyContent: 'space-between' }}>
                              {['👍', '❤️', '😂', '😮', '😢', '🙏'].map((emoji) => (
                                <button
                                  key={emoji}
                                  type="button"
                                  style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', padding: '2px 4px', borderRadius: 4 }}
                                  onClick={async () => {
                                    setMenuMensagemId(null)
                                    if (onReagirMensagem) await onReagirMensagem(m.id, emoji)
                                    exibirToast(`Reagiu com ${emoji}`)
                                  }}
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>

                            <button
                              type="button"
                              onClick={() => { onCitar(m); setMenuMensagemId(null) }}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--msn-text)', borderRadius: 4, textAlign: 'left' }}
                            >
                              <Reply size={14} /> Responder
                            </button>

                            {grupo && remetente && !saida && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void responderEmParticular(remetente, m)}
                                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--msn-text)', borderRadius: 4, textAlign: 'left' }}
                                >
                                  <CornerUpRight size={14} /> Responder em particular
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void conversarComContato(remetente)}
                                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--msn-text)', borderRadius: 4, textAlign: 'left' }}
                                >
                                  <User size={14} /> Conversar com {remetente.nome}
                                </button>
                              </>
                            )}

                            {conteudo && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (conteudo) {
                                    void navigator.clipboard.writeText(conteudo)
                                    exibirToast('Texto copiado!')
                                  }
                                  setMenuMensagemId(null)
                                }}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--msn-text)', borderRadius: 4, textAlign: 'left' }}
                              >
                                <Copy size={14} /> Copiar
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => { setModalEncaminhar(m); setMenuMensagemId(null) }}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--msn-text)', borderRadius: 4, textAlign: 'left' }}
                            >
                              <Share2 size={14} /> Encaminhar
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setMensagensFixadas((prev) => {
                                  const n = new Set(prev)
                                  if (n.has(m.id)) n.delete(m.id)
                                  else n.add(m.id)
                                  return n
                                })
                                exibirToast(mensagensFixadas.has(m.id) ? 'Mensagem desfixada' : 'Mensagem fixada')
                                setMenuMensagemId(null)
                              }}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--msn-text)', borderRadius: 4, textAlign: 'left' }}
                            >
                              <Pin size={14} /> {mensagensFixadas.has(m.id) ? 'Desfixar' : 'Fixar'}
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setMensagensFavoritas((prev) => {
                                  const n = new Set(prev)
                                  if (n.has(m.id)) n.delete(m.id)
                                  else n.add(m.id)
                                  return n
                                })
                                exibirToast(mensagensFavoritas.has(m.id) ? 'Removida dos favoritos' : 'Adicionada aos favoritos')
                                setMenuMensagemId(null)
                              }}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--msn-text)', borderRadius: 4, textAlign: 'left' }}
                            >
                              <Star size={14} /> {mensagensFavoritas.has(m.id) ? 'Desfavoritar' : 'Favoritar'}
                            </button>

                            {conteudo && (
                              <button
                                type="button"
                                onClick={() => {
                                  setNotaInterna(true)
                                  setTexto((prev) => (prev ? `${prev}\n${conteudo}` : conteudo))
                                  exibirToast('Texto adicionado às notas internas!')
                                  setMenuMensagemId(null)
                                }}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--msn-text)', borderRadius: 4, textAlign: 'left' }}
                              >
                                <StickyNote size={14} /> Adicionar texto às notas
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                setMenuMensagemId(null)
                                if (onApagarMensagem) void onApagarMensagem(m.id)
                                setMensagensApagadasLocal((prev) => new Set(prev).add(m.id))
                                exibirToast('Mensagem apagada (mantida no histórico riscada)')
                              }}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', borderRadius: 4, textAlign: 'left' }}
                            >
                              <Trash2 size={14} /> Apagar
                            </button>
                          </div>
                        )}
                      </div>

                      {saida && (
                        <button type="button" onClick={() => onCitar(m)} className="brs-messenger-toolbar-btn" style={{ padding: 4, opacity: 0.55, flexShrink: 0 }} title="Responder citando">
                          <Reply size={12} />
                        </button>
                      )}
                    </div>
                  </Fragment>
                )
              })
            })()
          )}
        </div>
        {novasNaoLidas > 0 && (
          <button
            type="button"
            onClick={() => irParaOFim(true)}
            className="brs-messenger-primary-button"
            style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 99, boxShadow: '0 4px 12px rgba(0,0,0,.18)' }}
          >
            <ArrowDown size={13} /> {novasNaoLidas === 1 ? '1 nova' : `${novasNaoLidas} novas`}
          </button>
        )}
      </div>

      {chipsResposta.length > 0 && (
        <div style={{ display: 'flex', gap: 5, padding: '6px 10px 0', overflowX: 'auto' }}>
          {chipsResposta.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => usarResposta(r)}
              style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 99, border: '1px solid var(--msn-soft-border)', background: 'var(--msn-surface-alt)', color: 'var(--msn-text)', whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: 0 }}
              title={r.conteudo}
            >
              {r.arquivoPath ? '📎 ' : ''}
              {r.atalho}
            </button>
          ))}
        </div>
      )}

      {/* Editor / Caixa de texto */}
      <div className="brs-messenger-editor" style={{ padding: 8, borderTop: '1px solid var(--msn-border)' }}>
        {citacao && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '5px 8px', marginBottom: 6, borderLeft: '3px solid var(--msn-accent)', background: 'var(--msn-surface-alt)', borderRadius: 4 }}>
            <div style={{ fontSize: 11.5, color: 'var(--msn-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Respondendo: {citacao.content || (citacao.attachments?.length ? '📎 anexo' : '')}
            </div>
            <button type="button" onClick={() => onCitar(null)} className="brs-messenger-toolbar-btn" style={{ padding: 3, flexShrink: 0 }}>
              <X size={11} />
            </button>
          </div>
        )}
        {sugestoesPicker.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--msn-soft-border)', borderRadius: 6, marginBottom: 6, overflow: 'hidden' }}>
            {sugestoesPicker.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => usarResposta(r)}
                style={{ textAlign: 'left', padding: '6px 9px', fontSize: 12, background: 'var(--msn-surface)', border: 'none', borderBottom: '1px solid var(--msn-soft-border)', cursor: 'pointer', color: 'var(--msn-text)' }}
              >
                <span style={{ fontWeight: 700 }}>{r.arquivoPath ? '📎 ' : ''}{r.atalho}</span> — {r.conteudo.slice(0, 60)}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <div style={{ position: 'relative' }}>
            <button type="button" className="brs-messenger-toolbar-btn" onClick={() => setEmojiAberto((v) => !v)} title="Emoji">
              <Smile size={13} />
            </button>
            {emojiAberto && (
              <EmojiPicker
                onSelecionar={(e) => {
                  setTexto((prev) => prev + e)
                  setEmojiAberto(false)
                }}
              />
            )}
          </div>
          <label className="brs-messenger-toolbar-btn brs-messenger-toolbar-file" title="Enviar arquivo">
            <Paperclip size={13} />
            <input ref={fileInputRef} type="file" className="hidden" accept={MIME_ANEXO_ACEITOS} onChange={(e) => void onEscolherArquivo(e.target.files)} />
          </label>
          {gravando === 'idle' && (
            <button type="button" className="brs-messenger-toolbar-btn" onClick={iniciarGravacao} title="Gravar áudio">
              <Mic size={13} />
            </button>
          )}
          <button
            type="button"
            className={`brs-messenger-pill-btn ${notaInterna ? 'is-active' : ''}`}
            onClick={() => setNotaInterna((v) => !v)}
            title="Comentário interno"
          >
            <StickyNote size={12} /> {notaInterna ? 'Nota interna' : 'Mensagem'}
          </button>
        </div>

        {gravando !== 'idle' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px' }}>
            {gravando === 'gravando' ? (
              <>
                <span style={{ width: 9, height: 9, borderRadius: 99, background: '#dc2626', animation: 'pulse 1.2s infinite' }} />
                <span style={{ fontSize: 12, color: 'var(--msn-text)', flex: 1 }}>Gravando… {tempoGravacao(duracaoMs)}</span>
                <button type="button" onClick={cancelarGravacao} className="brs-messenger-toolbar-btn" title="Cancelar">
                  <Trash2 size={13} />
                </button>
                <button type="button" onClick={pararGravacao} className="brs-messenger-primary-button" style={{ padding: '5px 10px' }}>
                  <Square size={12} />
                </button>
              </>
            ) : (
              <>
                <span style={{ fontSize: 12, color: 'var(--msn-text)', flex: 1 }}>Áudio pronto ({tempoGravacao(duracaoMs)})</span>
                <button type="button" onClick={cancelarGravacao} className="brs-messenger-toolbar-btn" title="Cancelar">
                  <X size={13} />
                </button>
                <button type="button" onClick={confirmarEnvioAudio} className="brs-messenger-primary-button" style={{ padding: '5px 12px', display: 'flex', gap: 5, alignItems: 'center' }}>
                  <Send size={12} /> Enviar
                </button>
              </>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, position: 'relative' }}>
            {sugestoesMencao.length > 0 && (
              <div className="brs-messenger" style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 4, borderRadius: 6, width: 240, zIndex: 60, padding: 4, background: 'var(--msn-surface)', boxShadow: '0 4px 16px rgba(0,0,0,.18)' }} data-brs-messenger-ignore-close="true">
                {sugestoesMencao.map((m) => {
                  const rotuloFormatado = formatarContatoMencao(m)
                  return (
                    <button
                      key={m.jid}
                      type="button"
                      onClick={() => escolherMencao(m)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '5px 8px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--msn-text)', borderRadius: 4, textAlign: 'left' }}
                    >
                      <AvatarContato nome={rotuloFormatado} tamanho={20} fontSize={9} />
                      {rotuloFormatado}
                    </button>
                  )
                })}
              </div>
            )}
            <textarea
              className={`brs-messenger-composer-input ${notaInterna ? 'is-nota' : ''}`}
              placeholder={notaInterna ? 'Escreva uma nota interna (não vai pro cliente)…' : grupo ? 'Digite uma mensagem… (@ para mencionar, Ctrl+V para colar imagem)' : 'Digite uma mensagem… (Ctrl+V para colar imagem)'}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={handlePaste}
            />
            <button type="button" onClick={() => void enviar()} disabled={enviando || !texto.trim()} className="brs-messenger-primary-button brs-messenger-send-button">
              {enviando ? <Loader2 size={14} className="spinner" /> : <Send size={14} />}
            </button>
          </div>
        )}
      </div>

      {/* Modal Transferir Chamado */}
      {modalTransferir && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'grid', placeItems: 'center', zIndex: 400 }} data-brs-messenger-ignore-close="true">
          <div className="brs-messenger" style={{ width: 340, maxWidth: '92vw', borderRadius: 6, overflow: 'hidden' }} data-brs-messenger-ignore-close="true">
            <div className="brs-messenger-titlebar">
              <span>Transferir chamado</span>
            </div>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--msn-surface)' }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--msn-text)' }}>
                Transferir para departamento
                <select className="brs-messenger-select" style={{ width: '100%', marginTop: 4 }} value={transfDepartamentoId} onChange={(e) => setTransfDepartamentoId(e.target.value)}>
                  <option value="">Selecione…</option>
                  {departamentos.map((d) => (
                    <option key={d.id} value={d.id}>{d.nome}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--msn-text)' }}>
                Transferir para atendente (opcional)
                <select className="brs-messenger-select" style={{ width: '100%', marginTop: 4 }} value={transfAgenteId} onChange={(e) => setTransfAgenteId(e.target.value)}>
                  <option value="">Sem atendente (fica na fila)</option>
                  {agentes.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--msn-text)' }}>
                Adicionar comentário
                <textarea
                  className="brs-messenger-composer-input"
                  style={{ width: '100%', marginTop: 4, minHeight: 60 }}
                  value={transfComentario}
                  onChange={(e) => setTransfComentario(e.target.value)}
                />
              </label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setModalTransferir(false)} className="brs-messenger-pill-btn" style={{ height: 28, padding: '0 12px' }}>
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!transfDepartamentoId || Boolean(alterando)}
                  onClick={() => void salvarTransferencia()}
                  className="brs-messenger-primary-button"
                  style={{ padding: '6px 14px' }}
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Preview de Imagem (Ctrl+V) */}
      {modalPastePreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'grid', placeItems: 'center', zIndex: 500 }} data-brs-messenger-ignore-close="true">
          <div className="brs-messenger" style={{ width: 440, maxWidth: '92vw', borderRadius: 8, overflow: 'hidden', background: 'var(--msn-surface)' }}>
            <div className="brs-messenger-titlebar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Enviar Imagem (Ctrl+V)</span>
              <button type="button" onClick={() => setModalPastePreview(null)} className="brs-messenger-toolbar-btn">
                <X size={14} />
              </button>
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={modalPastePreview.url} alt="Preview da imagem colada" style={{ maxHeight: 260, maxWidth: '100%', objectFit: 'contain', borderRadius: 6, border: '1px solid var(--msn-soft-border)' }} />
              <textarea
                className="brs-messenger-composer-input"
                style={{ width: '100%', minHeight: 50 }}
                placeholder="Legenda da imagem (opcional)..."
                value={modalPastePreview.legenda}
                onChange={(e) => setModalPastePreview((prev) => (prev ? { ...prev, legenda: e.target.value } : null))}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
                <button type="button" onClick={() => setModalPastePreview(null)} className="brs-messenger-pill-btn" style={{ padding: '4px 12px' }}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="brs-messenger-primary-button"
                  style={{ padding: '5px 16px', display: 'flex', gap: 6, alignItems: 'center' }}
                  onClick={async () => {
                    const { file, legenda } = modalPastePreview
                    setModalPastePreview(null)
                    await onEnviarAnexo(file, legenda || undefined)
                    irParaMensagemEnviada()
                  }}
                >
                  <Send size={13} /> Enviar Imagem
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Lightbox de Imagens com Zoom, Download e Encaminhar */}
      {modalLightbox && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.88)', zIndex: 1000, display: 'flex', flexDirection: 'column', backdropFilter: 'blur(4px)' }}>
          <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,.4)', color: '#fff' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Visualizador de Imagem</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button type="button" title="Zoom Out" onClick={() => setZoomScale((z) => Math.max(0.5, z - 0.25))} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 6 }}>
                <ZoomOut size={18} />
              </button>
              <span style={{ fontSize: 12, minWidth: 40, textAlign: 'center' }}>{Math.round(zoomScale * 100)}%</span>
              <button type="button" title="Zoom In" onClick={() => setZoomScale((z) => Math.min(4, z + 0.25))} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 6 }}>
                <ZoomIn size={18} />
              </button>
              <button type="button" title="Resetar Zoom" onClick={() => setZoomScale(1)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 6 }}>
                <RotateCw size={16} />
              </button>
              <a href={modalLightbox.url} download={modalLightbox.nome || 'imagem.png'} target="_blank" rel="noreferrer" title="Baixar / Salvar Imagem" style={{ color: '#fff', padding: 6, display: 'flex', alignItems: 'center' }}>
                <Download size={18} />
              </a>
              {modalLightbox.mensagem && (
                <button
                  type="button"
                  title="Encaminhar Imagem"
                  onClick={() => {
                    const msg = modalLightbox.mensagem
                    setModalLightbox(null)
                    if (msg) setModalEncaminhar(msg)
                  }}
                  style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 6 }}
                >
                  <Share2 size={18} />
                </button>
              )}
              <button type="button" onClick={() => { setModalLightbox(null); setZoomScale(1) }} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 6 }}>
                <X size={22} />
              </button>
            </div>
          </div>
          <div style={{ flex: 1, display: 'grid', placeItems: 'center', overflow: 'auto', padding: 20 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={modalLightbox.url}
              alt="Lightbox Preview"
              style={{
                transform: `scale(${zoomScale})`,
                transition: 'transform 0.15s ease-out',
                maxHeight: '82vh',
                maxWidth: '90vw',
                objectFit: 'contain',
                borderRadius: 6,
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              }}
            />
          </div>
        </div>
      )}

      {/* Modal de Encaminhar Mensagem */}
      {modalEncaminhar && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', zIndex: 450 }} data-brs-messenger-ignore-close="true">
          <div className="brs-messenger" style={{ width: 380, maxWidth: '92vw', borderRadius: 8, overflow: 'hidden', background: 'var(--msn-surface)' }}>
            <div className="brs-messenger-titlebar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Encaminhar Mensagem</span>
              <button type="button" onClick={() => setModalEncaminhar(null)} className="brs-messenger-toolbar-btn">
                <X size={14} />
              </button>
            </div>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                className="brs-messenger-search-input"
                placeholder="Buscar conversa para encaminhar..."
                value={filtroEncaminhar}
                onChange={(e) => setFiltroEncaminhar(e.target.value)}
              />
              <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(conversas || [])
                  .filter((c) => (c.meta?.sender?.name || '').toLowerCase().includes(filtroEncaminhar.toLowerCase()))
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--msn-soft-border)', background: 'var(--msn-surface-alt)', cursor: 'pointer', textAlign: 'left' }}
                      onClick={async () => {
                        const msg = modalEncaminhar
                        setModalEncaminhar(null)
                        setFiltroEncaminhar('')
                        if (onEncaminharMensagem && msg) {
                          await onEncaminharMensagem(msg, c.id)
                          exibirToast(`Mensagem encaminhada para ${c.meta?.sender?.name || 'conversa'}`)
                        }
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <AvatarContato nome={c.meta?.sender?.name} tamanho={28} fontSize={11} />
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{c.meta?.sender?.name || 'Sem nome'}</span>
                      </div>
                      <Share2 size={14} style={{ color: 'var(--msn-accent)' }} />
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
