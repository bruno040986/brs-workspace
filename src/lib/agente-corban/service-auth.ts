import { timingSafeEqual } from 'node:crypto'

/**
 * Autenticação das rotas de serviço Agente Corban ↔ Portal Parceiro (Bearer =
 * PORTAL_SERVICE_TOKEN), fail-closed e sem vazar tempo de comparação. Mesmo
 * padrão de isNvtiServiceAuthorized (src/lib/nvti/service-auth.ts).
 */
export function isPortalServiceAuthorized(req: { headers: { get(name: string): string | null } }): boolean {
  const secret = String(process.env.PORTAL_SERVICE_TOKEN || '')
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const ok = Boolean(secret) && Boolean(token) && (() => {
    const a = Buffer.from(token)
    const b = Buffer.from(secret)
    return a.length === b.length && timingSafeEqual(a, b)
  })()
  if (!ok) {
    // DIAGNÓSTICO TEMPORÁRIO (401 persistente investigado em 09/09) — nunca loga o valor, só metadados,
    // pra achar se é diferença de tamanho (espaço/quebra de linha colada por engano). Remover depois.
    console.error('[agente-corban] auth diagnostico', {
      secretLen: secret.length,
      secretTrimmedLen: secret.trim().length,
      secretHasEnvVar: Boolean(process.env.PORTAL_SERVICE_TOKEN),
      tokenLen: token.length,
      authHeaderPresente: Boolean(auth),
    })
  }
  return ok
}
