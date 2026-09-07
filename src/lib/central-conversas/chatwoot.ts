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

  async req<T>(path: string, init?: { method?: string; body?: unknown; form?: FormData; timeoutMs?: number }): Promise<T> {
    const headers: Record<string, string> = { api_access_token: this.token }
    let body: BodyInit | undefined
    if (init?.form) {
      // Multipart (anexos): o fetch do Node 20+ monta o boundary sozinho.
      body = init.form
    } else if (init?.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(init.body)
    }
    const res = await fetch(`${base()}/api/v1/accounts/${this.accountId}${path}`, {
      method: init?.method || 'GET',
      headers,
      body,
      signal: AbortSignal.timeout(init?.timeoutMs ?? 20_000),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Chatwoot HTTP ${res.status} em ${path}: ${text.slice(0, 200)}`)
    return (text ? JSON.parse(text) : {}) as T
  }

  listarInboxes() {
    return this.req<{ payload: Array<{ id: number; name: string; channel_type: string; website_token?: string; phone_number?: string }> }>('/inboxes').then((r) => r.payload || [])
  }

  /** Adiciona um agente como membro de uma inbox (aditivo, não substitui o conjunto). */
  adicionarMembroInbox(inboxId: number, userId: number) {
    return this.req('/inbox_members', { method: 'POST', body: { inbox_id: inboxId, user_ids: [userId] } })
  }

  /** Adiciona um agente à conta (cria o usuário no Chatwoot se não existir, ou anexa o existente pelo e-mail). */
  criarAgente(input: { nome: string; email: string }) {
    return this.req<{ id: number; name: string; email: string }>('/agents', {
      method: 'POST',
      body: { name: input.nome, email: input.email, role: 'agent', availability_status: 'available', auto_offline: false },
    })
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

  listarConversas(params: { status?: 'open' | 'resolved' | 'pending' | 'all'; assigneeType?: 'me' | 'unassigned' | 'all'; page?: number; q?: string; inboxId?: number; teamId?: number }) {
    const s = new URLSearchParams()
    s.set('status', params.status || 'open')
    s.set('assignee_type', params.assigneeType || 'all')
    s.set('page', String(params.page || 1))
    if (params.q) s.set('q', params.q)
    if (params.inboxId) s.set('inbox_id', String(params.inboxId))
    if (params.teamId) s.set('team_id', String(params.teamId))
    return this.req<{ data: { meta: Record<string, number>; payload: ChatwootConversa[] } }>(`/conversations?${s.toString()}`).then((r) => r.data)
  }

  /** Contadores por aba (mine/unassigned/assigned/all), opcionalmente por departamento. */
  metaConversas(params: { teamId?: number; status?: 'open' | 'resolved' | 'pending' | 'all' } = {}) {
    const s = new URLSearchParams()
    s.set('status', params.status || 'open')
    if (params.teamId) s.set('team_id', String(params.teamId))
    return this.req<{ meta: { mine_count: number; unassigned_count: number; assigned_count: number; all_count: number } }>(`/conversations/meta?${s.toString()}`).then((r) => r.meta)
  }

  mensagens(conversationId: number, before?: number) {
    const s = before ? `?before=${before}` : ''
    return this.req<{ payload: ChatwootMensagem[]; meta: Record<string, unknown> }>(`/conversations/${conversationId}/messages${s}`)
  }

  /**
   * `contentAttributes` é um contrato NOSSO com o engine (não é campo
   * documentado do Chatwoot — eles só guardam o objeto e devolvem de volta).
   * Usado hoje pra `in_reply_to` (responder citando): o engine lê no webhook
   * `message_created` e mapeia pro `quoted` do Baileys.
   */
  enviarMensagem(conversationId: number, content: string, privada = false, contentAttributes?: Record<string, unknown>) {
    const body: Record<string, unknown> = { content, message_type: 'outgoing', private: privada }
    if (contentAttributes) body.content_attributes = contentAttributes
    return this.req<{ id: number }>(`/conversations/${conversationId}/messages`, { method: 'POST', body })
  }

  /**
   * Mensagem outgoing com anexo (multipart `attachments[]`). `legenda` vira o
   * `content` da mensagem (opcional). FormData/Blob nativos do Node 20+.
   */
  enviarMensagemComAnexo(conversationId: number, file: { nome: string; mime: string; bytes: Buffer }, legenda?: string) {
    const form = new FormData()
    if (legenda) form.set('content', legenda)
    form.set('message_type', 'outgoing')
    form.set('private', 'false')
    form.append('attachments[]', new Blob([new Uint8Array(file.bytes)], { type: file.mime }), file.nome)
    return this.req<{ id: number }>(`/conversations/${conversationId}/messages`, { method: 'POST', form, timeoutMs: 60_000 })
  }

  /** Nota interna (só o time vê; nunca vai pro WhatsApp). */
  notaInterna(conversationId: number, texto: string) {
    return this.enviarMensagem(conversationId, texto, true)
  }

  /** Labels cadastradas na conta (tags disponíveis). */
  listarLabelsConta() {
    return this.req<{ payload: Array<{ id: number; title: string; description: string | null; color: string | null }> }>('/labels').then((r) => r.payload || [])
  }

  labelsDaConversa(conversationId: number) {
    return this.req<{ payload: string[] }>(`/conversations/${conversationId}/labels`).then((r) => r.payload || [])
  }

  /** Substitui o CONJUNTO de labels da conversa (comportamento do endpoint do Chatwoot). */
  setLabelsDaConversa(conversationId: number, labels: string[]) {
    return this.req<{ payload: string[] }>(`/conversations/${conversationId}/labels`, { method: 'POST', body: { labels } }).then((r) => r.payload || [])
  }

  labelsDoContato(contactId: number) {
    return this.req<{ payload: string[] }>(`/contacts/${contactId}/labels`).then((r) => r.payload || [])
  }

  /** Substitui o CONJUNTO de labels do contato. */
  setLabelsDoContato(contactId: number, labels: string[]) {
    return this.req<{ payload: string[] }>(`/contacts/${contactId}/labels`, { method: 'POST', body: { labels } }).then((r) => r.payload || [])
  }

  criarLabel(input: { titulo: string; cor: string; descricao?: string }) {
    return this.req<{ id: number; title: string; color: string | null; description: string | null }>('/labels', {
      method: 'POST',
      body: { title: input.titulo, color: input.cor, description: input.descricao || '', show_on_sidebar: true },
    })
  }

  atualizarLabel(labelId: number, input: { titulo?: string; cor?: string; descricao?: string }) {
    const body: Record<string, unknown> = {}
    if (input.titulo !== undefined) body.title = input.titulo
    if (input.cor !== undefined) body.color = input.cor
    if (input.descricao !== undefined) body.description = input.descricao
    return this.req(`/labels/${labelId}`, { method: 'PATCH', body })
  }

  excluirLabel(labelId: number) {
    return this.req(`/labels/${labelId}`, { method: 'DELETE' })
  }

  /** Histórico de chamados do contato (Digisac): conversas por conexão/departamento/protocolo. */
  conversasDoContato(contactId: number) {
    return this.req<{ payload: ChatwootConversa[] }>(`/contacts/${contactId}/conversations`).then((r) => r.payload || [])
  }

  silenciar(conversationId: number, silenciar: boolean) {
    return this.req(`/conversations/${conversationId}/${silenciar ? 'mute' : 'unmute'}`, { method: 'POST', body: {} })
  }

  marcarNaoLida(conversationId: number) {
    return this.req(`/conversations/${conversationId}/unread`, { method: 'POST', body: {} })
  }

  /** Respostas rápidas (canned responses) da conta. */
  respostasRapidas() {
    return this.req<Array<{ id: number; short_code: string; content: string }>>('/canned_responses')
  }

  /**
   * Atribui a conversa a um agente e/ou a um departamento (Team). A API do
   * Chatwoot ignora `team_id` quando `assignee_id` vem NA MESMA requisição —
   * por isso, quando os dois são passados, disparamos duas chamadas em
   * sequência (departamento primeiro, depois agente) pra garantir que os
   * dois colem.
   */
  async atribuir(conversationId: number, params: { assigneeId?: number | null; teamId?: number | null }) {
    if (params.teamId !== undefined) {
      await this.req(`/conversations/${conversationId}/assignments`, { method: 'POST', body: { team_id: params.teamId } })
    }
    if (params.assigneeId !== undefined) {
      await this.req(`/conversations/${conversationId}/assignments`, { method: 'POST', body: { assignee_id: params.assigneeId } })
    }
    return { ok: true }
  }

  // ---------------------------------------------------------------------
  // Teams (departamentos) — espelhados em chat_departamentos.
  // ---------------------------------------------------------------------

  listarTeams() {
    return this.req<ChatwootTeam[]>('/teams')
  }

  criarTeam(input: { nome: string; descricao?: string; distribuicaoAutomatica?: boolean }) {
    return this.req<ChatwootTeam>('/teams', {
      method: 'POST',
      body: { name: input.nome, description: input.descricao || '', allow_auto_assign: Boolean(input.distribuicaoAutomatica) },
    })
  }

  atualizarTeam(teamId: number, input: { nome?: string; descricao?: string; distribuicaoAutomatica?: boolean }) {
    const body: Record<string, unknown> = {}
    if (input.nome !== undefined) body.name = input.nome
    if (input.descricao !== undefined) body.description = input.descricao
    if (input.distribuicaoAutomatica !== undefined) body.allow_auto_assign = input.distribuicaoAutomatica
    return this.req<ChatwootTeam>(`/teams/${teamId}`, { method: 'PATCH', body })
  }

  membrosTeam(teamId: number) {
    return this.req<Array<{ id: number; name: string; email: string }>>(`/teams/${teamId}/team_members`)
  }

  adicionarMembrosTeam(teamId: number, userIds: number[]) {
    if (!userIds.length) return Promise.resolve()
    return this.req(`/teams/${teamId}/team_members`, { method: 'POST', body: { user_ids: userIds } })
  }

  removerMembrosTeam(teamId: number, userIds: number[]) {
    if (!userIds.length) return Promise.resolve()
    return this.req(`/teams/${teamId}/team_members`, { method: 'DELETE', body: { user_ids: userIds } })
  }

  /**
   * Ajusta a disponibilidade (online/busy/offline) de UM agente específico.
   * A API exige reenviar o `role` atual (senão rebaixaria/promoveria sem
   * querer) — por isso pede o role de quem chama antes de setar.
   */
  atualizarDisponibilidadeAgente(agentId: number, role: 'agent' | 'administrator', availability: 'online' | 'busy' | 'offline') {
    return this.req(`/agents/${agentId}`, { method: 'PATCH', body: { role, availability } })
  }

  mudarStatus(conversationId: number, status: 'open' | 'resolved' | 'pending') {
    return this.req(`/conversations/${conversationId}/toggle_status`, { method: 'POST', body: { status } })
  }

  agentes() {
    return this.req<Array<{ id: number; name: string; email: string; role?: 'agent' | 'administrator'; availability_status?: string }>>('/agents')
  }

  /** Aba "Contatos" (Digisac): busca por nome/e-mail/telefone; sem termo, lista os contatos "resolvidos". */
  listarContatos(params: { q?: string; page?: number }) {
    const page = params.page || 1
    const termo = params.q?.trim()
    const path = termo ? `/contacts/search?q=${encodeURIComponent(termo)}&page=${page}` : `/contacts?page=${page}`
    return this.req<{ payload: Array<{ id: number; name: string; phone_number: string | null; email: string | null; thumbnail?: string }> }>(path).then((r) => r.payload || [])
  }

  perfil() {
    return fetch(`${base()}/api/v1/profile`, { headers: { api_access_token: this.token } }).then(async (r) => (r.ok ? ((await r.json()) as { id: number; name: string; email: string }) : null))
  }
}

export type ChatwootTeam = { id: number; name: string; description: string | null; allow_auto_assign: boolean }

export type ChatwootConversa = {
  id: number
  inbox_id: number
  status: string
  unread_count: number
  last_activity_at: number
  created_at?: number
  waiting_since?: number
  labels?: string[]
  muted?: boolean
  messages?: ChatwootMensagem[]
  meta: {
    sender?: { id: number; name: string; phone_number?: string | null; thumbnail?: string; identifier?: string }
    assignee?: { id: number; name: string } | null
    // Não documentado no OpenAPI oficial do Chatwoot mas presente na prática
    // (o próprio dashboard deles usa pra exibir o chip do departamento) — a
    // leitura desse campo é sempre defensiva (ver getConversas).
    team?: { id: number; name: string } | null
    channel?: string
  }
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
