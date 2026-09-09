/**
 * Normaliza URLs de site institucional/averbador. Aceita "empresa.com.br",
 * "http://x" ou "https://x/y"; sempre devolve com esquema https:// (o
 * fornecedor não expõe http puro nesses cadastros) e sem barra final
 * supérflua. Lança se não for uma URL válida — quem chama decide se isso
 * bloqueia o salvamento ou só ignora o campo (campo é opcional nos dois
 * cadastros que usam este helper).
 */
export function normalizarUrl(bruta: string): string {
  const texto = String(bruta || '').trim()
  if (!texto) return ''
  const comEsquema = /^https?:\/\//i.test(texto) ? texto : `https://${texto}`
  let url: URL
  try {
    url = new URL(comEsquema)
  } catch {
    throw new Error(`URL inválida: "${bruta}".`)
  }
  if (!url.hostname.includes('.')) throw new Error(`URL inválida: "${bruta}".`)
  const href = url.href
  return href.endsWith('/') && url.pathname === '/' && !url.search && !url.hash ? href.slice(0, -1) : href
}
