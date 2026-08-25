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
// Campos personalizados — de CONTATO ou de OPORTUNIDADE (modelos distintos,
// cache separado por modelo). Oportunidade é o que passou a guardar cada
// oferta (REFIN/Novo/Cartão) — ver src/lib/alvoconsig/ofertas-wesales.ts.
// ---------------------------------------------------------------------------

export type CustomFieldModel = 'contact' | 'opportunity'
type CustomFieldDef = { id: string; fieldKey?: string; name?: string; model?: string }

const customFieldsCache = new Map<CustomFieldModel, CustomFieldDef[]>()

async function listCustomFields(model: CustomFieldModel = 'contact'): Promise<CustomFieldDef[]> {
  const cached = customFieldsCache.get(model)
  if (cached) return cached
  const res = await http<{ customFields?: CustomFieldDef[] }>(`/locations/${locationId()}/customFields?model=${model}`)
  const fields = res.customFields || []
  customFieldsCache.set(model, fields)
  return fields
}

function fieldKeyMatches(def: CustomFieldDef, key: string, model: CustomFieldModel) {
  const target = key.toLowerCase()
  const fieldKey = String(def.fieldKey || '').toLowerCase()
  return fieldKey === target || fieldKey === `${model}.${target}` || fieldKey.endsWith(`.${target}`)
}

export async function resolveCustomField(key: string, model: CustomFieldModel = 'contact'): Promise<CustomFieldDef | null> {
  const fields = await listCustomFields(model)
  return fields.find((def) => fieldKeyMatches(def, key, model)) || null
}

/** Garante que o campo personalizado existe na location (cria se faltar). */
export async function ensureCustomField(key: string, name: string, model: CustomFieldModel = 'contact'): Promise<CustomFieldDef> {
  const existing = await resolveCustomField(key, model)
  if (existing) return existing
  const res = await http<{ customField?: CustomFieldDef } & CustomFieldDef>(`/locations/${locationId()}/customFields`, {
    method: 'POST',
    body: { name, dataType: 'TEXT', model, fieldKey: key },
  })
  customFieldsCache.delete(model)
  return (res.customField || res) as CustomFieldDef
}

/** Remove a DEFINIÇÃO do campo (não só o valor) — usado na faxina de campos descontinuados. */
export async function deleteCustomField(fieldId: string, model: CustomFieldModel = 'contact'): Promise<void> {
  await http(`/locations/${locationId()}/customFields/${fieldId}`, { method: 'DELETE' })
  customFieldsCache.delete(model)
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

// ---------------------------------------------------------------------------
// Oportunidades — cada oferta (REFIN/Novo/Cartão) vira uma. Ver
// src/lib/alvoconsig/ofertas-wesales.ts para o pipeline/etapas/campos.
// ---------------------------------------------------------------------------

export type WesalesOpportunity = {
  id: string
  name?: string
  pipelineId?: string
  pipelineStageId?: string
  status?: 'open' | 'won' | 'lost' | 'abandoned'
  monetaryValue?: number
  contactId?: string
  customFields?: Array<{ id: string; fieldValue?: unknown; value?: unknown }>
  [key: string]: unknown
}

export function opportunityFieldValue(op: WesalesOpportunity, fieldId: string): string | null {
  const found = (op.customFields || []).find((f) => f.id === fieldId)
  const raw = found ? (found.fieldValue ?? found.value) : null
  return raw === null || raw === undefined ? null : String(raw)
}

export type OpportunityPayload = {
  contactId: string
  pipelineId: string
  pipelineStageId: string
  name: string
  status?: 'open' | 'won' | 'lost' | 'abandoned'
  monetaryValue?: number
  customFields?: Array<{ id: string; fieldValue: string }>
}

export async function createOpportunity(payload: OpportunityPayload): Promise<WesalesOpportunity> {
  const res = await http<{ opportunity: WesalesOpportunity }>(`/opportunities/`, {
    method: 'POST',
    body: { locationId: locationId(), status: 'open', ...payload },
  })
  return res.opportunity
}

export async function updateOpportunity(
  opportunityId: string,
  patch: {
    pipelineStageId?: string
    status?: 'open' | 'won' | 'lost' | 'abandoned'
    monetaryValue?: number
    name?: string
    customFields?: Array<{ id: string; fieldValue: string }>
  },
): Promise<WesalesOpportunity> {
  const res = await http<{ opportunity: WesalesOpportunity }>(`/opportunities/${opportunityId}`, { method: 'PUT', body: patch })
  return res.opportunity
}

/** Endpoint dedicado — muda só o status (ganha/perdida), sem mexer na etapa. */
export async function updateOpportunityStatus(opportunityId: string, status: 'open' | 'won' | 'lost' | 'abandoned'): Promise<void> {
  await http(`/opportunities/${opportunityId}/status`, { method: 'PUT', body: { status } })
}

/** Oportunidades de um contato (opcionalmente só de um pipeline) — pra decidir criar vs atualizar. */
export async function findOpportunitiesByContact(contactId: string, pipelineId?: string): Promise<WesalesOpportunity[]> {
  const params = new URLSearchParams({ location_id: locationId(), contact_id: contactId })
  if (pipelineId) params.set('pipeline_id', pipelineId)
  const res = await http<{ opportunities?: WesalesOpportunity[] }>(`/opportunities/search?${params.toString()}`)
  return res.opportunities ?? []
}

export async function getOpportunity(opportunityId: string): Promise<WesalesOpportunity | null> {
  try {
    const res = await http<{ opportunity: WesalesOpportunity }>(`/opportunities/${opportunityId}`)
    return res.opportunity ?? null
  } catch {
    return null
  }
}

/**
 * `findOpportunitiesByContact` (busca em lista) não devolve os `customFields`
 * de cada oportunidade — incidente 25/08/2026: dedup por campo (instituição+
 * tabela) sempre falhava e duplicava a mesma oferta a cada reimportação.
 * Esta versão busca o DETALHE de cada uma (GET por id, que devolve completo)
 * antes de qualquer comparação por campo.
 */
export async function findOpportunitiesByContactDetalhadas(contactId: string, pipelineId?: string): Promise<WesalesOpportunity[]> {
  const resumidas = await findOpportunitiesByContact(contactId, pipelineId)
  const detalhadas = await Promise.all(resumidas.map((op) => getOpportunity(op.id)))
  return detalhadas.filter((op): op is WesalesOpportunity => op !== null)
}

export type WesalesPipelineStage = { id: string; name: string }
export type WesalesPipeline = { id: string; name: string; stages?: WesalesPipelineStage[] }

let pipelinesCache: WesalesPipeline[] | null = null

async function listPipelines(): Promise<WesalesPipeline[]> {
  if (pipelinesCache) return pipelinesCache
  const res = await http<{ pipelines?: WesalesPipeline[] }>(`/opportunities/pipelines?locationId=${locationId()}`)
  pipelinesCache = res.pipelines ?? []
  return pipelinesCache
}

function normalizarNome(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export async function resolvePipeline(nome: string): Promise<WesalesPipeline | null> {
  const pipelines = await listPipelines()
  const alvo = normalizarNome(nome)
  return pipelines.find((p) => normalizarNome(p.name) === alvo) || null
}

export async function resolvePipelineStage(pipelineNome: string, estagioNome: string): Promise<{ pipeline: WesalesPipeline; stage: WesalesPipelineStage } | null> {
  const pipeline = await resolvePipeline(pipelineNome)
  if (!pipeline) return null
  const alvo = normalizarNome(estagioNome)
  const stage = (pipeline.stages || []).find((s) => normalizarNome(s.name) === alvo)
  return stage ? { pipeline, stage } : null
}

// ---------------------------------------------------------------------------
// Empresas ("Consignantes/Empregadores", objeto Business renomeado no
// WeSales) — um registro por convênio, fonte de "a quem esse contato está
// vinculado" (ver src/lib/alvoconsig/consignantes-wesales.ts).
//
// IMPORTANTE: campo personalizado em Empresa NÃO passa pelos endpoints
// `/businesses/*` (esses só aceitam os campos padrão — nome/endereço/etc,
// sem customFields) nem pelo `/locations/{id}/customFields` que o resto
// deste arquivo usa (o `model` dele só aceita contact/opportunity/all).
// Empresa usa a família `/custom-fields/*` (definição do campo) e
// `/objects/business/records/*` (valor do registro) — validado direto na
// API em 24/08/2026 antes de escrever este código. Nessa API de records, o
// valor de CADA campo (padrão ou personalizado) mora junto em `properties`,
// como objeto plano chaveado pelo sufixo da fieldKey (`name`, `city`,
// `alvoconsig_tipo`, ...) — bem mais simples que o modelo de
// id-de-campo+valor usado em contato/oportunidade.
// ---------------------------------------------------------------------------

export type WesalesBusinessRecord = { id: string; properties: Record<string, unknown> }

export async function createBusinessRecord(properties: Record<string, unknown>): Promise<WesalesBusinessRecord> {
  const res = await http<{ record: WesalesBusinessRecord }>(`/objects/business/records?locationId=${locationId()}`, {
    method: 'POST',
    body: { properties },
  })
  return res.record
}

export async function updateBusinessRecord(businessId: string, properties: Record<string, unknown>): Promise<WesalesBusinessRecord> {
  const res = await http<{ record: WesalesBusinessRecord }>(`/objects/business/records/${businessId}?locationId=${locationId()}`, {
    method: 'PUT',
    body: { properties },
  })
  return res.record
}

export async function getBusinessRecord(businessId: string): Promise<WesalesBusinessRecord | null> {
  try {
    const res = await http<{ record: WesalesBusinessRecord }>(`/objects/business/records/${businessId}?locationId=${locationId()}`)
    return res.record ?? null
  } catch {
    return null
  }
}

/** Vincula (ou desvincula, com businessId=null) até 50 contatos por chamada a uma Empresa. */
export async function setContactsBusiness(contactIds: string[], businessId: string | null): Promise<void> {
  for (let i = 0; i < contactIds.length; i += 50) {
    const chunk = contactIds.slice(i, i + 50)
    if (!chunk.length) continue
    await http(`/contacts/bulk/business`, { method: 'POST', body: { ids: chunk, businessId } })
  }
}

type BusinessFieldSchema = {
  fields: Array<{ id: string; fieldKey: string }>
  folders: Array<{ id: string; objectKey: string }>
}

let businessSchemaCache: BusinessFieldSchema | null = null

async function businessSchema(): Promise<BusinessFieldSchema> {
  if (businessSchemaCache) return businessSchemaCache
  const res = await http<BusinessFieldSchema>(`/custom-fields/object-key/business?locationId=${locationId()}`)
  businessSchemaCache = { fields: res.fields || [], folders: res.folders || [] }
  return businessSchemaCache
}

/**
 * Garante que o campo personalizado existe em Empresa (cria se faltar) e
 * devolve a chave curta (sufixo) — já é o que `properties` usa em
 * create/updateBusinessRecord.
 */
export async function ensureBusinessCustomField(key: string, name: string): Promise<string> {
  const schema = await businessSchema()
  const existing = schema.fields.find((f) => f.fieldKey === `business.${key}`)
  if (existing) return key

  const folder = schema.folders.find((f) => f.objectKey === 'business')
  if (!folder) throw new Error('Pasta de campos personalizados de Empresa não encontrada no WeSales.')

  await http(`/custom-fields/?locationId=${locationId()}`, {
    method: 'POST',
    body: { locationId: locationId(), name, dataType: 'TEXT', fieldKey: `business.${key}`, objectKey: 'business', parentId: folder.id, showInForms: false },
  })
  businessSchemaCache = null
  return key
}
