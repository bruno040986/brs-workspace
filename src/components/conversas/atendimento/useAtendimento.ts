'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ehGrupo, parseIdentifier } from './types'
import { pollingVisivel } from '@/lib/polling-visivel'
import { assinarPresencaConversa } from '@/lib/central-conversas/presenca-actions'
import { ouvirPresenca, type PresencaRecebida } from './presencaCanal'
import { mergeChatwootMessages, type ChatwootMensagem } from '@/lib/central-conversas/chatwoot'
import {
  addNotaInterna,
  apagarMensagem as apagarMensagemAction,
  editarMensagemConversa,
  assumirConversa,
  buscarEntidades,
  encaminharMensagem as encaminharMensagemAction,
  encerrarConversa,
  enviarAnexoConversa,
  enviarAudioConversa,
  getAgentesChat,
  getCanaisAtendimento,
  getContadores,
  getContatoMeta,
  getConversas,
  getDadosConversaAberta,
  getGaleriaConversa,
  getHistoricoContato,
  getMensagens,
  getMeta,
  getMinhaDisponibilidade,
  getRespostasRapidas,
  getTags,
  getTagsConta,
  getTagsContato,
  iniciarConversaPorTelefone,
  listarContatos,
  marcarConversaLida,
  marcarNaoLidaConversa,
  meusDepartamentos,
  reagirMensagem as reagirMensagemAction,
  responderConversa,
  setAtendentePadraoContato,
  setDepartamentoPadraoContato,
  setMinhaDisponibilidade,
  setObservacoes as setObservacoesAction,
  setTags as setTagsAction,
  setTagsContato as setTagsContatoAction,
  setVinculo as setVinculoAction,
  setVinculoContato as setVinculoContatoAction,
  silenciarConversa,
  transferirConversa,
  type ContatoBusca,
  type DepartamentoResumo,
  type ResultadoNovaConversa,
} from '@/lib/central-conversas/actions'
import { agendarAcao, cancelarAgendamento, listarAgendamentos, reagendar as reagendarAction } from '@/lib/central-conversas/agendamento-actions'
import { enviarRespostaRapida, listarRespostasVisiveis } from '@/lib/central-conversas/respostas-rapidas-actions'
import type {
  AcaoAgendada,
  AgenteChat,
  ConversaAtendimento,
  ContatoMeta,
  EntidadeBusca,
  EntidadeTipo,
  GaleriaItem,
  HistoricoChamado,
  InboxAtendimento,
  InstanciaAtendimento,
  MensagemComExtras,
  RespostaRapida,
  RespostaRapidaRow,
  TagConta,
} from './types'

export type AbaAtendimento = 'meus' | 'fila' | 'geral' | 'contatos'

function mensagem(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}

export function useAtendimento() {
  const [aba, setAba] = useState<AbaAtendimento>('meus')
  const [abaAnterior, setAbaAnterior] = useState<AbaAtendimento>('meus')
  const [busca, setBusca] = useState('')
  // Conjunto vazio = "Todos" (sem filtro). Multi-seleção: marcar um ou vários
  // canais/departamentos ao mesmo tempo.
  const [canalIds, setCanalIds] = useState<Set<number>>(() => new Set())
  const [departamentoIds, setDepartamentoIds] = useState<Set<string>>(() => new Set())
  const [departamentos, setDepartamentos] = useState<DepartamentoResumo[]>([])
  const [ehSupervisor, setEhSupervisor] = useState(false)
  const [disponivel, setDisponivel] = useState(true)
  const [carregandoLista, setCarregandoLista] = useState(true)
  const [conversas, setConversas] = useState<ConversaAtendimento[]>([])
  const [filaCount, setFilaCount] = useState(0)
  const [contadores, setContadores] = useState({ mine: 0, unassigned: 0, all: 0 })
  const [presenca, setPresenca] = useState<'online' | 'busy' | 'offline' | null>(null)
  const [contatos, setContatos] = useState<ContatoBusca[]>([])
  const [carregandoContatos, setCarregandoContatos] = useState(false)
  const [selecionada, setSelecionada] = useState<ConversaAtendimento | null>(null)
  const [mensagens, setMensagens] = useState<MensagemComExtras[]>([])
  const [carregandoThread, setCarregandoThread] = useState(false)
  const [agentes, setAgentes] = useState<AgenteChat[]>([])
  const [canaisAtendimento, setCanaisAtendimento] = useState<{ inboxes: InboxAtendimento[]; instancias: InstanciaAtendimento[]; conta: { nome: string; chatwootAccountId: number } | null }>({
    inboxes: [],
    instancias: [],
    conta: null,
  })
  // Nome da instância/inbox por id — pro "balãozinho" de instância na lista e
  // no cabeçalho da conversa (paridade Digisac). Mesma fonte usada pelos
  // chips de filtro, só reindexada por id em vez de lista.
  const nomeInstanciaPorInbox = useMemo(() => {
    const mapa = new Map<number, string>()
    for (const i of canaisAtendimento.instancias) if (i.inboxId) mapa.set(i.inboxId, i.nome)
    for (const i of canaisAtendimento.inboxes) if (!mapa.has(i.id)) mapa.set(i.id, i.nome)
    return mapa
  }, [canaisAtendimento])

  const [tagsConta, setTagsConta] = useState<TagConta[]>([])
  const [tagsConversa, setTagsConversaState] = useState<string[]>([])
  const [respostasRapidas, setRespostasRapidas] = useState<RespostaRapida[] | null>(null)
  const [respostasVisiveis, setRespostasVisiveis] = useState<RespostaRapidaRow[]>([])
  const [contatoMeta, setContatoMeta] = useState<ContatoMeta | null>(null)
  const [tagsContato, setTagsContatoState] = useState<string[]>([])
  const [historico, setHistorico] = useState<HistoricoChamado[] | null>(null)
  const [carregandoHistorico, setCarregandoHistorico] = useState(false)
  const [galeria, setGaleria] = useState<GaleriaItem[] | null>(null)
  const [carregandoGaleria, setCarregandoGaleria] = useState(false)
  const [agendamentos, setAgendamentos] = useState<AcaoAgendada[]>([])
  const [citacao, setCitacao] = useState<MensagemComExtras | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Presença do contato da conversa aberta (só individual): 'digitando'/'gravando' expiram sozinhos
  // em 12 s caso o 'parado' do WhatsApp se perca; 'online' vale até chegar 'offline'.
  const [presencaContato, setPresencaContato] = useState<PresencaRecebida['estado'] | null>(null)

  const selecionadaIdRef = useRef<number | null>(null)
  useEffect(() => {
    selecionadaIdRef.current = selecionada?.id ?? null
  }, [selecionada])

  // Set dos ids de mensagem carregados na thread aberta — usado pelo Realtime
  // de ticks/reações para saber se o payload (sem conversation_id) é da thread atual.
  const mensagensIdsRef = useRef<Set<number>>(new Set())
  useEffect(() => {
    mensagensIdsRef.current = new Set(mensagens.map((m) => m.id))
  }, [mensagens])

  // Com 1 único selecionado dá pra empurrar o filtro pro servidor (mais
  // eficiente); com 0 (= Todos) ou 2+ (multi-seleção) o Chatwoot só aceita um
  // inbox_id/team_id por chamada, então busca tudo e filtra no cliente abaixo.
  const canalIdServidor = canalIds.size === 1 ? [...canalIds][0] : undefined
  const teamIdFiltro =
    departamentoIds.size === 1 ? departamentos.find((d) => departamentoIds.has(d.id))?.chatwootTeamId ?? undefined : undefined

  const cacheConversasRef = useRef<Partial<Record<AbaAtendimento, ConversaAtendimento[]>>>({})
  // O Chatwoot pagina de 25 em 25 e a lista só mostrava a página 1 (a Fila
  // tinha 60 em 24/09 e 35 ficavam invisíveis). N = páginas já pedidas nesta
  // aba ("Carregar mais"); volta a 1 quando aba/busca/filtros mudam.
  const paginasRef = useRef(1)
  const [temMaisConversas, setTemMaisConversas] = useState(false)
  const abaRef = useRef(aba)
  useEffect(() => {
    abaRef.current = aba
  }, [aba])

  // Invalida cache quando a busca ou filtros de canal/departamento mudam
  useEffect(() => {
    cacheConversasRef.current = {}
    paginasRef.current = 1
  }, [busca, canalIds, departamentoIds])

  const carregarLista = useCallback(async (): Promise<ConversaAtendimento[]> => {
    if (aba === 'contatos') return []
    const abaSolicitada = aba
    try {
      const params = new URLSearchParams()
      params.set('aba', aba)
      if (busca) params.set('q', busca)
      if (canalIdServidor) params.set('inboxId', String(canalIdServidor))
      if (teamIdFiltro) params.set('teamId', String(teamIdFiltro))

      // Refaz TODAS as páginas já pedidas (1..N): poll/Realtime substituem a
      // lista inteira, e só a página 1 faria a página 2 sumir a cada 30 s.
      const respostas = await Promise.all(
        Array.from({ length: paginasRef.current }, (_, i) => {
          const p = new URLSearchParams(params)
          p.set('page', String(i + 1))
          return fetch(`/api/conversas/lista?${p.toString()}`).then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            return res.json()
          })
        }),
      )
      const r = respostas[0]
      const vistos = new Set<number>()
      let lista: ConversaAtendimento[] = []
      for (const resp of respostas) {
        for (const c of (resp.conversas || []) as ConversaAtendimento[]) {
          if (!vistos.has(c.id)) {
            vistos.add(c.id)
            lista.push(c)
          }
        }
      }
      const ultimaPagina = (respostas[respostas.length - 1].conversas || []) as ConversaAtendimento[]
      if (abaSolicitada === abaRef.current) setTemMaisConversas(ultimaPagina.length >= 25)
      if (canalIds.size > 1) lista = lista.filter((c) => canalIds.has(c.inbox_id))
      if (departamentoIds.size > 1) {
        const teamsAlvo = new Set(departamentos.filter((d) => departamentoIds.has(d.id)).map((d) => d.chatwootTeamId).filter((x): x is number => x !== null))
        lista = lista.filter((c) => c.meta?.team && teamsAlvo.has(c.meta.team.id))
      }
      setDisponivel(r.disponivel)
      cacheConversasRef.current[abaSolicitada] = lista

      if (abaSolicitada === abaRef.current) {
        const selId = selecionadaIdRef.current
        const listaAjustada = selId ? lista.map((c) => (c.id === selId ? { ...c, unread_count: 0 } : c)) : lista
        setConversas(listaAjustada)
      }
      // Mantém a conversa aberta em dia com a lista (atendente, última mensagem):
      setSelecionada((prev) => {
        if (!prev) return prev
        const fresca = lista.find((c) => c.id === prev.id)
        return fresca ? { ...fresca, unread_count: 0, atendimentoMeta: fresca.atendimentoMeta ?? prev.atendimentoMeta } : prev
      })
      setErro(null)
      return lista
    } catch (err) {
      setErro(mensagem(err, 'Erro ao carregar conversas.'))
      return []
    } finally {
      if (abaSolicitada === abaRef.current) {
        setCarregandoLista(false)
      }
    }
  }, [aba, busca, canalIds, departamentoIds, departamentos, canalIdServidor, teamIdFiltro])

  const carregarMaisConversas = useCallback(async () => {
    paginasRef.current += 1
    await carregarLista()
  }, [carregarLista])

  const carregarContadores = useCallback(async () => {
    try {
      const url = teamIdFiltro ? `/api/conversas/contadores?teamId=${teamIdFiltro}` : '/api/conversas/contadores'
      const res = await fetch(url)
      if (!res.ok) return
      const c = await res.json()
      setContadores(c)
      setFilaCount(c.unassigned)
    } catch {
      // contadores são acessórios — a lista continua funcionando sem eles
    }
  }, [teamIdFiltro])

  const carregarContatos = useCallback(async () => {
    setCarregandoContatos(true)
    try {
      const url = busca ? `/api/conversas/contatos?q=${encodeURIComponent(busca)}` : '/api/conversas/contatos'
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const lista = await res.json()
      setContatos(lista)
    } catch (err) {
      setErro(mensagem(err, 'Erro ao carregar contatos.'))
    } finally {
      setCarregandoContatos(false)
    }
  }, [busca])

  const carregarThread = useCallback(async (conversationId: number, opts: { silencioso?: boolean } = {}) => {
    if (!opts.silencioso) setCarregandoThread(true)
    try {
      const res = await fetch(`/api/conversas/${conversationId}/mensagens`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const r = await res.json()
      if (selecionadaIdRef.current === conversationId) {
        const fresh = (r.payload || []).filter((m: ChatwootMensagem) => m.message_type !== 2 || m.content)
        if (opts.silencioso) {
          setMensagens((prev) => mergeChatwootMessages(prev, fresh))
        } else {
          setMensagens(fresh)
        }
      }
    } catch (err) {
      if (!opts.silencioso && selecionadaIdRef.current === conversationId) setErro(mensagem(err, 'Erro ao carregar mensagens.'))
    } finally {
      if (!opts.silencioso && selecionadaIdRef.current === conversationId) setCarregandoThread(false)
    }
  }, [])

  const carregarMeta = useCallback(async (conversationId: number, contactId?: number) => {
    try {
      const url = `/api/conversas/${conversationId}/meta${contactId ? `?contactId=${contactId}` : ''}`
      const res = await fetch(url)
      if (!res.ok) return
      const data = await res.json()
      if (selecionadaIdRef.current === conversationId) {
        setSelecionada((prev) => (prev && prev.id === conversationId ? { ...prev, atendimentoMeta: data.meta } : prev))
        setTagsConversaState(data.tags || [])
      }
    } catch {
      // meta é auxiliar — segue exibindo a conversa sem ela
    }
  }, [])

  /** Dados por CONTATO (Fase B §a/b/c): vínculo/departamento/atendente padrão, tags, agendamentos da conversa. */
  const carregarDadosContato = useCallback(async (conversationId: number, contactId?: number) => {
    if (selecionadaIdRef.current !== conversationId) return
    setAgendamentos([])
    setContatoMeta(null)
    setTagsContatoState([])
    setHistorico(null)
    setGaleria(null)
    try {
      const agend = await listarAgendamentos(conversationId)
      if (selecionadaIdRef.current === conversationId) setAgendamentos(agend)
    } catch {
      // agendamentos são auxiliares
    }
    if (!contactId) return
    try {
      const res = await fetch(`/api/conversas/contatos/${contactId}/meta`)
      if (!res.ok) return
      const data = await res.json()
      if (selecionadaIdRef.current === conversationId) {
        setContatoMeta(data.contatoMeta)
        setTagsContatoState(data.tagsContato || [])
      }
    } catch {
      // meta de contato é auxiliar — segue exibindo a conversa sem ela
    }
  }, [])

  // Bootstrap: lista, agentes, canais, tags da conta, respostas rápidas via GET HTTP endpoint único
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/conversas/bootstrap')
        if (!res.ok) throw new Error('Bootstrap HTTP Error')
        const data = await res.json()
        setAgentes(data.agentes || [])
        setCanaisAtendimento(data.canaisAtendimento || { inboxes: [], instancias: [], conta: null })
        setTagsConta(data.tagsConta || [])
        setDepartamentos(data.departamentos || [])
        setEhSupervisor(Boolean(data.ehSupervisor))
        if (data.presenca) setPresenca(data.presenca)
        setRespostasRapidas(data.respostasRapidas || null)
      } catch {
        // Fallback gracioso para Server Actions se a rota HTTP falhar por qualquer motivo
        const [ag, canais, tags, deps, pres] = await Promise.allSettled([getAgentesChat(), getCanaisAtendimento(), getTagsConta(), meusDepartamentos(), getMinhaDisponibilidade()])
        if (ag.status === 'fulfilled') setAgentes(ag.value || [])
        if (canais.status === 'fulfilled') setCanaisAtendimento(canais.value)
        if (tags.status === 'fulfilled') setTagsConta(tags.value || [])
        if (deps.status === 'fulfilled') {
          setDepartamentos(deps.value.departamentos)
          setEhSupervisor(deps.value.ehSupervisor)
        }
        if (pres.status === 'fulfilled') setPresenca(pres.value)
        try {
          const r = await getRespostasRapidas()
          setRespostasRapidas(r || [])
        } catch {
          setRespostasRapidas(null)
        }
      }
    })()
  }, [])

  useEffect(() => {
    if (aba === 'contatos') return
    paginasRef.current = 1
    const cacheExistente = cacheConversasRef.current[aba]
    if (cacheExistente) {
      setConversas(cacheExistente)
      setCarregandoLista(false)
    } else {
      setConversas([])
      setCarregandoLista(true)
    }
    void Promise.all([carregarLista(), carregarContadores()])

    return pollingVisivel(
      () => Promise.all([carregarLista(), carregarContadores()]),
      30_000,
      { imediato: false },
    )
  }, [aba, carregarLista, carregarContadores])

  useEffect(() => {
    if (aba === 'contatos') void carregarContatos()
  }, [aba, carregarContatos])

  useEffect(() => {
    if (!selecionada) return
    const contactId = selecionada.meta?.sender?.id
    const conversationId = selecionada.id

    // 1. Exibe mensagens da thread IMEDIATAMENTE (carregamento prioritário)
    void carregarThread(conversationId)

    // 2. Carrega metadados auxiliares em segundo plano (não bloqueia exibição das mensagens)
    void carregarMeta(conversationId, contactId)
    void carregarDadosContato(conversationId, contactId)

    // Redes de segurança: polling visível que retorna a Promise
    return pollingVisivel(() => carregarThread(conversationId, { silencioso: true }), 30_000, { imediato: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionada?.id])

  // Realtime: novo evento do engine → refresca lista/thread aberta. Ticks e
  // reações (sem conversation_id no payload) refazem a thread só quando o
  // chatwoot_message_id pertence à thread aberta, com debounce (vários juntos).
  const accountId = canaisAtendimento.conta?.chatwootAccountId ?? null
  // Refs, não deps: `carregarLista` muda a cada tecla da busca (deps aba/busca/
  // canal) — como dep do efeito, cada letra derrubava e recriava o canal.
  // O canal assina UMA vez por conta e chama sempre a versão atual.
  const carregarListaRef = useRef(carregarLista)
  const carregarThreadRef = useRef(carregarThread)
  const carregarContadoresRef = useRef(carregarContadores)
  useEffect(() => {
    carregarListaRef.current = carregarLista
    carregarThreadRef.current = carregarThread
    carregarContadoresRef.current = carregarContadores
  }, [carregarLista, carregarThread, carregarContadores])
  useEffect(() => {
    setPresencaContato(null)
    const alvo = selecionada && !ehGrupo(selecionada) ? parseIdentifier(selecionada.meta.sender?.identifier) : null
    if (!accountId || !alvo?.jid.endsWith('@s.whatsapp.net')) return
    void assinarPresencaConversa(alvo.instanciaId, alvo.jid)
    let expira: ReturnType<typeof setTimeout> | null = null
    const parar = ouvirPresenca(accountId, (p) => {
      if (p.jid !== alvo.jid || p.instanciaId !== alvo.instanciaId) return
      if (expira) clearTimeout(expira)
      setPresencaContato(p.estado === 'parado' ? null : p.estado)
      if (p.estado === 'digitando' || p.estado === 'gravando') expira = setTimeout(() => setPresencaContato(null), 12_000)
    })
    return () => {
      parar()
      if (expira) clearTimeout(expira)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionada?.id, accountId])

  useEffect(() => {
    if (!accountId) return
    const supabase = createClient()
    const carregarLista = () => carregarListaRef.current()
    const carregarThread = (id: number, opts: { silencioso?: boolean }) => carregarThreadRef.current(id, opts)
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const refetchThreadDebounced = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        if (selecionadaIdRef.current) void carregarThread(selecionadaIdRef.current, { silencioso: true })
      }, 400)
    }
    // Nome único por montagem: dock e /conversas montam este hook ao mesmo tempo,
    // e o supabase-js reaproveita canal de mesmo nome (o 2º .on() após subscribe lança).
    const canal = supabase
      .channel(`chat-eventos-atendimento-${Math.random().toString(36).slice(2, 10)}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_eventos', filter: `chatwoot_account_id=eq.${accountId}` },
        (payload) => {
          const ev = payload.new as { payload?: { conversation_id?: number } }
          void carregarLista()
          void carregarContadoresRef.current()
          if (selecionadaIdRef.current && ev.payload?.conversation_id === selecionadaIdRef.current) {
            void carregarThread(selecionadaIdRef.current, { silencioso: true })
          }
        },
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_mensagem_status' }, (payload) => {
        const row = payload.new as { chatwoot_message_id?: number }
        if (row.chatwoot_message_id !== undefined && mensagensIdsRef.current.has(row.chatwoot_message_id)) refetchThreadDebounced()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_mensagem_edicoes' }, (payload) => {
        const row = payload.new as { chatwoot_message_id?: number }
        if (row.chatwoot_message_id !== undefined && mensagensIdsRef.current.has(row.chatwoot_message_id)) refetchThreadDebounced()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_mensagem_reacoes' }, (payload) => {
        const row = payload.new as { chatwoot_message_id?: number }
        if (row.chatwoot_message_id !== undefined && mensagensIdsRef.current.has(row.chatwoot_message_id)) refetchThreadDebounced()
      })
      .subscribe()
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      supabase.removeChannel(canal)
    }
  }, [accountId])

  // Aba "Contatos" virou um ícone à parte (não fica misturado com Chats/Fila/
  // Geral, que são visões de conversa): guarda a aba de conversa anterior pra
  // voltar pra ela ao fechar o painel de contatos.
  useEffect(() => {
    if (aba !== 'contatos') setAbaAnterior(aba)
  }, [aba])
  const alternarContatos = useCallback(() => {
    setAba((atual) => (atual === 'contatos' ? abaAnterior : 'contatos'))
  }, [abaAnterior])

  const alternarCanal = useCallback((id: number) => {
    setCanalIds((prev) => {
      const novo = new Set(prev)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }, [])
  const alternarDepartamentoFiltro = useCallback((id: string) => {
    setDepartamentoIds((prev) => {
      const novo = new Set(prev)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }, [])

  // Abrir a conversa marca como lida (zera o badge de não lidas): o Chatwoot
  // nunca faz isso sozinho aqui, só quando alguém abre a conversa NA TELA
  // NATIVA dele. Otimista nos dois estados (selecionada + item da lista) pra
  // o badge sumir na hora, sem esperar o próximo poll/refresh.
  const selecionarConversa = useCallback((c: ConversaAtendimento | null) => {
    const precisaMarcarLida = Boolean(c && c.unread_count > 0)
    setSelecionada(c && precisaMarcarLida ? { ...c, unread_count: 0 } : c)
    setMensagens([])
    setTagsConversaState([])
    setCitacao(null)
    if (c && precisaMarcarLida) {
      setConversas((prev) => prev.map((x) => (x.id === c.id ? { ...x, unread_count: 0 } : x)))
      void marcarConversaLida(c.id).catch(() => {})
    }
  }, [])

  // Respostas rápidas cadastradas (Fase B §d), restritas ao(s) departamento(s) do
  // atendente. Se a tabela estiver vazia (nada cadastrado ainda), o composer cai
  // de volta pro canned response nativo do Chatwoot (`respostasRapidas` acima).
  useEffect(() => {
    void (async () => {
      try {
        const r = await listarRespostasVisiveis(departamentos.map((d) => d.id))
        setRespostasVisiveis(r)
      } catch {
        setRespostasVisiveis([])
      }
    })()
  }, [departamentos])

  async function enviarTexto(texto: string, mentions?: string[]) {
    if (!selecionada || !texto.trim()) return
    setEnviando(true)
    setErro(null)
    try {
      await responderConversa(selecionada.id, texto.trim(), citacao?.id, mentions)
      setCitacao(null)
      void marcarConversaLida(selecionada.id).catch(() => {})
      await carregarThread(selecionada.id, { silencioso: true })
      void carregarLista()
    } catch (err) {
      setErro(mensagem(err, 'Falha ao enviar mensagem.'))
      throw err
    } finally {
      setEnviando(false)
    }
  }

  function citar(m: MensagemComExtras | null) {
    setCitacao(m)
  }

  /** Resposta rápida com anexo: sai direto (arquivo + texto como legenda) — Fase B §d. */
  async function enviarRespostaRapidaFn(respostaId: string) {
    if (!selecionada) return
    setEnviando(true)
    setErro(null)
    try {
      await enviarRespostaRapida(selecionada.id, respostaId)
      void marcarConversaLida(selecionada.id).catch(() => {})
      await carregarThread(selecionada.id, { silencioso: true })
      void carregarLista()
    } catch (err) {
      setErro(mensagem(err, 'Falha ao enviar resposta rápida.'))
      throw err
    } finally {
      setEnviando(false)
    }
  }

  async function enviarNota(texto: string) {
    if (!selecionada || !texto.trim()) return
    setEnviando(true)
    setErro(null)
    try {
      await addNotaInterna(selecionada.id, texto.trim())
      await carregarThread(selecionada.id, { silencioso: true })
    } catch (err) {
      setErro(mensagem(err, 'Falha ao salvar nota interna.'))
      throw err
    } finally {
      setEnviando(false)
    }
  }

  async function enviarAnexo(file: File, legenda?: string) {
    if (!selecionada) return
    setEnviando(true)
    setErro(null)
    try {
      const form = new FormData()
      form.append('file', file)
      if (legenda) form.append('legenda', legenda)
      await enviarAnexoConversa(selecionada.id, form)
      void marcarConversaLida(selecionada.id).catch(() => {})
      await carregarThread(selecionada.id, { silencioso: true })
      void carregarLista()
    } catch (err) {
      setErro(mensagem(err, 'Falha ao enviar anexo.'))
      throw err
    } finally {
      setEnviando(false)
    }
  }

  async function enviarAudio(blob: Blob) {
    if (!selecionada) return
    setEnviando(true)
    setErro(null)
    try {
      const form = new FormData()
      const tipo = (blob.type || 'audio/ogg').split(';')[0]
      form.append('file', new File([blob], `audio.${tipo === 'audio/webm' ? 'webm' : 'ogg'}`, { type: tipo }))
      const r = await enviarAudioConversa(selecionada.id, form)
      if (!r.ok) throw new Error(r.error)
      void marcarConversaLida(selecionada.id).catch(() => {})
      await carregarThread(selecionada.id, { silencioso: true })
      void carregarLista()
    } catch (err) {
      setErro(mensagem(err, 'Falha ao enviar áudio.'))
      throw err
    } finally {
      setEnviando(false)
    }
  }

  /** Otimista (Messenger M0 frente e): aplica no estado ANTES do await, pro cabeçalho/composer
   * refletirem na hora (transferir fecha modal já mostrando o novo atendente); erro do servidor
   * restaura o valor anterior (guardado fora do setState — não dá pra ler `selecionada` de dentro
   * do próprio updater com segurança de tipo aqui). */
  async function transferir(input: { departamentoId: string; agenteId?: number | null; comentario?: string }) {
    if (!selecionada) return
    const anterior = selecionada
    const departamento = departamentos.find((d) => d.id === input.departamentoId)
    const agente = input.agenteId ? agentes.find((a) => a.id === input.agenteId) : null
    setSelecionada((prev) =>
      prev
        ? {
            ...prev,
            meta: { ...prev.meta, assignee: agente ? { id: agente.id, name: agente.name } : null, team: departamento ? { id: departamento.chatwootTeamId || 0, name: departamento.nome } : prev.meta.team },
          }
        : prev,
    )
    try {
      const res = await transferirConversa(selecionada.id, input)
      if (!res.ok) throw new Error(res.error)
      await carregarThread(selecionada.id, { silencioso: true })
      void carregarLista()
    } catch (err) {
      setSelecionada(anterior)
      setErro(mensagem(err, 'Falha ao transferir conversa.'))
      throw err
    }
  }

  /** Atribuição rápida (troca só o atendente, mantém o departamento — usada no select "Atendente" do
   * painel e no botão "Assumir para mim" da thread). Otimista, mesmo padrão de `transferir`. */
  async function atribuirAgente(agenteId: number | null) {
    if (!selecionada) return
    const anterior = selecionada
    const agente = agenteId ? agentes.find((a) => a.id === agenteId) : null
    setSelecionada((prev) => (prev ? { ...prev, meta: { ...prev.meta, assignee: agente || null } } : prev))
    try {
      await assumirConversa(selecionada.id, agenteId)
      await carregarThread(selecionada.id, { silencioso: true })
      void carregarLista()
    } catch (err) {
      setSelecionada(anterior)
      setErro(mensagem(err, 'Falha ao atribuir atendente.'))
      throw err
    }
  }

  async function mudarPresenca(status: 'online' | 'busy' | 'offline') {
    const anterior = presenca
    setPresenca(status)
    try {
      const r = await setMinhaDisponibilidade(status)
      if (!r.ok) throw new Error(r.erro || 'Falha ao atualizar disponibilidade.')
    } catch (err) {
      setPresenca(anterior)
      setErro(mensagem(err, 'Falha ao atualizar disponibilidade.'))
    }
  }

  async function encerrar(motivo?: string) {
    if (!selecionada) return
    try {
      await encerrarConversa(selecionada.id, motivo || undefined)
      selecionarConversa(null)
      void carregarLista()
    } catch (err) {
      setErro(mensagem(err, 'Falha ao encerrar conversa.'))
      throw err
    }
  }

  async function silenciar(v: boolean) {
    if (!selecionada) return
    try {
      await silenciarConversa(selecionada.id, v)
    } catch (err) {
      setErro(mensagem(err, 'Falha ao silenciar conversa.'))
    }
  }

  async function marcarNaoLida() {
    if (!selecionada) return
    try {
      await marcarNaoLidaConversa(selecionada.id)
      selecionarConversa(null)
      void carregarLista()
    } catch (err) {
      setErro(mensagem(err, 'Falha ao marcar como não lida.'))
    }
  }

  async function vincular(tipo: EntidadeTipo | null, id: string | null) {
    if (!selecionada) return
    try {
      const meta = await setVinculoAction(selecionada.id, tipo, id)
      setSelecionada((prev) => (prev ? { ...prev, atendimentoMeta: meta } : prev))
    } catch (err) {
      setErro(mensagem(err, 'Falha ao vincular.'))
      throw err
    }
  }

  async function salvarObservacoes(texto: string) {
    if (!selecionada) return
    try {
      const meta = await setObservacoesAction(selecionada.id, texto)
      setSelecionada((prev) => (prev ? { ...prev, atendimentoMeta: meta } : prev))
    } catch (err) {
      setErro(mensagem(err, 'Falha ao salvar observações.'))
    }
  }

  async function salvarTags(tags: string[]) {
    if (!selecionada) return
    try {
      const atualizado = await setTagsAction(selecionada.id, tags)
      setTagsConversaState(atualizado)
    } catch (err) {
      setErro(mensagem(err, 'Falha ao salvar tags.'))
    }
  }

  function contatoId(): number | undefined {
    return selecionada?.meta?.sender?.id
  }

  async function vincularContato(tipo: EntidadeTipo | null, id: string | null) {
    const cid = contatoId()
    if (!cid) return
    try {
      const meta = await setVinculoContatoAction(cid, tipo, id)
      setContatoMeta(meta)
    } catch (err) {
      setErro(mensagem(err, 'Falha ao vincular o contato.'))
      throw err
    }
  }

  async function definirDepartamentoPadraoContato(departamentoId: string | null) {
    const cid = contatoId()
    if (!cid) return
    try {
      const meta = await setDepartamentoPadraoContato(cid, departamentoId)
      setContatoMeta(meta)
    } catch (err) {
      setErro(mensagem(err, 'Falha ao definir o departamento padrão do contato.'))
      throw err
    }
  }

  async function definirAtendentePadraoContato(chatwootAgentId: number | null) {
    const cid = contatoId()
    if (!cid) return
    try {
      const meta = await setAtendentePadraoContato(cid, chatwootAgentId)
      setContatoMeta(meta)
    } catch (err) {
      setErro(mensagem(err, 'Falha ao definir o atendente padrão do contato.'))
      throw err
    }
  }

  async function salvarTagsContato(tags: string[]) {
    const cid = contatoId()
    if (!cid) return
    try {
      const atualizado = await setTagsContatoAction(cid, tags)
      setTagsContatoState(atualizado)
    } catch (err) {
      setErro(mensagem(err, 'Falha ao salvar tags do contato.'))
    }
  }

  /** Sob demanda (abre no modal "Histórico de chamados" do painel — Fase B §b). */
  async function carregarHistoricoContato() {
    const cid = contatoId()
    if (!cid) return
    setCarregandoHistorico(true)
    try {
      const r = await getHistoricoContato(cid)
      setHistorico(r)
    } catch (err) {
      setErro(mensagem(err, 'Falha ao carregar histórico de chamados.'))
    } finally {
      setCarregandoHistorico(false)
    }
  }

  /** Sob demanda ("ver todos" da galeria — Fase B §b). */
  async function carregarGaleriaCompleta() {
    if (!selecionada) return
    setCarregandoGaleria(true)
    try {
      const r = await getGaleriaConversa(selecionada.id)
      setGaleria(r)
    } catch (err) {
      setErro(mensagem(err, 'Falha ao carregar galeria.'))
    } finally {
      setCarregandoGaleria(false)
    }
  }

  async function criarAgendamento(input: { acao: 'mensagem' | 'lembrete_interno'; texto: string; agendadoPara: string }) {
    if (!selecionada) return
    try {
      await agendarAcao({ conversationId: selecionada.id, ...input })
      const lista = await listarAgendamentos(selecionada.id)
      setAgendamentos(lista)
    } catch (err) {
      setErro(mensagem(err, 'Falha ao agendar ação.'))
      throw err
    }
  }

  async function cancelarAgendamentoFn(id: string) {
    if (!selecionada) return
    try {
      await cancelarAgendamento(id)
      const lista = await listarAgendamentos(selecionada.id)
      setAgendamentos(lista)
    } catch (err) {
      setErro(mensagem(err, 'Falha ao cancelar agendamento.'))
      throw err
    }
  }

  async function reagendarAcao(id: string, novaData: string) {
    if (!selecionada) return
    try {
      await reagendarAction(id, novaData)
      const lista = await listarAgendamentos(selecionada.id)
      setAgendamentos(lista)
    } catch (err) {
      setErro(mensagem(err, 'Falha ao reagendar ação.'))
      throw err
    }
  }

  async function buscarEntidadesFn(q: string): Promise<{ parceiros: EntidadeBusca[]; instituicoes: EntidadeBusca[]; promotoras: EntidadeBusca[] }> {
    try {
      return await buscarEntidades(q)
    } catch {
      return { parceiros: [], instituicoes: [], promotoras: [] }
    }
  }

  /** `operationId` nasce no modal (uma chave por intenção — Lote 02B); aqui só passa adiante. Resultado 'incerto' volta pro modal, sem retry. */
  async function novaConversa(input: { instanciaId: string; telefone: string; texto: string; operationId: string }): Promise<ResultadoNovaConversa> {
    let r: ResultadoNovaConversa
    try {
      r = await iniciarConversaPorTelefone(input)
    } catch (err) {
      r = { resultado: 'incerto', mensagem: err instanceof Error ? err.message : 'Falha ao comunicar com o servidor.' }
    }

    if (r.resultado === 'confirmado') abrirConversaCriada(r.conversationId)
    return r
  }

  /** Atualiza a lista e seleciona a conversa recém-criada em segundo plano para não travar a UI nem o fechamento do modal. */
  function abrirConversaCriada(conversationId?: number | null) {
    void (async () => {
      try {
        const lista = await carregarLista()
        const encontrada = conversationId ? lista.find((c) => c.id === conversationId) : undefined
        if (encontrada) selecionarConversa(encontrada)
      } catch (err) {
        console.error('[abrirConversaCriada] Erro ao carregar lista em segundo plano:', err)
      }
    })()
  }

  async function reagirMensagem(messageId: number, emoji: string) {
    if (!selecionada) return
    try {
      await reagirMensagemAction(selecionada.id, messageId, emoji)
      await carregarThread(selecionada.id, { silencioso: true })
    } catch (err) {
      setErro(mensagem(err, 'Falha ao reagir à mensagem.'))
    }
  }

  /** Devolve o erro (texto) pra o editor da bolha mostrar; sucesso = null e a thread refaz o fetch. */
  async function editarMensagem(messageId: number, texto: string): Promise<string | null> {
    if (!selecionada) return 'Nenhuma conversa aberta.'
    const r = await editarMensagemConversa(selecionada.id, messageId, texto)
    if (!r.ok) return r.error
    await carregarThread(selecionada.id, { silencioso: true })
    return null
  }

  async function apagarMensagem(messageId: number) {
    if (!selecionada) return
    try {
      await apagarMensagemAction(selecionada.id, messageId)
      await carregarThread(selecionada.id, { silencioso: true })
    } catch (err) {
      setErro(mensagem(err, 'Falha ao apagar mensagem.'))
    }
  }

  async function encaminharMensagem(sourceMessage: MensagemComExtras, targetConversationId: number) {
    try {
      await encaminharMensagemAction(sourceMessage, targetConversationId)
      if (selecionada?.id === targetConversationId) {
        await carregarThread(selecionada.id, { silencioso: true })
      }
      void carregarLista()
    } catch (err) {
      setErro(mensagem(err, 'Falha ao encaminhar mensagem.'))
    }
  }

  return {
    aba,
    setAba,
    alternarContatos,
    busca,
    setBusca,
    canalIds,
    alternarCanal,
    limparCanais: () => setCanalIds(new Set()),
    departamentoIds,
    alternarDepartamentoFiltro,
    limparDepartamentosFiltro: () => setDepartamentoIds(new Set()),
    departamentos,
    ehSupervisor,
    contadores,
    presenca,
    mudarPresenca,
    contatos,
    carregandoContatos,
    disponivel,
    carregandoLista,
    conversas,
    carregarMaisConversas,
    temMaisConversas,
    filaCount,
    selecionada,
    selecionarConversa,
    mensagens,
    carregandoThread,
    agentes,
    canaisAtendimento,
    nomeInstanciaPorInbox,
    tagsConta,
    tagsConversa,
    respostasRapidas,
    respostasVisiveis,
    contatoMeta,
    tagsContato,
    historico,
    carregandoHistorico,
    carregarHistoricoContato,
    galeria,
    carregandoGaleria,
    carregarGaleriaCompleta,
    agendamentos,
    criarAgendamento,
    cancelarAgendamento: cancelarAgendamentoFn,
    reagendarAcao,
    citacao,
    citar,
    enviando,
    erro,
    setErro,
    enviarTexto,
    enviarNota,
    enviarAnexo,
    enviarAudio,
    enviarRespostaRapida: enviarRespostaRapidaFn,
    transferir,
    encerrar,
    silenciar,
    marcarNaoLida,
    atribuirAgente,
    vincular,
    vincularContato,
    definirDepartamentoPadraoContato,
    definirAtendentePadraoContato,
    salvarObservacoes,
    salvarTags,
    salvarTagsContato,
    buscarEntidades: buscarEntidadesFn,
    novaConversa,
    presencaContato,
    abrirConversaCriada,
    recarregarLista: carregarLista,
    reagirMensagem,
    apagarMensagem,
    editarMensagem,
    encaminharMensagem,
  }
}

export type UseAtendimentoReturn = ReturnType<typeof useAtendimento>
