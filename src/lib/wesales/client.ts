/**
 * Cliente WeSales (GoHighLevel / LeadConnector v2) do WORKSPACE.
 *
 * Portado do padrão validado no clt-orchestrator (src/clients/wesales.ts) e no
 * brs-alvoconsig (apps/web/src/lib/wesales/client.ts): Bearer de Private
 * Integration + header `Version: 2021-07-28`. Usado pelas rotas admin do
 * AlvoConsig (importação pequena, criação de campanha, crons de expurgo e
 * conferência) — nunca no caminho de uma tela de atendimento (latência).
 *
 * Envs: WESALES_API_TOKEN, WESALES_LOCATION_ID (mesmas do brs-alvoconsig —
 * criar/copiar na Vercel do Workspace se ainda não existirem).
 */

const BASE_URL = 'https://services.leadconnectorhq.com'
const API_VERSION = '2021-07-28'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Env ${name} não configurada.`)
  return value
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${requireEnv('WESALES_API_TOKEN')}`,
    Version: API_VERSION,
    'Content-Type': 'application/json',
  }
}

function locationId(): string {
  return requireEnv('WESALES_LOCATION_ID')
}

export class WesalesHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    url: string,
  ) {
    super(`WeSales HTTP ${status} em ${url}: ${body.slice(0, 300)}`)
  }
}

const MAX_TENTATIVAS_429 = 5

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 429 (rate limit) tenta de novo com backoff em vez de descartar a operação
 * na hora — respeita `Retry-After` quando o WeSales manda, senão backoff
 * exponencial com jitter. Sem isso, uma rajada de importação/campanha perde
 * ofertas/contatos silenciosamente (incidente 24/08/2026: 12 de 27 ofertas
 * REFIN descartadas por 429 numa importação só).
 */
async function http<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const url = `${BASE_URL}${path}`
  let tentativa = 0
  for (;;) {
    const res = await fetch(url, {
      method: init?.method || 'GET',
      headers: authHeaders(),
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
    if (res.status === 429 && tentativa < MAX_TENTATIVAS_429) {
      tentativa += 1
      // Diagnóstico (Bruno pediu o limite real desta integração, 24/08/2026):
      // a doc genérica do LeadConnector diz 100 req/10s + 200k/dia por app por
      // location, mas isso bateu 429 bem antes disso — logamos os cabeçalhos
      // reais que o WeSales manda pra descobrir o teto desta Private
      // Integration específica (ver logs da função na Vercel).
      const cabecalhosLimite = ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-interval-milliseconds', 'retry-after']
        .map((h) => `${h}=${res.headers.get(h) ?? '—'}`)
        .join(' ')
      console.warn(`WeSales 429 em ${url} (tentativa ${tentativa}/${MAX_TENTATIVAS_429}) — ${cabecalhosLimite}`)
      const retryAfter = Number.parseFloat(res.headers.get('retry-after') || '')
      const esperaMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 400 * 2 ** tentativa + Math.random() * 300
      await sleep(esperaMs)
      continue
    }
    const text = await res.text()
    if (!res.ok) throw new WesalesHttpError(res.status, text, url)
    return (text ? JSON.parse(text) : {}) as T
  }
}

export function normalizeCpfDigits(cpf: string) {
  return String(cpf || '').replace(/\D/g, '').padStart(11, '0')
}

// ---------------------------------------------------------------------------
// Campos personalizados (resolvidos por key, cache por execução da function)
// ---------------------------------------------------------------------------

type CustomFieldDef = { id: string; fieldKey?: string; name?: string; model?: string }

let customFieldsCache: CustomFieldDef[] | null = null

async function listCustomFields(): Promise<CustomFieldDef[]> {
  if (customFieldsCache) return customFieldsCache
  const res = await http<{ customFields?: CustomFieldDef[] }>(`/locations/${locationId()}/customFields?model=contact`)
  customFieldsCache = res.customFields || []
  return customFieldsCache
}

function fieldKeyMatches(def: CustomFieldDef, key: string) {
  const target = key.toLowerCase()
  const fieldKey = String(def.fieldKey || '').toLowerCase()
  return fieldKey === target || fieldKey === `contact.${target}` || fieldKey.endsWith(`.${target}`)
}

export async function resolveCustomField(key: string): Promise<CustomFieldDef | null> {
  const fields = await listCustomFields()
  return fields.find((def) => fieldKeyMatches(def, key)) || null
}

/** Garante que o campo personalizado existe na location (cria se faltar). */
export async function ensureCustomField(key: string, name: string): Promise<CustomFieldDef> {
  const existing = await resolveCustomField(key)
  if (existing) return existing
  const res = await http<{ customField?: CustomFieldDef } & CustomFieldDef>(`/locations/${locationId()}/customFields`, {
    method: 'POST',
    body: { name, dataType: 'TEXT', model: 'contact', fieldKey: key },
  })
  customFieldsCache = null
  return (res.customField || res) as CustomFieldDef
}

// ---------------------------------------------------------------------------
// Contatos
// ---------------------------------------------------------------------------

export type WesalesContact = {
  id: string
  name?: string
  firstName?: string
  lastName?: string
  phone?: string
  tags?: string[]
  customFields?: Array<{ id: string; value?: string }>
  [key: string]: unknown
}

export function customFieldValue(contact: WesalesContact, fieldId: string): string | null {
  const found = (contact.customFields || []).find((f) => f.id === fieldId)
  return found?.value ?? null
}

export async function findContactByCpf(cpf: string): Promise<WesalesContact | null> {
  const def = await resolveCustomField('cpf')
  if (!def) return null
  const res = await http<{ contacts?: WesalesContact[] }>(`/contacts/search`, {
    method: 'POST',
    body: {
      locationId: locationId(),
      pageLimit: 1,
      filters: [{ field: `customFields.${def.id}`, operator: 'eq', value: normalizeCpfDigits(cpf) }],
    },
  })
  return res.contacts?.[0] ?? null
}

export type ContactPayload = {
  name?: string
  phone?: string | null
  tags?: string[]
  source?: string
  customFields?: Array<{ id: string; fieldValue: string }>
}

/** Cria (chave = CPF, após findContactByCpf não achar). */
export async function createContact(payload: ContactPayload): Promise<{ contact: WesalesContact | null; duplicateOfId?: string }> {
  try {
    const res = await http<{ contact: WesalesContact }>(`/contacts/`, {
      method: 'POST',
      body: { locationId: locationId(), ...payload },
    })
    return { contact: res.contact }
  } catch (error) {
    if (error instanceof WesalesHttpError && error.status === 400 && error.body.includes('duplicated contacts')) {
      try {
        const parsed = JSON.parse(error.body) as { meta?: { contactId?: string } }
        return { contact: null, duplicateOfId: parsed.meta?.contactId }
      } catch {
        return { contact: null }
      }
    }
    throw error
  }
}

export async function updateContact(contactId: string, payload: ContactPayload): Promise<void> {
  await http(`/contacts/${contactId}`, { method: 'PUT', body: payload })
}

export async function getContact(contactId: string): Promise<WesalesContact | null> {
  try {
    const res = await http<{ contact: WesalesContact }>(`/contacts/${contactId}`)
    return res.contact ?? null
  } catch {
    return null
  }
}

/** Endpoint dedicado da v2 — aditivo, não remove as tags existentes. */
export async function addContactTags(contactId: string, tags: string[]): Promise<void> {
  if (!tags.length) return
  await http(`/contacts/${contactId}/tags`, { method: 'POST', body: { tags } })
}

export async function removeContactTags(contactId: string, tags: string[]): Promise<void> {
  if (!tags.length) return
  await http(`/contacts/${contactId}/tags`, { method: 'DELETE', body: { tags } })
}

// ---------------------------------------------------------------------------
// Busca por filtros (tags, campos personalizados) — com paginação
// ---------------------------------------------------------------------------

export type ContactSearchFilter = { field: string; operator: string; value: unknown }
export type ContactSearchPage = { contacts: WesalesContact[]; total: number; nextCursor: unknown[] | null }

export async function searchContacts(
  filters: ContactSearchFilter[],
  options: { pageLimit?: number; searchAfter?: unknown[] } = {},
): Promise<ContactSearchPage> {
  const res = await http<{ contacts?: WesalesContact[]; total?: number }>(`/contacts/search`, {
    method: 'POST',
    body: {
      locationId: locationId(),
      pageLimit: options.pageLimit ?? 100,
      ...(options.searchAfter ? { searchAfter: options.searchAfter } : {}),
      ...(filters.length > 0 ? { filters } : {}),
      sort: [{ field: 'dateAdded', direction: 'asc' }],
    },
  })
  const contacts = res.contacts ?? []
  const last = contacts[contacts.length - 1] as { searchAfter?: unknown[] } | undefined
  const nextCursor = contacts.length > 0 && Array.isArray(last?.searchAfter) ? (last!.searchAfter as unknown[]) : null
  return { contacts, total: res.total ?? contacts.length, nextCursor }
}

/** Pagina automaticamente até `limite` contatos ou esgotar os resultados. */
export async function searchContactsAte(filters: ContactSearchFilter[], limite: number): Promise<WesalesContact[]> {
  const out: WesalesContact[] = []
  let cursor: unknown[] | undefined
  while (out.length < limite) {
    const page = await searchContacts(filters, { pageLimit: Math.min(100, limite - out.length), searchAfter: cursor })
    out.push(...page.contacts)
    if (!page.nextCursor || page.contacts.length === 0) break
    cursor = page.nextCursor
  }
  return out.slice(0, limite)
}

/** Só a contagem (não materializa os contatos) — usa o `total` da 1ª página. */
export async function countContacts(filters: ContactSearchFilter[]): Promise<number> {
  const page = await searchContacts(filters, { pageLimit: 1 })
  return page.total
}
