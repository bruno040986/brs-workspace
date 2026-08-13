/**
 * Configuração da Assinafy lida da tabela `assinafy_config`.
 *
 * A tabela guarda um único registro, com a api_key, o account_id do workspace,
 * o ambiente (sandbox/production) e o segredo de webhook. O ambiente decide a
 * base URL usada pelo cliente.
 *
 * Apenas back-end: a api_key nunca deve chegar ao cliente.
 */

import type { AssinafyEnvironment } from './types'

export const ASSINAFY_BASE_URLS: Record<AssinafyEnvironment, string> = {
  production: 'https://api.assinafy.com.br',
  sandbox: 'https://sandbox.assinafy.com.br',
}

export type AssinafyConfig = {
  id: string
  apiKey: string
  accountId: string
  environment: AssinafyEnvironment
  webhookSecret: string
  isActive: boolean
  baseUrl: string
}

/** Normaliza o valor de ambiente vindo do banco para os dois válidos. */
export function normalizeEnvironment(value: unknown): AssinafyEnvironment {
  return value === 'sandbox' ? 'sandbox' : 'production'
}

export function baseUrlFor(environment: AssinafyEnvironment): string {
  return ASSINAFY_BASE_URLS[environment]
}

/**
 * Busca a configuração da Assinafy no banco.
 *
 * Retorna `null` se não houver registro, se a tabela/colunas ainda não
 * existirem neste banco, ou se faltarem credenciais essenciais (api_key,
 * account_id). Nunca lança — o chamador decide o que fazer com a ausência.
 */
export async function getAssinafyConfig(): Promise<AssinafyConfig | null> {
  try {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const supabase = await createAdminClient()

    const { data, error } = await supabase
      .from('assinafy_config')
      .select('*')
      .limit(1)
      .maybeSingle()

    if (error || !data) return null

    const apiKey = String(data.api_key || '').trim()
    const accountId = String(data.account_id || '').trim()
    const environment = normalizeEnvironment(data.environment)

    if (!apiKey || !accountId) return null

    return {
      id: String(data.id),
      apiKey,
      accountId,
      environment,
      webhookSecret: String(data.webhook_secret || ''),
      isActive: Boolean(data.is_active),
      baseUrl: baseUrlFor(environment),
    }
  } catch (error) {
    console.error('Erro ao ler assinafy_config:', error)
    return null
  }
}

/**
 * Como `getAssinafyConfig`, mas exige que a integração esteja **ativa** e
 * completa. Lança com mensagem clara quando não dá para operar — usar nas
 * ações que realmente vão chamar a API.
 */
export async function requireActiveAssinafyConfig(): Promise<AssinafyConfig> {
  const config = await getAssinafyConfig()
  if (!config) {
    throw new Error(
      'Assinafy não configurada: informe API Key e Account ID em Configurações → API Assinatura Eletrônica.',
    )
  }
  if (!config.isActive) {
    throw new Error('Integração da Assinafy está desativada. Ative-a nas configurações antes de disparar.')
  }
  return config
}
