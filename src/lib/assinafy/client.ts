/**
 * Cliente HTTP tipado da Assinafy.
 *
 * Autentica por `X-Api-Key` e escopa as chamadas pelo account_id do workspace.
 * Funciona igual em sandbox e produção — só muda a base URL, resolvida pela
 * config. Apenas back-end (a api_key nunca vai ao cliente).
 *
 * Todo método devolve `data` já desembrulhado do envelope da API, ou lança
 * `AssinafyError` em falha de rede/HTTP. Ações de servidor capturam e traduzem.
 */

import type { AssinafyConfig } from './config'
import { baseUrlFor, getAssinafyConfig, requireActiveAssinafyConfig } from './config'
import type {
  AssinafyAssignment,
  AssinafyDocument,
  AssinafyEnvelope,
  AssinafyEnvironment,
  AssinafyField,
  AssinafySigner,
  AssinafyTemplate,
  AssinafyWebhookEvent,
  CreateAssignmentInput,
  CreateDocumentFromTemplateInput,
  CreateFieldInput,
  CreateSignerInput,
  UpsertWebhookSubscriptionInput,
} from './types'

export class AssinafyError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'AssinafyError'
    this.status = status
    this.body = body
  }
}

type ClientOptions = {
  apiKey: string
  accountId: string
  baseUrl: string
}

export class AssinafyClient {
  private readonly apiKey: string
  private readonly accountId: string
  private readonly baseUrl: string

  constructor(options: ClientOptions) {
    this.apiKey = options.apiKey
    this.accountId = options.accountId
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
  }

  /** Constrói o cliente a partir da config do banco (exige integração ativa). */
  static async fromActiveConfig(): Promise<AssinafyClient> {
    const config = await requireActiveAssinafyConfig()
    return AssinafyClient.fromConfig(config)
  }

  /** Constrói o cliente a partir de uma config já carregada. */
  static fromConfig(config: AssinafyConfig): AssinafyClient {
    return new AssinafyClient({
      apiKey: config.apiKey,
      accountId: config.accountId,
      baseUrl: config.baseUrl,
    })
  }

  /**
   * Cliente para teste de credenciais avulsas (ex.: validar sandbox antes de
   * salvar), sem depender do que está gravado no banco.
   */
  static forCredentials(input: {
    apiKey: string
    accountId: string
    environment: AssinafyEnvironment
  }): AssinafyClient {
    return new AssinafyClient({
      apiKey: input.apiKey,
      accountId: input.accountId,
      baseUrl: baseUrlFor(input.environment),
    })
  }

  // -----------------------------------------------------------------------
  // Núcleo de request
  // -----------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; formData?: FormData; query?: Record<string, string> } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)
    for (const [key, value] of Object.entries(options.query || {})) {
      url.searchParams.set(key, value)
    }

    const headers: Record<string, string> = { 'X-Api-Key': this.apiKey }
    let body: BodyInit | undefined

    if (options.formData) {
      // multipart: NÃO definir Content-Type — o runtime injeta o boundary.
      body = options.formData
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.body)
    }

    let response: Response
    try {
      response = await fetch(url, { method, headers, body })
    } catch (err) {
      throw new AssinafyError(
        `Falha de conexão com a Assinafy: ${(err as Error).message}`,
        0,
        null,
      )
    }

    const raw = await response.text()
    let parsed: unknown = null
    if (raw) {
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = raw
      }
    }

    if (!response.ok) {
      const message =
        (parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as { message?: unknown }).message || '')
          : '') || `Assinafy respondeu ${response.status}`
      throw new AssinafyError(message, response.status, parsed)
    }

    // A API embrulha em { status, message, data }. Devolve o data quando existir.
    if (parsed && typeof parsed === 'object' && 'data' in parsed) {
      return (parsed as AssinafyEnvelope<T>).data
    }
    return parsed as T
  }

  // -----------------------------------------------------------------------
  // Documentos
  // -----------------------------------------------------------------------

  /**
   * Sobe um PDF e cria o documento. `file` é o binário do contrato já gerado.
   * POST /v1/accounts/{accountId}/documents  (multipart, campo `file`)
   */
  async uploadDocument(
    file: Uint8Array | Blob,
    fileName: string,
  ): Promise<AssinafyDocument> {
    const form = new FormData()
    const blob = file instanceof Blob ? file : new Blob([file as BlobPart], { type: 'application/pdf' })
    form.append('file', blob, fileName)
    return this.request<AssinafyDocument>(
      'POST',
      `/v1/accounts/${this.accountId}/documents`,
      { formData: form },
    )
  }

  /** GET /v1/documents/{documentId} — estado atual + assignment. */
  async getDocument(documentId: string): Promise<AssinafyDocument> {
    return this.request<AssinafyDocument>('GET', `/v1/documents/${documentId}`)
  }

  // -----------------------------------------------------------------------
  // Signatários
  // -----------------------------------------------------------------------

  /** POST /v1/accounts/{accountId}/signers — cria um signatário reutilizável. */
  async createSigner(input: CreateSignerInput): Promise<AssinafySigner> {
    return this.request<AssinafySigner>(
      'POST',
      `/v1/accounts/${this.accountId}/signers`,
      { body: input },
    )
  }

  /** GET /v1/accounts/{accountId}/signers — lista os signatários da conta. */
  async listSigners(): Promise<AssinafySigner[]> {
    const data = await this.request<AssinafySigner[] | { signers?: AssinafySigner[] }>(
      'GET',
      `/v1/accounts/${this.accountId}/signers`,
    )
    if (Array.isArray(data)) return data
    return data?.signers || []
  }

  /**
   * Busca um signatário pelo e-mail; cria se não existir. E-mail é único na
   * Assinafy, então recriar dá erro — este helper torna o fluxo idempotente.
   */
  async findOrCreateSigner(input: CreateSignerInput): Promise<AssinafySigner> {
    const email = String(input.email || '').trim().toLowerCase()
    if (email) {
      const existing = await this.listSigners()
      const found = existing.find((s) => String(s?.email || '').trim().toLowerCase() === email)
      if (found) return found
    }
    return this.createSigner(input)
  }

  // -----------------------------------------------------------------------
  // Assignments (pedido de assinatura)
  // -----------------------------------------------------------------------

  /**
   * Cria o pedido de assinatura de um documento. A resposta traz
   * `signing_urls` — o link individual por signatário.
   * POST /v1/documents/{documentId}/assignments
   */
  async createAssignment(
    documentId: string,
    input: CreateAssignmentInput,
  ): Promise<AssinafyAssignment> {
    return this.request<AssinafyAssignment>(
      'POST',
      `/v1/documents/${documentId}/assignments`,
      { body: input },
    )
  }

  // -----------------------------------------------------------------------
  // Campos (definições reutilizáveis)
  // -----------------------------------------------------------------------

  /** GET /v1/accounts/{accountId}/fields — lista as definições de campo da conta. */
  async listFields(): Promise<AssinafyField[]> {
    const data = await this.request<AssinafyField[] | { fields?: AssinafyField[] }>(
      'GET',
      `/v1/accounts/${this.accountId}/fields`,
    )
    if (Array.isArray(data)) return data
    return data?.fields || []
  }

  /**
   * POST /v1/accounts/{accountId}/fields — cria um campo customizado nomeado.
   * Cada campo criado ganha um `field_id` próprio, permitindo preencher valores
   * distintos por campo no template (ao contrário do "Campo Texto" genérico).
   */
  async createField(input: CreateFieldInput): Promise<AssinafyField> {
    return this.request<AssinafyField>('POST', `/v1/accounts/${this.accountId}/fields`, {
      body: input,
    })
  }

  // -----------------------------------------------------------------------
  // Templates (Opção A)
  // -----------------------------------------------------------------------

  /** GET /v1/accounts/{accountId}/templates — lista os templates da conta com papéis e campos. */
  async listTemplates(): Promise<AssinafyTemplate[]> {
    const data = await this.request<AssinafyTemplate[] | { templates?: AssinafyTemplate[] }>(
      'GET',
      `/v1/accounts/${this.accountId}/templates`,
    )
    if (Array.isArray(data)) return data
    return data?.templates || []
  }

  /**
   * Gera um documento a partir de um template, já preenchido e com o pedido de
   * assinatura criado na mesma chamada. A resposta traz o documento com o
   * `assignment` e os `signing_urls` por parte.
   * POST /v1/accounts/{accountId}/templates/{templateId}/documents
   */
  async createDocumentFromTemplate(
    templateId: string,
    input: CreateDocumentFromTemplateInput,
  ): Promise<AssinafyDocument> {
    return this.request<AssinafyDocument>(
      'POST',
      `/v1/accounts/${this.accountId}/templates/${templateId}/documents`,
      { body: input },
    )
  }

  // -----------------------------------------------------------------------
  // Webhooks
  // -----------------------------------------------------------------------

  /** GET /v1/webhooks/event-types — catálogo de eventos assináveis. */
  async listWebhookEventTypes(): Promise<Array<{ id: string; description: string }>> {
    return this.request('GET', `/v1/webhooks/event-types`)
  }

  /** PUT /v1/accounts/{accountId}/webhooks/subscriptions — registra/atualiza a inscrição. */
  async upsertWebhookSubscription(
    input: UpsertWebhookSubscriptionInput,
  ): Promise<unknown> {
    return this.request(
      'PUT',
      `/v1/accounts/${this.accountId}/webhooks/subscriptions`,
      { body: input },
    )
  }
}

/** Eventos que o fluxo do SCP normalmente quer assinar no webhook. */
export const SCP_WEBHOOK_EVENTS: AssinafyWebhookEvent[] = [
  'document_ready',
  'signer_signed_document',
  'signer_rejected_document',
  'user_rejected_document',
  'document_processing_failed',
]

/**
 * Testa credenciais avulsas contra a API, sem gravar nada. Útil para validar o
 * sandbox antes de salvar. Retorna sucesso/erro em vez de lançar.
 */
export async function pingAssinafyCredentials(input: {
  apiKey: string
  accountId: string
  environment: AssinafyEnvironment
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = AssinafyClient.forCredentials(input)
    // Endpoint leve e escopado por conta: se o token/conta forem válidos, responde.
    await client.listWebhookEventTypes()
    return { ok: true }
  } catch (err) {
    const message = err instanceof AssinafyError ? err.message : (err as Error).message
    return { ok: false, error: message }
  }
}

/** Atalho: existe config utilizável? (não exige estar ativa) */
export async function isAssinafyConfigured(): Promise<boolean> {
  return (await getAssinafyConfig()) !== null
}
