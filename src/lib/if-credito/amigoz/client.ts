/**
 * Adaptador Amigoz — Fatia 1 (descoberta). SÓ servidor.
 *
 * API: parceiros.amigozconsig.com.br (doc em /redoc, v1.3.2). REST síncrona,
 * sem webhook. Autenticação em 3 passos: POST /api/login (usuário+senha →
 * JWT access/refresh), POST /api/login/seleciona-corban (corban_id) e
 * POST /api/login/refresh. Os schemas de resposta da doc estão vazios, então
 * o parser de token é tolerante (access | access_token | token; refresh |
 * refresh_token) e a validade sai do `exp` do próprio JWT.
 *
 * Toda chamada fica registrada em if_credito_chamadas com a requisição
 * SANITIZADA (nunca senha, nunca token) e a resposta bruta — é assim que a
 * descoberta fixa o formato das margens/ofertas antes da Fatia 2.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { cifrarTexto, decifrarTexto } from '@/lib/central-conversas/cofre'

export const AMIGOZ_BASE_URL_PADRAO = 'https://parceiros.amigozconsig.com.br'

/** Averbadoras da doc (ConsultaQueryParams.averbadora). */
export const AMIGOZ_AVERBADORAS: Record<number, string> = {
  1: 'FACIL',
  2: 'ZETRASOFT',
  3: 'QUANTUM',
  5: 'DATAPREV',
  6: 'SERPRO',
  7: 'NEOCONSIG',
  8: 'SAFECONSIG',
}

/** Tipos de produto da doc (EnumTipoProdutoSwagger). */
export const AMIGOZ_TIPOS_PRODUTO: Record<number, string> = {
  7: 'Cartão Benefício',
  14: 'Saque Complementar',
  15: 'Cartão Consignado',
  19: 'Retenção WhatsApp',
  21: 'Refin Saque Cartão',
  22: 'Agregação Margem Cartão',
  23: 'Consignado Privado',
}

export type ConfigAmigoz = {
  instituicaoId: string
  baseUrl: string
  usuario: string
  senha: string
  corbanIdExterno: string
  accessToken: string | null
  tokenExpiraEm: Date | null
  refreshToken: string | null
  ativo: boolean
}

export type ResultadoChamada = {
  ok: boolean
  status: number
  corpo: unknown
  duracaoMs: number
}

type Json = Record<string, unknown>

function ehObjeto(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Lê o `exp` do JWT sem validar assinatura (só pra saber quando renovar). */
function expiracaoDoJwt(token: string): Date | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Json
    const exp = Number(json.exp)
    return Number.isFinite(exp) ? new Date(exp * 1000) : null
  } catch {
    return null
  }
}

function extrairTokens(corpo: unknown): { access: string | null; refresh: string | null } {
  if (!ehObjeto(corpo)) return { access: null, refresh: null }
  // Alguns backends embrulham em { data: {...} } — olha um nível abaixo também.
  const fontes: Json[] = [corpo]
  if (ehObjeto(corpo.data)) fontes.push(corpo.data)
  let access: string | null = null
  let refresh: string | null = null
  for (const f of fontes) {
    for (const k of ['access', 'access_token', 'token']) {
      if (!access && typeof f[k] === 'string') access = f[k] as string
    }
    for (const k of ['refresh', 'refresh_token']) {
      if (!refresh && typeof f[k] === 'string') refresh = f[k] as string
    }
  }
  return { access, refresh }
}

/** Localiza a IF "Amigoz" no cadastro (fonte da verdade de quem tem API). */
export async function obterInstituicaoAmigoz(): Promise<{ id: string; name: string } | null> {
  const admin = await createAdminClient()
  const { data } = await admin
    .from('financial_institutions')
    .select('id, name')
    .is('deleted_at', null)
    .ilike('name', '%amigoz%')
    .limit(1)
    .maybeSingle()
  return data ? { id: String(data.id), name: String(data.name) } : null
}

export async function carregarConfigAmigoz(): Promise<ConfigAmigoz> {
  const inst = await obterInstituicaoAmigoz()
  if (!inst) throw new Error('Amigoz não está cadastrada em Instituições Financeiras.')
  const admin = await createAdminClient()
  const { data, error } = await admin
    .from('if_credito_config')
    .select('base_url, usuario, senha_enc, corban_id_externo, access_token_enc, token_expira_em, refresh_token_enc, ativo')
    .eq('instituicao_financeira_id', inst.id)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Amigoz sem configuração: preencha usuário, senha e corban no card da IF.')
  if (!data.usuario || !data.senha_enc) throw new Error('Amigoz sem usuário/senha configurados.')
  return {
    instituicaoId: inst.id,
    baseUrl: String(data.base_url || AMIGOZ_BASE_URL_PADRAO).replace(/\/+$/, ''),
    usuario: String(data.usuario),
    senha: decifrarTexto(String(data.senha_enc)),
    corbanIdExterno: String(data.corban_id_externo || '').trim(),
    accessToken: data.access_token_enc ? decifrarTexto(String(data.access_token_enc)) : null,
    tokenExpiraEm: data.token_expira_em ? new Date(String(data.token_expira_em)) : null,
    refreshToken: data.refresh_token_enc ? decifrarTexto(String(data.refresh_token_enc)) : null,
    ativo: Boolean(data.ativo),
  }
}

async function guardarTokens(instituicaoId: string, access: string, refresh: string | null) {
  const admin = await createAdminClient()
  const row: Record<string, unknown> = {
    access_token_enc: cifrarTexto(access),
    token_expira_em: expiracaoDoJwt(access)?.toISOString() ?? new Date(Date.now() + 30 * 60_000).toISOString(),
    updated_at: new Date().toISOString(),
  }
  if (refresh) row.refresh_token_enc = cifrarTexto(refresh)
  await admin.from('if_credito_config').update(row).eq('instituicao_financeira_id', instituicaoId)
}

/** Remove das requisições gravadas qualquer campo sensível. */
function sanitizar(body: unknown): unknown {
  if (!ehObjeto(body)) return body
  const copia: Json = {}
  for (const [k, v] of Object.entries(body)) {
    copia[k] = /senha|password|token|refresh|secret/i.test(k) ? '***' : v
  }
  return copia
}

/**
 * Chamada HTTP crua + registro em if_credito_chamadas. `token` opcional
 * (login não tem). Corpo devolvido como JSON quando possível, senão texto.
 */
export async function chamarAmigoz(
  cfg: Pick<ConfigAmigoz, 'instituicaoId' | 'baseUrl'>,
  operacao: string,
  metodo: 'GET' | 'POST',
  caminho: string,
  body?: unknown,
  token?: string | null,
  criadoPor?: string | null
): Promise<ResultadoChamada> {
  const inicio = Date.now()
  let status = 0
  let corpo: unknown = null
  try {
    const res = await fetch(`${cfg.baseUrl}${caminho}`, {
      method: metodo,
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(60_000),
    })
    status = res.status
    const texto = await res.text()
    try {
      corpo = texto ? JSON.parse(texto) : null
    } catch {
      corpo = texto
    }
  } catch (err) {
    corpo = { erro_rede: err instanceof Error ? err.message : String(err) }
  }
  const duracaoMs = Date.now() - inicio
  const ok = status >= 200 && status < 300

  // Login/refresh/seleciona-corban devolvem token: não gravar a resposta crua.
  const respostaGravada = /login/.test(caminho) ? sanitizar(corpo) : corpo
  const admin = await createAdminClient()
  await admin.from('if_credito_chamadas').insert({
    instituicao_financeira_id: cfg.instituicaoId,
    operacao,
    metodo,
    caminho,
    requisicao: body !== undefined ? sanitizar(body) : null,
    resposta: respostaGravada ?? null,
    http_status: status || null,
    sucesso: ok,
    duracao_ms: duracaoMs,
    created_by: criadoPor ?? null,
  })

  return { ok, status, corpo, duracaoMs }
}

function mensagemErro(r: ResultadoChamada): string {
  if (ehObjeto(r.corpo)) {
    const d = r.corpo.detail ?? r.corpo.message ?? r.corpo.erro ?? r.corpo.error
    if (typeof d === 'string') return d
    if (d !== undefined) return JSON.stringify(d).slice(0, 300)
  }
  if (typeof r.corpo === 'string' && r.corpo) return r.corpo.slice(0, 300)
  return `HTTP ${r.status || 'sem resposta'}`
}

/**
 * Login completo: /api/login → /api/login/seleciona-corban. Guarda tokens
 * no cofre. Devolve o access token pronto pra uso.
 */
export async function autenticarAmigoz(cfg: ConfigAmigoz, criadoPor?: string | null): Promise<string> {
  const login = await chamarAmigoz(cfg, 'login', 'POST', '/api/login', { usuario: cfg.usuario, senha: cfg.senha }, null, criadoPor)
  if (!login.ok) throw new Error(`Login Amigoz falhou: ${mensagemErro(login)}`)
  let { access, refresh } = extrairTokens(login.corpo)
  if (!access) throw new Error('Login Amigoz não devolveu token reconhecível (ver if_credito_chamadas).')

  if (cfg.corbanIdExterno) {
    const corbanId = Number(cfg.corbanIdExterno)
    const sel = await chamarAmigoz(
      cfg,
      'seleciona-corban',
      'POST',
      '/api/login/seleciona-corban',
      { corban_id: Number.isFinite(corbanId) ? corbanId : cfg.corbanIdExterno },
      access,
      criadoPor
    )
    if (!sel.ok) throw new Error(`Selecionar corban falhou: ${mensagemErro(sel)}`)
    // Se devolver token novo (escopado no corban), passa a valer ele.
    const t = extrairTokens(sel.corpo)
    if (t.access) access = t.access
    if (t.refresh) refresh = t.refresh
  }

  await guardarTokens(cfg.instituicaoId, access, refresh)
  return access
}

/** Access token válido: cache → refresh → login. */
export async function obterTokenAmigoz(cfg: ConfigAmigoz, criadoPor?: string | null, forcarLogin = false): Promise<string> {
  if (!forcarLogin && cfg.accessToken && cfg.tokenExpiraEm && cfg.tokenExpiraEm.getTime() - Date.now() > 60_000) {
    return cfg.accessToken
  }
  if (!forcarLogin && cfg.refreshToken) {
    const r = await chamarAmigoz(cfg, 'refresh', 'POST', '/api/login/refresh', { refresh: cfg.refreshToken }, null, criadoPor)
    const t = extrairTokens(r.corpo)
    if (r.ok && t.access) {
      await guardarTokens(cfg.instituicaoId, t.access, t.refresh)
      return t.access
    }
  }
  return autenticarAmigoz(cfg, criadoPor)
}

/**
 * Chamada autenticada. Em 401 refaz login uma vez (token revogado/expirado
 * antes do `exp`, ou corban não selecionado).
 */
export async function chamarAmigozAutenticado(
  cfg: ConfigAmigoz,
  operacao: string,
  metodo: 'GET' | 'POST',
  caminho: string,
  body?: unknown,
  criadoPor?: string | null
): Promise<ResultadoChamada> {
  let token = await obterTokenAmigoz(cfg, criadoPor)
  let r = await chamarAmigoz(cfg, operacao, metodo, caminho, body, token, criadoPor)
  if (r.status === 401) {
    token = await obterTokenAmigoz(cfg, criadoPor, true)
    r = await chamarAmigoz(cfg, operacao, metodo, caminho, body, token, criadoPor)
  }
  return r
}

export { mensagemErro as mensagemErroAmigoz }
