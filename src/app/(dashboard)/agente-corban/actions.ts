'use server'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requirePermission as requireServerPermission } from '@/lib/auth/server'
import {
  AGENTE_CORBAN_CATALOGS,
  buildAgentesParceirosPersistenceRow,
  createEmptyAgenteCorbanDraft,
  normalizeAgenteCorbanDraftFromRow,
  normalizeStatus,
  type AgenteCorbanCatalogResource,
  type AgenteCorbanDraft,
} from '@/lib/agente-corban'

const supabaseAdmin = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
)

type CatalogRow = {
  id: string
  name: string
  is_active: boolean
  deleted_at: string | null
  created_at: string | null
  updated_at: string | null
}

type CompanyProfileLookup = {
  id: string
  nickname: string
  cnpj: string | null
  is_active: boolean
  company_data: Record<string, unknown> | null
}

type CommercialEntityLookup = {
  id: string
  name: string
  role: 'superintendente' | 'supervisor' | 'gerente' | string
  parent_id: string | null
  status: string | null
  cadastral_data: Record<string, unknown> | null
  arw_code: string | null
  filial: string | null
  nivel_acesso: string | null
  tipo_agente: string | null
  regra_fisico: string | null
}

export type AgenteCorbanListItem = {
  id: string
  name?: string | null
  cpf_cnpj?: string | null
  person_type?: string | null
  status?: string | null
  arw_code?: string | null
  filial?: string | null
  nivel_acesso?: string | null
  tipo_agente?: string | null
  regra_fisico?: string | null
  search_text: string
  superintendente?: { id: string; name: string | null; role: string | null } | null
  supervisor?: { id: string; name: string | null; role: string | null } | null
  gerente?: { id: string; name: string | null; role: string | null } | null
  [key: string]: unknown
}

type AgenteCorbanRecord = Record<string, unknown>

function getCatalogTable(resource: AgenteCorbanCatalogResource) {
  const entry = AGENTE_CORBAN_CATALOGS.find((item) => item.resource === resource)
  if (!entry) throw new Error('Catálogo inválido.')
  return entry.table
}

function isMissingTableError(error: unknown) {
  const err = error as { code?: string; message?: string } | null | undefined
  const message = String(err?.message || '')
  return err?.code === 'PGRST205' || /Could not find the table/i.test(message) || /does not exist/i.test(message)
}

async function safeSelect<T>(query: PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>, fallback: T): Promise<T> {
  try {
    const { data, error } = await query
    if (error) throw error
    return (data ?? fallback) as T
  } catch (error: unknown) {
    if (isMissingTableError(error)) return fallback
    throw error
  }
}

function normalizeMaybeObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

async function requireAgenteCorbanPermission(action: 'can_view' | 'can_include' | 'can_edit' | 'can_delete' | 'can_activate_inactivate' = 'can_view') {
  await requireServerPermission('agente-corban', action)
}

async function requireCatalogPermission(
  resource: AgenteCorbanCatalogResource,
  action: 'can_view' | 'can_include' | 'can_edit' | 'can_delete' | 'can_activate_inactivate' = 'can_view',
) {
  await requireServerPermission(resource, action)
}

function catalogLabel(resource: AgenteCorbanCatalogResource) {
  return AGENTE_CORBAN_CATALOGS.find((item) => item.resource === resource)?.label || resource
}

function revalidateAgenteCorbanPaths(id?: string | null) {
  revalidatePath('/agente-corban')
  revalidatePath('/agente-corban/novo')
  if (id) revalidatePath(`/agente-corban/${id}`)
  for (const catalog of AGENTE_CORBAN_CATALOGS) {
    revalidatePath(catalog.route)
  }
}

export async function getAgenteCorbanList(): Promise<
  | { success: true; items: AgenteCorbanListItem[] }
  | { success: false; error: string; items: [] }
> {
  try {
    await requireAgenteCorbanPermission('can_view')

    const { data, error } = await supabaseAdmin
      .from('agentes_parceiros')
      .select(`
        *,
        superintendente:superintendente_id ( id, name, role ),
        supervisor:supervisor_id ( id, name, role ),
        gerente:gerente_id ( id, name, role )
      `)
      .order('created_at', { ascending: false })

    if (error) throw error

    const items = ((data || []) as AgenteCorbanListItem[]).map((row) => ({
      ...row,
      search_text: String([
        row?.name,
        row?.cpf_cnpj,
        row?.arw_code,
        row?.filial,
        row?.nivel_acesso,
        row?.tipo_agente,
        row?.regra_fisico,
        row?.person_type,
        normalizeStatus(row?.status),
      ]
        .filter(Boolean)
        .join(' '))
        .toLowerCase(),
    }))

    return { success: true, items }
  } catch (error: any) {
    console.error('Erro ao buscar lista do Agente Corban:', error)
    return { success: false, error: error.message, items: [] }
  }
}

export async function getAgenteCorbanById(id: string) {
  try {
    await requireAgenteCorbanPermission('can_view')

    const recordId = String(id || '').trim()
    if (!recordId) return { success: false, error: 'ID inválido.', record: null, draft: createEmptyAgenteCorbanDraft() }

    const { data, error } = await supabaseAdmin
      .from('agentes_parceiros')
      .select(`
        *,
        superintendente:superintendente_id ( id, name, role ),
        supervisor:supervisor_id ( id, name, role ),
        gerente:gerente_id ( id, name, role )
      `)
      .eq('id', recordId)
      .maybeSingle()

    if (error) throw error
    if (!data) return { success: false, error: 'Registro não encontrado.', record: null, draft: createEmptyAgenteCorbanDraft() }

    return {
      success: true,
      record: data,
      draft: normalizeAgenteCorbanDraftFromRow(data),
    }
  } catch (error: any) {
    console.error('Erro ao carregar Agente Corban:', error)
    return { success: false, error: error.message, record: null, draft: createEmptyAgenteCorbanDraft() }
  }
}

export async function getAgenteCorbanLookups() {
  try {
    await requireAgenteCorbanPermission('can_view')

    const [companyProfiles, commercialEntities, catalogRows] = await Promise.all([
      safeSelect(
        supabaseAdmin
          .from('company_profiles')
          .select('id, nickname, cnpj, is_active, company_data')
          .order('is_active', { ascending: false })
          .order('nickname', { ascending: true }),
        [] as CompanyProfileLookup[],
      ),
      safeSelect(
        supabaseAdmin
          .from('commercial_entities')
          .select('id, name, role, parent_id, status, cadastral_data, arw_code, filial, nivel_acesso, tipo_agente, regra_fisico')
          .order('role', { ascending: true })
          .order('name', { ascending: true }),
        [] as CommercialEntityLookup[],
      ),
      Promise.all(
        AGENTE_CORBAN_CATALOGS.map(async (catalog) => {
          const rows = await safeSelect(
            supabaseAdmin
              .from(getCatalogTable(catalog.resource))
              .select('*')
              .order('is_active', { ascending: false })
              .order('name', { ascending: true }),
            [] as CatalogRow[],
          )
          return [catalog.resource, rows] as const
        }),
      ),
    ])

    const catalogs = Object.fromEntries(catalogRows)

    return {
      success: true,
      companyProfiles,
      commercialEntities,
      catalogs,
    }
  } catch (error: any) {
    console.error('Erro ao carregar lookups do Agente Corban:', error)
    return {
      success: false,
      error: error.message,
      companyProfiles: [],
      commercialEntities: [],
      catalogs: {},
    }
  }
}

export async function saveAgenteCorbanRecord(draft: Partial<AgenteCorbanDraft>) {
  try {
    const recordId = String(draft?.id || '').trim()
    await requireAgenteCorbanPermission(recordId ? 'can_edit' : 'can_include')

    let mergedDraft: AgenteCorbanDraft
    let existingRecord: AgenteCorbanRecord | null = null

    if (recordId) {
      const { data, error } = await supabaseAdmin
        .from('agentes_parceiros')
        .select('*')
        .eq('id', recordId)
        .maybeSingle()
      if (error) throw error
      if (!data) return { success: false, error: 'Registro não encontrado.', id: null }
      existingRecord = data
      mergedDraft = {
        ...normalizeAgenteCorbanDraftFromRow(data),
        ...draft,
        socios: draft.socios === undefined ? normalizeAgenteCorbanDraftFromRow(data).socios : (draft.socios || []),
        corban_data: normalizeMaybeObject(normalizeAgenteCorbanDraftFromRow(data).corban_data),
        additional_data: normalizeMaybeObject(normalizeAgenteCorbanDraftFromRow(data).additional_data),
      }
    } else {
      mergedDraft = {
        ...createEmptyAgenteCorbanDraft(),
        ...draft,
        socios: draft.socios === undefined ? createEmptyAgenteCorbanDraft().socios : (draft.socios || []),
      }
    }

    const persistence = buildAgentesParceirosPersistenceRow(mergedDraft)

    if (recordId) {
      const { error } = await supabaseAdmin
        .from('agentes_parceiros')
        .update(persistence)
        .eq('id', recordId)
      if (error) throw error

      revalidateAgenteCorbanPaths(recordId)
      return { success: true, id: recordId }
    }

    const insertPayload = {
      ...persistence,
      created_at: new Date().toISOString(),
    }

    const { data, error } = await supabaseAdmin
      .from('agentes_parceiros')
      .insert(insertPayload)
      .select('id')
      .maybeSingle()

    if (error) {
      if ((error as any)?.code === '23505') {
        const cpfCnpj = String(insertPayload.cpf_cnpj || '').trim()
        if (!cpfCnpj) throw error

        const { data: existing, error: existingError } = await supabaseAdmin
          .from('agentes_parceiros')
          .select('*')
          .eq('cpf_cnpj', cpfCnpj)
          .maybeSingle()
        if (existingError) throw existingError
        if (!existing) throw error

        const fallbackDraft = {
          ...normalizeAgenteCorbanDraftFromRow(existing),
          ...draft,
          id: existing.id,
          socios: draft.socios === undefined ? normalizeAgenteCorbanDraftFromRow(existing).socios : (draft.socios || []),
          corban_data: normalizeMaybeObject(normalizeAgenteCorbanDraftFromRow(existing).corban_data),
          additional_data: normalizeMaybeObject(normalizeAgenteCorbanDraftFromRow(existing).additional_data),
        }
        const fallbackPersistence = buildAgentesParceirosPersistenceRow(fallbackDraft)
        const { error: updateError } = await supabaseAdmin
          .from('agentes_parceiros')
          .update(fallbackPersistence)
          .eq('id', existing.id)
        if (updateError) throw updateError

        revalidateAgenteCorbanPaths(existing.id)
        return { success: true, id: existing.id, reused: true }
      }

      throw error
    }

    const insertedId = data?.id || null
    revalidateAgenteCorbanPaths(insertedId)
    return { success: true, id: insertedId }
  } catch (error: any) {
    console.error('Erro ao salvar Agente Corban:', error)
    return { success: false, error: error.message, id: null }
  }
}

export async function getAgenteCorbanCatalogRows(resource: AgenteCorbanCatalogResource) {
  try {
    await requireCatalogPermission(resource, 'can_view')

    const table = getCatalogTable(resource)
    const { data, error } = await supabaseAdmin
      .from(table)
      // '*' para incluir os campos extras do Tipo de Agente
      // (percentual_repasse, codigo_arw) — os outros catálogos ignoram.
      .select('*')
      .order('is_active', { ascending: false })
      .order('name', { ascending: true })

    if (error) throw error

    return { success: true, rows: (data || []) as CatalogRow[] }
  } catch (error: any) {
    if (isMissingTableError(error)) {
      return { success: true, rows: [] as CatalogRow[] }
    }
    console.warn(`Erro ao listar ${catalogLabel(resource)}:`, error)
    return { success: false, error: error.message, rows: [] as CatalogRow[] }
  }
}

export async function saveAgenteCorbanCatalogRow(
  resource: AgenteCorbanCatalogResource,
  payload: {
    id?: string
    name: string
    is_active?: boolean
    /** Só no catálogo Tipo de Agente (comissionamento). */
    percentual_repasse?: number | null
    codigo_arw?: number | null
  },
) {
  try {
    const isUpdate = !!String(payload.id || '').trim()
    await requireCatalogPermission(resource, isUpdate ? 'can_edit' : 'can_include')

    const table = getCatalogTable(resource)
    const name = String(payload.name || '').trim()
    if (!name) return { success: false, error: 'Informe o nome.', id: null }

    const row: Record<string, unknown> = {
      name,
      is_active: payload.is_active !== false,
      deleted_at: payload.is_active === false ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }
    if (resource === 'agente-corban-tipos-agente') {
      const pct = Number(payload.percentual_repasse)
      row.percentual_repasse = Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : null
      const cod = Number.parseInt(String(payload.codigo_arw ?? ''), 10)
      row.codigo_arw = Number.isFinite(cod) ? cod : null
    }

    if (isUpdate) {
      const { error } = await supabaseAdmin
        .from(table)
        .update(row)
        .eq('id', payload.id)
      if (error) throw error

      revalidatePath(AGENTE_CORBAN_CATALOGS.find((item) => item.resource === resource)?.route || '/agente-corban')
      return { success: true, id: payload.id || null }
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .insert({
        ...row,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .maybeSingle()
    if (error) throw error

    revalidatePath(AGENTE_CORBAN_CATALOGS.find((item) => item.resource === resource)?.route || '/agente-corban')
    return { success: true, id: data?.id || null }
  } catch (error: any) {
    console.error(`Erro ao salvar ${catalogLabel(resource)}:`, error)
    return { success: false, error: error.message, id: null }
  }
}

export async function setAgenteCorbanCatalogStatus(
  resource: AgenteCorbanCatalogResource,
  id: string,
  isActive: boolean,
) {
  try {
    await requireCatalogPermission(resource, 'can_activate_inactivate')

    const table = getCatalogTable(resource)
    const { error } = await supabaseAdmin
      .from(table)
      .update({
        is_active: isActive,
        deleted_at: isActive ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) throw error

    revalidatePath(AGENTE_CORBAN_CATALOGS.find((item) => item.resource === resource)?.route || '/agente-corban')
    return { success: true }
  } catch (error: any) {
    console.error(`Erro ao alterar status de ${catalogLabel(resource)}:`, error)
    return { success: false, error: error.message }
  }
}
