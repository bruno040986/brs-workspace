import { createAdminClient } from '@/lib/supabase/server'
import { normalizeTiers } from './pricing'
import type { NvtiConfigRow, NvtiMetodo } from './types'

export type NvtiConfigState = NvtiConfigRow & {
  has_credentials: boolean
}

function normalizeMetodo(value: unknown): NvtiMetodo {
  return String(value || '') === 'NvBookCelObWhats' ? 'NvBookCelObWhats' : 'NVBOOK_CEL_OBG'
}

function normalizeMoney(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.round(parsed * 100) / 100
}

export function createEmptyNvtiConfig(): NvtiConfigState {
  return {
    id: '',
    usuario: '',
    senha: '',
    cliente: '',
    metodo: 'NVBOOK_CEL_OBG',
    token: '',
    token_generated_at: null,
    monthly_cap_brl: 500,
    user_monthly_cap_brl: 15,
    cache_days: 30,
    price_tiers: normalizeTiers(null),
    is_active: true,
    created_at: null,
    updated_at: null,
    has_credentials: false,
  }
}

function normalizeRow(row: Record<string, unknown> | null): NvtiConfigState {
  if (!row) return createEmptyNvtiConfig()
  const usuario = String(row.usuario || '')
  const senha = String(row.senha || '')
  const cliente = String(row.cliente || '')
  return {
    id: String(row.id || ''),
    usuario,
    senha,
    cliente,
    metodo: normalizeMetodo(row.metodo),
    token: String(row.token || ''),
    token_generated_at: row.token_generated_at ? String(row.token_generated_at) : null,
    monthly_cap_brl: normalizeMoney(row.monthly_cap_brl, 500),
    user_monthly_cap_brl: normalizeMoney(row.user_monthly_cap_brl, 15),
    cache_days: Math.max(0, Number.parseInt(String(row.cache_days ?? 30), 10) || 0),
    price_tiers: normalizeTiers(row.price_tiers),
    is_active: row.is_active !== false,
    created_at: row.created_at ? String(row.created_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
    has_credentials: Boolean(usuario && senha && cliente),
  }
}

export async function getNvtiConfig(): Promise<NvtiConfigState> {
  try {
    const supabase = await createAdminClient()
    const { data, error } = await supabase
      .from('nvti_config')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return normalizeRow(data as Record<string, unknown> | null)
  } catch {
    return createEmptyNvtiConfig()
  }
}

export type SaveNvtiConfigInput = {
  id?: string
  usuario: string
  senha?: string
  cliente: string
  metodo: NvtiMetodo
  monthly_cap_brl?: number
  user_monthly_cap_brl?: number
  cache_days: number
  price_tiers: unknown
  is_active: boolean
}

export async function saveNvtiConfig(input: SaveNvtiConfigInput): Promise<{ id: string }> {
  const supabase = await createAdminClient()

  const payload: Record<string, unknown> = {
    usuario: input.usuario.trim(),
    cliente: input.cliente.trim(),
    metodo: normalizeMetodo(input.metodo),
    cache_days: Math.max(0, Math.trunc(input.cache_days)),
    price_tiers: normalizeTiers(input.price_tiers),
    is_active: input.is_active,
  }
  if (input.monthly_cap_brl !== undefined) payload.monthly_cap_brl = normalizeMoney(input.monthly_cap_brl, 500)
  if (input.user_monthly_cap_brl !== undefined) payload.user_monthly_cap_brl = normalizeMoney(input.user_monthly_cap_brl, 15)
  // Senha nova invalida o token cacheado.
  if (input.senha && input.senha.trim()) {
    payload.senha = input.senha.trim()
    payload.token = ''
    payload.token_generated_at = null
  }

  if (input.id) {
    const { error } = await supabase.from('nvti_config').update(payload).eq('id', input.id)
    if (error) throw error
    return { id: input.id }
  }

  const { data, error } = await supabase.from('nvti_config').insert(payload).select('id').single()
  if (error) throw error
  return { id: String(data.id) }
}

export async function saveNvtiToken(configId: string, token: string): Promise<void> {
  const supabase = await createAdminClient()
  await supabase
    .from('nvti_config')
    .update({ token, token_generated_at: new Date().toISOString() })
    .eq('id', configId)
}
