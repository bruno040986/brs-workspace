/** Rótulos de exibição (puro, sem imports) — usado pelo card e pelo painel de saúde. */

const LIMITES: Record<string, string> = {
  TIER_NOT_SET: 'Não definido',
  TIER_50: '50',
  TIER_250: '250',
  TIER_1K: '1 mil',
  TIER_2K: '2 mil',
  TIER_10K: '10 mil',
  TIER_100K: '100 mil',
  TIER_UNLIMITED: 'Ilimitado',
}

/** Limite de conversas iniciadas pela empresa em 24 h (janela móvel). */
export function rotuloLimite(tier: string): string {
  return LIMITES[tier] ?? tier
}

export type Qualidade = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN'

const QUALIDADES: Record<Qualidade, { rotulo: string; cor: string }> = {
  GREEN: { rotulo: 'Alta', cor: 'var(--brs-success)' },
  YELLOW: { rotulo: 'Média', cor: '#b45309' },
  RED: { rotulo: 'Baixa', cor: 'var(--brs-danger)' },
  UNKNOWN: { rotulo: 'Desconhecida', cor: 'var(--brs-gray-400)' },
}

export function rotuloQualidade(q: string): { rotulo: string; cor: string } {
  return QUALIDADES[(q as Qualidade) in QUALIDADES ? (q as Qualidade) : 'UNKNOWN']
}

export function formatarMoeda(valor: string, moeda: string): string {
  const n = Number(valor)
  if (!Number.isFinite(n)) return `${valor} ${moeda}`.trim()
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda || 'USD' }).format(n)
  } catch {
    return `${n.toFixed(2)} ${moeda}`.trim()
  }
}

export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR')
}
