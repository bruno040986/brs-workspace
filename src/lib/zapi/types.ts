/**
 * Tipos da integração Z-API (WhatsApp).
 *
 * Referência: https://developer.z-api.io — base URL
 * `https://api.z-api.io/instances/{instanceId}/token/{token}/{método}`,
 * header opcional/obrigatório `Client-Token` (token de segurança da conta).
 */

/** Linha da tabela `zapi_instances` (segredos incluídos — só back-end). */
export type ZapiInstanceRow = {
  id: string
  name: string
  instance_id: string
  token: string
  client_token: string
  is_active: boolean
  is_default: boolean
  webhook_key: string
  last_status: ZapiStatus | null
  last_device: ZapiDevice | null
  last_checked_at: string | null
  webhook_mode: ZapiWebhookMode
  webhook_relay_urls: Partial<Record<ZapiWebhookKind, string>>
  webhook_flags: Partial<Record<ZapiWebhookKind, boolean>>
  next_send_at: string | null
  worker_lock_until: string | null
  worker_lock_by: string | null
  created_at: string
  updated_at: string
}

/** Versão segura para o cliente: sem token/client_token. */
export type ZapiInstancePublic = Omit<ZapiInstanceRow, 'token' | 'client_token'> & {
  has_token: boolean
  has_client_token: boolean
}

export type ZapiWebhookMode = 'none' | 'direct' | 'relay'

/** Tipos de webhook que a Z-API permite configurar por instância. */
export type ZapiWebhookKind = 'received' | 'delivery' | 'message_status' | 'disconnected' | 'connected'

/** Resposta padrão de todo `send-*`. */
export type ZapiSendResult = {
  zaapId: string
  messageId: string
  id: string
}

/** GET /status */
export type ZapiStatus = {
  connected: boolean
  smartphoneConnected: boolean
  /** Preenchido mesmo em sucesso ("You are already connected") — não usar como erro. */
  error?: string | null
}

/** GET /device */
export type ZapiDevice = {
  phone?: string
  imgUrl?: string
  about?: string
  name?: string
  device?: { sessionName?: string; device_model?: string }
  originalDevice?: string
  sessionId?: number
  isBusiness?: boolean
}

/** GET /me — metadados da instância + URLs de webhook configuradas. */
export type ZapiMe = {
  id?: string
  name?: string
  due?: number
  connected?: boolean
  paymentStatus?: string
  created?: number
  connectedCallbackUrl?: string | null
  deliveryCallbackUrl?: string | null
  disconnectedCallbackUrl?: string | null
  messageStatusCallbackUrl?: string | null
  presenceChatCallbackUrl?: string | null
  receivedCallbackUrl?: string | null
  receiveCallbackSentByMe?: boolean
  [key: string]: unknown
}

export type ZapiButton = { id?: string; label: string }

export type ZapiSendTextInput = {
  phone: string
  message: string
  delayMessage?: number
  delayTyping?: number
}

export type ZapiSendImageInput = {
  phone: string
  /** URL pública/assinada ou data URI base64. */
  image: string
  caption?: string
  delayMessage?: number
}

export type ZapiSendDocumentInput = {
  phone: string
  document: string
  /** Extensão sem ponto (pdf, xlsx, docx…). Vai no path. */
  extension: string
  fileName?: string
  caption?: string
  delayMessage?: number
}

export type ZapiSendAudioInput = {
  phone: string
  audio: string
  waveform?: boolean
  delayMessage?: number
  delayTyping?: number
}

export type ZapiSendContactInput = {
  phone: string
  contactName: string
  contactPhone: string
  contactBusinessDescription?: string
  delayMessage?: number
}

export type ZapiSendButtonListInput = {
  phone: string
  message: string
  buttons: ZapiButton[]
  delayMessage?: number
}

// -------------------------------------------------------------------------
// Webhooks (payloads recebidos)
// -------------------------------------------------------------------------

export type ZapiMessageStatus = 'SENT' | 'RECEIVED' | 'READ' | 'READ_BY_ME' | 'PLAYED' | string

export type ZapiMessageStatusCallback = {
  type: 'MessageStatusCallback'
  instanceId?: string
  status: ZapiMessageStatus
  ids?: string[]
  id?: string
  momment?: number
  phone?: string
  isGroup?: boolean
}

export type ZapiDeliveryCallback = {
  type: 'DeliveryCallback'
  instanceId?: string
  phone?: string
  zaapId?: string
  messageId?: string
  error?: string
}

export type ZapiReceivedCallback = {
  type: 'ReceivedCallback' | 'ReceivedCallBack'
  instanceId?: string
  phone?: string
  messageId?: string
  referenceMessageId?: string
  momment?: number
  fromMe?: boolean
  isGroup?: boolean
  text?: { message?: string }
  buttonsResponseMessage?: { buttonId?: string; message?: string }
  listResponseMessage?: { selectedRowId?: string; title?: string; message?: string }
  [key: string]: unknown
}

export type ZapiConnectionCallback = {
  type: 'ConnectedCallback' | 'DisconnectedCallback'
  instanceId?: string
  connected?: boolean
  disconnected?: boolean
  error?: string
  momment?: number
  phone?: string
}

export type ZapiWebhookPayload =
  | ZapiMessageStatusCallback
  | ZapiDeliveryCallback
  | ZapiReceivedCallback
  | ZapiConnectionCallback
  | { type?: string; [key: string]: unknown }
