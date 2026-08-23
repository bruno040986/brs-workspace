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

// ---------------------------------------------------------------------------
// Resolução de Spread (margem mínima) e grades de comissionamento
// (tela de Prazo Comissão — decisões Bruno 24/08/2026)
// ---------------------------------------------------------------------------

export type SpreadRow = {
  id: string
  forma_contrato_id: string
  tipos_agente: string[]
  instituicoes: string[]
  convenios: string[]
  tipos_formalizacao: string[]
  pontos: number
  vigencia_inicio: string
  vigencia_fim: string | null
}

export type ContextoTabela = {
  formaContratoId: string
  institutionId: string
  convenioId: string | null
  tipoFormalizacaoId: string | null
}

/**
 * Resolve o spread aplicável a um tipo de agente no contexto da Tabela de
 * Comissão. Regras: forma de contrato obrigatória; dimensões em array vazio
 * valem para todos; vence o MAIS ESPECÍFICO (mais dimensões preenchidas que
 * casam); empate → vigência mais recente.
 */
export function resolverSpreadTipoAgente(
  spreads: SpreadRow[],
  contexto: ContextoTabela,
  tipoAgenteId: string,
  hoje = new Date().toISOString().slice(0, 10),
): SpreadRow | null {
  const candidatos = spreads.filter((spread) => {
    if (spread.forma_contrato_id !== contexto.formaContratoId) return false
    if (spread.vigencia_inicio > hoje) return false
    if (spread.vigencia_fim && spread.vigencia_fim < hoje) return false
    if (spread.tipos_agente.length > 0 && !spread.tipos_agente.includes(tipoAgenteId)) return false
    if (spread.instituicoes.length > 0 && !spread.instituicoes.includes(contexto.institutionId)) return false
    if (spread.convenios.length > 0 && (!contexto.convenioId || !spread.convenios.includes(contexto.convenioId))) return false
    if (spread.tipos_formalizacao.length > 0 && (!contexto.tipoFormalizacaoId || !spread.tipos_formalizacao.includes(contexto.tipoFormalizacaoId))) return false
    return true
  })
  if (!candidatos.length) return null

  const especificidade = (spread: SpreadRow) =>
    (spread.tipos_agente.length > 0 ? 1 : 0) +
    (spread.instituicoes.length > 0 ? 1 : 0) +
    (spread.convenios.length > 0 ? 1 : 0) +
    (spread.tipos_formalizacao.length > 0 ? 1 : 0)

  candidatos.sort((a, b) => {
    const diff = especificidade(b) - especificidade(a)
    if (diff !== 0) return diff
    return b.vigencia_inicio.localeCompare(a.vigencia_inicio)
  })
  return candidatos[0]
}

export type LinhaGrade = {
  tipoAgenteId: string
  tipoAgenteNome: string
  codigoArw: number | null
  liquidaImposto: number | null
  spread: number | null
  spreadAusente: boolean
  liquidaTotal: number | null
  percentualRepasse: number | null
  repasse: number | null
}

/**
 * Grade de comissionamento (Comissão / Emissão / Seguro).
 * - Comissão: desconta imposto e SPREAD, depois aplica % repasse.
 * - Emissão (valor fixo) e Seguro: descontam SÓ o imposto (regra ARW) e
 *   aplicam % repasse — `usarSpread: false`.
 * Valores percentuais ou em R$ — as subtrações percentuais valem igual.
 */
export function calcularGradeComissionamento(params: {
  valorBase: number | null
  impostoPercent: number | null
  usarSpread: boolean
  tiposAgente: Array<{ id: string; name: string; codigo_arw: number | null; percentual_repasse: number | null }>
  spreads: SpreadRow[]
  contexto: ContextoTabela | null
}): LinhaGrade[] {
  const imposto = params.impostoPercent ?? 0
  const liquidaImposto = params.valorBase === null ? null : params.valorBase * (1 - imposto / 100)

  return params.tiposAgente.map((tipo) => {
    let spread: number | null = null
    let spreadAusente = false
    if (params.usarSpread) {
      const hit = params.contexto ? resolverSpreadTipoAgente(params.spreads, params.contexto, tipo.id) : null
      spread = hit ? Number(hit.pontos) : null
      spreadAusente = !hit
    }
    const liquidaTotal =
      liquidaImposto === null ? null : Math.max(0, liquidaImposto - (params.usarSpread ? spread ?? 0 : 0))
    const pct = tipo.percentual_repasse
    const repasse = liquidaTotal === null || pct === null ? null : Math.round(liquidaTotal * (pct / 100) * 100) / 100

    return {
      tipoAgenteId: tipo.id,
      tipoAgenteNome: tipo.name,
      codigoArw: tipo.codigo_arw,
      liquidaImposto: liquidaImposto === null ? null : Math.round(liquidaImposto * 100) / 100,
      spread,
      spreadAusente,
      liquidaTotal: liquidaTotal === null ? null : Math.round(liquidaTotal * 100) / 100,
      percentualRepasse: pct,
      repasse,
    }
  })
}
