/**
 * Parser do "Relatório de Fatores PRICE - Carência Variável" do Santander
 * (decisão 26/08/2026 — ver docs/SPEC-COEFICIENTES-SANTANDER.md). O relatório
 * cobre várias semanas de uma vez (uma linha por dia, um fator por prazo) —
 * por isso importar em lote em vez de digitar coeficiente por coeficiente.
 *
 * Formato observado (fixo, sistema legado do banco):
 *   Convênio: 4875 - MUNICIPIO DE MESQUITA ; Regra: 8104875 - 1 Oferta Novo
 *   Com Seguro; Seguro: S; Financia IOF: S
 *   Faixa Parcelas: 12;24;36;...;120; Data. Inicio: 25/08/2026; Data Final: 14/09/2026
 *   PRAZO   12   24   36 ...
 *   TAXA  2,3800 2,3800 ...
 *   25/08/2026  0,106263  0,0609326  ...
 */

import { extrairLinhasPdf } from './pdf-tabela'

export type FatorSantanderResultado = {
  convenioCodigo: string
  convenioNome: string
  regraCodigo: string
  regraNome: string
  seguro: boolean
  financiaIof: boolean
  taxaPercentual: number
  prazos: number[]
  dataInicio: string
  dataFinal: string
  linhas: Array<{ data: string; fatoresPorPrazo: Record<number, number> }>
}

function numeroBr(texto: string): number {
  return Number.parseFloat(String(texto).trim().replace(/\./g, '').replace(',', '.'))
}

function dataIsoBr(dataBr: string): string {
  const [d, m, a] = dataBr.split('/')
  return `${a}-${m}-${d}`
}

export async function parseFatoresSantander(buffer: Buffer): Promise<FatorSantanderResultado> {
  const linhasPdf = await extrairLinhasPdf(buffer)
  const texto = linhasPdf.map((l) => l.texto).join('\n')

  const matchConvenioRegra = texto.match(
    /Conv[êe]nio:\s*(\d+)\s*-\s*([^;]+?)\s*;\s*Regra:\s*(\S+)\s*-\s*([^;]+?)\s*;\s*Seguro:\s*(\w+)\s*;\s*Financia\s*IOF:\s*(\w+)/i,
  )
  if (!matchConvenioRegra) {
    throw new Error('Não encontrei a linha "Convênio / Regra / Seguro / Financia IOF" — formato de PDF inesperado.')
  }
  const [, convenioCodigo, convenioNome, regraCodigo, regraNome, seguroTxt, financiaIofTxt] = matchConvenioRegra

  const matchFaixa = texto.match(
    /Faixa Parcelas:\s*([\d;]+)\s*;\s*Data\.?\s*In[íi]cio:\s*(\d{2}\/\d{2}\/\d{4})\s*;\s*Data Final:\s*(\d{2}\/\d{2}\/\d{4})/i,
  )
  if (!matchFaixa) {
    throw new Error('Não encontrei a linha "Faixa Parcelas / Data Início / Data Final" — formato de PDF inesperado.')
  }
  const prazos = matchFaixa[1]
    .split(';')
    .map((p) => Number.parseInt(p, 10))
    .filter((p) => Number.isFinite(p) && p > 0)
  const dataInicio = dataIsoBr(matchFaixa[2])
  const dataFinal = dataIsoBr(matchFaixa[3])

  const linhaTaxa = linhasPdf.find((l) => /^TAXA\b/i.test(l.texto))
  if (!linhaTaxa) throw new Error('Não encontrei a linha "TAXA" da tabela — formato de PDF inesperado.')
  const taxaTokens = linhaTaxa.texto.replace(/^TAXA\s*/i, '').trim().split(/\s+/).filter(Boolean)
  const taxaPercentual = numeroBr(taxaTokens[0])
  if (!Number.isFinite(taxaPercentual) || taxaPercentual <= 0) {
    throw new Error(`Não consegui ler a taxa na linha "TAXA" (lida: "${linhaTaxa.texto}").`)
  }

  const dadoRegex = /^(\d{2}\/\d{2}\/\d{4})\s+(.+)$/
  const linhas: FatorSantanderResultado['linhas'] = []
  for (const linha of linhasPdf) {
    const m = linha.texto.match(dadoRegex)
    if (!m) continue
    const valores = m[2]
      .trim()
      .split(/\s+/)
      .map(numeroBr)
      .filter((v) => Number.isFinite(v))
    if (valores.length === 0) continue
    const fatoresPorPrazo: Record<number, number> = {}
    prazos.forEach((prazo, i) => {
      if (valores[i] !== undefined && valores[i] > 0) fatoresPorPrazo[prazo] = valores[i]
    })
    if (Object.keys(fatoresPorPrazo).length === 0) continue
    linhas.push({ data: dataIsoBr(m[1]), fatoresPorPrazo })
  }
  if (linhas.length === 0) {
    throw new Error('Não encontrei nenhuma linha de dados (data + fatores) no PDF — confira se é o relatório certo.')
  }

  return {
    convenioCodigo: convenioCodigo.trim(),
    convenioNome: convenioNome.trim(),
    regraCodigo: regraCodigo.trim(),
    regraNome: regraNome.trim(),
    seguro: /^s/i.test(seguroTxt),
    financiaIof: /^s/i.test(financiaIofTxt),
    taxaPercentual,
    prazos,
    dataInicio,
    dataFinal,
    linhas,
  }
}
