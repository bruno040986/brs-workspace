/**
 * Leitura de documentos do parceiro (bucket PRIVADO `partner-documents`). Funções puras.
 * O Portal grava em `corban_data` só o PATH do objeto; registros antigos têm a URL pública
 * (`.../object/public/partner-documents/<path>`). Ambos servem pela rota autenticada
 * /api/agente-corban/documento (nunca por URL do Storage).
 */
export const BUCKET_DOCUMENTOS = 'partner-documents'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** URL antiga do Storage ou path puro -> path do bucket. Outra coisa (https externo, scheme, `..`) -> null. */
export function extrairPathDocumento(valor: unknown): string | null {
  const s = typeof valor === 'string' ? valor.trim() : ''
  if (!s || s.length > 1000) return null
  let path: string
  if (/^https:\/\//i.test(s)) {
    const m = /^https:\/\/[^/]+\/storage\/v1\/object\/(?:public|sign|authenticated)\/partner-documents\/([^?#]+)/i.exec(s)
    if (!m) return null
    try { path = decodeURIComponent(m[1]) } catch { return null }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//') || s.startsWith('/api/')) {
    return null
  } else {
    path = s.replace(/^\/+/, '')
  }
  if (!path || path.includes('..') || path.includes('\\') || path.includes('\0') || path.includes('?') || path.includes('#')) return null
  return path
}

/** Todos os paths de documento presentes em `corban_data` (documents, socios[], etc.), em qualquer profundidade. */
export function coletarPathsDoAgente(corbanData: unknown): Set<string> {
  const out = new Set<string>()
  const visitar = (v: unknown, prof: number) => {
    if (prof > 8 || v == null) return
    if (typeof v === 'string') {
      const p = extrairPathDocumento(v)
      if (p && p.includes('/')) out.add(p)
    } else if (Array.isArray(v)) v.forEach((x) => visitar(x, prof + 1))
    else if (typeof v === 'object') Object.values(v as object).forEach((x) => visitar(x, prof + 1))
  }
  visitar(corbanData, 0)
  return out
}

/**
 * O valor pedido só vale se o PRÓPRIO agente o referencia: consta no corban_data dele, ou é
 * upload de correção dele (`correcao/<agenteId>/...`, ainda fora do corban_data). O cliente
 * informa só a referência; quem decide é o servidor. Devolve o path ou null.
 */
export function resolverDocumentoDoAgente(corbanData: unknown, agenteId: string, referencia: unknown): string | null {
  const path = extrairPathDocumento(referencia)
  if (!path || !UUID_RE.test(agenteId)) return null
  if (path.toLowerCase().startsWith(`correcao/${agenteId.toLowerCase()}/`)) return path
  return coletarPathsDoAgente(corbanData).has(path) ? path : null
}

/** Nome de arquivo seguro para Content-Disposition (sem aspas, quebras, barras ou não-ASCII). */
export function nomeArquivoSeguro(path: string): string {
  const base = String(path).split('/').pop() || 'documento'
  const limpo = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(-80)
  return limpo || 'documento'
}

/** Para a UI: path ou URL de partner-documents -> rota autenticada; o resto (https externo etc.) fica como veio. */
export function urlDocumentoParceiro(agenteId: string | null | undefined, valor: string | null | undefined): string {
  const raw = String(valor || '').trim()
  if (!agenteId || !extrairPathDocumento(raw)) return raw
  return `/api/agente-corban/documento?agente=${encodeURIComponent(agenteId)}&ref=${encodeURIComponent(raw)}`
}
