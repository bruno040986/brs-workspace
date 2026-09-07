/**
 * Client do engine (brs-alvoconsig/services/engine, Railway): instâncias
 * WhatsApp Baileys/Z-API. Envs: ENGINE_URL, ENGINE_API_TOKEN.
 *
 * Contrato de envio (Lote 02B, 07/09/2026): todo `POST /instancias/:id/enviar`
 * leva `operationId` (uuid) gerado UMA vez por intenção de envio na UI e
 * propagado UI → action → aqui (ver `envio-intencao.ts`). Este helper NUNCA
 * gera a chave nem faz retry. Depois que o POST foi tentado, qualquer falha
 * que não comprove rejeição (queda de conexão, timeout, 5xx, corpo ilegível,
 * 2xx sem confirmação válida, 409 DELIVERY_UNCERTAIN) vira
 * `EngineEnvioIncertoError`: a mensagem pode ter saído. Só rejeições
 * comprovadas (validação local, 4xx do contrato, erro de domínio com código,
 * conflito de chave antes do envio) sobem como erro comum/`EngineErro`.
 * Enquanto o modo durável da conta BRS estiver desligado no engine, o campo é
 * aceito e ignorado: NÃO há idempotência, só preparação do contrato.
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

// Campos declarados explicitamente (sem "parameter properties"): o runner de
// testes usa o strip-types do Node, que não aceita essa sintaxe.

/** Erro de domínio/rejeição comprovada do engine (`{ erro|error, codigo|code }`, 4xx do contrato). Nada foi enviado. */
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

export type MotivoIncerto = 'timeout' | 'transporte' | 'gateway' | 'resposta' | 'uncertain'

/**
 * Envio sem confirmação: a mensagem PODE ter saído ou não. Nunca reenviar
 * automaticamente com chave nova; a UI informa e a pessoa decide.
 */
export class EngineEnvioIncertoError extends Error {
  readonly operationId: string
  readonly motivo: MotivoIncerto
  constructor(message: string, operationId: string, motivo: MotivoIncerto) {
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
      const corpo = parseJson(text)
      const codigo = corpo?.codigo || corpo?.code
      if (codigo) throw new EngineErro(String(corpo?.erro || corpo?.error || `Engine HTTP ${res.status}`), String(codigo), res.status)
      throw new Error(`Engine HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    return (text ? JSON.parse(text) : {}) as T
  } finally {
    clearTimeout(timeout)
  }
}

type CorpoErro = { erro?: string; error?: string; codigo?: string; code?: string; message?: string }

function parseJson(text: string): CorpoErro | null {
  try {
    const v = text ? JSON.parse(text) : null
    return v && typeof v === 'object' ? (v as CorpoErro) : null
  } catch {
    return null
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

/**
 * Lista EXPLÍCITA de códigos cuja semântica, no contrato do `POST
 * /instancias/:id/enviar` do engine (server.ts / send-operation.ts /
 * baileys.ts / grupos.ts), comprova rejeição ANTES de qualquer efeito no
 * WhatsApp. Só esses viram `EngineErro`; qualquer outro código em 5xx (inclusive
 * `SEND_RESULT_PERSISTENCE_FAILED`, que é pós-envio, e códigos desconhecidos)
 * fica INCERTO.
 *  - numero_sem_whatsapp: 422 `{ error, erro }` (NumeroSemWhatsAppError, checado antes de enviar)
 *  - OPERATION_CONTENT_CONFLICT / SEND_PERSISTENCE_FAILED: claimSend, antes do envio;
 *    o Fastify entrega como 500 `{ error: 'enviar pelo WhatsApp: <código>' }`
 *    ou `{ statusCode, error, message: '<código>' }` — por isso o casamento é
 *    por palavra inteira dentro dos campos, não igualdade
 *  - INSTANCIA_DESCONECTADA / PROVEDOR_NAO_SUPORTADO / GRUPO_NAO_PERMITIDO:
 *    gates de instância (`{ erro, codigo }`), avaliados antes do envio
 */
const REJEICOES_PRE_ENVIO = ['numero_sem_whatsapp', 'OPERATION_CONTENT_CONFLICT', 'SEND_PERSISTENCE_FAILED', 'INSTANCIA_DESCONECTADA', 'PROVEDOR_NAO_SUPORTADO', 'GRUPO_NAO_PERMITIDO']
const REJEICAO_RE = new RegExp(`\\b(${REJEICOES_PRE_ENVIO.join('|')})\\b`)

/**
 * Classifica uma resposta não-2xx do /enviar. Ordem: DELIVERY_UNCERTAIN →
 * rejeição pré-envio da lista → 5xx (qualquer código) = incerto → 409 sem
 * código = incerto → demais 4xx = rejeição (erro de contrato/cliente, antes do
 * efeito). Um código existir NÃO prova rejeição.
 */
function classificarFalha(status: number, corpo: CorpoErro | null, texto: string): { tipo: 'incerto'; motivo: MotivoIncerto; mensagem: string } | { tipo: 'rejeicao'; codigo: string; mensagem: string } {
  const campos = [corpo?.codigo, corpo?.code, corpo?.erro, corpo?.error, corpo?.message].map((v) => String(v || '')).filter(Boolean)
  const mensagem = String(corpo?.erro || corpo?.error || corpo?.message || '') || `Engine HTTP ${status}: ${texto.slice(0, 200)}`
  if (campos.some((c) => /\bDELIVERY_UNCERTAIN\b/.test(c)) || (status === 409 && !campos.length)) {
    return { tipo: 'incerto', motivo: 'uncertain', mensagem: 'O engine não confirmou o envio (em processamento ou aguardando reconciliação).' }
  }
  for (const c of campos) {
    const m = c.match(REJEICAO_RE)
    if (m) return { tipo: 'rejeicao', codigo: m[1], mensagem }
  }
  if (status >= 500) return { tipo: 'incerto', motivo: 'gateway', mensagem: `O engine/gateway falhou (HTTP ${status}) — o envio pode ter saído ou não.` }
  if (status === 409) return { tipo: 'incerto', motivo: 'uncertain', mensagem: 'O engine não confirmou o envio (HTTP 409 sem código conhecido).' }
  return { tipo: 'rejeicao', codigo: String(corpo?.codigo || corpo?.code || `HTTP_${status}`), mensagem }
}

function ehAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
}

/**
 * Envio direto por instância. Só lança três coisas: `Error` (validação local,
 * antes de qualquer rede), `EngineErro` (rejeição comprovada — nada saiu) e
 * `EngineEnvioIncertoError` (pode ter saído; conservar a chave, não reenviar
 * sozinho). Exatamente UMA tentativa de POST.
 */
async function enviarPorInstancia(instanciaId: string, destino: string, texto: string, opcoes: EnvioEngineOpcoes): Promise<EngineEnviarResposta> {
  if (!ehOperationId(opcoes?.operationId)) throw new Error('operationId inválido: a chave de envio deve ser um uuid gerado uma vez por intenção.')
  const token = process.env.ENGINE_API_TOKEN
  if (!token) throw new Error('Engine não configurado (ENGINE_API_TOKEN).')
  const operationId = opcoes.operationId
  const body: Record<string, unknown> = { destino, texto, operationId }
  if (opcoes.mentions?.length) body.mentions = opcoes.mentions
  if (opcoes.quoted?.messageId) body.quoted = { messageId: opcoes.quoted.messageId }
  const incerto = (motivo: MotivoIncerto, msg: string) => new EngineEnvioIncertoError(msg, operationId, motivo)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)
  let res: Response
  try {
    res = await fetch(`${base()}/instancias/${instanciaId}/enviar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timeout)
    // O POST foi tentado: não dá pra saber se chegou. Timeout e queda de
    // conexão (fetch failed / ECONNRESET) são ambos incertos.
    if (ehAbort(err)) throw incerto('timeout', 'O engine não respondeu a tempo — o envio pode ter saído ou não.')
    throw incerto('transporte', 'A conexão com o engine caiu durante o envio — a mensagem pode ter saído ou não.')
  }

  let text: string
  try {
    text = await res.text()
  } catch {
    throw incerto('resposta', 'A resposta do engine foi interrompida — o envio pode ter saído ou não.')
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    const f = classificarFalha(res.status, parseJson(text), text)
    if (f.tipo === 'incerto') throw incerto(f.motivo, f.mensagem)
    throw new EngineErro(f.mensagem, f.codigo, res.status)
  }

  // 2xx só confirma com corpo válido: `ok:true` + id da mensagem. Objeto vazio
  // ou JSON quebrado não é prova de envio.
  const dados = parseJson(text) as (EngineEnviarResposta & CorpoErro) | null
  if (!dados || dados.ok !== true || !(dados.id || dados.messageId)) {
    throw incerto('resposta', 'O engine respondeu sem confirmação válida — o envio pode ter saído ou não.')
  }
  return dados
}

export const engine = {
  conectar: (instanciaId: string) => chamar<EngineConectarResposta>(`/instancias/${instanciaId}/conectar`, { method: 'POST', body: {} }),
  status: (instanciaId: string) => chamar<EngineStatusResposta>(`/instancias/${instanciaId}/status`),
  desconectar: (instanciaId: string, logout: boolean) => chamar<{ ok: boolean }>(`/instancias/${instanciaId}/desconectar`, { method: 'POST', body: { logout } }),
  enviar: enviarPorInstancia,
  saude: async () => {
    try {
      const res = await fetch(`${base()}/health`, { signal: AbortSignal.timeout(6000) })
      return res.ok
    } catch {
      return false
    }
  },
}
