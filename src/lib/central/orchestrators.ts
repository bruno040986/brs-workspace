/**
 * Central de Integrações — registro dos orquestradores e client da Admin API.
 *
 * Arquitetura hub-and-spoke: cada orquestrador (serviço satélite por PRODUTO)
 * expõe uma Admin API padronizada (/api/admin/*) protegida por Bearer token.
 * O Workspace é o único frontend; o token vive SÓ em env do servidor e nunca
 * chega ao navegador (todas as chamadas passam por server actions/rotas).
 *
 * Para plugar um orquestrador novo (ex. Prefeituras): adicionar uma entrada em
 * ORCHESTRATORS e as envs ORCH_<SLUG>_BASE_URL / ORCH_<SLUG>_ADMIN_TOKEN.
 */

export type OrchestratorSystem = 'wesales' | 'callface' | 'vendeai' | 'nvti'

export interface OrchestratorDef {
  slug: string
  name: string
  product: string
  description: string
  baseUrlEnv: string
  tokenEnv: string
  defaultBaseUrl?: string
  systems: OrchestratorSystem[]
}

export const ORCHESTRATORS: OrchestratorDef[] = [
  {
    slug: 'clt',
    name: 'Orquestrador CLT',
    product: 'Crédito consignado CLT (NuAzul)',
    description:
      'Funil CLT: WeSales (CRM) + CallFace (voz) + Vende.AI (WhatsApp) + site NuAzul + higienização NVTI.',
    baseUrlEnv: 'ORCH_CLT_BASE_URL',
    tokenEnv: 'ORCH_CLT_ADMIN_TOKEN',
    defaultBaseUrl: 'https://clt-orchestrator.vercel.app',
    systems: ['wesales', 'callface', 'vendeai', 'nvti'],
  },
]

export function getOrchestrator(slug: string): OrchestratorDef | null {
  return ORCHESTRATORS.find((o) => o.slug === slug) ?? null
}

export function orchestratorConfigured(def: OrchestratorDef): boolean {
  return Boolean((process.env[def.tokenEnv] || '').trim())
}

export class OrchestratorApiError extends Error {
  constructor(
    readonly slug: string,
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'OrchestratorApiError'
  }
}

/**
 * Chamada server-side à Admin API de um orquestrador. Lança
 * OrchestratorApiError com a mensagem devolvida pela API (as mensagens são
 * seguras de mostrar na central).
 */
export async function orchestratorFetch<T = unknown>(
  slug: string,
  path: string,
  options: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const def = getOrchestrator(slug)
  if (!def) throw new OrchestratorApiError(slug, 404, `Orquestrador "${slug}" não cadastrado.`)

  // trim: valor colado na Vercel com espaço/quebra de linha no fim quebra o
  // Bearer silenciosamente (401 sem pista) — normalizamos aqui.
  const token = (process.env[def.tokenEnv] || '').trim()
  if (!token) {
    throw new OrchestratorApiError(
      slug,
      503,
      `Token do orquestrador não configurado (env ${def.tokenEnv}).`,
    )
  }
  const baseUrl = (process.env[def.baseUrlEnv] || def.defaultBaseUrl || '').trim().replace(/\/$/, '')
  if (!baseUrl) {
    throw new OrchestratorApiError(slug, 503, `URL do orquestrador não configurada (env ${def.baseUrlEnv}).`)
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    cache: 'no-store',
  })

  const text = await res.text().catch(() => '')
  let json: unknown
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    json = undefined
  }

  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json
        ? String((json as { error: unknown }).error)
        : `HTTP ${res.status}`
    throw new OrchestratorApiError(slug, res.status, message)
  }

  return json as T
}
