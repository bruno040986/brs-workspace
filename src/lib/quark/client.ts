/**
 * Cliente da API QuarkRH (https://api.quark.tec.br/v1).
 *
 * Auth: header `Auth-token: <token>` (o Bruno gera no próprio acesso Quark).
 * Credencial cifrada em `quark_config` (cofre AES, CRM_CREDENTIALS_KEY) —
 * nunca chega ao navegador.
 *
 * Fase 1 (03/09/2026): SÓ LEITURA + mapeamento. A função `explorarEndpoints`
 * sonda caminhos candidatos e devolve status + amostra do corpo, para
 * descobrir os shapes reais (não há Swagger público). Escrita de volta no
 * Quark é fase posterior, com o inventário em mãos.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { cifrarTexto, decifrarTexto } from '@/lib/central-conversas/cofre'

export type QuarkConfigPublica = {
  temToken: boolean
  baseUrl: string
  isActive: boolean
  atualizadoEm: string | null
}

type ConfigRow = {
  id: number
  auth_token_enc: string | null
  base_url: string
  is_active: boolean
  updated_at: string | null
}

export async function lerQuarkConfigRow(): Promise<ConfigRow | null> {
  const admin = await createAdminClient()
  const { data, error } = await admin.from('quark_config').select('*').eq('id', 1).maybeSingle()
  if (error) {
    if (String(error.message || '').includes('quark_config')) return null
    throw error
  }
  return (data as ConfigRow | null) || null
}

export async function lerQuarkConfigPublica(): Promise<QuarkConfigPublica> {
  const row = await lerQuarkConfigRow()
  return {
    temToken: Boolean(row?.auth_token_enc),
    baseUrl: row?.base_url || 'https://api.quark.tec.br/v1',
    isActive: row?.is_active !== false,
    atualizadoEm: row?.updated_at || null,
  }
}

export async function salvarQuarkConfig(input: {
  authToken?: string
  baseUrl?: string
  isActive: boolean
  updatedBy: string
}): Promise<void> {
  const admin = await createAdminClient()
  const atual = await lerQuarkConfigRow()
  const { error } = await admin.from('quark_config').upsert(
    {
      id: 1,
      auth_token_enc: input.authToken?.trim() ? cifrarTexto(input.authToken.trim()) : atual?.auth_token_enc || null,
      base_url: (input.baseUrl ?? atual?.base_url ?? 'https://api.quark.tec.br/v1').trim(),
      is_active: input.isActive,
      updated_at: new Date().toISOString(),
      updated_by: input.updatedBy,
    },
    { onConflict: 'id' },
  )
  if (error) throw error
}

async function tokenEBase(): Promise<{ token: string; base: string }> {
  const row = await lerQuarkConfigRow()
  if (!row?.auth_token_enc) throw new Error('Token do QuarkRH não configurado (Provedores e APIs › QuarkRH).')
  return { token: decifrarTexto(row.auth_token_enc), base: row.base_url || 'https://api.quark.tec.br/v1' }
}

/** GET autenticado, devolvendo status + corpo (json ou texto). */
export async function quarkGet(path: string): Promise<{ status: number; ok: boolean; body: unknown }> {
  const { token, base } = await tokenEBase()
  const res = await fetch(`${base}${path}`, {
    headers: { 'Auth-token': token, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  const texto = await res.text()
  let body: unknown = texto
  try {
    body = texto ? JSON.parse(texto) : null
  } catch {
    body = texto
  }
  return { status: res.status, ok: res.ok, body }
}

// Caminhos candidatos do mapeamento (Fase 1). A ordem cobre o essencial de
// folha: empresa → colaboradores → estrutura → rubricas/eventos → folha.
export const QUARK_ENDPOINTS_SONDA = [
  '/empresa',
  '/empresas',
  '/colaboradores',
  '/colaborador',
  '/funcionarios',
  '/departamentos',
  '/cargos',
  '/rubricas',
  '/eventos',
  '/proventos',
  '/descontos',
  '/holerite',
  '/holerites',
  '/folha',
  '/folha-pagamento',
  '/competencias',
  '/ponto',
  '/afastamentos',
  '/ferias',
  '/beneficios',
]

export type SondaResultado = { path: string; status: number; amostra: string }

/**
 * Sonda os endpoints candidatos e devolve status + uma amostra curta do
 * corpo de cada um — o suficiente para eu montar o inventário sem despejar
 * dados sensíveis inteiros na tela.
 */
export async function explorarEndpoints(): Promise<SondaResultado[]> {
  const resultados: SondaResultado[] = []
  for (const path of QUARK_ENDPOINTS_SONDA) {
    try {
      const r = await quarkGet(path)
      const bruto = typeof r.body === 'string' ? r.body : JSON.stringify(r.body)
      resultados.push({ path, status: r.status, amostra: String(bruto).slice(0, 400) })
    } catch (err) {
      resultados.push({ path, status: 0, amostra: err instanceof Error ? err.message : 'erro' })
    }
  }
  return resultados
}

export async function testarConexaoQuark(): Promise<{ ok: boolean; detalhe: string }> {
  try {
    // /empresa é o mais provável de existir e ser leve; qualquer 2xx/4xx que
    // NÃO seja 401 já prova que o token foi aceito.
    const r = await quarkGet('/empresa')
    if (r.status === 401) return { ok: false, detalhe: 'Token recusado (401). Confira o Auth-token no acesso Quark.' }
    if (r.status === 0) return { ok: false, detalhe: 'Sem resposta da API.' }
    return { ok: true, detalhe: `Token aceito — /empresa respondeu ${r.status}.` }
  } catch (err) {
    return { ok: false, detalhe: err instanceof Error ? err.message : 'Falha na conexão.' }
  }
}
