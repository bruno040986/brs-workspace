/**
 * Domínio do Comissionamento (espelho da lógica do ARW).
 *
 * Fórmula validada nos prints do ARW (22/08/2026):
 *   líquido = comissão × (1 − imposto da IF)
 *   repasse por tipo de agente = (líquido − spread) × (%repasse do tipo / 100)
 * Os repasses NÃO são armazenados — calculados a partir dos insumos.
 */

export const FORMAS_PAGAMENTO_PRAZO = [
  { value: 'percentual', label: '1 - Percentual' },
  { value: 'fixo', label: '2 - Valor Fixo' },
  { value: 'faixa_percentual', label: '3 - Faixa de Valores (Percentual)' },
  { value: 'faixa_fixo', label: '4 - Faixa de Valores (Valor Fixo)' },
] as const

export type FormaPagamentoPrazo = (typeof FORMAS_PAGAMENTO_PRAZO)[number]['value']

export function formaPagamentoLabel(value: string | null | undefined) {
  return FORMAS_PAGAMENTO_PRAZO.find((item) => item.value === value)?.label || '-'
}

export function formaPagamentoUsaFaixa(value: string | null | undefined) {
  return value === 'faixa_percentual' || value === 'faixa_fixo'
}

export function formaPagamentoEmPercentual(value: string | null | undefined) {
  return value === 'percentual' || value === 'faixa_percentual'
}

export const ORIGENS_MARGEM = [
  { value: 'novo', label: 'Margem Empréstimo Novo' },
  { value: 'cartao_rmc', label: 'Margem Cartão (RMC)' },
  { value: 'cartao_rcc', label: 'Margem Cartão Benefício (RCC)' },
  { value: 'nenhuma', label: 'Não usa margem' },
] as const

export function origemMargemLabel(value: string | null | undefined) {
  return ORIGENS_MARGEM.find((item) => item.value === value)?.label || '-'
}

export type RepasseCalculado = {
  tipoAgenteId: string
  tipoAgenteNome: string
  codigoArw: number | null
  percentualRepasse: number | null
  spread: number | null
  repasse: number | null
}

/**
 * Calcula a grade de repasses de um Prazo Comissão, no mesmo formato da tela
 * do ARW. `comissao` em %, `impostoPercent` em % (ex.: 7), spreads em pontos.
 */
export function calcularRepasses(params: {
  comissao: number | null
  impostoPercent: number | null
  tiposAgente: Array<{ id: string; name: string; codigo_arw: number | null; percentual_repasse: number | null }>
  spreadPorTipoAgente: Map<string, number>
}): { liquido: number | null; repasses: RepasseCalculado[] } {
  const comissao = params.comissao
  const imposto = params.impostoPercent ?? 0
  const liquido = comissao === null ? null : comissao * (1 - imposto / 100)

  const repasses = params.tiposAgente.map((tipo) => {
    const spread = params.spreadPorTipoAgente.has(tipo.id) ? params.spreadPorTipoAgente.get(tipo.id)! : null
    const pct = tipo.percentual_repasse
    let repasse: number | null = null
    if (liquido !== null && spread !== null && pct !== null) {
      repasse = Math.max(0, (liquido - spread) * (pct / 100))
    }
    return {
      tipoAgenteId: tipo.id,
      tipoAgenteNome: tipo.name,
      codigoArw: tipo.codigo_arw,
      percentualRepasse: pct,
      spread,
      repasse: repasse === null ? null : Math.round(repasse * 100) / 100,
    }
  })

  return { liquido: liquido === null ? null : Math.round(liquido * 100) / 100, repasses }
}
