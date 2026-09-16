/**
 * Adaptador FyDigital — descoberta (Fatia 4, escopo reduzido). SÓ servidor.
 *
 * API: OAuth2 client_credentials (Bearer, `expires_in` segundos) + assinatura
 * JWT RS256 de CADA payload de ação com a chave privada da empresa (a doc
 * chama isso de "criptografia", mas é assinatura: JWT::encode/decode do
 * Firebase\JWT no PHP deles). A resposta síncrona de endpoints de ação é
 * quase sempre só um ack — o resultado de negócio chega por WEBHOOK,
 * assinado com a chave pública DELES (api_public_key). Como a doc deles tem
 * exemplos inconsistentes (a seção de Autenticação mostra o body inteiro
 * como uma string JWT; as seções de cada endpoint mostram um array PHP puro)
 * e os schemas de resposta não são garantidos, a chamada aqui é
 * propositalmente tolerante: grava a requisição decodificada (legível) e a
 * resposta CRUA em if_credito_chamadas, e tenta verificar/decodificar a
 * assinatura RS256 quando o corpo parece uma string JWT — sem travar se não
 * for. É assim que fixamos o formato real antes de desenhar o fluxo de
 * produção (mapa de enum, Criar Operação de verdade etc.).
 */
import jwt from 'jsonwebtoken'
import { createAdminClient } from '@/lib/supabase/server'
import { cifrarTexto, decifrarTexto } from '@/lib/central-conversas/cofre'

export type ConfigFyDigital = {
  instituicaoId: string
  ambiente: 'producao' | 'homologacao'
  baseUrl: string
  clientId: string
  clientSecret: string
  empresaPrivateKey: string
  empresaPublicKey: string
  apiPublicKey: string
  accessToken: string | null
  tokenExpiraEm: Date | null
  webhookKey: string | null
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

function normalizarNome(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Localiza a IF "FyDigital" no cadastro (mesma normalização da tela de config). */
export async function obterInstituicaoFyDigital(): Promise<{ id: string; name: string } | null> {
  const admin = await createAdminClient()
  const { data } = await admin.from('financial_institutions').select('id, name').is('deleted_at', null)
  const achado = (data || []).find((i: any) => normalizarNome(String(i.name || '')).includes('fydigital'))
  return achado ? { id: String(achado.id), name: String(achado.name) } : null
}

export async function carregarConfigFyDigital(): Promise<ConfigFyDigital> {
  const inst = await obterInstituicaoFyDigital()
  if (!inst) throw new Error('FyDigital não está cadastrada em Instituições Financeiras.')
  const admin = await createAdminClient()
  const { data, error } = await admin
    .from('if_credito_config')
    .select(
      'ambiente, base_url, client_id, client_secret_enc, empresa_private_key_enc, empresa_public_key_enc, api_public_key_enc, access_token_enc, token_expira_em, webhook_key, ativo'
    )
    .eq('instituicao_financeira_id', inst.id)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('FyDigital sem configuração: preencha as credenciais no card da IF.')
  if (!data.client_id || !data.client_secret_enc) throw new Error('FyDigital sem Client ID/Client Secret configurados.')
  const baseUrl = String(data.base_url || '').trim().replace(/\/+$/, '')
  if (!/^https:\/\//.test(baseUrl)) throw new Error('Base URL da FyDigital inválida (preencha no card).')
  return {
    instituicaoId: inst.id,
    ambiente: (data.ambiente || 'homologacao') as 'producao' | 'homologacao',
    baseUrl: `${baseUrl}/`,
    clientId: String(data.client_id),
    clientSecret: decifrarTexto(String(data.client_secret_enc)),
    empresaPrivateKey: data.empresa_private_key_enc ? decifrarTexto(String(data.empresa_private_key_enc)) : '',
    empresaPublicKey: data.empresa_public_key_enc ? decifrarTexto(String(data.empresa_public_key_enc)) : '',
    apiPublicKey: data.api_public_key_enc ? decifrarTexto(String(data.api_public_key_enc)) : '',
    accessToken: data.access_token_enc ? decifrarTexto(String(data.access_token_enc)) : null,
    tokenExpiraEm: data.token_expira_em ? new Date(String(data.token_expira_em)) : null,
    webhookKey: data.webhook_key || null,
    ativo: Boolean(data.ativo),
  }
}

async function guardarToken(instituicaoId: string, accessToken: string, expiresInSegundos: number) {
  const admin = await createAdminClient()
  const expira = new Date(Date.now() + Math.max(60, expiresInSegundos) * 1000)
  await admin
    .from('if_credito_config')
    .update({ access_token_enc: cifrarTexto(accessToken), token_expira_em: expira.toISOString(), updated_at: new Date().toISOString() })
    .eq('instituicao_financeira_id', instituicaoId)
}

const CHAVE_SENSIVEL = /secret|private|senha|password|authorization|^access_token$/i
const PARECE_JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const PARECE_PEM = /-----BEGIN/

/**
 * Mascara segredo por CHAVE (secret/private/senha/token…) e por FORMATO
 * (qualquer string com cara de JWT ou de chave PEM), em qualquer
 * profundidade — mesmo cuidado do adaptador Amigoz (incidente 14/09: um
 * token escapou do filtro por chave).
 */
function sanitizar(valor: unknown): unknown {
  if (typeof valor === 'string') return PARECE_JWT.test(valor) || PARECE_PEM.test(valor) ? '***' : valor
  if (Array.isArray(valor)) return valor.map(sanitizar)
  if (!ehObjeto(valor)) return valor
  const copia: Json = {}
  for (const [k, v] of Object.entries(valor)) {
    copia[k] = CHAVE_SENSIVEL.test(k) && typeof v === 'string' ? '***' : sanitizar(v)
  }
  return copia
}

/**
 * Chamada HTTP crua + registro em if_credito_chamadas (mesma tabela
 * IF-agnóstica usada pela descoberta da Amigoz). `requisicaoLog` é o que vai
 * pro registro (o payload DECODIFICADO e legível, não o JWT assinado cru).
 */
export async function chamarFyDigital(
  cfg: Pick<ConfigFyDigital, 'instituicaoId' | 'baseUrl'>,
  operacao: string,
  caminho: string,
  opts: { metodo?: 'GET' | 'POST'; body?: BodyInit; headers?: Record<string, string>; requisicaoLog?: unknown } = {},
  criadoPor?: string | null
): Promise<ResultadoChamada> {
  const inicio = Date.now()
  let status = 0
  let corpo: unknown = null
  try {
    const res = await fetch(`${cfg.baseUrl}${caminho}`, {
      method: opts.metodo || 'POST',
      headers: { accept: 'application/json', ...opts.headers },
      body: opts.body,
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

  const admin = await createAdminClient()
  await admin.from('if_credito_chamadas').insert({
    instituicao_financeira_id: cfg.instituicaoId,
    operacao,
    metodo: opts.metodo || 'POST',
    caminho,
    requisicao: opts.requisicaoLog !== undefined ? sanitizar(opts.requisicaoLog) : null,
    resposta: sanitizar(corpo) ?? null,
    http_status: status || null,
    sucesso: ok,
    duracao_ms: duracaoMs,
    created_by: criadoPor ?? null,
  })

  return { ok, status, corpo, duracaoMs }
}

function mensagemErro(r: ResultadoChamada): string {
  if (ehObjeto(r.corpo)) {
    const d = (r.corpo as any).error_description ?? (r.corpo as any).message ?? (r.corpo as any).observacao ?? (r.corpo as any).error
    if (typeof d === 'string') return d
    if (d !== undefined) return JSON.stringify(d).slice(0, 300)
  }
  if (typeof r.corpo === 'string' && r.corpo) return r.corpo.slice(0, 300)
  return `HTTP ${r.status || 'sem resposta'}`
}

/** Etapa 1 da autenticação: client_credentials (formdata) → Bearer. */
export async function autenticarFyDigital(cfg: ConfigFyDigital, criadoPor?: string | null): Promise<string> {
  const form = new FormData()
  form.set('client_id', cfg.clientId)
  form.set('client_secret', cfg.clientSecret)
  form.set('grant_type', 'client_credentials')
  form.set('scope', '')
  const r = await chamarFyDigital(
    cfg,
    'oauth_token',
    'oauth/token',
    { metodo: 'POST', body: form, requisicaoLog: { client_id: cfg.clientId, grant_type: 'client_credentials' } },
    criadoPor
  )
  if (!r.ok) throw new Error(`Autenticação OAuth falhou: ${mensagemErro(r)}`)
  const corpo = r.corpo as any
  const accessToken = corpo?.access_token
  if (typeof accessToken !== 'string' || !accessToken) throw new Error('OAuth não devolveu access_token reconhecível (ver histórico de chamadas).')
  const expiresIn = Number(corpo?.expires_in) || 86400
  await guardarToken(cfg.instituicaoId, accessToken, expiresIn)
  return accessToken
}

/** Bearer válido: cache → login. Sem refresh_token nessa API (é client_credentials puro). */
export async function obterTokenFyDigital(cfg: ConfigFyDigital, criadoPor?: string | null, forcarLogin = false): Promise<string> {
  if (!forcarLogin && cfg.accessToken && cfg.tokenExpiraEm && cfg.tokenExpiraEm.getTime() - Date.now() > 60_000) {
    return cfg.accessToken
  }
  return autenticarFyDigital(cfg, criadoPor)
}

/** Teste de autenticação (doc): POST base_path/api/ok com o Bearer. Sem JWT/RSA. */
export async function testarApiOk(cfg: Pick<ConfigFyDigital, 'instituicaoId' | 'baseUrl'>, token: string, criadoPor?: string | null): Promise<ResultadoChamada> {
  return chamarFyDigital(cfg, 'api_ok', 'api/ok', { metodo: 'POST', headers: { authorization: `Bearer ${token}` } }, criadoPor)
}

/** Assina o payload com a chave privada da empresa (RS256) — "de cada payload", por doc/memória. */
export function assinarPayloadFyDigital(data: unknown, empresaPrivateKeyPem: string): string {
  return jwt.sign(data as object, empresaPrivateKeyPem, { algorithm: 'RS256', noTimestamp: true })
}

/** Verifica/decodifica um JWT assinado pela FyDigital (chave pública da API). Null se não validar/não for JWT. */
export function verificarAssinaturaFyDigital(token: string, apiPublicKeyPem: string): unknown | null {
  try {
    return jwt.verify(token, apiPublicKeyPem, { algorithms: ['RS256'] })
  } catch {
    return null
  }
}

export type ResultadoOperacaoAssinada = ResultadoChamada & { assinaturaValida?: boolean; corpoDecodificado?: unknown }

/**
 * Chama um endpoint de ação (base_path/api/<client_id>) com o payload
 * assinado como JWT RS256. A resposta síncrona é só um ack na maioria dos
 * casos (o resultado real chega por webhook) — se vier uma string com cara
 * de JWT, tenta verificar com a chave pública da API.
 */
export async function chamarOperacaoAssinada(
  cfg: ConfigFyDigital,
  operacao: string,
  payload: Record<string, unknown>,
  criadoPor?: string | null
): Promise<ResultadoOperacaoAssinada> {
  if (!cfg.empresaPrivateKey) throw new Error('Chave privada da empresa (RSA) não configurada.')
  const token = await obterTokenFyDigital(cfg, criadoPor)
  const jwtAssinado = assinarPayloadFyDigital(payload, cfg.empresaPrivateKey)
  const caminho = `api/${cfg.clientId}`
  const r = await chamarFyDigital(
    cfg,
    operacao,
    caminho,
    { metodo: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(jwtAssinado), requisicaoLog: payload },
    criadoPor
  )

  let assinaturaValida: boolean | undefined
  let corpoDecodificado: unknown
  if (typeof r.corpo === 'string' && cfg.apiPublicKey) {
    const semAspas = r.corpo.replace(/^"|"$/g, '')
    const decodificado = verificarAssinaturaFyDigital(semAspas, cfg.apiPublicKey)
    assinaturaValida = decodificado !== null
    corpoDecodificado = decodificado ?? undefined
  }
  return { ...r, assinaturaValida, corpoDecodificado }
}

export { mensagemErro as mensagemErroFyDigital }
