/**
 * Promoção NuAzul — tipos compartilhados da lógica pura (CONTRATO §3.1).
 * Dinheiro SEMPRE em centavos (inteiro). Datas civis como 'YYYY-MM-DD'.
 */

export type TipoOperacao = 'novo' | 'refinanciamento' | 'portabilidade' | 'saque_cartao_consignado' | 'saque_cartao_beneficio' | 'outro'

export const TIPOS_CARTAO: ReadonlySet<TipoOperacao> = new Set<TipoOperacao>(['saque_cartao_consignado', 'saque_cartao_beneficio'])

export type OperacaoConfirmada = {
  id: string
  tipo: TipoOperacao
  valorCentavos: number
  /** Data de cadastro na financeira (YYYY-MM-DD). */
  dataDigitacao: string
  /** Data do crédito na conta (YYYY-MM-DD) ou null se ainda não paga. */
  dataPagamento: string | null
}

/** `ate` em centavos, inclusivo; `null` = sem teto (última faixa). */
export type FaixaCartao = { ate: number | null; pct: number }

export type RegraDataIndicacao = 'digitacao_apos_inscricao' | 'pagamento_apos_inscricao' | 'sem_restricao'

export type PixTipo = 'cpf' | 'telefone' | 'email' | 'aleatoria' | 'dados_bancarios'

export type ParametrosCampanha = {
  minimoCentavos: number
  passoCentavos: number
  numerosPorPasso: number
  faixasCartao: FaixaCartao[]
  pixIndicadorCentavos: number
}

export const PARAMETROS_PADRAO: ParametrosCampanha = {
  minimoCentavos: 500000,
  passoCentavos: 500000,
  numerosPorPasso: 2,
  faixasCartao: [
    { ate: 1000000, pct: 50 },
    { ate: 1500000, pct: 40 },
    { ate: 2000000, pct: 30 },
    { ate: 3000000, pct: 25 },
    { ate: null, pct: 20 },
  ],
  pixIndicadorCentavos: 5000,
}

export type Elegibilidade = {
  totalCentavos: number
  cartaoCentavos: number
  pct: number
  proporcaoOk: boolean
  atingiuMinimo: boolean
  numerosCalculados: number
  /** max(emitidos, calculados) — número emitido nunca é revogado. */
  numerosDevidos: number
  numerosAEmitir: number
  saldoCentavos: number
  cartaoFaltanteCentavos: number
}

export type TipoEnvioPromocao = 'otp' | 'comprovante_indicacao' | 'link_numeros_servidor' | 'link_numeros_indicador' | 'comprovante_numeros' | 'aviso_pagamento'
