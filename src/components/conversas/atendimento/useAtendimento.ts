'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  addNotaInterna,
  assumirConversa,
  buscarEntidades,
  encerrarConversa,
  enviarAnexoConversa,
  enviarAudioConversa,
  getAgentesChat,
  getCanaisAtendimento,
  getContadores,
  getContatoMeta,
  getConversas,
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
  marcarNaoLidaConversa,
  meusDepartamentos,
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
  const [busca, setBusca] = useState('')
  const [canalId, setCanalId] = useState<number | null>(null)
  const [departamentoId, setDepartamentoId] = useState<string | null>(null)
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
  const [canaisAtendimento, setCanaisAtendimento] = useState<{ inboxes: InboxAtendimento[]; instancias: InstanciaAtendimento[] }>({ inboxes: [], instancias: [] })
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

  const selecionadaIdRef = useRef<number | null>(null)
  useEffect(() => {
    selecionadaIdRef.current = selecionada?.id ?? null
  }, [selecionada])

  const teamIdFiltro = departamentoId ? departamentos.find((d) => d.id === departamentoId)?.chatwootTeamId ?? undefined : undefined

  const carregarLista = useCallback(async (): Promise<ConversaAtendimento[]> => {
    if (aba === 'contatos') return []
    try {
      const r = await getConversas({ aba, q: busca || undefined, inboxId: canalId ?? undefined, teamId: teamIdFiltro ?? undefined })
      const lista = (r.conversas || []) as ConversaAtendimento[]
      setDisponivel(r.disponivel)
      setConversas(lista)
      // Mantém a conversa aberta em dia com a lista (atendente, última mensagem):
      // sem isso o select de Atendente ficava "Sem atendente" até reabrir a conversa.
      setSelecionada((prev) => {
        if (!prev) return prev
        const fresca = lista.find((c) => c.id === prev.id)
        return fresca ? { ...fresca, atendimentoMeta: fresca.atendimentoMeta ?? prev.atendimentoMeta } : prev
      })
      setErro(null)
      return lista
    } catch (err) {
      setErro(mensagem(err, 'Erro ao carregar conversas.'))
      return []
    } finally {
      setCarregandoLista(false)
    }
  }, [aba, busca, canalId, teamIdFiltro])

  const carregarContadores = useCallback(async () => {
    try {
      const c = await getContadores(teamIdFiltro ?? undefined)
      setContadores(c)
      setFilaCount(c.unassigned)
    } catch {
      // contadores são acessórios — a lista continua funcionando sem eles
    }
  }, [teamIdFiltro])

  const carregarContatos = useCallback(async () => {
    setCarregandoContatos(true)
    try {
      const lista = await listarContatos({ q: busca || undefined })
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
      const r = await getMensagens(conversationId)
      setMensagens((r.payload || []).filter((m) => m.message_type !== 2 || m.content))
    } catch (err) {
      if (!opts.silencioso) setErro(mensagem(err, 'Erro ao carregar mensagens.'))
    } finally {
      if (!opts.silencioso) setCarregandoThread(false)
    }
  }, [])

  const carregarMeta = useCallback(async (conversationId: number, contactId?: number) => {
    try {
      const [meta, tags] = await Promise.all([getMeta(conversationId, contactId), getTags(conversationId).catch(() => [])])
      setSelecionada((prev) => (prev && prev.id === conversationId ? { ...prev, atendimentoMeta: meta } : prev))
      setTagsConversaState(tags)
    } catch {
      // meta é auxiliar — segue exibindo a conversa sem ela
    }
  }, [])

  /** Dados por CONTATO (Fase B §a/b/c): vínculo/departamento/atendente padrão, tags, agendamentos da conversa. */
  const carregarDadosContato = useCallback(async (conversationId: number, contactId?: number) => {
    setAgendamentos([])
    setContatoMeta(null)
    setTagsContatoState([])
    setHistorico(null)
    setGaleria(null)
    try {
      const agend = await listarAgendamentos(conversationId)
      setAgendamentos(agend)
    } catch {
      // agendamentos são auxiliares
    }
    if (!contactId) return
    try {
      const [cm, tc] = await Promise.all([getContatoMeta(contactId), getTagsContato(contactId).catch(() => [])])
      setContatoMeta(cm)
      setTagsContatoState(tc)
    } catch {
      // meta de contato é auxiliar — segue exibindo a conversa sem ela
    }
  }, [])

  // Bootstrap: lista, agentes, canais, tags da conta, respostas rápidas (feature opcional).
  useEffect(() => {
    void (async () => {
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
    })()
  }, [])

  useEffect(() => {
    // setCarregandoLista fica só na troca de aba/busca/canal (via este bootstrap),
    // nunca no polling de 6s abaixo — daí o carregamento inicial ficar isolado
    // num callback próprio em vez de uma chamada direta no corpo do efeito.
    void (async () => {
      setCarregandoLista(true)
      await Promise.all([carregarLista(), carregarContadores()])
    })()
    const t = setInterval(() => {
      void carregarLista()
      void carregarContadores()
    }, 6000)
    return () => clearInterval(t)
  }, [carregarLista, carregarContadores])

  useEffect(() => {
    if (aba === 'contatos') void carregarContatos()
  }, [aba, carregarContatos])

  useEffect(() => {
    if (!selecionada) return
    const contactId = selecionada.meta?.sender?.id
    void (async () => {
      await carregarThread(selecionada.id)
      await carregarMeta(selecionada.id, contactId)
      await carregarDadosContato(selecionada.id, contactId)
    })()
    const t = setInterval(() => void carregarThread(selecionada.id, { silencioso: true }), 6000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionada?.id])

  // Realtime: novo evento do engine → refresca lista/thread aberta.
  useEffect(() => {
    const supabase = createClient()
    // Nome único por montagem: dock e /conversas montam este hook ao mesmo tempo,
    // e o supabase-js reaproveita canal de mesmo nome (o 2º .on() após subscribe lança).
    const canal = supabase
      .channel(`chat-eventos-atendimento-${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_eventos' }, (payload) => {
        const ev = payload.new as { payload?: { conversation_id?: number } }
        void carregarLista()
        if (selecionadaIdRef.current && ev.payload?.conversation_id === selecionadaIdRef.current) {
          void carregarThread(selecionadaIdRef.current, { silencioso: true })
        }
      })
      .subscribe()
    return () => {
      supabase.removeChannel(canal)
    }
  }, [carregarLista, carregarThread])

  const selecionarConversa = useCallback((c: ConversaAtendimento | null) => {
    setSelecionada(c)
    setMensagens([])
    setTagsConversaState([])
    setCitacao(null)
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

  async function enviarTexto(texto: string) {
    if (!selecionada || !texto.trim()) return
    setEnviando(true)
    setErro(null)
    try {
      await responderConversa(selecionada.id, texto.trim(), citacao?.id)
      setCitacao(null)
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
      form.append('file', new File([blob], 'audio.ogg', { type: blob.type || 'audio/ogg' }))
      await enviarAudioConversa(selecionada.id, form)
      await carregarThread(selecionada.id, { silencioso: true })
      void carregarLista()
    } catch (err) {
      setErro(mensagem(err, 'Falha ao enviar áudio.'))
      throw err
    } finally {
      setEnviando(false)
    }
  }

  async function transferir(input: { departamentoId: string; agenteId?: number | null; comentario?: string }) {
    if (!selecionada) return
    try {
      await transferirConversa(selecionada.id, input)
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
      await carregarThread(selecionada.id, { silencioso: true })
      void carregarLista()
    } catch (err) {
      setErro(mensagem(err, 'Falha ao transferir conversa.'))
      throw err
    }
  }

  /** Atribuição rápida (troca só o atendente, mantém o departamento — usada no select "Atendente" do painel). */
  async function atribuirAgente(agenteId: number | null) {
    if (!selecionada) return
    try {
      await assumirConversa(selecionada.id, agenteId)
      const agente = agenteId ? agentes.find((a) => a.id === agenteId) : null
      setSelecionada((prev) => (prev ? { ...prev, meta: { ...prev.meta, assignee: agente || null } } : prev))
      await carregarThread(selecionada.id, { silencioso: true })
      void carregarLista()
    } catch (err) {
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

  async function novaConversa(input: { instanciaId: string; telefone: string; texto: string }) {
    const r = await iniciarConversaPorTelefone(input)
    const lista = await carregarLista()
    if (r.conversationId) {
      const encontrada = lista.find((c) => c.id === r.conversationId)
      if (encontrada) selecionarConversa(encontrada)
    }
    return r
  }

  return {
    aba,
    setAba,
    busca,
    setBusca,
    canalId,
    setCanalId,
    departamentoId,
    setDepartamentoId,
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
    filaCount,
    selecionada,
    selecionarConversa,
    mensagens,
    carregandoThread,
    agentes,
    canaisAtendimento,
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
    recarregarLista: carregarLista,
  }
}

export type UseAtendimentoReturn = ReturnType<typeof useAtendimento>
