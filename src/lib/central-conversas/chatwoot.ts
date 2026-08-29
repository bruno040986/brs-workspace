/**
 * Client mínimo da API do Chatwoot (Application API, token da CONTA) pro
 * Workspace: caixas de entrada nativas (360dialog, site), listagem de
 * conversas/mensagens pra Central de Conversas. Env: CHATWOOT_URL.
 */

function base(): string {
  return String(process.env.CHATWOOT_URL || 'https://chat.brspromotora.com.br').replace(/\/$/, '')
}

export class ChatwootConta {
  constructor(
    readonly accountId: number,
    private readonly token: string,
  ) {}

  async req<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const res = await fetch(`${base()}/api/v1/accounts/${this.accountId}${path}`, {
      method: init?.method || 'GET',
      headers: { api_access_token: this.token, 'Content-Type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Chatwoot HTTP ${res.status} em ${path}: ${text.slice(0, 200)}`)
    return (text ? JSON.parse(text) : {}) as T
  }

  listarInboxes() {
    return this.req<{ payload: Array<{ id: number; name: string; channel_type: string; website_token?: string; phone_number?: string }> }>('/inboxes').then((r) => r.payload || [])
  }

  /** WhatsApp oficial via 360dialog (nativo do Chatwoot). */
  criarInbox360dialog(input: { nome: string; telefone: string; apiKey: string }) {
    return this.req<{ id: number }>('/inboxes', {
      method: 'POST',
      body: { name: input.nome, channel: { type: 'whatsapp', provider: 'default', phone_number: input.telefone, provider_config: { api_key: input.apiKey } } },
    })
  }

  /** Chat de site (widget). Devolve website_token pro script. */
  criarInboxSite(input: { nome: string; siteUrl: string; corPrimaria?: string; boasVindas?: string }) {
    return this.req<{ id: number; website_token: string }>('/inboxes', {
      method: 'POST',
      body: {
        name: input.nome,
        channel: {
          type: 'web_widget',
          website_url: input.siteUrl,
          widget_color: input.corPrimaria || '#e90541',
          welcome_title: input.boasVindas || 'Olá! Como podemos ajudar?',
        },
      },
    })
  }

  listarConversas(params: { status?: 'open' | 'resolved' | 'pending' | 'all'; assigneeType?: 'me' | 'unassigned' | 'all'; page?: number; q?: string }) {
    const s = new URLSearchParams()
    s.set('status', params.status || 'open')
    s.set('assignee_type', params.assigneeType || 'all')
    s.set('page', String(params.page || 1))
    if (params.q) s.set('q', params.q)
    return this.req<{ data: { meta: Record<string, number>; payload: ChatwootConversa[] } }>(`/conversations?${s.toString()}`).then((r) => r.data)
  }

  mensagens(conversationId: number, before?: number) {
    const s = before ? `?before=${before}` : ''
    return this.req<{ payload: ChatwootMensagem[]; meta: Record<string, unknown> }>(`/conversations/${conversationId}/messages${s}`)
  }

  enviarMensagem(conversationId: number, content: string, privada = false) {
    return this.req<{ id: number }>(`/conversations/${conversationId}/messages`, { method: 'POST', body: { content, message_type: 'outgoing', private: privada } })
  }

  atribuir(conversationId: number, assigneeId: number | null) {
    return this.req(`/conversations/${conversationId}/assignments`, { method: 'POST', body: { assignee_id: assigneeId } })
  }

  mudarStatus(conversationId: number, status: 'open' | 'resolved' | 'pending') {
    return this.req(`/conversations/${conversationId}/toggle_status`, { method: 'POST', body: { status } })
  }

  agentes() {
    return this.req<Array<{ id: number; name: string; email: string; availability_status?: string }>>('/agents')
  }

  perfil() {
    return fetch(`${base()}/api/v1/profile`, { headers: { api_access_token: this.token } }).then(async (r) => (r.ok ? ((await r.json()) as { id: number; name: string; email: string }) : null))
  }
}

export type ChatwootConversa = {
  id: number
  inbox_id: number
  status: string
  unread_count: number
  last_activity_at: number
  messages?: ChatwootMensagem[]
  meta: { sender?: { id: number; name: string; phone_number?: string | null; thumbnail?: string; identifier?: string }; assignee?: { id: number; name: string } | null; channel?: string }
  last_non_activity_message?: ChatwootMensagem | null
}

export type ChatwootMensagem = {
  id: number
  content: string | null
  message_type: number // 0 incoming, 1 outgoing, 2 activity, 3 template
  created_at: number
  private: boolean
  sender?: { id?: number; name?: string; type?: string } | null
  attachments?: Array<{ id: number; file_type: string; data_url: string }>
  content_attributes?: Record<string, unknown>
}
