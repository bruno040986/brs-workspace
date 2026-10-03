/**
 * Elegibilidade / direitos da promoção (CONTRATO §3.3). Puro, inteiros em centavos.
 * Regras: regras.md §5–§7 + decisões (nunca revoga número emitido; geração incremental).
 */
import { PARAMETROS_PADRAO, TIPOS_CARTAO, type Elegibilidade, type FaixaCartao, type OperacaoConfirmada, type ParametrosCampanha, type RegraDataIndicacao } from './tipos.ts'
import { dataCivilSp } from './dias-uteis.ts'

/** 1ª faixa com (ate === null || total <= ate). Abaixo do mínimo cai na 1ª faixa. */
export function pctCartaoDaFaixa(totalCentavos: number, faixas: FaixaCartao[]): number {
  for (const f of faixas) {
    if (f.ate === null || totalCentavos <= f.ate) return f.pct
  }
  return faixas[faixas.length - 1]?.pct ?? 0
}

function somar(ops: OperacaoConfirmada[], filtro: (o: OperacaoConfirmada) => boolean = () => true): number {
  return ops.reduce((acc, o) => (filtro(o) ? acc + o.valorCentavos : acc), 0)
}

export function calcularElegibilidade(ops: OperacaoConfirmada[], numerosEmitidos: number, p: ParametrosCampanha = PARAMETROS_PADRAO): Elegibilidade {
  const totalCentavos = somar(ops)
  const cartaoCentavos = somar(ops, (o) => TIPOS_CARTAO.has(o.tipo))
  const atingiuMinimo = totalCentavos >= p.minimoCentavos
  const pct = pctCartaoDaFaixa(totalCentavos, p.faixasCartao)
  // cartao/total >= pct/100, sem ponto flutuante
  const proporcaoOk = cartaoCentavos * 100 >= totalCentavos * pct
  const passos = Math.floor(totalCentavos / p.passoCentavos)
  const numerosCalculados = atingiuMinimo && proporcaoOk ? passos * p.numerosPorPasso : 0
  const numerosDevidos = Math.max(numerosEmitidos, numerosCalculados)
  return {
    totalCentavos,
    cartaoCentavos,
    pct,
    proporcaoOk,
    atingiuMinimo,
    numerosCalculados,
    numerosDevidos,
    numerosAEmitir: numerosDevidos - numerosEmitidos,
    saldoCentavos: totalCentavos - passos * p.passoCentavos,
    cartaoFaltanteCentavos: proporcaoOk ? 0 : Math.ceil((totalCentavos * pct) / 100) - cartaoCentavos,
  }
}

/**
 * Regulamento §9: a indicação só vale se registrada ANTES da PRIMEIRA proposta do CPF
 * (menor data de digitação entre TODAS as operações, inclusive canceladas/invalidadas — §9.6).
 * A financeira só informa data (sem hora): no mesmo dia civil (SP) a indicação ainda vale.
 */
export function indicacaoVale(registradaEmIso: string, primeiraDigitacao: string | null): boolean {
  return primeiraDigitacao === null || dataCivilSp(registradaEmIso) <= primeiraDigitacao
}

/** §9.4: inscrição direta (ou criada antes da indicação) nunca é vinculada a indicador. */
export function inscricaoPodeSerIndicada(origem: 'direta' | 'indicacao', inscricaoCriadaEmIso: string, indicacaoRegistradaEmIso: string): boolean {
  return origem !== 'direta' && new Date(inscricaoCriadaEmIso) >= new Date(indicacaoRegistradaEmIso)
}

export const AVISO_INDICACAO_POSTERIOR = 'Indicação posterior à primeira proposta — não gera R$ 50 nem número da sorte (regulamento §9).'

/**
 * Operações que contam para o INDICADOR. No modo padrão (digitacao_apos_inscricao = regra do §9)
 * é tudo-ou-nada: indicação posterior à 1ª proposta zera os direitos do indicador.
 * `primeiraDigitacao`: menor data_digitacao de todas as operações do CPF (qualquer status).
 */
export function operacoesConsideradasParaIndicador(ops: OperacaoConfirmada[], inscritaEmIso: string, regra: RegraDataIndicacao, primeiraDigitacao: string | null = null): OperacaoConfirmada[] {
  if (regra === 'sem_restricao') return ops
  if (regra === 'digitacao_apos_inscricao') return indicacaoVale(inscritaEmIso, primeiraDigitacao) ? ops : []
  const corte = dataCivilSp(inscritaEmIso)
  return ops.filter((o) => o.dataPagamento !== null && o.dataPagamento >= corte)
}

/** Pix: só o mínimo (ignora proporção). Número: mínimo E proporção. Máx. 1 de cada por indicado. */
export function direitosDoIndicador(opsConsideradas: OperacaoConfirmada[], p: ParametrosCampanha = PARAMETROS_PADRAO): { pixDevido: boolean; numeroDevido: boolean; elegibilidade: Elegibilidade } {
  const elegibilidade = calcularElegibilidade(opsConsideradas, 0, p)
  return {
    pixDevido: elegibilidade.atingiuMinimo,
    numeroDevido: elegibilidade.atingiuMinimo && elegibilidade.proporcaoOk,
    elegibilidade,
  }
}

export type SnapshotGeracao = {
  operacoes: OperacaoConfirmada[]
  totalCentavos: number
  usadoAnteriorCentavos: number
  usadoNestaCentavos: number
  saldoCentavos: number
  vinculos: Array<{ operacaoId: string; valorUtilizadoCentavos: number }>
}

/**
 * Snapshot gravado na geração. Consome operações em ordem de pagamento (depois
 * digitação, depois id) até cobrir usadoAnterior + usadoNesta; a última pode ser parcial.
 */
export function montarSnapshotGeracao(ops: OperacaoConfirmada[], usadoAnteriorCentavos: number, qtd: number, p: ParametrosCampanha = PARAMETROS_PADRAO): SnapshotGeracao {
  const ordenadas = [...ops].sort((a, b) =>
    (a.dataPagamento ?? '9999').localeCompare(b.dataPagamento ?? '9999') || a.dataDigitacao.localeCompare(b.dataDigitacao) || a.id.localeCompare(b.id),
  )
  const totalCentavos = somar(ops)
  const usadoNestaCentavos = (qtd / p.numerosPorPasso) * p.passoCentavos
  const vinculos: SnapshotGeracao['vinculos'] = []
  let pular = usadoAnteriorCentavos
  let restante = usadoNestaCentavos
  for (const o of ordenadas) {
    if (restante <= 0) break
    let disponivel = o.valorCentavos
    if (pular > 0) {
      const consumido = Math.min(pular, disponivel)
      pular -= consumido
      disponivel -= consumido
    }
    if (disponivel <= 0) continue
    const usar = Math.min(disponivel, restante)
    vinculos.push({ operacaoId: o.id, valorUtilizadoCentavos: usar })
    restante -= usar
  }
  return {
    operacoes: ordenadas,
    totalCentavos,
    usadoAnteriorCentavos,
    usadoNestaCentavos,
    saldoCentavos: totalCentavos - usadoAnteriorCentavos - usadoNestaCentavos,
    vinculos,
  }
}
