/**
 * Ofertas de crédito no WeSales — cada oferta (REFIN de uma tabela/banco, ou
 * Novo/Cartão calculado por coeficiente) vira uma OPORTUNIDADE própria, não
 * mais campos numerados no contato (decisão de 24/08/2026, ver
 * docs/SPEC-CRM-WESALES-CAMPANHAS.md). Substitui src/lib/alvoconsig/refin-slots.ts.
 *
 * Pipeline "Ofertas de Crédito" — criado manualmente uma vez na interface do
 * WeSales (a API não cria pipeline); o código resolve pelo NOME (como já faz
 * com campo personalizado por key), então não há id fixo no código.
 *
 * Etapas (nesta ordem, nomes EXATOS a criar no WeSales):
 *   Disponível → Em Negociação → Digitação / Análise Bancária →
 *   Formalização → Liberada p/ Pagamento → Proposta Paga
 * "Perdida" não é etapa — é o STATUS da oportunidade (lost/abandoned),
 * aplicado na etapa em que ela estava quando caiu (mostra ONDE se perde).
 */

import { resolvePipelineStage, type WesalesPipeline, type WesalesPipelineStage } from '@/lib/wesales/client'

export const PIPELINE_OFERTAS_NOME = 'Ofertas de Crédito'

export const ETAPA_DISPONIVEL = 'Disponível'
export const ETAPA_EM_NEGOCIACAO = 'Em Negociação'
export const ETAPA_DIGITACAO = 'Digitação / Análise Bancária'
export const ETAPA_FORMALIZACAO = 'Formalização'
export const ETAPA_LIBERADA = 'Liberada p/ Pagamento'
export const ETAPA_PAGA = 'Proposta Paga'

export type TipoOferta = 'refin' | 'novo' | 'cartao_rmc' | 'cartao_rcc'

/** Campos de OPORTUNIDADE (modelo 'opportunity') — um conjunto só, reaproveitado por todo tipo de oferta. */
export const OFERTA_FIELD_KEYS = {
  tipoOferta: 'alvoconsig_tipo_oferta',
  parcela: 'alvoconsig_oferta_parcela',
  prazo: 'alvoconsig_oferta_prazo',
  taxa: 'alvoconsig_oferta_taxa',
  tabelaCodigo: 'alvoconsig_oferta_tabela_codigo',
  instituicaoId: 'alvoconsig_oferta_instituicao_id',
  instituicao: 'alvoconsig_oferta_instituicao',
  // Só fazem sentido pra REFIN (contrato já existente noutro banco) — ficam
  // vazios em ofertas de Novo/Cartão, sem custo nenhum.
  parcelasPagas: 'alvoconsig_oferta_parcelas_pagas',
  saldoDevedor: 'alvoconsig_oferta_saldo_devedor',
  contrato: 'alvoconsig_oferta_contrato',
  contratoElegivel: 'alvoconsig_oferta_contrato_elegivel',
  seguroValor: 'alvoconsig_oferta_seguro_valor',
  seguroSimNao: 'alvoconsig_oferta_seguro',
} as const

export const OFERTA_FIELD_LABELS: Record<keyof typeof OFERTA_FIELD_KEYS, string> = {
  tipoOferta: 'AlvoConsig — Tipo de Oferta',
  parcela: 'AlvoConsig — Oferta: Parcela',
  prazo: 'AlvoConsig — Oferta: Prazo',
  taxa: 'AlvoConsig — Oferta: Taxa',
  tabelaCodigo: 'AlvoConsig — Oferta: Código da Tabela',
  instituicaoId: 'AlvoConsig — Oferta: Instituição (id)',
  instituicao: 'AlvoConsig — Oferta: Instituição',
  parcelasPagas: 'AlvoConsig — Oferta: Parcelas Pagas',
  saldoDevedor: 'AlvoConsig — Oferta: Saldo Devedor',
  contrato: 'AlvoConsig — Oferta: Contrato',
  contratoElegivel: 'AlvoConsig — Oferta: Contrato Elegível',
  seguroValor: 'AlvoConsig — Oferta: Valor do Seguro',
  seguroSimNao: 'AlvoConsig — Oferta: Tem Seguro',
} as const

/**
 * Campos de CONTATO — foto rápida da margem (sem histórico; o histórico mora
 * nas oportunidades). Pasta "Dados de Crédito", criados pelo Bruno na UI do
 * WeSales em 29/08/2026: valor é MONETORY (mandar NÚMERO — "1234,56" vira
 * 123456 na API) e data é DATE (só AAAA-MM-DD). Compartilhados entre convênio
 * público e CLT (CLT só usa "Novo" — não tem cartão RMC/RCC). Convênio NÃO é
 * por produto — é o campo único "Convênio (Código/Nome)" de campos-sync.ts.
 */
export const MARGEM_FIELD_KEYS = {
  novoValor: 'novo_margem',
  novoData: 'novo_margem_data',
  rmcValor: 'cartao_rmc_margem',
  rmcData: 'cartao_rmc_margem_data',
  rccValor: 'cartao_rcc_margem',
  rccData: 'cartao_rcc_margem_data',
} as const

/** Nome visível no WeSales — só pra mensagem de erro quando o campo não existir. */
export const MARGEM_FIELD_LABELS: Record<keyof typeof MARGEM_FIELD_KEYS, string> = {
  novoValor: 'Novo Margem',
  novoData: 'Novo Margem Data',
  rmcValor: 'Cartão RMC Margem',
  rmcData: 'Cartão RMC Margem Data',
  rccValor: 'Cartão RCC Margem',
  rccData: 'Cartão RCC Margem Data',
} as const

export function nomeOportunidade(tipo: TipoOferta, instituicaoNome: string, tabelaNome: string | null): string {
  const rotuloTipo = tipo === 'refin' ? 'REFIN' : tipo === 'novo' ? 'Novo' : tipo === 'cartao_rmc' ? 'Cartão RMC' : 'Cartão RCC'
  const partes = [rotuloTipo, instituicaoNome, tabelaNome].filter(Boolean)
  return partes.join(' — ')
}

let cachePipeline: { pipeline: WesalesPipeline; stages: Record<string, WesalesPipelineStage> } | null = null

/** Resolve o pipeline "Ofertas de Crédito" e todas as suas etapas (1x, cacheado). */
export async function resolverPipelineOfertas() {
  if (cachePipeline) return cachePipeline
  const disponivel = await resolvePipelineStage(PIPELINE_OFERTAS_NOME, ETAPA_DISPONIVEL)
  if (!disponivel) {
    throw new Error(
      `Pipeline "${PIPELINE_OFERTAS_NOME}" (ou a etapa "${ETAPA_DISPONIVEL}") não encontrado no WeSales — crie o pipeline com as etapas: ${ETAPA_DISPONIVEL}, ${ETAPA_EM_NEGOCIACAO}, ${ETAPA_DIGITACAO}, ${ETAPA_FORMALIZACAO}, ${ETAPA_LIBERADA}, ${ETAPA_PAGA}.`,
    )
  }
  const stages: Record<string, WesalesPipelineStage> = { [ETAPA_DISPONIVEL]: disponivel.stage }
  for (const nome of [ETAPA_EM_NEGOCIACAO, ETAPA_DIGITACAO, ETAPA_FORMALIZACAO, ETAPA_LIBERADA, ETAPA_PAGA]) {
    const resolved = await resolvePipelineStage(PIPELINE_OFERTAS_NOME, nome)
    if (resolved) stages[nome] = resolved.stage
  }
  cachePipeline = { pipeline: disponivel.pipeline, stages }
  return cachePipeline
}
