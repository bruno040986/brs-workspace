/**
 * Acesso à tabela `zapi_instances` (só back-end; usa service role).
 *
 * Nunca lança por tabela ausente — devolve vazio/null e deixa o chamador
 * decidir. `requireActiveInstance` lança com mensagem clara quando não dá para
 * operar (usar nas ações que realmente vão chamar a API).
 */

import type { ZapiInstancePublic, ZapiInstanceRow } from './types'
import { ZapiClient } from './client'

const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01'])
function isMissingTable(error: any): boolean {
  return !!error && MISSING_TABLE_CODES.has(String(error.code || ''))
}

async function admin() {
  const { createAdminClient } = await import('@/lib/supabase/server')
  return createAdminClient()
}

function coerceRow(row: any): ZapiInstanceRow {
  return {
    ...row,
    client_token: String(row?.client_token || ''),
    webhook_relay_urls: row?.webhook_relay_urls || {},
    webhook_flags: row?.webhook_flags || {},
  } as ZapiInstanceRow
}

/** Remove segredos antes de devolver ao cliente. */
export function toPublicInstance(row: ZapiInstanceRow): ZapiInstancePublic {
  const { token, client_token, ...rest } = row
  return { ...rest, has_token: !!token, has_client_token: !!client_token }
}

export async function listInstances(options: { activeOnly?: boolean } = {}): Promise<ZapiInstanceRow[]> {
  try {
    const supabase = await admin()
    let query = supabase.from('zapi_instances').select('*').order('is_default', { ascending: false }).order('name')
    if (options.activeOnly) query = query.eq('is_active', true)
    const { data, error } = await query
    if (error) {
      if (isMissingTable(error)) return []
      throw error
    }
    return (data || []).map(coerceRow)
  } catch (error) {
    console.error('Erro ao listar zapi_instances:', error)
    return []
  }
}

export async function getInstanceById(id: string): Promise<ZapiInstanceRow | null> {
  if (!id) return null
  try {
    const supabase = await admin()
    const { data, error } = await supabase.from('zapi_instances').select('*').eq('id', id).maybeSingle()
    if (error) {
      if (isMissingTable(error)) return null
      throw error
    }
    return data ? coerceRow(data) : null
  } catch (error) {
    console.error('Erro ao ler zapi_instances:', error)
    return null
  }
}

export async function getInstanceByWebhookKey(key: string): Promise<ZapiInstanceRow | null> {
  if (!key) return null
  try {
    const supabase = await admin()
    const { data, error } = await supabase.from('zapi_instances').select('*').eq('webhook_key', key).maybeSingle()
    if (error) {
      if (isMissingTable(error)) return null
      throw error
    }
    return data ? coerceRow(data) : null
  } catch (error) {
    console.error('Erro ao ler zapi_instances por webhook_key:', error)
    return null
  }
}

/** Instância padrão ativa; se não houver padrão, a primeira ativa. */
export async function getDefaultInstance(): Promise<ZapiInstanceRow | null> {
  const all = await listInstances({ activeOnly: true })
  return all.find((i) => i.is_default) || all[0] || null
}

/**
 * Resolve a instância para um envio: a pedida (se ativa) ou a padrão.
 * Retorna null quando não há nenhuma utilizável.
 */
export async function resolveInstanceForSend(instanceId?: string | null): Promise<ZapiInstanceRow | null> {
  if (instanceId) {
    const row = await getInstanceById(instanceId)
    if (row && row.is_active && row.instance_id && row.token) return row
  }
  const def = await getDefaultInstance()
  if (def && def.instance_id && def.token) return def
  return null
}

export async function requireActiveInstance(instanceId?: string | null): Promise<ZapiInstanceRow> {
  const row = await resolveInstanceForSend(instanceId)
  if (!row) {
    throw new Error(
      'Nenhuma instância Z-API ativa configurada. Cadastre em Configurações → API WhatsApp.',
    )
  }
  return row
}

export function clientForInstance(row: ZapiInstanceRow): ZapiClient {
  return ZapiClient.fromInstance(row)
}

/** Atualiza cache de status/device (após "Testar conexão" ou checagem do worker). */
export async function cacheInstanceHealth(id: string, patch: { last_status?: unknown; last_device?: unknown }) {
  try {
    const supabase = await admin()
    await supabase
      .from('zapi_instances')
      .update({ ...patch, last_checked_at: new Date().toISOString() })
      .eq('id', id)
  } catch (error) {
    console.error('Erro ao cachear saúde da instância:', error)
  }
}
