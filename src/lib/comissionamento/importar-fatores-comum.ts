/**
 * Contrato comum dos leitores de PDF de Fatores (Santander, Daycoval, ...):
 * cada leitor devolve um `ArquivoFatores` com N tabelas (o Daycoval traz uma
 * tabela por página; o Santander, uma por PDF). A rota de importação não
 * conhece o layout de nenhum banco — só este contrato.
 */

export type LinhaFatores = { data: string; fatoresPorPrazo: Record<number, number> }

export type TabelaFatores = {
  /** Código que casa com `tabelas_comissao.codigo_tabela_banco` (Regra no Santander, "Convênio" no Daycoval). */
  codigoTabelaBanco: string
  nomeTabela: string
  /** Taxa mensal do PDF (%), ou null quando o relatório não a traz (Daycoval). */
  taxaPercentual: number | null
  prazos: number[]
  dataInicio: string
  dataFinal: string
  linhas: LinhaFatores[]
  /** Informativos que vão pra mensagem do resultado (ex.: só dias úteis). */
  avisos: string[]
  /** Motivo pra NÃO gravar a tabela (fail-closed), ou null. */
  bloqueio: string | null
}

export type ArquivoFatores = {
  /** Descrição curta do layout reconhecido, pra mensagem do resultado. */
  formato: string
  convenioCodigo: string | null
  convenioNome: string | null
  tabelas: TabelaFatores[]
}

export function numeroBr(texto: string): number {
  return Number.parseFloat(String(texto).trim().replace(/\./g, '').replace(',', '.'))
}

export function dataIsoBr(dataBr: string): string {
  const [d, m, a] = dataBr.split('/')
  return `${a}-${m}-${d}`
}

export function dataBrIso(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

export const ehDataBr = (texto: string) => /^\d{2}\/\d{2}\/\d{4}$/.test(texto)

/** Dias corridos entre duas datas ISO, inclusive as pontas. */
export function diasCorridos(inicioIso: string, fimIso: string): number {
  const ini = Date.UTC(+inicioIso.slice(0, 4), +inicioIso.slice(5, 7) - 1, +inicioIso.slice(8, 10))
  const fim = Date.UTC(+fimIso.slice(0, 4), +fimIso.slice(5, 7) - 1, +fimIso.slice(8, 10))
  return Math.round((fim - ini) / 86_400_000) + 1
}
