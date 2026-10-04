/**
 * Atribuição (UTM) da promoção → WeSales. Lógica pura (sem I/O) para testar com node:test.
 * Se as chaves reais dos campos criados na UI do WeSales forem diferentes, ajuste SÓ `CAMPOS_TRAFEGO`.
 */

export type Tracking = Record<string, string | null | undefined>

/** coluna de promocao_tracking → fieldKey do campo customizado (TEXTO) no WeSales. */
export const CAMPOS_TRAFEGO: Record<string, string> = {
  utm_source: 'trafego__utm_source',
  utm_medium: 'trafego__utm_medium',
  utm_campaign: 'trafego__utm_campaign',
  utm_content: 'trafego__utm_content',
  fbclid: 'trafego__click_id_meta',
  landing_url: 'trafego__pagina_de_entrada',
}

export const SOURCE_BASE = 'Promoção NuAzul Valparaíso'

/** minúsculas, sem acento, só [a-z0-9_-], espaço vira hífen, máx 40. Vazio = ''. */
export function slugTag(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40)
}

export function tagsTrafego(t: Tracking | null | undefined): string[] {
  if (!t) return []
  const pares: Array<[string, unknown]> = [
    ['utm-campanha-', t.utm_campaign],
    ['utm-conteudo-', t.utm_content],
    ['utm-origem-', t.utm_source],
  ]
  return pares.flatMap(([prefixo, v]) => {
    const s = slugTag(v)
    return s ? [prefixo + s] : []
  })
}

/** 'Promoção NuAzul Valparaíso | meta/valparaiso_promo/margem_20' — sem UTM, o source de sempre. */
export function sourceTrafego(t: Tracking | null | undefined): string {
  const partes = [t?.utm_source, t?.utm_campaign, t?.utm_content].map((v) => slugTag(v))
  if (!partes.some(Boolean)) return SOURCE_BASE
  return `${SOURCE_BASE} | ${partes.join('/')}`.slice(0, 120)
}

/**
 * Para cada campo com valor: resolve (sem criar) e monta a entrada; campo inexistente é pulado e listado em `ausentes`.
 * `resolver` e `entrada` são injetados (resolveCustomField / customFieldEntry) para manter este módulo puro.
 */
export async function camposTrafego<D>(
  t: Tracking | null | undefined,
  resolver: (key: string) => Promise<D | null>,
  entrada: (def: D, valor: string) => { id: string; fieldValue: string | number } | null,
): Promise<{ entradas: Array<{ id: string; fieldValue: string | number }>; ausentes: string[] }> {
  const entradas: Array<{ id: string; fieldValue: string | number }> = []
  const ausentes: string[] = []
  if (!t) return { entradas, ausentes }
  for (const [coluna, key] of Object.entries(CAMPOS_TRAFEGO)) {
    const valor = String(t[coluna] ?? '').trim().slice(0, 255)
    if (!valor) continue
    const def = await resolver(key)
    if (!def) {
      ausentes.push(key)
      continue
    }
    const e = entrada(def, valor)
    if (e) entradas.push(e)
  }
  return { entradas, ausentes }
}
