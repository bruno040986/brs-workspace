'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { EllipsisVertical, MessageSquareText, MessagesSquare, Paperclip, Search, Send, Users } from 'lucide-react'
import { useMessengerDock } from '@/components/layout/MessengerDockContext'
import { deriveChatStatus, normalizeManualStatus, type ChatStatus } from '@/lib/chat/presence'

type PresenceMode = 'online' | 'busy'

type Contact = {
  id: string
  email: string
  full_name?: string
  short_name?: string
  avatar_url?: string | null
  nickname?: string | null
  status?: ChatStatus
  status_message?: string | null
}

type ChatMessage = {
  id: string
  text: string
  timestamp: string
  sender: {
    id: string
    email: string
    full_name?: string
  }
  text_style?: {
    bold?: boolean
    italic?: boolean
    underline?: boolean
  } | null
  attachments?: Array<{ name?: string; url?: string; size?: number; type?: string }>
  delivery_status?: 'sending' | 'sent' | 'read' | null
}

type Conversation = {
  id: string
  participant: Contact
  lastMessage?: ChatMessage
  unreadCount: number
}

type MyProfile = {
  user: { id: string; name?: string; email?: string; avatar_url?: string | null } | null
  profile: {
    nickname?: string | null
    status?: ChatStatus
    manual_status?: PresenceMode
    status_message?: string | null
    last_seen_at?: string | null
    last_interaction_at?: string | null
    is_visible?: boolean | null
    has_focus?: boolean | null
  } | null
}

type MessengerToast = {
  id: string
  text: string
}

type GoogleChatComponentProps = {
  variant?: 'widget' | 'dock'
}

const statusIcon: Record<ChatStatus, string> = {
  online: '🟢',
  offline: '⚪',
  busy: '⛔',
  away: '🚫',
}

function formatName(label?: string | null) {
  if (!label) return ''
  const parts = label.trim().split(' ').filter(Boolean)
  return parts[0] || ''
}

function displayName(label?: string | null, nickname?: string | null) {
  return nickname || formatName(label) || ''
}

function contactDisplayName(contact: Pick<Contact, 'full_name' | 'email' | 'nickname' | 'short_name'>) {
  return displayName(contact.full_name || contact.email, contact.nickname) || contact.email
}

function conversationDisplayName(contact: Pick<Contact, 'full_name' | 'email' | 'nickname' | 'short_name'>) {
  return displayName(contact.full_name || contact.email, contact.nickname) || contact.email
}

function hasGlobalMessengerNotifier() {
  if (typeof window === 'undefined') return false
  return Boolean((window as Window & { __BRS_MESSENGER_GLOBAL_NOTIFIER__?: boolean }).__BRS_MESSENGER_GLOBAL_NOTIFIER__)
}

export function GoogleChatComponent({ variant = 'widget' }: GoogleChatComponentProps) {
  const isDockVariant = variant === 'dock'
  const messengerDock = useMessengerDock()
  const [activeTab, setActiveTab] = useState<1 | 2 | 3>(1)
  const [isLoading, setIsLoading] = useState(true)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [search, setSearch] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [text, setText] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<Array<{ name: string; url: string; size: number; type: string }>>([])
  const [menuConversationId, setMenuConversationId] = useState<string | null>(null)
  const [myProfile, setMyProfile] = useState<MyProfile>({ user: null, profile: null })
  const [nickname, setNickname] = useState('')
  const [status, setStatus] = useState<PresenceMode>('online')
  const [effectiveStatus, setEffectiveStatus] = useState<ChatStatus>('offline')
  const [statusMessage, setStatusMessage] = useState('')
  const [style, setStyle] = useState<{ bold: boolean; italic: boolean; underline: boolean }>({
    bold: false,
    italic: false,
    underline: false,
  })
  const [popupToasts, setPopupToasts] = useState<MessengerToast[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const heartbeatRef = useRef<number | null>(null)
  const conversationPollRef = useRef<number | null>(null)
  const messagesPollRef = useRef<number | null>(null)
  const contactsPollRef = useRef<number | null>(null)
  const presenceSyncRef = useRef<Promise<void> | null>(null)
  const lastPresenceSyncAtRef = useRef(0)
  const presenceStateRef = useRef<{
    status?: string | null
    last_seen_at?: string | null
    last_interaction_at?: string | null
    is_visible?: boolean | null
    has_focus?: boolean | null
  } | null>(null)
  const activeTabRef = useRef<1 | 2 | 3>(1)
  const selectedConversationIdRef = useRef<string | null>(null)
  const initializedContactsRef = useRef(false)
  const initializedConversationsRef = useRef(false)
  const lastContactStatusRef = useRef<Record<string, ChatStatus>>({})
  const lastUnreadByConversationRef = useRef<Record<string, number>>({})
  const stickToBottomRef = useRef(true)
  const selectedConversation = useMemo<Conversation | null>(() => {
    const activeConversation = messengerDock.activeConversation
    if (!activeConversation) return null
    const found = conversations.find((c) => c.id === activeConversation.id)
    if (found) return found
    return {
      id: activeConversation.id,
      participant: activeConversation.participant,
      unreadCount: 0,
    }
  }, [conversations, messengerDock.activeConversation])

  useEffect(() => {
    bootstrap()
    return () => {
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current)
      if (conversationPollRef.current) window.clearInterval(conversationPollRef.current)
      if (messagesPollRef.current) window.clearInterval(messagesPollRef.current)
      if (contactsPollRef.current) window.clearInterval(contactsPollRef.current)
    }
  }, [])

  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])

  useEffect(() => {
    selectedConversationIdRef.current = messengerDock.activeConversation?.id || null
  }, [messengerDock.activeConversation?.id])

  useEffect(() => {
    const onScrollToBottom = () => {
      if (!selectedConversation) return
      stickToBottomRef.current = true
      setActiveTab(3)
      window.setTimeout(() => {
        scrollMessagesToBottom('smooth')
      }, 50)
    }

    window.addEventListener('brs-messenger:scroll-to-bottom', onScrollToBottom as EventListener)
    return () => window.removeEventListener('brs-messenger:scroll-to-bottom', onScrollToBottom as EventListener)
  }, [selectedConversation])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const updateStickiness = () => {
      stickToBottomRef.current = isNearBottom(container)
    }

    updateStickiness()
    container.addEventListener('scroll', updateStickiness, { passive: true })
    return () => container.removeEventListener('scroll', updateStickiness)
  }, [selectedConversation?.id, activeTab])

  useEffect(() => {
    if (conversationPollRef.current) window.clearInterval(conversationPollRef.current)
    // O Bridge global (layout do dashboard) já faz esse mesmo polling em
    // background; com o painel aberto só precisamos de uma cadência curta
    // pra UI, sem duplicar a carga do Bridge com o mesmo intervalo.
    const interval = hasGlobalMessengerNotifier() ? 5000 : 3000
    conversationPollRef.current = window.setInterval(() => void fetchConversations(), interval)
    return () => {
      if (conversationPollRef.current) window.clearInterval(conversationPollRef.current)
    }
  }, [])

  useEffect(() => {
    if (contactsPollRef.current) window.clearInterval(contactsPollRef.current)
    const interval = hasGlobalMessengerNotifier() ? 6000 : 4000
    contactsPollRef.current = window.setInterval(() => void fetchContacts(), interval)
    return () => {
      if (contactsPollRef.current) window.clearInterval(contactsPollRef.current)
    }
  }, [])

  useEffect(() => {
    if (messagesPollRef.current) window.clearInterval(messagesPollRef.current)
    if (!selectedConversation) return
    messagesPollRef.current = window.setInterval(() => {
      void loadMessages(selectedConversation.id, true)
    }, 2000)
    return () => {
      if (messagesPollRef.current) window.clearInterval(messagesPollRef.current)
    }
  }, [selectedConversation?.id])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const syncVisibility = () => {
      void syncPresenceUpdate({ force: true })
    }

    const syncActivity = () => {
      void syncPresenceUpdate({ activityAt: new Date().toISOString() })
    }

    window.addEventListener('focus', syncVisibility)
    window.addEventListener('blur', syncVisibility)
    document.addEventListener('visibilitychange', syncVisibility)
    window.addEventListener('mousemove', syncActivity, { passive: true })
    window.addEventListener('mousedown', syncActivity, { passive: true })
    window.addEventListener('keydown', syncActivity)
    window.addEventListener('touchstart', syncActivity, { passive: true })
    window.addEventListener('scroll', syncActivity, { passive: true })

    return () => {
      window.removeEventListener('focus', syncVisibility)
      window.removeEventListener('blur', syncVisibility)
      document.removeEventListener('visibilitychange', syncVisibility)
      window.removeEventListener('mousemove', syncActivity)
      window.removeEventListener('mousedown', syncActivity)
      window.removeEventListener('keydown', syncActivity)
      window.removeEventListener('touchstart', syncActivity)
      window.removeEventListener('scroll', syncActivity)
    }
  }, [])

  async function bootstrap() {
    setIsLoading(true)
    await Promise.all([fetchMyProfile(), fetchContacts(), fetchConversations()])
    await syncPresenceUpdate({ activityAt: new Date().toISOString(), force: true })
    heartbeatRef.current = window.setInterval(() => void syncPresenceUpdate(), 60000)
    setIsLoading(false)
  }

  async function fetchMyProfile() {
    const response = await fetch('/api/chat/profile')
    const data = await response.json()
    if (!response.ok) return
    setMyProfile(data)
    setNickname(data.profile?.nickname || '')
    setStatus(normalizeManualStatus(data.profile?.manual_status || data.profile?.status))
    setEffectiveStatus((data.profile?.status || 'offline') as ChatStatus)
    presenceStateRef.current = data.profile
    setStatusMessage(data.profile?.status_message || '')
  }

  async function syncPresenceUpdate(options: { activityAt?: string; force?: boolean } = {}) {
    if (presenceSyncRef.current && !options.force) return presenceSyncRef.current

    const now = Date.now()
    if (!options.force && now - lastPresenceSyncAtRef.current < 15000) return

    const presencePromise: Promise<void> = fetch('/api/chat/presence', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        visibility_state: document.visibilityState,
        has_focus: document.hasFocus(),
        activity_at: options.activityAt || null,
      }),
    })
      .then(() => undefined)
      .catch(() => undefined)

    presenceSyncRef.current = presencePromise.finally(() => {
      presenceSyncRef.current = null
    })
    lastPresenceSyncAtRef.current = now
    await presencePromise

    const nowIso = new Date().toISOString()
    const currentPresence = presenceStateRef.current || {}
    const snapshot = {
      status,
      last_seen_at: nowIso,
      last_interaction_at: options.activityAt || currentPresence.last_interaction_at || currentPresence.last_seen_at || null,
      is_visible: document.visibilityState === 'visible',
      has_focus: document.hasFocus(),
    }
    presenceStateRef.current = snapshot
    setEffectiveStatus(deriveChatStatus(snapshot, Date.now()))
  }

  async function fetchContacts() {
    const response = await fetch('/api/chat/contacts')
    const data = await response.json()
    const nextContacts = Array.isArray(data) ? (data as Contact[]) : []

    if (initializedContactsRef.current) {
      const previous = lastContactStatusRef.current
      for (const contact of nextContacts) {
        const prevStatus = previous[contact.id] || 'offline'
        const nextStatus = (contact.status || 'offline') as ChatStatus
        if (prevStatus === 'offline' && nextStatus !== 'offline') {
          const label = displayName(contact.full_name || contact.email, contact.nickname)
          if (!hasGlobalMessengerNotifier()) {
            pushToast(`${label} acabou de entrar.`)
          }
        }
      }
    }

    const statusMap: Record<string, ChatStatus> = {}
    for (const c of nextContacts) {
      statusMap[c.id] = (c.status || 'offline') as ChatStatus
    }
    lastContactStatusRef.current = statusMap
    initializedContactsRef.current = true
    setContacts(nextContacts)
  }

  async function fetchConversations() {
    const response = await fetch('/api/chat/conversations')
    const data = await response.json()
    const nextConversations = Array.isArray(data) ? (data as Conversation[]) : []

    if (initializedConversationsRef.current) {
      const previousUnread = lastUnreadByConversationRef.current
      for (const conv of nextConversations) {
        const prev = previousUnread[conv.id] || 0
        const next = conv.unreadCount || 0
        const hasNewUnread = next > prev
        if (!hasNewUnread) continue

        const isCurrentChatOpen =
          activeTabRef.current === 3 &&
          selectedConversationIdRef.current === conv.id &&
          !document.hidden

        if (!isCurrentChatOpen && !hasGlobalMessengerNotifier()) {
          const label = displayName(conv.participant.full_name || conv.participant.email, conv.participant.nickname)
          pushToast(`${label} te enviou uma mensagem.`)
        }
      }
    }

    const unreadMap: Record<string, number> = {}
    for (const conv of nextConversations) {
      unreadMap[conv.id] = conv.unreadCount || 0
    }
    lastUnreadByConversationRef.current = unreadMap
    initializedConversationsRef.current = true
    setConversations(nextConversations)
  }

  function pushToast(text: string) {
    if (hasGlobalMessengerNotifier()) return
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setPopupToasts((prev) => {
      const next = [...prev, { id, text }]
      return next.slice(-4)
    })
    window.setTimeout(() => {
      setPopupToasts((prev) => prev.filter((t) => t.id !== id))
    }, 4800)
  }

  async function saveProfile() {
    await fetch('/api/chat/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: nickname || null,
        status,
        status_message: statusMessage || null,
      }),
    })
    await Promise.all([fetchMyProfile(), fetchContacts(), fetchConversations()])
  }

  async function openConversation(contact: Contact) {
    let conversation = conversations.find((c) => c.participant.id === contact.id) || null
    if (!conversation) {
      const response = await fetch('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: contact.id }),
      })
      const data = await response.json()
      if (!response.ok || !data?.id) return
      await fetchConversations()
      conversation = {
        id: data.id,
        participant: contact,
        unreadCount: 0,
      }
    }
    messengerDock.setActiveConversation({
      id: conversation.id,
      participant: contact,
    })
    setActiveTab(3)
    stickToBottomRef.current = true
    await loadMessages(conversation.id)
  }

  async function loadMessages(conversationId: string, silent = false) {
    if (!silent) setLoadingMessages(true)
    const response = await fetch(`/api/chat/messages?conversationId=${conversationId}`)
    const data = await response.json()
    if (Array.isArray(data)) {
      setMessages(data)
    }
    if (!silent) setLoadingMessages(false)
    const shouldStickToBottom = !silent || stickToBottomRef.current
    if (shouldStickToBottom) {
      setTimeout(() => {
        scrollMessagesToBottom('auto')
      }, 50)
    }
    await fetchConversations()
  }

  async function sendMessage() {
    if (!selectedConversation) return
    if (!text.trim() && attachedFiles.length === 0) return
    const optimisticId = `temp-${Date.now()}`
    const optimisticMessage: ChatMessage = {
      id: optimisticId,
      text: text.trim() || '[Arquivo]',
      timestamp: new Date().toISOString(),
      sender: {
        id: myProfile.user?.id || 'me',
        email: myProfile.user?.email || '',
        full_name: myProfile.user?.name,
      },
      text_style: style,
      attachments: attachedFiles,
      delivery_status: 'sending',
    }
    setMessages((prev) => [...prev, optimisticMessage])
    setIsSending(true)
    const response = await fetch('/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: selectedConversation.id,
        text: text.trim() || '[Arquivo]',
        textStyle: style,
        attachments: attachedFiles,
      }),
    })
    const data = await response.json()
    setIsSending(false)
    if (!response.ok) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
      return
    }
    setMessages((prev) => prev.map((m) => (m.id === optimisticId ? data : m)))
    setText('')
    setAttachedFiles([])
    stickToBottomRef.current = true
    setTimeout(() => {
      scrollMessagesToBottom('auto')
    }, 50)
    await fetchConversations()
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!isSending && (text.trim() || attachedFiles.length > 0)) {
        void sendMessage()
      }
    }
  }

  async function onPickFile(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    for (const file of Array.from(fileList)) {
      if (file.size > 15 * 1024 * 1024) {
        alert(`Arquivo ${file.name} excede 15MB.`)
        continue
      }
      const form = new FormData()
      form.append('file', file)
      const response = await fetch('/api/chat/upload', { method: 'POST', body: form })
      const uploaded = await response.json()
      if (response.ok) {
        setAttachedFiles((prev) => [...prev, uploaded])
      }
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData.items
    const files: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length > 0) {
      e.preventDefault()
      const dt = new DataTransfer()
      files.forEach((f) => dt.items.add(f))
      void onPickFile(dt.files)
    }
  }

  function isNearBottom(container: HTMLDivElement) {
    const threshold = 120
    return container.scrollHeight - (container.scrollTop + container.clientHeight) < threshold
  }

  function scrollMessagesToBottom(behavior: ScrollBehavior = 'auto') {
    const container = messagesContainerRef.current
    if (!container) return
    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    })
    stickToBottomRef.current = true
  }

  async function deleteConversation(id: string) {
    // soft local removal (historico na base pode ser mantido)
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (selectedConversation?.id === id) {
      messengerDock.setActiveConversation(null)
      setMessages([])
      setActiveTab(2)
    }
  }

  const onlineContacts = useMemo(
    () => contacts.filter((c) => (c.status || 'offline') !== 'offline' && `${contactDisplayName(c) || c.email}`.toLowerCase().includes(search.toLowerCase())),
    [contacts, search],
  )
  const offlineContacts = useMemo(
    () => contacts.filter((c) => (c.status || 'offline') === 'offline' && `${contactDisplayName(c) || c.email}`.toLowerCase().includes(search.toLowerCase())),
    [contacts, search],
  )
  const filteredConversations = useMemo(
    () =>
      conversations.filter((c) =>
        `${conversationDisplayName(c.participant) || c.participant.email}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [conversations, search],
  )

  const unreadTotal = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0)
  const myNameDefault = formatName(myProfile.user?.name || myProfile.user?.email || '')
  const myNameDisplay = nickname || myNameDefault

  if (isLoading) return <div className="text-sm text-gray-500 py-4">Carregando BRS Messenger...</div>

  return (
    <div
      className={`brs-messenger rounded-[2px] overflow-hidden ${isDockVariant ? 'brs-messenger-dock-widget' : ''}`}
      style={{
        fontFamily: 'Tahoma, Geneva, sans-serif',
        height: isDockVariant ? '100%' : 460,
        minHeight: isDockVariant ? 0 : undefined,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className="brs-messenger-titlebar">
        <div className="brs-messenger-titlebar-left">
          BRS Messenger
        </div>
        <div className="brs-messenger-titlebar-status">{statusIcon[effectiveStatus]}</div>
      </div>

      <div className="brs-messenger-searchbar">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Localizar contato..."
            className="brs-messenger-search-input"
          />
        </div>
      </div>

      <div className="brs-messenger-tabs">
        <button
          className={`brs-messenger-tab ${activeTab === 1 ? 'is-active' : ''}`}
          onClick={() => setActiveTab(1)}
        >
          <Users size={12} />
          <span>Perfil e Contatos</span>
        </button>
        <button
          className={`brs-messenger-tab ${activeTab === 2 ? 'is-active' : ''}`}
          onClick={() => setActiveTab(2)}
        >
          <MessagesSquare size={12} />
          <span>Conversas</span>
          {unreadTotal > 0 && <span className="ml-1 inline-flex min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] items-center justify-center">{unreadTotal}</span>}
        </button>
        <button className={`brs-messenger-tab ${activeTab === 3 ? 'is-active' : ''}`} onClick={() => setActiveTab(3)} disabled={!selectedConversation}>
          <MessageSquareText size={12} />
          <span>Chat</span>
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0 }} className="brs-messenger-body">
        {activeTab === 1 && (
          <div className="brs-messenger-tab-panel brs-messenger-profile-panel">
            <div className="brs-messenger-profile-card">
              <div className="flex gap-2">
                <div className="brs-messenger-profile-avatar">
                  {myProfile.user?.avatar_url ? <img src={myProfile.user.avatar_url} alt={myNameDefault} className="w-full h-full object-cover" /> : myNameDefault.charAt(0)}
                </div>
                <div className="flex-1">
                  <div className="brs-messenger-profile-name">{myNameDisplay}</div>
                  <input
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value.slice(0, 40))}
                    placeholder="Nickname do Messenger"
                    className="brs-messenger-profile-input"
                  />
                </div>
              </div>
              <div className="mt-2">
                <select value={status} onChange={(e) => setStatus(e.target.value as PresenceMode)} className="brs-messenger-select">
                  <option value="online">Automático</option>
                  <option value="busy">Ocupado</option>
                </select>
              </div>
              <input
                value={statusMessage}
                onChange={(e) => setStatusMessage(e.target.value.slice(0, 50))}
                placeholder="Mensagem de status (max 50)"
                className="brs-messenger-profile-input mt-2"
              />
              <button onClick={saveProfile} className="brs-messenger-primary-button mt-2 w-full py-1">
                Salvar Perfil
              </button>
            </div>

            <div className="brs-messenger-group">
              <div className="brs-messenger-group-header">Ativos ({onlineContacts.length})</div>
              <div className="brs-messenger-group-list">
                {onlineContacts.map((c) => (
                  <button
                    key={c.id}
                    onDoubleClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      void openConversation(c)
                    }}
                    className={`brs-messenger-contact ${selectedConversation?.participant.id === c.id ? 'is-active' : ''}`}
                  >
                    <span className="brs-messenger-contact-status">{statusIcon[(c.status as ChatStatus) || 'online']}</span>{' '}
                    <span className="brs-messenger-contact-name">{contactDisplayName(c)}</span>
                    {c.status === 'busy' ? ' ⛔' : c.status === 'away' ? ' 🚫' : ''}
                    {c.status_message ? <span className="brs-messenger-contact-status-message"> - {c.status_message}</span> : null}
                  </button>
                ))}
                {onlineContacts.length === 0 && <div className="brs-messenger-empty-state">Sem contatos ativos.</div>}
              </div>
            </div>

            <div className="brs-messenger-group">
              <div className="brs-messenger-group-header">Offline ({offlineContacts.length})</div>
              <div className="brs-messenger-group-list">
                {offlineContacts.map((c) => (
                  <button
                    key={c.id}
                    onDoubleClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      void openConversation(c)
                    }}
                    className={`brs-messenger-contact ${selectedConversation?.participant.id === c.id ? 'is-active' : ''}`}
                  >
                    <span className="brs-messenger-contact-status">{statusIcon.offline}</span>{' '}
                    <span className="brs-messenger-contact-name is-offline">{contactDisplayName(c)}</span>
                  </button>
                ))}
                {offlineContacts.length === 0 && <div className="brs-messenger-empty-state">Sem contatos offline.</div>}
              </div>
            </div>
          </div>
        )}

        {activeTab === 2 && (
          <div className="brs-messenger-tab-panel brs-messenger-conversation-panel">
            {filteredConversations.map((conv) => (
              <div
                key={conv.id}
                onDoubleClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  void openConversation(conv.participant)
                }}
                className={`brs-messenger-conversation ${selectedConversation?.id === conv.id ? 'is-active' : ''}`}
              >
                <div className="flex items-start gap-2">
                  <div className="brs-messenger-avatar">
                    {conv.participant.avatar_url ? (
                      <img src={conv.participant.avatar_url} alt={conv.participant.full_name || conv.participant.email} className="w-full h-full object-cover" />
                    ) : (
                      (conversationDisplayName(conv.participant) ||
                        conv.participant.email ||
                        '?').charAt(0)
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between gap-2">
                      <p className="brs-messenger-conversation-name">{conversationDisplayName(conv.participant) || conv.participant.email}</p>
                      <div className="relative">
                        <button onClick={() => setMenuConversationId(menuConversationId === conv.id ? null : conv.id)} className="text-gray-500 hover:text-gray-700">
                          <EllipsisVertical size={14} />
                        </button>
                        {menuConversationId === conv.id && (
                          <div className="absolute right-0 top-5 brs-messenger-menu border rounded shadow z-10">
                            <button
                              className="block px-3 py-1.5 text-xs hover:bg-slate-100 w-full text-left"
                              onClick={() => {
                                setMenuConversationId(null)
                                void openConversation(conv.participant)
                              }}
                            >
                              Abrir Conversa
                            </button>
                            <button
                              className="block px-3 py-1.5 text-xs hover:bg-slate-100 w-full text-left text-red-700"
                              onClick={() => {
                                setMenuConversationId(null)
                                void deleteConversation(conv.id)
                              }}
                            >
                              Excluir
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <p className="brs-messenger-conversation-preview">{conv.lastMessage?.text || 'Sem mensagens ainda.'}</p>
                  </div>
                  {conv.unreadCount > 0 ? <span className="bg-red-600 text-white text-[10px] rounded-full px-1.5 py-0.5">{conv.unreadCount}</span> : null}
                </div>
              </div>
            ))}
            {filteredConversations.length === 0 && <div className="brs-messenger-empty-state">Nenhuma conversa.</div>}
          </div>
        )}

        {activeTab === 3 && (
          <div className="h-full flex flex-col min-h-0 brs-messenger-chat-shell">
            {!selectedConversation ? (
              <div className="p-4 text-sm text-gray-500">Abra uma conversa pela aba de Contatos ou Conversas.</div>
            ) : (
              <>
                <div className="brs-messenger-chat-head text-sm font-semibold flex items-center gap-2">
                  <MessageSquareText size={14} />
                  <span className="brs-messenger-chat-head-name">
                    {displayName(
                      selectedConversation.participant.full_name || selectedConversation.participant.email,
                      selectedConversation.participant.nickname,
                    ) || selectedConversation.participant.email}
                  </span>
                  {selectedConversation.participant.status_message ? (
                    <span className="brs-messenger-chat-head-status-message">
                      — {selectedConversation.participant.status_message}
                    </span>
                  ) : null}
                </div>
                <div ref={messagesContainerRef} className="flex-1 min-h-0 overflow-y-auto p-3 brs-messenger-chat-scroll">
                  {loadingMessages ? (
                    <div className="text-xs text-gray-500">Carregando mensagens...</div>
                  ) : (
                    <div className="space-y-2">
                      {messages.map((m) => {
                        const mine = m.sender.id === myProfile.user?.id
                        return (
                          <div key={m.id} className={`flex min-w-0 ${mine ? 'justify-end' : 'justify-start'}`}>
                            <div className={`brs-messenger-message-bubble ${mine ? 'is-mine' : 'is-theirs'}`}>
                              <div
                                style={{
                                  fontWeight: m.text_style?.bold ? 700 : 400,
                                  fontStyle: m.text_style?.italic ? 'italic' : 'normal',
                                  textDecoration: m.text_style?.underline ? 'underline' : 'none',
                                  whiteSpace: 'pre-wrap',
                                }}
                              >
                                {m.text}
                              </div>
                              {Array.isArray(m.attachments) && m.attachments.length > 0 && (
                                <div className="mt-1 space-y-1">
                                  {m.attachments.map((a, idx) => (
                                    <a key={`${m.id}-att-${idx}`} href={a.url || '#'} target="_blank" className="block text-[11px] brs-messenger-attachment-link underline">
                                      📎 {a.name || 'anexo'}
                                    </a>
                                  ))}
                                </div>
                              )}
                              <div className="brs-messenger-message-meta mt-1 text-gray-500">
                                {new Date(m.timestamp).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                                {mine ? (
                                  <>
                                    {' '}
                                    {m.delivery_status === 'sending'
                                      ? '⏱️ enviando'
                                      : m.delivery_status === 'read'
                                        ? '✔️✔️ lido'
                                        : '✔️ enviado'}
                                  </>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </div>
                <div className="border-t p-2 brs-messenger-editor space-y-2">
                  <div className="brs-messenger-toolbar">
                    <button className={`brs-messenger-toolbar-btn ${style.bold ? 'is-active' : ''}`} onClick={() => setStyle((s) => ({ ...s, bold: !s.bold }))}>
                      B
                    </button>
                    <button className={`brs-messenger-toolbar-btn ${style.italic ? 'is-active' : ''}`} onClick={() => setStyle((s) => ({ ...s, italic: !s.italic }))}>
                      I
                    </button>
                    <button className={`brs-messenger-toolbar-btn ${style.underline ? 'is-active' : ''}`} onClick={() => setStyle((s) => ({ ...s, underline: !s.underline }))}>
                      U
                    </button>
                    <label className="brs-messenger-toolbar-btn brs-messenger-toolbar-file" title="Enviar arquivo">
                      <Paperclip size={12} />
                      <input type="file" className="hidden" onChange={(e) => void onPickFile(e.target.files)} />
                    </label>
                  </div>
                  {attachedFiles.length > 0 && (
                    <div className="text-[11px] text-gray-600">
                      {attachedFiles.map((f, i) => (
                        <div key={`${f.url}-${i}`}>📎 {f.name}</div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onPaste={onPaste}
                      onKeyDown={onComposerKeyDown}
                      className="brs-messenger-composer-input"
                      placeholder="Digite sua mensagem, cole texto ou imagem..."
                    />
                    <button onClick={sendMessage} disabled={isSending || (!text.trim() && attachedFiles.length === 0)} className="brs-messenger-primary-button brs-messenger-send-button">
                      <Send size={14} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="brs-messenger-toast-stack" aria-live="polite" data-brs-messenger-ignore-close="true">
        {popupToasts.map((toast) => (
          <div key={toast.id} className="brs-messenger-toast-item" data-brs-messenger-ignore-close="true">
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  )
}
