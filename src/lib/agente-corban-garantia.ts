/**
 * Regra de negócio da Garantia do Agente Corban (lógica pura, testável).
 *
 * Regra (decidida com o Bruno, 27/07):
 *  - A garantia cobre o BIMESTRE: a soma de 2 meses de produção deve caber no
 *    valor garantido.
 *  - O valor garantido anda em FAIXAS que dobram, sem teto: 500k → 1M → 2M → 4M…
 *  - Indicador: se a produção do bimestre MAIS RECENTE ultrapassa a faixa atual,
 *    sinaliza revisão e sugere a próxima faixa (dobro). Sem tolerância.
 *  - Produção é entrada MANUAL (integração ARW é futuro).
 */

/** Faixa base da garantia (R$ 500 mil). As faixas seguintes dobram sem teto. */
export const GARANTIA_FAIXA_BASE = 500_000

/** Um mês de produção informado manualmente. */
export type ProducaoMes = {
  /** Referência do mês, ex.: '2026-07'. */
  mes: string
  /** Valor produzido no mês (R$). */
  valor: number
}

export type GarantiaAvaliacao = {
  /** Valor garantido atual (faixa vigente). */
  valorGarantido: number
  /** Produção do bimestre mais recente (soma dos 2 meses mais recentes). */
  bimestreRecente: number
  /** Média mensal dos meses informados (visão informativa). */
  mediaMensal: number
  /** Média bimestral (média mensal × 2) — visão informativa. */
  mediaBimestral: number
  /** true se o bimestre recente ultrapassa o valor garantido. */
  precisaRevisar: boolean
  /** Próxima faixa sugerida quando precisa revisar (senão, a atual). */
  faixaSugerida: number
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Ordena a produção do mais antigo para o mais recente (por `mes` ISO 'YYYY-MM'). */
export function ordenarProducao(producao: ProducaoMes[]): ProducaoMes[] {
  return [...(Array.isArray(producao) ? producao : [])].sort((a, b) =>
    String(a?.mes || '').localeCompare(String(b?.mes || '')),
  )
}

/** Soma dos 2 meses mais recentes (o bimestre que dispara o indicador). */
export function bimestreMaisRecente(producao: ProducaoMes[]): number {
  const ordenada = ordenarProducao(producao)
  const ultimos = ordenada.slice(-2)
  return ultimos.reduce((sum, m) => sum + toNumber(m?.valor), 0)
}

/** Média mensal dos meses informados. */
export function mediaMensal(producao: ProducaoMes[]): number {
  const list = (Array.isArray(producao) ? producao : []).filter((m) => m && m.mes)
  if (list.length === 0) return 0
  const total = list.reduce((sum, m) => sum + toNumber(m?.valor), 0)
  return total / list.length
}

/**
 * Menor faixa (500k × 2^n) que comporta o valor informado. Ex.: 520k → 1M;
 * 300k → 500k; 1.2M → 2M. Sem teto.
 */
export function faixaQueComporta(valor: number): number {
  let faixa = GARANTIA_FAIXA_BASE
  const alvo = toNumber(valor)
  while (faixa < alvo) faixa *= 2
  return faixa
}

/** Próxima faixa (o dobro da atual). */
export function proximaFaixa(valorGarantido: number): number {
  const atual = toNumber(valorGarantido) || GARANTIA_FAIXA_BASE
  return atual * 2
}

/**
 * Avalia a garantia contra a produção. `valorGarantido` é a faixa vigente; se
 * ausente/zero, assume a faixa base.
 */
export function avaliarGarantia(valorGarantido: number, producao: ProducaoMes[]): GarantiaAvaliacao {
  const garantido = toNumber(valorGarantido) || GARANTIA_FAIXA_BASE
  const bimestre = bimestreMaisRecente(producao)
  const media = mediaMensal(producao)

  const precisaRevisar = bimestre > garantido
  const faixaSugerida = precisaRevisar ? faixaQueComporta(bimestre) : garantido

  return {
    valorGarantido: garantido,
    bimestreRecente: bimestre,
    mediaMensal: media,
    mediaBimestral: media * 2,
    precisaRevisar,
    faixaSugerida,
  }
}
