/**
 * Modelo canônico de "oferta disponível" — resultado de uma simulação em
 * tempo real na API de uma IF de crédito (Amigoz é a 1ª). IF-AGNÓSTICO: nada
 * de Amigoz aqui. Cada adaptador por IF (ex.: src/lib/if-credito/amigoz/ofertas.ts)
 * traduz a resposta bruta da IF pra este formato; o worker, as saídas pro
 * WeSales e a campanha do AlvoConsig só conhecem isto.
 * Ver docs/ROTEIRO-AMIGOZ-FATIA-3-OFERTAS.md, seção 1.
 */

export type ProdutoOferta = 'cartao_rmc' | 'cartao_rcc' | 'saque_complementar' | 'novo' | 'refin'

export type OfertaNormalizada = {
  produto: ProdutoOferta
  instituicaoId: string // financial_institutions.id
  instituicaoNome: string
  limitePreAprovado: number | null
  valorSaque: number | null
  numParcelas: number | null
  valorParcela: number | null
  taxaMes: number | null // %
  cetMes: number | null // %
  primeiroVencimento: string | null // AAAA-MM-DD
  tabelaCodigo: string | null // identidade da oferta na IF (idempotência); Amigoz: id do produto ("223 Cartão Consignado" → "223")
  bruto: unknown // resposta da IF, auditoria
}
