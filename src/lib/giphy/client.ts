/**
 * GIPHY — chave única do grupo, cifrada em `giphy_config` (cofre AES,
 * CRM_CREDENTIALS_KEY; a mesma chave existe no ambiente do CRM AlvoConsig,
 * que lê esta tabela direto pelo service role e decifra com o cofre dele).
 * Nunca chega ao navegador: a busca de GIFs roda no servidor de quem usa.
 *
 * Contexto: o Tenor foi descontinuado pelo Google em 30/06/2026; a conta
 * GIPHY do grupo é @brspromotora e a chave nasce em developers.giphy.com →
 * Create an App → tipo API (beta sai na hora; produção pede aprovação).
 */
import { createAdminClient } from '@/lib/supabase/server'
import { cifrarTexto, decifrarTexto } from '@/lib/central-conversas/cofre'

export const GIPHY_API_BASE = 'https://api.giphy.com/v1'

export type GiphyConfigPublica = {
  temChave: boolean
  rating: 'g' | 'pg' | 'pg-13'
  isActive: boolean
  atualizadoEm: string | null
}

type ConfigRow = {
  id: number
  api_key_enc: string | null
  rating: 'g' | 'pg' | 'pg-13'
  is_active: boolean
  updated_at: string | null
}

export async function lerGiphyConfigRow(): Promise<ConfigRow | null> {
  const admin = await createAdminClient()
  const { data, error } = await admin.from('giphy_config').select('*').eq('id', 1).maybeSingle()
  if (error) {
    if (String(error.message || '').includes('giphy_config')) return null
    throw error
  }
  return (data as ConfigRow | null) || null
}

export async function lerGiphyConfigPublica(): Promise<GiphyConfigPublica> {
  const row = await lerGiphyConfigRow()
  return {
    temChave: Boolean(row?.api_key_enc),
    rating: row?.rating || 'g',
    isActive: row?.is_active !== false,
    atualizadoEm: row?.updated_at || null,
  }
}

export async function salvarGiphyConfig(input: { apiKey?: string; rating: 'g' | 'pg' | 'pg-13'; isActive: boolean; updatedBy: string }): Promise<void> {
  const admin = await createAdminClient()
  const atual = await lerGiphyConfigRow()
  const { error } = await admin.from('giphy_config').upsert(
    {
      id: 1,
      api_key_enc: input.apiKey?.trim() ? cifrarTexto(input.apiKey.trim()) : atual?.api_key_enc || null,
      rating: input.rating,
      is_active: input.isActive,
      updated_at: new Date().toISOString(),
      updated_by: input.updatedBy,
    },
    { onConflict: 'id' },
  )
  if (error) throw error
}

async function chave(): Promise<string> {
  const row = await lerGiphyConfigRow()
  if (!row?.api_key_enc) throw new Error('Chave do GIPHY não configurada (Provedores e APIs › Figurinhas/GIFs).')
  return decifrarTexto(row.api_key_enc)
}

/** GET autenticado na API do GIPHY (status + corpo). */
export async function giphyGet(path: string, params: Record<string, string> = {}): Promise<{ status: number; ok: boolean; body: unknown }> {
  const apiKey = await chave()
  const url = new URL(`${GIPHY_API_BASE}${path}`)
  url.searchParams.set('api_key', apiKey)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), cache: 'no-store' })
    const texto = await res.text()
    let body: unknown = texto
    try {
      body = JSON.parse(texto)
    } catch {
      /* corpo não é JSON */
    }
    return { status: res.status, ok: res.ok, body }
  } catch (err) {
    return { status: 0, ok: false, body: err instanceof Error ? err.message : String(err) }
  }
}

export async function testarConexaoGiphy(): Promise<{ ok: boolean; detalhe: string }> {
  try {
    // /gifs/trending?limit=1 é o endpoint mais leve; 401/403 = chave recusada.
    const r = await giphyGet('/gifs/trending', { limit: '1', rating: 'g' })
    if (r.status === 401 || r.status === 403) return { ok: false, detalhe: `Chave recusada (${r.status}). Confira a chave em developers.giphy.com.` }
    if (r.status === 429) return { ok: false, detalhe: 'Limite de requisições da chave (429) — chave beta tem cota baixa; tente de novo em instantes.' }
    if (r.status === 0) return { ok: false, detalhe: `Sem resposta da API: ${String(r.body)}` }
    if (!r.ok) return { ok: false, detalhe: `GIPHY respondeu ${r.status}.` }
    const total = Array.isArray((r.body as { data?: unknown[] })?.data) ? (r.body as { data: unknown[] }).data.length : 0
    return { ok: true, detalhe: `Chave aceita — /gifs/trending respondeu ${r.status} (${total} item).` }
  } catch (err) {
    return { ok: false, detalhe: err instanceof Error ? err.message : 'Falha na conexão.' }
  }
}
