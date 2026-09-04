/**
 * Cliente da API QuarkRH (base https://api.quark.tec.br/rh/ext, paths /v1/*).
 *
 * Auth: header `Auth-token: <token>` (o Bruno gera no próprio acesso Quark).
 * Credencial cifrada em `quark_config` (cofre AES, CRM_CREDENTIALS_KEY) —
 * nunca chega ao navegador.
 *
 * Fase 1 (03/09/2026): SÓ LEITURA + mapeamento. A função `explorarEndpoints`
 * sonda caminhos candidatos e devolve status + amostra do corpo, para
 * confirmar os endpoints do Swagger (api-docs em /v3/api-docs). Escrita de volta no
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
    baseUrl: row?.base_url || 'https://api.quark.tec.br/rh/ext',
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
      base_url: (input.baseUrl ?? atual?.base_url ?? 'https://api.quark.tec.br/rh/ext').trim(),
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
  return { token: decifrarTexto(row.auth_token_enc), base: row.base_url || 'https://api.quark.tec.br/rh/ext' }
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
  '/v1/unidades',
  '/v1/colaboradores/',
  '/v1/cadastros-unidade/cargos',
  '/v1/beneficios/beneficio-colaborador',
  '/v1/beneficios/transporte',
  '/v1/beneficios/alimentacao',
  '/v1/ferias/calendario-ferias',
  '/v1/ausencias/',
  '/v1/saude-ocupacional/atestado-medico',
  '/v1/frequencias/carga-horaria',
  '/v1/solicitacoes-gerais/tipos',
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
    // /v1/unidades sempre existe e é leve; qualquer resposta que NÃO seja
    // 401 já prova que o token foi aceito.
    const r = await quarkGet('/v1/unidades')
    if (r.status === 401) return { ok: false, detalhe: 'Token recusado (401). Confira o Auth-token no acesso Quark.' }
    if (r.status === 0) return { ok: false, detalhe: 'Sem resposta da API.' }
    return { ok: true, detalhe: `Token aceito — /v1/unidades respondeu ${r.status}.` }
  } catch (err) {
    return { ok: false, detalhe: err instanceof Error ? err.message : 'Falha na conexão.' }
  }
}

// ===========================================================================
// Colaboradores (Etapa 1 da folha — sincronização)
// ===========================================================================

export type QuarkColaborador = {
  id: string
  nome: string
  cpf: string
  pis: string
  cargo: string
  vinculo: string
  setor: string
  admissao: string // dd/mm/aaaa ou aaaa-mm-dd (formato do Quark)
  esocial: string
}

function parseDataQuark(s: string): string | null {
  const t = String(s || '').trim()
  if (!t) return null
  // dd/mm/aaaa
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  // aaaa-mm-dd já ok
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  return null
}

/**
 * A API do Quark envelopa TODA resposta num ExtratorResponse:
 * { pagina, cliente, dados: [...], status, error, message }. A lista real
 * vem no campo `dados`. Este helper desembrulha e pagina (campo `pagina`).
 */
function extrairDados(env: any): any[] {
  if (Array.isArray(env)) return env
  if (Array.isArray(env?.dados)) return env.dados
  // fallbacks defensivos
  if (Array.isArray(env?.colaboradores)) return env.colaboradores
  if (Array.isArray(env?.content)) return env.content
  return []
}

/** Lista todos os colaboradores da unidade, seguindo a paginação do Quark. */
export async function listarColaboradoresQuark(): Promise<QuarkColaborador[]> {
  const acumulado: any[] = []
  let pagina = 0
  for (let i = 0; i < 200; i++) {
    const sep = '/v1/colaboradores/'.includes('?') ? '&' : '?'
    const env: any = (await quarkGet(`/v1/colaboradores/${sep}pagina=${pagina}`)) as any
    if (env?.error) throw new Error(`Quark: ${env.error}`)
    const lote = extrairDados(env)
    if (lote.length === 0) break
    acumulado.push(...lote)
    // sem sinal de próxima página → para (evita loop)
    const proxima = Number(env?.pagina)
    if (!Number.isFinite(proxima) || lote.length < 50) break
    pagina = proxima + 1
  }
  return acumulado.map((c: any) => ({
    id: String(c.id ?? ''),
    nome: String(c.nome ?? ''),
    cpf: String(c.pessoaCpfFormatado ?? c.cpf ?? '').replace(/\D/g, ''),
    pis: String(c.pisPessoa ?? c.pis ?? ''),
    cargo: String(c.cargoNivelSubNivelFormatado ?? c.cargoDenominacao ?? ''),
    vinculo: String(c.cargoVinculoDenominacao ?? ''),
    setor: String(c.setorDenominacao ?? ''),
    admissao: parseDataQuark(c.dataAdmissaoFormatada ?? c.dataAdmissao ?? '') ?? '',
    esocial: String(c.eletronicoSocial ?? c.esocial ?? ''),
  }))
}

/** Amostra crua do colaborador (debug/mapeamento). */
export async function amostraColaboradorQuark(): Promise<{ status: number; amostra: string }> {
  const r = await quarkGet('/v1/colaboradores/?pagina=0')
  const bruto = typeof r.body === 'string' ? r.body : JSON.stringify(r.body)
  return { status: r.status, amostra: bruto.slice(0, 1200) }
}
