/**
 * Cliente do web service da Nova Vida TI (ASMX, form-urlencoded).
 *
 * - GerarToken(usuario, senha, cliente) → token com validade de 24h.
 *   O manual pede as credenciais em BASE64; se o retorno não parecer um token,
 *   tentamos uma vez com as credenciais em texto puro (o manual é ambíguo — a
 *   seção de BASE64 fala do SOAP Header).
 * - NVBOOK_CEL_OBG / NvBookCelObWhats (documento, token) → XML <CONSULTA>.
 *
 * Toda resposta ASMX via HTTP POST vem embrulhada em
 * <string xmlns="http://tempuri.org/">…payload…</string>.
 */

import { parseXmlDocument, normalizeConsulta } from './normalize'
import type { NvtiMetodo, NvtiResultado } from './types'

const BASE_URL = 'https://wsnv.novavidati.com.br/WSLocalizador.asmx'
const REQUEST_TIMEOUT_MS = 30_000

/**
 * A NVTI libera acesso por whitelist de IP e a Vercel não tem IP fixo de
 * saída. Se NVTI_PROXY_URL estiver definida (http(s)://user:pass@host:porta),
 * as chamadas saem por esse proxy de IP fixo; sem a env, conexão direta.
 */
type FetchWithDispatcher = RequestInit & { dispatcher?: unknown }

async function getProxyDispatcher(): Promise<unknown | undefined> {
  const proxyUrl = String(process.env.NVTI_PROXY_URL || '').trim()
  if (!proxyUrl) return undefined
  const g = globalThis as typeof globalThis & { __nvtiProxyAgent?: { url: string; agent: unknown } }
  if (g.__nvtiProxyAgent?.url === proxyUrl) return g.__nvtiProxyAgent.agent
  const { ProxyAgent } = await import('undici')
  const agent = new ProxyAgent(proxyUrl)
  g.__nvtiProxyAgent = { url: proxyUrl, agent }
  return agent
}

export class NvtiApiError extends Error {
  readonly kind: 'auth' | 'token' | 'remote' | 'parse'
  constructor(kind: 'auth' | 'token' | 'remote' | 'parse', message: string) {
    super(message)
    this.kind = kind
  }
}

async function postForm(method: string, fields: Record<string, string>): Promise<string> {
  const body = new URLSearchParams(fields)
  let res: Response
  try {
    const dispatcher = await getProxyDispatcher()
    const init: FetchWithDispatcher = {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }
    if (dispatcher) init.dispatcher = dispatcher
    res = await fetch(`${BASE_URL}/${method}`, init)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'falha de rede'
    throw new NvtiApiError('remote', `Falha ao chamar a NVTI (${method}): ${message}`)
  }
  const text = await res.text()
  if (!res.ok) {
    throw new NvtiApiError('remote', `NVTI ${method} retornou HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  return text
}

/** Desembrulha o <string> do ASMX e devolve o conteúdo (payload) como texto. */
function unwrapAsmxString(xml: string): string {
  const doc = parseXmlDocument(xml)
  const value = doc.string
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  // Sem o wrapper <string>: pode ser o payload direto ou uma página de erro.
  return xml.trim()
}

/** Extrai a mensagem de <ERROS><ERRO>…</ERRO></ERROS> quando a NVTI recusa a chamada. */
function extractErro(payload: string): string | null {
  const match = payload.match(/<ERRO>\s*([^<]+?)\s*<\/ERRO>/i)
  return match ? match[1].trim() : null
}

function looksLikeToken(value: string): boolean {
  if (!value || value.length < 16) return false
  if (/\s/.test(value)) return false
  if (/inv[aá]lid|erro|senha|usu[aá]rio|negad/i.test(value)) return false
  return true
}

export type NvtiCredentials = { usuario: string; senha: string; cliente: string }

function toBase64(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64')
}

export async function gerarToken(credentials: NvtiCredentials): Promise<string> {
  const attempts: Array<Record<string, string>> = [
    {
      usuario: toBase64(credentials.usuario),
      senha: toBase64(credentials.senha),
      cliente: toBase64(credentials.cliente),
    },
    {
      usuario: credentials.usuario,
      senha: credentials.senha,
      cliente: credentials.cliente,
    },
  ]

  let lastResult = ''
  for (const fields of attempts) {
    const raw = await postForm('GerarToken', fields)
    const value = unwrapAsmxString(raw)
    if (looksLikeToken(value)) return value
    lastResult = value
  }
  const erro = extractErro(lastResult)
  if (erro) {
    const hint = /IP/i.test(erro)
      ? ' O acesso da NVTI é liberado por IP fixo — o IP de saída desta chamada não está na whitelist deles.'
      : ''
    throw new NvtiApiError('auth', `NVTI recusou a autenticação: ${erro}.${hint}`)
  }
  throw new NvtiApiError('auth', `GerarToken não retornou um token válido. Retorno: "${lastResult.slice(0, 200)}"`)
}

function isTokenProblem(payload: string): boolean {
  return /token/i.test(payload) && /inv[aá]lid|expirad|nao autorizado|não autorizado|negad/i.test(payload)
}

/**
 * Executa a consulta no método contratado. Retorna o resultado normalizado e o
 * XML bruto (para auditoria/reprocessamento).
 */
export async function consultarCpfRemoto(
  metodo: NvtiMetodo,
  token: string,
  cpf: string,
): Promise<{ resultado: NvtiResultado; rawXml: string }> {
  const raw = await postForm(metodo, { documento: cpf, token })
  const payload = unwrapAsmxString(raw)

  if (!payload.includes('<CONSULTA')) {
    if (isTokenProblem(payload)) {
      throw new NvtiApiError('token', `Token recusado pela NVTI: "${payload.slice(0, 200)}"`)
    }
    const erro = extractErro(payload)
    if (erro) {
      throw new NvtiApiError('remote', `NVTI recusou a consulta: ${erro}`)
    }
    throw new NvtiApiError('remote', `NVTI não retornou CONSULTA para o CPF: "${payload.slice(0, 300)}"`)
  }

  try {
    return { resultado: normalizeConsulta(payload, cpf), rawXml: payload }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'falha ao interpretar o XML'
    throw new NvtiApiError('parse', message)
  }
}
