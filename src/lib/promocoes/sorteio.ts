/** Apuração do sorteio (CONTRATO §3.4; regras.md §12–§14). Puro. */

export type Contemplado = { numero: number; distancia: number; direcao: 'exato' | 'superior' | 'inferior' }

/**
 * Aproximação circular: exato → superior → inferior → 2º superior → 2º inferior…
 * Equidistantes: o superior vence (testado primeiro). Após 99999 vem 00000.
 */
export function apurarContemplado(numeroExtraido: number, validos: ReadonlySet<number>, serie = 100000): Contemplado | null {
  if (!validos.size) return null
  const n = ((numeroExtraido % serie) + serie) % serie
  if (validos.has(n)) return { numero: n, distancia: 0, direcao: 'exato' }
  const maxD = Math.floor(serie / 2)
  for (let d = 1; d <= maxD; d++) {
    const sup = (n + d) % serie
    if (validos.has(sup)) return { numero: sup, distancia: d, direcao: 'superior' }
    const inf = (n - d + serie) % serie
    if (validos.has(inf)) return { numero: inf, distancia: d, direcao: 'inferior' }
  }
  return null
}

/** Aceita '12345', '12.345', '012345' (usa os últimos 5 dígitos). */
export function parseNumeroLoteria(texto: string): number | null {
  const d = String(texto ?? '').replace(/\D/g, '')
  if (d.length < 5) return null
  return Number(d.slice(-5))
}
