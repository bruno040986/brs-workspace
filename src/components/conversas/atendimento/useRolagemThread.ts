'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'

/** Distância até o fim, em px, considerada "ainda acompanhando" — folga
 * generosa o bastante pra não perder o acompanhamento por causa de um
 * pixel de sub-render, mas restrita o bastante pra contar como "leu até o fim". */
const LIMIAR_FIM_PX = 96

/** Atributo HTML (kebab-case, pro seletor/JSX) que cada item renderizado
 * precisa ter pra rolagem funcionar: `data-chave-rolagem={chaveItem(item)}`
 * no wrapper de CADA item do thread. */
const ATRIBUTO_CHAVE_HTML = 'data-chave-rolagem'
/** Mesma chave, como propriedade de `HTMLElement.dataset` (camelCase —
 * conversão automática do DOM a partir do atributo HTML acima). */
const ATRIBUTO_CHAVE_DATASET = 'chaveRolagem'

/** Pra usar no JSX do chamador sem repetir a string literal:
 * `<div {...{ [ATRIBUTO_CHAVE_ROLAGEM]: chaveItem(it) }}>`. */
export const ATRIBUTO_CHAVE_ROLAGEM = ATRIBUTO_CHAVE_HTML

export type FotoThread = { primeiro: string | undefined; ultimo: string | undefined; tamanho: number; chaves: Set<string> }

/** Extraída (junto com `novosNoFim` abaixo) porque é a parte pura e
 * testável sem React/jsdom (indisponíveis no runner `node --test` deste
 * projeto — o Workspace roda testes de lógica pura, diferente do harness
 * do CRM AlvoConsig que renderiza o hook de verdade). Ambas exportadas só
 * pra teste; o hook é quem as usa de verdade. */
export function fotoDe<T>(thread: T[], chaveItem: (item: T) => string): FotoThread {
  const chaves = new Set(thread.map(chaveItem))
  return { primeiro: thread.length ? chaveItem(thread[0]) : undefined, ultimo: thread.length ? chaveItem(thread[thread.length - 1]) : undefined, tamanho: thread.length, chaves }
}

/** Quantos itens no FIM do thread não existiam no render anterior — para
 * de contar no 1º item já conhecido. Imune a prepend (fica no início) e a
 * remoção do último item anterior (ex.: aviso otimista substituído pela
 * mensagem real): conta só o que é novo de verdade. */
export function novosNoFim<T>(thread: T[], chaveItem: (item: T) => string, anteriores: Set<string>): number {
  let n = 0
  for (let i = thread.length - 1; i >= 0 && !anteriores.has(chaveItem(thread[i])); i--) n++
  return n
}
type AncoraHistorico = { chave: string; offsetAntes: number; topoAntes: number }

export type RolagemThread = {
  containerRef: React.RefObject<HTMLDivElement | null>
  novasNaoLidas: number
  /** Handler de `onScroll` do container — atualiza "está perto do fim?" e limpa o contador quando o operador volta pro fim sozinho. */
  aoRolarMensagens: () => void
  /** Clique no botão "Novas mensagens" — vai pro fim (suave, ação deliberada) e reseta. */
  irParaOFim: (suave: boolean) => void
  /** Chame depois de qualquer envio bem-sucedido do próprio operador (texto, nota, áudio, anexo, ação otimista). Rola pro fim
   * INCONDICIONALMENTE, mesmo que `thread` não tenha mudado nesta renderização — cobre o caso em que o Realtime já entregou a
   * mesma mensagem enquanto a Server Action ainda estava pendente (revisão Astra 09/09/2026: só `seguindoFimRef=true` não bastava,
   * porque o efeito keyed em `thread` não dispara de novo se nada mudou de fato). */
  irParaMensagemEnviada: () => void
  /** Mídia (imagem/áudio) que termina de carregar DEPOIS do texto pode aumentar a altura do balão — só reforça o acompanhamento
   * se o operador já estava no fim. Ligar em onLoad/onLoadedData. */
  aoMidiaCarregar: () => void
  /** Chame IMEDIATAMENTE ANTES de aplicar um prepend de histórico (ex.: logo antes do setState que insere itens mais antigos no
   * início da lista) — nunca antes do fetch de rede, e só quando a resposta realmente traz item(ns) mais antigo(s) que o mais
   * antigo já carregado (revisão Astra rodada 3, 09/09/2026: uma resposta não-vazia mas inteiramente sobreposta ao que já existe
   * não pode armar âncora — ela nunca seria consumida e ficaria pendurada pra um prepend futuro real usar por engano). Ancora no
   * ELEMENTO do 1º item atual (chave + offsetTop), não na altura total do container — uma mensagem nova chegando no fim no MESMO
   * commit não desloca essa âncora, porque só afeta conteúdo abaixo do item ancorado (revisão Astra rodada 3: a versão anterior,
   * baseada em delta de altura total, incluía por engano a altura de qualquer item novo acrescentado no fim). Requer que cada item
   * do thread tenha `data-chave-rolagem={chaveItem(item)}` no wrapper renderizado.
   *
   * Workspace: a thread ainda NÃO pagina (`getMensagens` aceita `before`, mas `carregarThread` não usa) — fica exportada e pronta,
   * sem chamador (roteiro M0 fato 6). */
  armarAncoraHistorico: () => void
}

function encontrarElementoPorChave(container: HTMLElement, chave: string): HTMLElement | null {
  const candidatos = container.querySelectorAll<HTMLElement>(`[${ATRIBUTO_CHAVE_HTML}]`)
  for (const el of candidatos) if (el.dataset[ATRIBUTO_CHAVE_DATASET] === chave) return el
  return null
}

/**
 * Rolagem da lista de mensagens do Atendimento — extraída pra ficar
 * testável sem precisar simular Server Actions, Supabase ou Realtime: só
 * depende da lista já renderizada (`thread`) e de uma função de chave
 * estável por item (deve ser referencialmente estável entre renders — uma
 * função top-level, não uma arrow function inline). Cada item renderizado
 * pelo chamador precisa ter `data-chave-rolagem={chaveItem(item)}` no
 * elemento wrapper.
 *
 * Comportamento: 1ª renderização com conteúdo vai pro fim; prepend de
 * histórico (armado via `armarAncoraHistorico`) preserva a posição visual
 * ancorando no elemento do 1º item ANTERIOR (não na altura total — robusto
 * a um append simultâneo no mesmo commit); mensagem(ns) nova(s) no fim são
 * contadas por POSIÇÃO relativa ao último item anterior (não pelo tamanho
 * total, que também cresce com prepend — histórico paginado nunca conta
 * como mensagem nova), e só acompanham se o operador estava a ≤96px do
 * fim; mudança de conteúdo sem mudar a CHAVE do último item (ex.: ack de
 * status) não dispara nada.
 *
 * Portado de `brs-alvoconsig/apps/web/src/components/crm/atendimento/useRolagemThread.ts`
 * (revisado 3x lá) — Messenger M0 frente (d), só troca de import.
 */
export function useRolagemThread<T>(thread: T[], chaveItem: (item: T) => string): RolagemThread {
  const containerRef = useRef<HTMLDivElement>(null)
  /** true = operador está perto do fim e deve acompanhar mensagens novas. */
  const seguindoFimRef = useRef(true)
  /** Última "foto" do thread renderizado — usada só pra CLASSIFICAR a mudança, nunca renderizada. */
  const anteriorRef = useRef<FotoThread | null>(null)
  /** Armada por armarAncoraHistorico(), consumida assim que o prepend realmente commitar (1º item mudou). */
  const ancoraHistoricoRef = useRef<AncoraHistorico | null>(null)
  const [novasNaoLidas, setNovasNaoLidas] = useState(0)
  /** Incrementado por irParaMensagemEnviada() — dispara o efeito abaixo, que rola pro fim incondicionalmente. */
  const [pedidoIrParaFim, setPedidoIrParaFim] = useState(0)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const atual = fotoDe(thread, chaveItem)
    const primeiroAtual = atual.primeiro
    const anterior = anteriorRef.current

    if (!anterior || anterior.tamanho === 0) {
      // 1ª renderização com conteúdo real (abertura da conversa) — vai pro fim.
      if (thread.length) container.scrollTop = container.scrollHeight
      anteriorRef.current = atual
      return
    }

    // Prepend de histórico — tratado INDEPENDENTE de um append simultâneo
    // no mesmo commit (revisão Astra rodada 3): não retorna cedo, então o
    // bloco de "mensagem nova no fim" abaixo sempre roda também.
    const ancora = ancoraHistoricoRef.current
    if (ancora && primeiroAtual !== anterior.primeiro) {
      const elAncora = encontrarElementoPorChave(container, ancora.chave)
      if (elAncora) {
        // Delta do PRÓPRIO elemento ancorado — imune a qualquer altura
        // acrescentada abaixo dele (ex.: mensagem nova no fim no mesmo commit).
        container.scrollTop = ancora.topoAntes + (elAncora.offsetTop - ancora.offsetAntes)
      }
      ancoraHistoricoRef.current = null
    }

    // Mensagem(ns) nova(s) no fim — contadas por POSIÇÃO relativa ao último
    // item anterior, não pelo tamanho total (que cresce tanto com prepend
    // quanto com append; contar pelo tamanho incluiria histórico paginado
    // como se fosse mensagem nova).
    const novos = novosNoFim(thread, chaveItem, anterior.chaves)
    if (novos > 0) {
      if (seguindoFimRef.current) {
        container.scrollTop = container.scrollHeight
      } else {
        setNovasNaoLidas((n) => n + novos)
      }
    }
    anteriorRef.current = atual
  }, [thread, chaveItem])

  // Rolagem INCONDICIONAL pro fim, disparada por uma ação do próprio
  // operador — roda mesmo se `thread` não tiver mudado nesta renderização.
  // Sempre roda DEPOIS do commit mais recente, então enxerga o conteúdo já
  // atualizado seja qual for a origem (ação própria ou Realtime).
  useLayoutEffect(() => {
    if (!pedidoIrParaFim) return
    // Só mutação de DOM/refs aqui (nunca setState) — o reset de
    // `novasNaoLidas` já acontece em irParaMensagemEnviada(), antes de
    // agendar este efeito, pra não encadear um novo render a partir de
    // dentro do próprio efeito.
    const container = containerRef.current
    if (container) container.scrollTop = container.scrollHeight
    seguindoFimRef.current = true
    anteriorRef.current = fotoDe(thread, chaveItem)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoIrParaFim])

  const irParaMensagemEnviada = useCallback(() => {
    setNovasNaoLidas(0)
    setPedidoIrParaFim((n) => n + 1)
  }, [])

  const aoRolarMensagens = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const perto = container.scrollHeight - container.scrollTop - container.clientHeight <= LIMIAR_FIM_PX
    seguindoFimRef.current = perto
    if (perto) setNovasNaoLidas(0)
  }, [])

  const irParaOFim = useCallback((suave: boolean) => {
    const container = containerRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior: suave ? 'smooth' : 'auto' })
    seguindoFimRef.current = true
    setNovasNaoLidas(0)
  }, [])

  const aoMidiaCarregar = useCallback(() => {
    const container = containerRef.current
    if (container && seguindoFimRef.current) container.scrollTop = container.scrollHeight
  }, [])

  const armarAncoraHistorico = useCallback(() => {
    const container = containerRef.current
    if (!container || !thread.length) return
    const chave = chaveItem(thread[0])
    const elAncora = encontrarElementoPorChave(container, chave)
    // Sem o elemento (ex.: ainda não montou) não dá pra ancorar com
    // precisão — melhor não armar nada (comportamento anterior à
    // correção) do que armar uma âncora inválida.
    if (!elAncora) return
    ancoraHistoricoRef.current = { chave, offsetAntes: elAncora.offsetTop, topoAntes: container.scrollTop }
  }, [thread, chaveItem])

  return { containerRef, novasNaoLidas, aoRolarMensagens, irParaOFim, irParaMensagemEnviada, aoMidiaCarregar, armarAncoraHistorico }
}
