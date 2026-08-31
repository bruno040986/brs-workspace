'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  addNotaInterna,
  buscarEntidades,
  encerrarConversa,
  enviarAnexoConversa,
  enviarAudioConversa,
  getAgentesChat,
  getCanaisAtendimento,
  getConversas,
  getMensagens,
  getMeta,
  getRespostasRapidas,
  getTags,
  getTagsConta,
  iniciarConversaPorTelefone,
  marcarNaoLidaConversa,
  responderConversa,
  setObservacoes as setObservacoesAction,
  setTags as setTagsAction,
  setVinculo as setVinculoAction,
  silenciarConversa,
  transferirConversa,
} from '@/lib/central-conversas/actions'
import type {
  AgenteChat,
  ChatwootMensagem,
  ConversaAtendimento,
  EntidadeBusca,
  EntidadeTipo,
  InboxAtendimento,
  InstanciaAtendimento,
  RespostaRapida,
  TagConta,
} from './types'

export type AbaAtendimento = 'meus' | 'fila' | 'geral'

function mensagem(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}

export function useAtendimento() {
  const [aba, setAba] = useState<AbaAtendimento>('meus')
  const [busca, setBusca] = useState('')
  const [canalId, setCanalId] = useState<number | null>(null)
  const [disponivel, setDisponivel] = useState(true)
  const [carregandoLista, setCarregandoLista] = useState(true)
  const [conversas, setConversas] = useState<ConversaAtendimento[]>([])
  const [filaCount, setFilaCount] = useState(0)
  const [selecionada, setSelecionada] = useState<ConversaAtendimento | null>(null)
  const [mensagens, setMensagens] = useState<ChatwootMensagem[]>([])
  const [carregandoThread, setCarregandoThread] = useState(false)
  const [agentes, setAgentes] = useState<AgenteChat[]>([])
  const [canaisAtendimento, setCanaisAtendimento] = useState<{ inboxes: InboxAtendimento[]; instancias: InstanciaAtendimento[] }>({ inboxes: [], instancias: [] })
  const [tagsConta, setTagsConta] = useState<TagConta[]>([])
  const [tagsConversa, setTagsConversaState] = useState<string[]>([])
  const [respostasRapidas, setRespostasRapidas] = useState<RespostaRapida[] | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const selecionadaIdRef = useRef<number | null>(null)
  useEffect(() => {
    selecionadaIdRef.current = selecionada?.id ?? null
  }, [selecionada])

  const carregarLista = useCallback(async (): Promise<ConversaAtendimento[]> => {
    try {
      const r = await getConversas({ aba, q: busca || undefined, inboxId: canalId ?? undefined })
      const lista = (r.conversas || []) as ConversaAtendimento[]
      setDisponivel(r.disponivel)
      setConversas(lista)
      const contagemFila = (r.meta as Record<string, number> | undefined)?.unassigned_count
      if (typeof contagemFila === 'number') setFilaCount(contagemFila)
      setErro(null)
      return lista
    } catch (err) {
      setErro(mensagem(err, 'Erro ao carregar conversas.'))
      return []
    } finally {
      setCarregandoLista(false)
    }
  }, [aba, busca, canalId])

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

  const carregarMeta = useCallback(async (conversationId: number) => {
    try {
      const [meta, tags] = await Promise.all([getMeta(conversationId), getTags(conversationId).catch(() => [])])
      setSelecionada((prev) => (prev && prev.id === conversationId ? { ...prev, atendimentoMeta: meta } : prev))
      setTagsConversaState(tags)
    } catch {
      // meta é auxiliar — segue exibindo a conversa sem ela
    }
  }, [])

  // Bootstrap: lista, agentes, canais, tags da conta, respostas rápidas (feature opcional).
  useEffect(() => {
    void (async () => {
      const [ag, canais, tags] = await Promise.allSettled([getAgentesChat(), getCanaisAtendimento(), getTagsConta()])
      if (ag.status === 'fulfilled') setAgentes(ag.value || [])
      if (canais.status === 'fulfilled') setCanaisAtendimento(canais.value)
      if (tags.status === 'fulfilled') setTagsConta(tags.value || [])
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
      await carregarLista()
    })()
    const t = setInterval(() => void carregarLista(), 6000)
    return () => clearInterval(t)
  }, [carregarLista])

  useEffect(() => {
    if (!selecionada) return
    void (async () => {
      await carregarThread(selecionada.id)
      await carregarMeta(selecionada.id)
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
  }, [])

  async function enviarTexto(texto: string) {
    if (!selecionada || !texto.trim()) return
    setEnviando(true)
    setErro(null)
    try {
      await responderConversa(selecionada.id, texto.trim())
      await carregarThread(selecionada.id, { silencioso: true })
      void carregarLista()
    } catch (err) {
      setErro(mensagem(err, 'Falha ao enviar mensagem.'))
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

  async function transferir(agenteId: number) {
    if (!selecionada) return
    try {
      await transferirConversa(selecionada.id, agenteId)
      await carregarThread(selecionada.id, { silencioso: true })
      void carregarLista()
    } catch (err) {
      setErro(mensagem(err, 'Falha ao transferir conversa.'))
      throw err
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
    enviando,
    erro,
    setErro,
    enviarTexto,
    enviarNota,
    enviarAnexo,
    enviarAudio,
    transferir,
    encerrar,
    silenciar,
    marcarNaoLida,
    vincular,
    salvarObservacoes,
    salvarTags,
    buscarEntidades: buscarEntidadesFn,
    novaConversa,
    recarregarLista: carregarLista,
  }
}

export type UseAtendimentoReturn = ReturnType<typeof useAtendimento>
