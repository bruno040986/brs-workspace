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
 * Operações que contam para o INDICADOR, segundo a regra parametrizada de data.
 * "Posterior" lido como data civil (SP) >= dia da inscrição (a financeira não registra hora).
 */
export function operacoesConsideradasParaIndicador(ops: OperacaoConfirmada[], inscritaEmIso: string, regra: RegraDataIndicacao): OperacaoConfirmada[] {
  if (regra === 'sem_restricao') return ops
  const corte = dataCivilSp(inscritaEmIso)
  if (regra === 'digitacao_apos_inscricao') return ops.filter((o) => o.dataDigitacao >= corte)
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
