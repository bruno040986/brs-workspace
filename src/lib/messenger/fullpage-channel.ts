'use client'

/**
 * Anti-eco dock × tela cheia (contrato BRS Messenger, item 7 da UI):
 * `/conversas` (AtendimentoCompleto) publica presença nesse BroadcastChannel
 * enquanto está montado; o dock (AtendimentoCompacto), ao ouvir, suprime
 * toasts/sons de Atendimento — mas mantém o badge de não lidas.
 */
export const BRS_MESSENGER_FULLPAGE_CHANNEL = 'brs-messenger-fullpage'
const HEARTBEAT_MS = 4000
const STALE_MS = 9000

type Sinal = { tipo: 'aberta' | 'fechada' }

export function publicarPresencaFullpage() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return () => {}
  const canal = new BroadcastChannel(BRS_MESSENGER_FULLPAGE_CHANNEL)
  const enviarAberta = () => canal.postMessage({ tipo: 'aberta' } satisfies Sinal)
  enviarAberta()
  const heartbeat = window.setInterval(enviarAberta, HEARTBEAT_MS)
  const onUnload = () => canal.postMessage({ tipo: 'fechada' } satisfies Sinal)
  window.addEventListener('pagehide', onUnload)
  return () => {
    window.clearInterval(heartbeat)
    window.removeEventListener('pagehide', onUnload)
    canal.postMessage({ tipo: 'fechada' } satisfies Sinal)
    canal.close()
  }
}

/** Retorna uma função de limpeza; chama `onMudanca(aberta)` quando o estado muda. */
export function observarFullpageAberta(onMudanca: (aberta: boolean) => void) {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return () => {}
  const canal = new BroadcastChannel(BRS_MESSENGER_FULLPAGE_CHANNEL)
  let ultimoSinalEm = 0
  let aberta = false

  const marcarFechada = () => {
    if (aberta) {
      aberta = false
      onMudanca(false)
    }
  }

  canal.onmessage = (event: MessageEvent<Sinal>) => {
    ultimoSinalEm = Date.now()
    if (event.data?.tipo === 'aberta') {
      if (!aberta) {
        aberta = true
        onMudanca(true)
      }
    } else {
      marcarFechada()
    }
  }

  const verificador = window.setInterval(() => {
    if (aberta && Date.now() - ultimoSinalEm > STALE_MS) marcarFechada()
  }, STALE_MS)

  return () => {
    window.clearInterval(verificador)
    canal.close()
  }
}
