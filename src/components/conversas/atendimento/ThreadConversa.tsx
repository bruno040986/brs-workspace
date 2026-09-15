'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  Check,
  CheckCheck,
  Download,
  Info,
  Loader2,
  Mic,
  Paperclip,
  Reply,
  Search,
  Send,
  Smile,
  Square,
  StickyNote,
  Trash2,
  UserCog,
  UserPlus,
  X,
} from 'lucide-react'
import EmojiPicker from './EmojiPicker'
import AvatarContato from './AvatarContato'
import { ATRIBUTO_CHAVE_ROLAGEM, useRolagemThread } from './useRolagemThread'
import { VINCULO_COR, VINCULO_LABEL, ehGrupo, horaCurta, type AgenteChat, type ConversaAtendimento, type MensagemComExtras, type RespostaRapida, type RespostaRapidaRow } from './types'
import { getMeuAgente, type DepartamentoResumo } from '@/lib/central-conversas/actions'
import { getGrupo } from '@/lib/central-conversas/grupos-actions'
import type { MembroGrupo } from '@/lib/central-conversas/engine'

const MIME_ANEXO_ACEITOS = '.pdf,.png,.jpg,.jpeg,.webp,.mp3,.ogg,.opus,.mp4,.xlsx,.csv'

/** Função top-level (referencialmente estável entre renders — exigência do useRolagemThread). */
function chaveMensagem(m: MensagemComExtras): string {
  return String(m.id)
}

// Uma resolução por carregamento de página, não por conversa aberta: cada
// chamada é uma server action + GET /agents no Chatwoot, e a thread monta a
// cada troca de conversa. O agente do usuário logado não muda na sessão.
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
}

type SenderGrupo = { jid?: string; numero?: string | null; nome?: string | null }

/**
 * Remetente de mensagem recebida em GRUPO. Contrato do engine
 * (RECADO-ENGINE-GRUPOS): `content_attributes.sender = { jid, numero, nome }`
 * — é OBJETO, nunca renderizar direto. O engine mantém o prefixo `*Nome:* `
 * no texto por compatibilidade com o CRM; com o label na bolha, tiramos o
 * prefixo pra não duplicar o nome. Mensagens anteriores ao contrato (sem
 * `sender`) caem no prefixo do texto.
 */
function remetenteDeGrupo(m: MensagemComExtras): { nome: string; conteudo: string | null } | null {
  const bruto = m.content_attributes?.sender
  const s: SenderGrupo | null = bruto && typeof bruto === 'object' ? (bruto as SenderGrupo) : typeof bruto === 'string' ? { nome: bruto } : null
  const conteudo = m.content
  const prefixo = conteudo?.match(/^\*(.+?):\*\s?([\s\S]*)$/)
  const nome = String(s?.nome || s?.numero || prefixo?.[1] || '').trim()
  if (!nome) return null
  const tiraPrefixo = prefixo && (!s?.nome || prefixo[1] === s.nome)
  return { nome, conteudo: tiraPrefixo ? prefixo[2] : conteudo }
}

/** Destaca tokens `@algo` no texto — só visual, sem lookup (frente e). */
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
  // Feedback imediato de assumir/transferir (Messenger M0 frente e): o hook
  // (useAtendimento.transferir/atribuirAgente) já é otimista — este estado é
  // só o spinner/toast LOCAL do botão, nada de estado de negócio.
  const [alterando, setAlterando] = useState<'assumindo' | 'transferindo' | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [meuAgente, setMeuAgente] = useState<{ id: number; name: string } | null | undefined>(undefined)
  // @menção (frente e, só em grupo): membros carregados sob demanda ao digitar
  // "@"; `mencoesAtuais` guarda jid por nome exibido no texto, zerado ao
  // enviar/trocar de conversa.
  const [membrosGrupo, setMembrosGrupo] = useState<MembroGrupo[]>([])
  const [mencoesAtuais, setMencoesAtuais] = useState<Map<string, string>>(new Map())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const gravacaoBlobRef = useRef<Blob | null>(null)
  const cronometroRef = useRef<number | null>(null)
  const inicioGravacaoRef = useRef(0)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Assumir para mim (frente e): resolução usuário logado → agente Chatwoot é
  // a mesma usada pela presença (getMinhaDisponibilidade), por e-mail — já
  // existe no servidor, então não há mapeamento novo pra inventar aqui.
  useEffect(() => {
    let vivo = true
    void resolverMeuAgente().then((r) => {
      if (vivo) setMeuAgente(r)
    })
    return () => {
      vivo = false
    }
  }, [])

  function exibirToast(texto: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast(texto)
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

  // Rolagem (frente d — useRolagemThread): com a busca aberta, o thread fica
  // CONGELADO na foto de quando ela abriu — nenhuma mensagem nova durante a
  // busca dispara scroll/"N nova(s)"; ao fechar a busca, volta a ler
  // `mensagens` ao vivo (comportamento atual preservado: "com buscaAberta,
  // não rolar"). Captura a foto no exato instante em que `buscaAberta` VIRA
  // true — padrão "ajustar state durante o render" dos docs do React (não
  // efeito: um efeito rodaria um commit depois, e o React Compiler deste
  // projeto proíbe tanto ler `ref.current` durante o render quanto chamar
  // setState dentro de um efeito sem uma razão externa).
  const [mensagensCongeladas, setMensagensCongeladas] = useState<MensagemComExtras[]>(mensagens)
  const [buscaAbertaAnterior, setBuscaAbertaAnterior] = useState(buscaAberta)
  if (buscaAberta !== buscaAbertaAnterior) {
    setBuscaAbertaAnterior(buscaAberta)
    if (buscaAberta) setMensagensCongeladas(mensagens)
  }
  const threadRolagem = buscaAberta ? mensagensCongeladas : mensagens
  // Destructuring (não `const rolagem = useRolagemThread(...)` + `rolagem.x`)
  // por exigência do React Compiler deste projeto: o objeto retornado carrega
  // `containerRef` (useRef) e um acesso via propriedade encadeada (`rolagem.x`)
  // faz o compiler tratar TODO o retorno como valor de ref, mesmo os campos
  // que não são refs — proibindo leitura durante o render ("Cannot access ref
  // value during render"). Desestruturar no ponto de chamada (mesmo padrão do
  // CRM AlvoConsig) evita o falso positivo.
  const { containerRef, novasNaoLidas, aoRolarMensagens, irParaOFim, irParaMensagemEnviada, aoMidiaCarregar } = useRolagemThread(threadRolagem, chaveMensagem)

  const mensagensPorId = useMemo(() => new Map(mensagens.map((m) => [m.id, m])), [mensagens])

  // Fase B §d: chips de resposta rápida cadastradas no Workspace (com escopo por
  // departamento) substituem o canned response nativo do Chatwoot; se nada foi
  // cadastrado ainda, cai de volta pro nativo (fallback combinado no roteiro).
  const chipsResposta = useMemo<Array<{ id: string; atalho: string; conteudo: string; arquivoPath: string | null }>>(
    () =>
      respostasVisiveis.length > 0
        ? respostasVisiveis.map((r) => ({ id: r.id, atalho: r.atalho, conteudo: r.texto, arquivoPath: r.arquivoPath }))
        : (respostasRapidas || []).map((r) => ({ id: String(r.id), atalho: r.atalho, conteudo: r.conteudo, arquivoPath: null })),
    [respostasVisiveis, respostasRapidas],
  )

  /** Resposta com anexo sai na hora (arquivo + texto como legenda); só texto vai pro composer. */
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

  // Zera menções + recarrega membros ao trocar de conversa; só busca em grupo.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversa.id, grupo])

  const termoMencao = useMemo(() => {
    if (!grupo) return null
    const m = texto.match(/(?:^|\s)@([^\s@]*)$/)
    return m ? m[1] : null
  }, [texto, grupo])

  const sugestoesMencao = useMemo(() => {
    if (termoMencao === null) return []
    const alvo = termoMencao.toLowerCase()
    return membrosGrupo.filter((m) => (m.nome || m.numero).toLowerCase().includes(alvo)).slice(0, 6)
  }, [termoMencao, membrosGrupo])

  function escolherMencao(m: MembroGrupo) {
    const rotulo = m.nome || m.numero
    setTexto((prev) => prev.replace(/(?:^|\s)@([^\s@]*)$/, (match) => `${match.startsWith(' ') ? ' ' : ''}@${rotulo} `))
    setMencoesAtuais((prev) => {
      const novo = new Map(prev)
      novo.set(rotulo, m.jid)
      return novo
    })
  }

  // "Assumir para mim" (frente e): reaproveita onTransferir (departamento
  // ATUAL + novo atendente, sem comentário — transferirConversa só grava
  // nota quando há comentário, então isto equivale a um atribuirAgente
  // silencioso) em vez de exigir um prop novo só pra este botão. Só aparece
  // quando dá pra resolver os dois lados: o agente Chatwoot do usuário
  // logado (getMeuAgente, e-mail — mesma resolução da presença) E o
  // departamento local correspondente ao time atual da conversa no Chatwoot.
  const departamentoAtualId = departamentos.find((d) => d.chatwootTeamId != null && d.chatwootTeamId === (conversa.meta.team?.id ?? null))?.id
  const podeAssumirParaMim = Boolean(meuAgente && departamentoAtualId && conversa.meta.assignee?.id !== meuAgente.id)

  async function assumirParaMim() {
    if (!meuAgente || !departamentoAtualId || alterando) return
    setAlterando('assumindo')
    try {
      await onTransferir({ departamentoId: departamentoAtualId, agenteId: meuAgente.id })
      exibirToast('Atendimento assumido')
    } catch {
      // erro do servidor já vira banner via at.erro (AtendimentoCompleto/Compacto);
      // a restauração do atendente anterior é feita pelo hook (transferir), otimista.
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
      // idem: erro já vira banner; hook restaura o atendente/departamento anteriores.
    } finally {
      setAlterando(null)
    }
  }

  async function enviar() {
    const valor = texto.trim()
    if (!valor) return
    // Só manda como menção o jid de nomes que sobreviveram no texto final
    // (a pessoa pode apagar um "@Nome" depois de escolhido).
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', background: 'var(--msn-surface)' }}>
      <div className="brs-messenger-chat-head" style={{ position: 'relative', height: 'auto', minHeight: 36, display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px' }}>
        {compacto && onVoltar && (
          <button type="button" onClick={onVoltar} className="brs-messenger-toolbar-btn" style={{ padding: 6 }}>
            <ArrowLeft size={14} />
          </button>
        )}
        <AvatarContato thumbnail={conversa.meta.sender?.thumbnail} nome={conversa.meta.sender?.name} tamanho={32} fontSize={12} raio={grupo ? 9 : 99} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conversa.meta.sender?.name || 'Sem nome'}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
            {grupo && membrosGrupo.length > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'var(--msn-surface-alt)', border: '1px solid var(--msn-soft-border)', color: 'var(--msn-muted)' }}>
                {membrosGrupo.length} membros
              </span>
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
            mensagensFiltradas.map((m) => {
              const atributoChave = { [ATRIBUTO_CHAVE_ROLAGEM]: chaveMensagem(m) }
              if (m.message_type === 2) {
                return (
                  <div key={m.id} {...atributoChave} style={{ alignSelf: 'center', fontSize: 11, color: 'var(--msn-muted)', background: 'var(--msn-surface-alt)', border: '1px solid var(--msn-soft-border)', borderRadius: 12, padding: '3px 12px', margin: '4px 0', maxWidth: '85%', wordBreak: 'break-word', overflowWrap: 'anywhere', textAlign: 'center' }}>
                    {m.content}
                  </div>
                )
              }
              const saida = m.message_type === 1 || m.message_type === 3
              const nota = Boolean(m.private)
              const aparelho = m.content_attributes?.origem === 'aparelho'
              const remetente = grupo && !saida ? remetenteDeGrupo(m) : null
              const conteudo = remetente ? remetente.conteudo : m.content
              const inReplyTo = m.content_attributes?.in_reply_to as number | undefined
              const citada = inReplyTo ? mensagensPorId.get(inReplyTo) : undefined
              return (
                <div key={m.id} {...atributoChave} style={{ alignSelf: saida ? 'flex-end' : 'flex-start', maxWidth: '78%', display: 'flex', alignItems: 'flex-end', gap: 3 }}>
                  {!saida && (
                    <button type="button" onClick={() => onCitar(m)} className="brs-messenger-toolbar-btn" style={{ padding: 4, opacity: 0.55, flexShrink: 0 }} title="Responder citando">
                      <Reply size={12} />
                    </button>
                  )}
                  <div className={`brs-messenger-message-bubble ${nota ? 'is-nota' : saida ? 'is-mine' : 'is-theirs'}`}>
                    {remetente && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--msn-accent)', marginBottom: 2 }}>{remetente.nome}</div>}
                    {inReplyTo && (
                      <div style={{ borderLeft: '3px solid var(--msn-accent)', padding: '3px 6px', marginBottom: 4, background: 'rgba(0,0,0,.04)', borderRadius: 4, fontSize: 11.5, color: 'var(--msn-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {citada?.content || (citada?.attachments?.length ? '📎 anexo' : 'mensagem citada')}
                      </div>
                    )}
                    {m.attachments?.map((a) =>
                      a.file_type === 'image' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={a.id} src={a.data_url} alt="" onLoad={aoMidiaCarregar} style={{ maxWidth: '100%', borderRadius: 6, marginBottom: 4, display: 'block' }} />
                      ) : a.file_type === 'audio' ? (
                        <audio key={a.id} controls src={a.data_url} onLoadedData={aoMidiaCarregar} style={{ maxWidth: '100%', marginBottom: 4 }} />
                      ) : (
                        <a key={a.id} href={a.data_url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, marginBottom: 4, color: 'var(--msn-link)' }}>
                          <Download size={12} /> anexo
                        </a>
                      ),
                    )}
                    {conteudo && (
                      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13 }}>
                        <TextoComMencoes texto={conteudo} temMencoes={Boolean((m.content_attributes?.mentions as string[] | undefined)?.length)} />
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
                      {horaCurta(m.created_at)}
                      {nota ? ' · nota interna' : ''}
                      {saida && !nota && (
                        <>
                          {m.status === 'falhou' ? (
                            <span style={{ color: '#dc2626' }} title="Falhou">
                              !
                            </span>
                          ) : m.status === 'lido' || m.status === 'entregue' ? (
                            <CheckCheck size={12} style={{ color: m.status === 'lido' ? 'var(--msn-accent)' : undefined }} />
                          ) : (
                            <Check size={12} />
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {saida && (
                    <button type="button" onClick={() => onCitar(m)} className="brs-messenger-toolbar-btn" style={{ padding: 4, opacity: 0.55, flexShrink: 0 }} title="Responder citando">
                      <Reply size={12} />
                    </button>
                  )}
                </div>
              )
            })
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
              <div className="brs-messenger" style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 4, borderRadius: 6, width: 220, zIndex: 60, padding: 4, background: 'var(--msn-surface)', boxShadow: '0 4px 16px rgba(0,0,0,.18)' }} data-brs-messenger-ignore-close="true">
                {sugestoesMencao.map((m) => (
                  <button
                    key={m.jid}
                    type="button"
                    onClick={() => escolherMencao(m)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '5px 8px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--msn-text)', borderRadius: 4 }}
                  >
                    <AvatarContato nome={m.nome || m.numero} tamanho={20} fontSize={9} />
                    {m.nome || m.numero}
                  </button>
                ))}
              </div>
            )}
            <textarea
              className={`brs-messenger-composer-input ${notaInterna ? 'is-nota' : ''}`}
              placeholder={notaInterna ? 'Escreva uma nota interna (não vai pro cliente)…' : grupo ? 'Digite uma mensagem… (@ para mencionar)' : 'Digite uma mensagem…'}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button type="button" onClick={() => void enviar()} disabled={enviando || !texto.trim()} className="brs-messenger-primary-button brs-messenger-send-button">
              {enviando ? <Loader2 size={14} className="spinner" /> : <Send size={14} />}
            </button>
          </div>
        )}
      </div>

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
    </div>
  )
}
