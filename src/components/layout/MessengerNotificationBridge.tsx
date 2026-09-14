'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageSquareText, UserPlus } from 'lucide-react'
import { useMessengerDock } from '@/components/layout/MessengerDockContext'
import { createClient } from '@/lib/supabase/client'
import { deriveChatStatus, type ChatPresenceRecord } from '@/lib/chat/presence'
import { pollingVisivel } from '@/lib/polling-visivel'

type ChatStatus = 'online' | 'offline' | 'busy' | 'away'

type BridgeContact = {
  id: string
  email: string
  full_name?: string
  short_name?: string
  nickname?: string | null
  status?: ChatStatus
  status_message?: string | null
}

type BridgeConversation = {
  id: string
  participant: BridgeContact
  unreadCount: number
}

type BridgeToast = {
  id: string
  kind: 'message' | 'contact'
  title: string
  body: string
  actionLabel?: string
  action?: 'scroll-bottom'
}

const WORKSPACE_TITLE = 'BRS Workspace'
const NOTIFICATION_ICON = '/favicon/FAVICON-BRS-PROMOTORA.png'
const MESSAGE_SOUND_URL = '/notificacao-chat-brs.mp3'

function firstName(label?: string | null) {
  if (!label) return ''
  const parts = String(label).trim().split(/\s+/).filter(Boolean)
  return parts[0] || ''
}

function contactLabel(contact: BridgeContact) {
  return (
    contact.nickname ||
    String(contact.full_name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 1)
      .join(' ') ||
    contact.email
  )
}

function messengerTitle(unreadTotal: number) {
  return unreadTotal > 0 ? `(${Math.min(99, unreadTotal)}) BRS Messenger` : WORKSPACE_TITLE
}

export function MessengerNotificationBridge() {
  const [toasts, setToasts] = useState<BridgeToast[]>([])
  const { unreadCount, setUnreadCount } = useMessengerDock()

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioBufferRef = useRef<AudioBuffer | null>(null)
  const audioWarmupRef = useRef<Promise<void> | null>(null)
  const audioUnlockedRef = useRef(false)

  const unreadByConversationRef = useRef<Record<string, number>>({})
  const contactStatusRef = useRef<Record<string, ChatStatus>>({})
  const initializedConversationsRef = useRef(false)
  const initializedContactsRef = useRef(false)
  const permissionRequestedRef = useRef(false)
  const lastMessageSoundAtRef = useRef(0)
  const lastContactSoundAtRef = useRef(0)
  const pollCooldownUntilRef = useRef(0)
  const pollFailuresRef = useRef(0)
  const originalFaviconHrefRef = useRef<string | null>(null)
  const faviconLinkRef = useRef<HTMLLinkElement | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const globalWindow = window as Window & { __BRS_MESSENGER_GLOBAL_NOTIFIER__?: boolean }
    globalWindow.__BRS_MESSENGER_GLOBAL_NOTIFIER__ = true
    document.title = WORKSPACE_TITLE

    const faviconLink = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
    faviconLinkRef.current = faviconLink
    originalFaviconHrefRef.current = faviconLink?.href || null

    const audio = new Audio(MESSAGE_SOUND_URL)
    audio.preload = 'auto'
    audio.load()
    audioRef.current = audio

    const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (AudioContextCtor) {
      audioContextRef.current = new AudioContextCtor()
    }

    const requestPermissionOnGesture = () => {
      if (permissionRequestedRef.current) return
      if (!('Notification' in window)) return
      permissionRequestedRef.current = true
      if (Notification.permission === 'default') {
        void Notification.requestPermission().catch(() => {})
      }
    }

    const unlockAudioOnGesture = () => {
      if (audioUnlockedRef.current) return
      void primeAudio().catch(() => {})
    }

    async function warmupAudio() {
      if (audioWarmupRef.current) return audioWarmupRef.current
      audioWarmupRef.current = (async () => {
        const context = audioContextRef.current
        if (!context) return

        if (context.state === 'suspended') {
          try {
            await context.resume()
          } catch {
            // ignore
          }
        }

        if (audioBufferRef.current) return

        try {
          const response = await fetch(MESSAGE_SOUND_URL, { cache: 'force-cache' })
          const arrayBuffer = await response.arrayBuffer()
          audioBufferRef.current = await context.decodeAudioData(arrayBuffer.slice(0))
        } catch {
          // keep HTMLAudio fallback available
        }
      })()
      return audioWarmupRef.current
    }

    async function primeAudio() {
      if (audioUnlockedRef.current) return true

      let unlocked = false

      try {
        await warmupAudio()
      } catch {
        // ignore warmup failures and keep trying below
      }

      const media = audioRef.current
      if (media) {
        try {
          media.muted = true
          media.volume = 0
          await media.play()
          media.pause()
          media.currentTime = 0
          unlocked = true
        } catch {
          unlocked = false
        } finally {
          media.muted = false
          media.volume = 1
        }
      }

      const context = audioContextRef.current
      if (!unlocked && context) {
        try {
          if (context.state === 'suspended') {
            await context.resume()
          }
          unlocked = context.state === 'running'
        } catch {
          unlocked = false
        }
      }

      if (unlocked) {
        audioUnlockedRef.current = true
      }

      return unlocked
    }

    const gestureEvents: Array<keyof WindowEventMap> = ['pointerdown', 'mousedown', 'mouseup', 'click', 'touchstart', 'keydown']
    for (const eventName of gestureEvents) {
      window.addEventListener(eventName, requestPermissionOnGesture, { capture: true })
      window.addEventListener(eventName, unlockAudioOnGesture, { capture: true })
    }

    return () => {
      for (const eventName of gestureEvents) {
        window.removeEventListener(eventName, requestPermissionOnGesture, { capture: true } as AddEventListenerOptions)
        window.removeEventListener(eventName, unlockAudioOnGesture, { capture: true } as AddEventListenerOptions)
      }
      delete globalWindow.__BRS_MESSENGER_GLOBAL_NOTIFIER__
      document.title = WORKSPACE_TITLE
      if (faviconLinkRef.current && originalFaviconHrefRef.current) {
        faviconLinkRef.current.href = originalFaviconHrefRef.current
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        void audioContextRef.current.close().catch(() => {})
      }
    }
  }, [])

  useEffect(() => {
    document.title = messengerTitle(unreadCount)
    return () => {
      document.title = WORKSPACE_TITLE
    }
  }, [unreadCount])

  useEffect(() => {
    updateFaviconBadge(unreadCount)
  }, [unreadCount])

  useEffect(() => {
    void bootstrap()

    // 13/09/2026: era poll de 8 s / 12 s para todo usuário logado, em toda
    // tela (maior origem de custo de Observability na Vercel). Agora a
    // novidade chega por Realtime (RLS já limita às conversas de que o
    // usuário participa); o poll vira rede de segurança de 60 s, pausado
    // com a aba oculta — e ainda cobre o "ficou offline" por inatividade,
    // que não gera evento nenhum.
    const pararConversas = pollingVisivel(() => refreshConversations(), 60_000, { imediato: false })
    const pararContatos = pollingVisivel(() => refreshContacts(), 60_000, { imediato: false })

    const supabase = createClient()
    let meuId = ''
    void supabase.auth.getUser().then(({ data }) => {
      meuId = data.user?.id || ''
    })

    // Heartbeat de presença de cada colega gera UPDATE a cada minuto; só
    // refaz a lista quando o status DERIVADO muda (online/ausente/ocupado).
    let contatosTimer: number | null = null
    const agendarContatos = () => {
      if (contatosTimer) return
      contatosTimer = window.setTimeout(() => {
        contatosTimer = null
        void refreshContacts()
      }, 1500)
    }

    const canal = supabase
      .channel(`interno-bridge-${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'workspace_chat_messages' }, (payload) => {
        const nova = payload.new as { sender_id?: string }
        if (nova.sender_id && nova.sender_id === meuId) return
        void refreshConversations()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'workspace_chat_user_profiles' }, (payload) => {
        const perfil = payload.new as ChatPresenceRecord & { user_id?: string }
        if (!perfil.user_id || perfil.user_id === meuId) return
        const derivado = deriveChatStatus(perfil, Date.now())
        const anterior = contactStatusRef.current[perfil.user_id]
        if (anterior !== undefined && anterior === derivado) return
        agendarContatos()
      })
      .subscribe()

    return () => {
      pararConversas()
      pararContatos()
      if (contatosTimer) window.clearTimeout(contatosTimer)
      supabase.removeChannel(canal)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function bootstrap() {
    await Promise.all([refreshConversations(true), refreshContacts(true)])
  }

  function registerPollFailure() {
    pollFailuresRef.current = Math.min(pollFailuresRef.current + 1, 6)
    const backoffMs = Math.min(60000, 5000 * 2 ** pollFailuresRef.current)
    pollCooldownUntilRef.current = Date.now() + backoffMs
  }

  function registerPollSuccess() {
    pollFailuresRef.current = 0
    pollCooldownUntilRef.current = 0
  }

  async function refreshContacts(silent = false) {
    // Backend fora do ar/instável não deve virar mais uma origem de
    // retries a cada tick do polling — pausa com backoff progressivo.
    if (Date.now() < pollCooldownUntilRef.current) return
    try {
      const response = await fetch('/api/chat/contacts', { cache: 'no-store' })
      if (!response.ok) {
        registerPollFailure()
        return
      }
      const data = await response.json()
      const nextContacts = Array.isArray(data) ? (data as BridgeContact[]) : []

      if (initializedContactsRef.current) {
        let played = false
        for (const contact of nextContacts) {
          const prevStatus = contactStatusRef.current[contact.id] || 'offline'
          const nextStatus = (contact.status || 'offline') as ChatStatus
          if (prevStatus === 'offline' && nextStatus !== 'offline') {
            const name = firstName(contactLabel(contact))
            const body = `${name || 'Usuário'} acabou de entrar.`
            pushToast({
              kind: 'contact',
              title: 'Entrada no Messenger',
              body,
            })
            showBrowserNotification('BRS Messenger', body, `contact-${contact.id}`)
            played = true
          }
        }
        if (played) playContactSound()
      }

      const statusMap: Record<string, ChatStatus> = {}
      for (const contact of nextContacts) {
        statusMap[contact.id] = (contact.status || 'offline') as ChatStatus
      }
      contactStatusRef.current = statusMap
      initializedContactsRef.current = true
      registerPollSuccess()
      if (!silent) return
    } catch (error) {
      console.error('Erro ao atualizar contatos do Messenger:', error)
      registerPollFailure()
    }
  }

  async function refreshConversations(silent = false) {
    if (Date.now() < pollCooldownUntilRef.current) return
    try {
      const response = await fetch('/api/chat/conversations', { cache: 'no-store' })
      if (!response.ok) {
        registerPollFailure()
        return
      }
      const data = await response.json()
      const nextConversations = Array.isArray(data) ? (data as BridgeConversation[]) : []

      const unreadMap: Record<string, number> = {}
      let nextUnreadTotal = 0
      const alerts: Array<{ name: string; delta: number }> = []

      for (const conversation of nextConversations) {
        const nextUnread = conversation.unreadCount || 0
        unreadMap[conversation.id] = nextUnread
        nextUnreadTotal += nextUnread

        if (!initializedConversationsRef.current) continue

        const prevUnread = unreadByConversationRef.current[conversation.id] || 0
        const delta = nextUnread - prevUnread
        if (delta > 0) {
          alerts.push({
            name: firstName(contactLabel(conversation.participant)),
            delta,
          })
        }
      }

      unreadByConversationRef.current = unreadMap
      initializedConversationsRef.current = true
      setUnreadCount(nextUnreadTotal)
      registerPollSuccess()

      if (silent || alerts.length === 0) return

      const totalNew = alerts.reduce((sum, item) => sum + item.delta, 0)
      const toastBody = totalNew === 1 ? '1 nova mensagem' : `${totalNew} novas mensagens`
      if (document.hidden || !document.hasFocus()) {
        document.title = messengerTitle(nextUnreadTotal)
      }

      pushToast({
        kind: 'message',
        title: 'BRS Messenger',
        body: toastBody,
        actionLabel: 'Ir para conversa',
        action: 'scroll-bottom',
      })

      for (const alert of alerts) {
        const body = `${alert.name || 'Usuário'} enviou uma mensagem.`
        showBrowserNotification('BRS Messenger', body, `message-${alert.name || 'user'}`)
      }

      playMessageSound()
    } catch (error) {
      console.error('Erro ao atualizar conversas do Messenger:', error)
      registerPollFailure()
    }
  }

  function playMessageSound() {
    if (typeof window === 'undefined') return
    const now = Date.now()
    if (now - lastMessageSoundAtRef.current < 850) return
    lastMessageSoundAtRef.current = now

    const audio = audioRef.current
    const context = audioContextRef.current
    const buffer = audioBufferRef.current

    try {
      if (context && buffer) {
        if (context.state === 'suspended') {
          void context.resume().catch(() => {})
        }
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(context.destination)
        source.start(0)
        return
      }

      if (!audio) return
      audio.currentTime = 0
      void audio.play().catch(() => {
        playFallbackTone()
      })
    } catch {
      // ignore autoplay restrictions silently
    }
  }

  function playContactSound() {
    if (typeof window === 'undefined') return
    const now = Date.now()
    if (now - lastContactSoundAtRef.current < 1200) return
    lastContactSoundAtRef.current = now
    playFallbackTone()
  }

  function playFallbackTone() {
    const context = audioContextRef.current
    if (!context) return
    try {
      if (context.state === 'suspended') {
        void context.resume().catch(() => {})
      }
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = 880
      gain.gain.value = 0.0001
      oscillator.connect(gain)
      gain.connect(context.destination)
      const startAt = context.currentTime
      gain.gain.exponentialRampToValueAtTime(0.08, startAt + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.14)
      oscillator.start(startAt)
      oscillator.stop(startAt + 0.16)
    } catch {
      // ignore autoplay restrictions silently
    }
  }

  function showBrowserNotification(titleText: string, body: string, tag?: string) {
    if (typeof window === 'undefined') return
    if (!('Notification' in window)) return
    if (Notification.permission !== 'granted') return
    try {
      new Notification(titleText, {
        body,
        icon: NOTIFICATION_ICON,
        badge: NOTIFICATION_ICON,
        requireInteraction: false,
        silent: true,
        tag: tag || 'brs-messenger',
      })
    } catch (error) {
      console.error('Erro ao mostrar notificação do navegador:', error)
    }
  }

  function pushToast(toast: Omit<BridgeToast, 'id'>) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setToasts((prev) => {
      const next = [...prev, { id, ...toast }]
      return next.slice(-3)
    })
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id))
    }, 5200)
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }

  function handleToastAction(action?: BridgeToast['action'], id?: string) {
    if (action === 'scroll-bottom') {
      window.dispatchEvent(new CustomEvent('brs-messenger:scroll-to-bottom'))
    }
    if (id) dismissToast(id)
  }

  function updateFaviconBadge(count: number) {
    const link = faviconLinkRef.current || document.querySelector<HTMLLinkElement>("link[rel~='icon']")
    if (!link) return
    faviconLinkRef.current = link
    if (!originalFaviconHrefRef.current) {
      originalFaviconHrefRef.current = link.href
    }

    if (!count) {
      link.href = originalFaviconHrefRef.current || link.href
      return
    }

    const canvas = document.createElement('canvas')
    const size = 64
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      ctx.clearRect(0, 0, size, size)
      ctx.drawImage(img, 0, 0, size, size)

      const badgeSize = 24
      const badgeX = size - badgeSize - 2
      const badgeY = 2
      ctx.fillStyle = '#ef4444'
      ctx.beginPath()
      ctx.roundRect(badgeX, badgeY, badgeSize, badgeSize, 999)
      ctx.fill()

      ctx.fillStyle = '#ffffff'
      ctx.font = '700 14px Arial'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(Math.min(99, count)), badgeX + badgeSize / 2, badgeY + badgeSize / 2 + 0.5)

      link.href = canvas.toDataURL('image/png')
    }
    img.src = originalFaviconHrefRef.current || link.href
  }

  return (
    <div
      className="brs-messenger-toast-stack"
      aria-live="polite"
      aria-atomic="true"
      data-brs-messenger-ignore-close="true"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`brs-messenger-notice-card ${toast.kind === 'message' ? 'is-message' : 'is-contact'}`}
          role="status"
          data-brs-messenger-ignore-close="true"
        >
          <div className="brs-messenger-notice-icon">
            {toast.kind === 'contact' ? <UserPlus size={18} /> : <MessageSquareText size={18} />}
          </div>
          <div className="brs-messenger-notice-title">{toast.title}</div>
          <div className="brs-messenger-notice-body">{toast.body}</div>
          {toast.actionLabel ? (
            <button className="brs-messenger-notice-action" onClick={() => handleToastAction(toast.action, toast.id)}>
              {toast.actionLabel}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
