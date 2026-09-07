/**
 * Client do engine (brs-alvoconsig/services/engine, Railway): instâncias
 * WhatsApp Baileys/Z-API. Envs: ENGINE_URL, ENGINE_API_TOKEN.
 *
 * Contrato de envio (Lote 02B, 07/09/2026): todo `POST /instancias/:id/enviar`
 * leva `operationId` (uuid) gerado UMA vez por intenção de envio na UI e
 * propagado UI → action → aqui (ver `envio-intencao.ts`). Este helper NUNCA
 * gera a chave nem faz retry: timeout e 409 `DELIVERY_UNCERTAIN` viram
 * `EngineEnvioIncertoError` (resultado não confirmado) e quem chama decide —
 * sem reenvio automático com chave nova. Enquanto o modo durável da conta BRS
 * estiver desligado no engine, o campo é aceito e ignorado: NÃO há
 * idempotência, só preparação do contrato.
 */
// Sem import de módulo irmão: o runner de testes (node --test com strip-types)
// resolve ESM sem extensão implícita; a regra de uuid é a mesma de envio-intencao.ts.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ehOperationId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

function base(): string {
  return String(process.env.ENGINE_URL || 'https://engine.brspromotora.com.br').replace(/\/$/, '')
}

export function engineConfigurado(): boolean {
  return Boolean(process.env.ENGINE_API_TOKEN)
}

/** Erro de domínio do engine (`{ erro|error, codigo|code }`), ex.: NAO_ADMIN, INSTANCIA_DESCONECTADA. */
// Campos declarados explicitamente (sem "parameter properties"): o runner de
// testes usa o strip-types do Node, que não aceita essa sintaxe.
export class EngineErro extends Error {
  readonly codigo: string
  readonly status: number
  constructor(message: string, codigo: string, status: number) {
    super(message)
    this.name = 'EngineErro'
    this.codigo = codigo
    this.status = status
  }
}

/**
 * Envio sem confirmação: a mensagem PODE ter saído ou não (timeout do nosso
 * lado, ou 409 `DELIVERY_UNCERTAIN` do engine — envio em processamento ou
 * aguardando reconciliação). Nunca reenviar automaticamente com chave nova.
 */
export class EngineEnvioIncertoError extends Error {
  readonly operationId: string
  readonly motivo: 'timeout' | 'uncertain'
  constructor(message: string, operationId: string, motivo: 'timeout' | 'uncertain') {
    super(message)
    this.name = 'EngineEnvioIncertoError'
    this.operationId = operationId
    this.motivo = motivo
  }
}

async function chamar<T>(path: string, init?: { method?: string; body?: unknown; timeoutMs?: number }): Promise<T> {
  const token = process.env.ENGINE_API_TOKEN
  if (!token) throw new Error('Engine não configurado (ENGINE_API_TOKEN).')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? 25_000)
  try {
    const res = await fetch(`${base()}${path}`, {
      method: init?.method || 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      let corpo: { erro?: string; error?: string; codigo?: string; code?: string } | null = null
      try {
        corpo = text ? JSON.parse(text) : null
      } catch {
        corpo = null
      }
      const codigo = corpo?.codigo || corpo?.code
      if (codigo) throw new EngineErro(String(corpo?.erro || corpo?.error || `Engine HTTP ${res.status}`), String(codigo), res.status)
      throw new Error(`Engine HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    return (text ? JSON.parse(text) : {}) as T
  } finally {
    clearTimeout(timeout)
  }
}

export type EngineConectarResposta = { ok: boolean; provedor: 'baileys' | 'zapi'; inboxId: number; conectada?: boolean; webhookUrl?: string }
export type EngineStatusResposta = { status: string; numero: string | null; sessao_em_memoria?: boolean; detalhe?: unknown }
export type EngineEnviarResposta = { ok: boolean; id: string; messageId?: string; conversationId?: number | null }

export type EnvioEngineOpcoes = {
  /** Chave da intenção de envio — obrigatória, gerada uma vez na UI (ver envio-intencao.ts). */
  operationId: string
  /** Menção real (@) — JIDs. Só Baileys. */
  mentions?: string[]
  /** Resposta citando — id da mensagem NO CHATWOOT. Só Baileys. */
  quoted?: { messageId: number }
}

function ehAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
}

export const engine = {
  conectar: (instanciaId: string) => chamar<EngineConectarResposta>(`/instancias/${instanciaId}/conectar`, { method: 'POST', body: {} }),
  status: (instanciaId: string) => chamar<EngineStatusResposta>(`/instancias/${instanciaId}/status`),
  desconectar: (instanciaId: string, logout: boolean) => chamar<{ ok: boolean }>(`/instancias/${instanciaId}/desconectar`, { method: 'POST', body: { logout } }),
  /**
   * Envio direto por instância. Lança `EngineEnvioIncertoError` em timeout ou
   * 409 DELIVERY_UNCERTAIN (resultado não confirmado — não reenviar com chave
   * nova) e `EngineErro` nos erros de domínio do engine.
   */
  enviar: async (instanciaId: string, destino: string, texto: string, opcoes: EnvioEngineOpcoes): Promise<EngineEnviarResposta> => {
    if (!ehOperationId(opcoes?.operationId)) throw new Error('operationId inválido: a chave de envio deve ser um uuid gerado uma vez por intenção.')
    const body: Record<string, unknown> = { destino, texto, operationId: opcoes.operationId }
    if (opcoes.mentions?.length) body.mentions = opcoes.mentions
    if (opcoes.quoted?.messageId) body.quoted = { messageId: opcoes.quoted.messageId }
    try {
      return await chamar<EngineEnviarResposta>(`/instancias/${instanciaId}/enviar`, { method: 'POST', body })
    } catch (err) {
      if (err instanceof EngineErro && (err.codigo === 'DELIVERY_UNCERTAIN' || (err.status === 409 && !err.codigo))) {
        throw new EngineEnvioIncertoError('O engine não confirmou o envio (em processamento ou aguardando reconciliação).', opcoes.operationId, 'uncertain')
      }
      if (ehAbort(err)) {
        throw new EngineEnvioIncertoError('O engine não respondeu a tempo — o envio pode ter saído ou não.', opcoes.operationId, 'timeout')
      }
      throw err
    }
  },
  saude: async () => {
    try {
      const res = await fetch(`${base()}/health`, { signal: AbortSignal.timeout(6000) })
      return res.ok
    } catch {
      return false
    }
  },
}
