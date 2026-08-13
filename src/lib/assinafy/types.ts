/**
 * Tipos da API da Assinafy, derivados do OpenAPI oficial
 * (https://api.assinafy.com.br/v1/docs/openapi.json).
 *
 * Só o subconjunto que o fluxo do SCP usa: documentos, signatários,
 * assignments (pedido de assinatura) e webhooks. Ampliar conforme necessário.
 */

/** Ambiente da Assinafy. Cada um tem credenciais e base URL próprias. */
export type AssinafyEnvironment = 'sandbox' | 'production'

/**
 * Ciclo de vida de um documento na Assinafy.
 * Fonte: GET /v1/documents/statuses.
 */
export type AssinafyDocumentStatus =
  | 'uploading'
  | 'uploaded'
  | 'metadata_processing'
  | 'metadata_ready'
  | 'pending_signature'
  | 'certificating'
  | 'certificated'
  | 'expired'
  | 'rejected_by_signer'
  | 'rejected_by_user'
  | 'failed'

/** Como o signatário prova identidade antes de assinar. */
export type AssinafyVerificationMethod = 'Email' | 'Whatsapp'

/** Como o convite de assinatura é entregue ao signatário. */
export type AssinafyNotificationMethod = 'Email' | 'Whatsapp'

/** Modo do assignment: `virtual` (sem campos) ou `collect` (campos por página). */
export type AssinafyAssignmentMethod = 'virtual' | 'collect'

/** Envelope padrão de toda resposta da API. */
export type AssinafyEnvelope<T> = {
  status: number
  message: string
  data: T
}

export type AssinafySigner = {
  id: string
  full_name: string
  email?: string | null
  whatsapp_phone_number?: string | null
}

/** Signatário dentro de um assignment, com estado de notificação/assinatura. */
export type AssinafyAssignmentSigner = {
  id: string
  full_name: string
  email?: string | null
  verification_method?: AssinafyVerificationMethod
  notification_methods?: AssinafyNotificationMethod[]
  step?: number
  notified?: boolean
  completed?: boolean
}

/** Link individual de assinatura, um por signatário. */
export type AssinafySigningUrl = {
  signer_id: string
  url: string
}

export type AssinafyAssignment = {
  resource: 'assignment'
  id: string
  method: AssinafyAssignmentMethod
  sender_email?: string
  expires_at?: string | null
  message?: string | null
  signers: AssinafyAssignmentSigner[]
  signing_urls?: AssinafySigningUrl[]
}

export type AssinafyDocument = {
  resource?: 'document'
  id: string
  name?: string
  status: AssinafyDocumentStatus
  assignment?: AssinafyAssignment | null
}

/** Entrada de um signatário ao criar um assignment. */
export type AssinafyAssignmentSignerInput = {
  id: string
  verification_method?: AssinafyVerificationMethod
  notification_methods?: AssinafyNotificationMethod[]
  /** Ordem de assinatura. Mesmo step = paralelo; steps diferentes = sequencial. */
  step?: number
}

export type CreateAssignmentInput = {
  method: AssinafyAssignmentMethod
  signers: AssinafyAssignmentSignerInput[]
  /** Texto incluído no e-mail de convite. */
  message?: string
  /** Expiração em ISO 8601. Sem expiração por padrão. */
  expires_at?: string
}

export type CreateSignerInput = {
  full_name: string
  email?: string
  /** Obrigatório para verificação/notificação por WhatsApp (planos pagos). */
  whatsapp_phone_number?: string
}

/**
 * Eventos de webhook relevantes ao fluxo de assinatura.
 * Fonte: GET /v1/webhooks/event-types e a seção Webhook Payloads.
 */
export type AssinafyWebhookEvent =
  | 'document_uploaded'
  | 'document_metadata_ready'
  | 'document_prepared'
  | 'assignment_created'
  | 'signature_requested'
  | 'signer_signed_document'
  | 'signer_rejected_document'
  | 'user_rejected_document'
  | 'document_ready'
  | 'document_processing_failed'

/** Envelope comum de todo corpo de webhook recebido da Assinafy. */
export type AssinafyWebhookPayload = {
  /** ID interno da atividade — usar para deduplicação. */
  id: number
  event: AssinafyWebhookEvent | string
  message?: string | null
  payload?: Record<string, unknown> | null
  origin?: { ip?: string; ['user-agent']?: string } | null
  /** Unix timestamp em segundos. */
  created_at: number
  subject?: Record<string, unknown>
  object?: Record<string, unknown>
  account_id: string
}

export type UpsertWebhookSubscriptionInput = {
  events: AssinafyWebhookEvent[]
  is_active: boolean
  url: string
  email: string
}

// -------------------------------------------------------------------------
// Templates (Opção A: contrato cadastrado como template na Assinafy)
// -------------------------------------------------------------------------

/** Papel de assinante definido no template (ex.: Contratada, Testemunha). */
export type AssinafyTemplateRole = {
  id: string
  name: string
  assignment_type?: string
}

/** Campo preenchível posicionado no template (mapeado por `field_id`). */
export type AssinafyTemplateField = {
  id?: string
  field_id: string
  role_id?: string
  label?: string
}

export type AssinafyTemplate = {
  id: string
  name: string
  document_name?: string
  status?: string
  roles?: AssinafyTemplateRole[]
  /** Campos podem vir agrupados por página; achatamos ao ler. */
  fields?: AssinafyTemplateField[]
}

/**
 * Um signatário mapeado a um papel do template. O `id` é o do signatário já
 * criado na conta (via createSigner); `role_id` é o papel no template.
 */
export type TemplateDocumentSignerInput = {
  role_id: string
  id: string
  verification_method?: AssinafyVerificationMethod
  notification_methods?: AssinafyNotificationMethod[]
  step?: number
}

/** Valor a preencher num campo do template. */
export type TemplateEditorFieldInput = {
  field_id: string
  value: string
}

/** Definição de campo reutilizável na conta (custom ou padrão). */
export type AssinafyField = {
  id: string
  name: string
  type: string
  regex?: string | null
  is_required?: boolean
  is_pre_defined?: boolean
  is_standard?: boolean
}

export type CreateFieldInput = {
  name: string
  /** Tipo do campo. 'text' é o genérico; há tipos com validação (cpf, cnpj, cep…). */
  type: string
  regex?: string | null
  is_required?: boolean
}

export type CreateDocumentFromTemplateInput = {
  /** Um por papel do template. */
  signers: TemplateDocumentSignerInput[]
  /** Valores dos campos preenchíveis (as tags do contrato). */
  editor_fields?: TemplateEditorFieldInput[]
  /** Título do documento; usa o nome do template por padrão. */
  name?: string
  message?: string
  expires_at?: string
}
