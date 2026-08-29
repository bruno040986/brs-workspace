/**
 * Client do engine (brs-alvoconsig/services/engine, Railway): instâncias
 * WhatsApp Baileys/Z-API. Envs: ENGINE_URL, ENGINE_API_TOKEN.
 */

function base(): string {
  return String(process.env.ENGINE_URL || 'https://engine.brspromotora.com.br').replace(/\/$/, '')
}

export function engineConfigurado(): boolean {
  return Boolean(process.env.ENGINE_API_TOKEN)
}

async function chamar<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const token = process.env.ENGINE_API_TOKEN
  if (!token) throw new Error('Engine não configurado (ENGINE_API_TOKEN).')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)
  try {
    const res = await fetch(`${base()}${path}`, {
      method: init?.method || 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Engine HTTP ${res.status}: ${text.slice(0, 200)}`)
    return (text ? JSON.parse(text) : {}) as T
  } finally {
    clearTimeout(timeout)
  }
}

export type EngineConectarResposta = { ok: boolean; provedor: 'baileys' | 'zapi'; inboxId: number; conectada?: boolean; webhookUrl?: string }
export type EngineStatusResposta = { status: string; numero: string | null; sessao_em_memoria?: boolean; detalhe?: unknown }

export const engine = {
  conectar: (instanciaId: string) => chamar<EngineConectarResposta>(`/instancias/${instanciaId}/conectar`, { method: 'POST', body: {} }),
  status: (instanciaId: string) => chamar<EngineStatusResposta>(`/instancias/${instanciaId}/status`),
  desconectar: (instanciaId: string, logout: boolean) => chamar<{ ok: boolean }>(`/instancias/${instanciaId}/desconectar`, { method: 'POST', body: { logout } }),
  enviar: (instanciaId: string, destino: string, texto: string) => chamar<{ ok: boolean; id: string }>(`/instancias/${instanciaId}/enviar`, { method: 'POST', body: { destino, texto } }),
  saude: async () => {
    try {
      const res = await fetch(`${base()}/health`, { signal: AbortSignal.timeout(6000) })
      return res.ok
    } catch {
      return false
    }
  },
}
