import type { NvtiPriceTier } from './types'

/** Preço padrão por consulta cobrado dos parceiros quando a faixa não tem `parceiro`. */
export const DEFAULT_PARCEIRO_UNIT = 0.08

export const DEFAULT_PRICE_TIERS: NvtiPriceTier[] = [
  { up_to: 10_000, unit: 0.06, parceiro: DEFAULT_PARCEIRO_UNIT },
  { up_to: 100_000, unit: 0.05, parceiro: DEFAULT_PARCEIRO_UNIT },
  { up_to: 500_000, unit: 0.04, parceiro: DEFAULT_PARCEIRO_UNIT },
  { up_to: 1_000_000, unit: 0.03, parceiro: DEFAULT_PARCEIRO_UNIT },
  { up_to: null, unit: 0.02, parceiro: DEFAULT_PARCEIRO_UNIT },
]

export function normalizeTiers(value: unknown): NvtiPriceTier[] {
  if (!Array.isArray(value)) return DEFAULT_PRICE_TIERS
  const tiers: NvtiPriceTier[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const upToRaw = (raw as { up_to?: unknown }).up_to
    const unitRaw = Number((raw as { unit?: unknown }).unit)
    if (!Number.isFinite(unitRaw) || unitRaw < 0) continue
    const upTo = upToRaw === null || upToRaw === undefined || upToRaw === '' ? null : Number(upToRaw)
    if (upTo !== null && (!Number.isFinite(upTo) || upTo <= 0)) continue
    const parceiroRaw = Number((raw as { parceiro?: unknown }).parceiro)
    const parceiro = Number.isFinite(parceiroRaw) && parceiroRaw >= 0 ? parceiroRaw : DEFAULT_PARCEIRO_UNIT
    tiers.push({ up_to: upTo, unit: unitRaw, parceiro })
  }
  if (!tiers.length) return DEFAULT_PRICE_TIERS
  tiers.sort((a, b) => {
    if (a.up_to === null) return 1
    if (b.up_to === null) return -1
    return a.up_to - b.up_to
  })
  if (tiers[tiers.length - 1].up_to !== null) {
    const last = tiers[tiers.length - 1]
    tiers.push({ up_to: null, unit: last.unit, parceiro: last.parceiro })
  }
  return tiers
}

/** Preço unitário da consulta que ocupa a posição `position` (1-based) no mês. */
export function unitCostForPosition(tiers: NvtiPriceTier[], position: number): number {
  for (const tier of tiers) {
    if (tier.up_to === null || position <= tier.up_to) return tier.unit
  }
  return tiers[tiers.length - 1]?.unit ?? 0
}

/** Preço (R$) cobrado do parceiro pela consulta que ocupa a posição `position` (1-based). */
export function parceiroPriceForPosition(tiers: NvtiPriceTier[], position: number): number {
  for (const tier of tiers) {
    if (tier.up_to === null || position <= tier.up_to) return tier.parceiro
  }
  return tiers[tiers.length - 1]?.parceiro ?? DEFAULT_PARCEIRO_UNIT
}

/**
 * Custo acumulado (cascata) de `count` consultas cobradas no mês: as primeiras
 * 10.000 na faixa 1, as seguintes na faixa 2 etc. Determinístico a partir da
 * contagem — o gasto do mês nunca depende de somar linhas uma a uma.
 */
export function costForCount(tiers: NvtiPriceTier[], count: number): number {
  let remaining = Math.max(0, Math.trunc(count))
  let previousCap = 0
  let total = 0
  for (const tier of tiers) {
    if (remaining <= 0) break
    const capacity = tier.up_to === null ? remaining : Math.max(0, tier.up_to - previousCap)
    const used = Math.min(remaining, capacity)
    total += used * tier.unit
    remaining -= used
    if (tier.up_to !== null) previousCap = tier.up_to
  }
  return Math.round(total * 10_000) / 10_000
}

/** Início (inclusive) e fim (exclusive) do mês corrente em UTC (estimativa de fatura). */
export function currentMonthRange(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { start: start.toISOString(), end: end.toISOString() }
}

export function formatBrl(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}
