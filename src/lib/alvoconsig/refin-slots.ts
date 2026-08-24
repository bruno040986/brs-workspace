/**
 * REFIN multi-oferta: um mesmo CPF pode ter até MAX_OFERTAS_REFIN ofertas
 * (linhas diferentes na planilha, cada uma de uma tabela — `oferta_regra`).
 * Decisão do Bruno (24/08/2026): guardar TODAS no WeSales, não só a
 * "melhor" — comissão/seguro não se resumem ao troco. Cada oferta ocupa um
 * "slot" (1..5) com 6 campos personalizados: troco, parcela, prazo, taxa,
 * tabela (código do banco) e instituição (id da IF, escolhida uma vez por
 * importação — a planilha nunca mistura banco).
 *
 * Reimportação: se o mesmo (instituição, tabela) já ocupa um slot, ATUALIZA
 * esse slot em vez de duplicar — assim uma atualização de valores do mesmo
 * banco não consome um slot novo, mas uma oferta de banco/tabela diferente
 * (import futura, outro IF) ocupa outro slot.
 */

export const MAX_OFERTAS_REFIN = 5

export const REFIN_SLOT_CAMPOS = ['troco', 'parcela', 'prazo', 'taxa', 'tabela', 'instituicao'] as const
export type RefinSlotCampo = (typeof REFIN_SLOT_CAMPOS)[number]

const REFIN_SLOT_LABELS: Record<RefinSlotCampo, string> = {
  troco: 'Troco',
  parcela: 'Parcela',
  prazo: 'Prazo',
  taxa: 'Taxa',
  tabela: 'Tabela (código banco)',
  instituicao: 'Instituição (id)',
}

export function refinSlotFieldKey(slot: number, campo: RefinSlotCampo): string {
  return `alvoconsig_refin_${campo}_${slot}`
}

export function refinSlotFieldName(slot: number, campo: RefinSlotCampo): string {
  return `AlvoConsig — Refin ${REFIN_SLOT_LABELS[campo]} ${slot}`
}

/** Todos os pares (slot, campo) — usado para preparar/ler os 30 campos de uma vez. */
export function todosOsSlotsECampos(): Array<{ slot: number; campo: RefinSlotCampo }> {
  const out: Array<{ slot: number; campo: RefinSlotCampo }> = []
  for (let slot = 1; slot <= MAX_OFERTAS_REFIN; slot++) {
    for (const campo of REFIN_SLOT_CAMPOS) out.push({ slot, campo })
  }
  return out
}

export function digitsOrRaw(value: string | null | undefined): string {
  const trimmed = String(value || '').trim()
  const digits = trimmed.replace(/\D/g, '')
  return digits || trimmed
}
