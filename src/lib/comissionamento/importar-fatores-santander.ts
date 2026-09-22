/**
 * Parser do "Relatório de Fatores PRICE - Carência Variável" do Santander
 * (decisão 26/08/2026 — ver docs/SPEC-COEFICIENTES-SANTANDER.md). O relatório
 * cobre várias semanas de uma vez (uma linha por dia, um fator por prazo) —
 * por isso importar em lote em vez de digitar coeficiente por coeficiente.
 *
 * Dois layouts do MESMO relatório (mesmo gerador do banco):
 *
 *  (a) LISTA — "Faixa Parcelas: 12;24;36;...;120": poucos prazos, cabem numa
 *      página; um bloco PRAZO/TAXA e uma linha por dia.
 *  (b) INTERVALO — "Faixa Parcelas: 3-144": dezenas de prazos, PAGINADO POR
 *      COLUNAS: cada página repete o cabeçalho, traz um bloco PRAZO/TAXA com
 *      até 13 prazos e repete TODAS as datas com os fatores daquelas colunas.
 *
 * A leitura é por BLOCOS: cada linha "PRAZO" define as colunas do bloco, a
 * "TAXA" a taxa por coluna, e as linhas de data abaixo trazem os fatores desses
 * prazos; os blocos são somados por data. O layout (a) é o caso de um bloco só.
 * A "Faixa Parcelas" serve só de conferência (os prazos lidos precisam caber
 * nela) — quem manda nas colunas é a linha PRAZO.
 *
 * Detalhe de extração (pdf2json): o rótulo "PRAZO"/"TAXA" e os números ficam
 * em Y ligeiramente diferente e viram linhas separadas — os números são
 * procurados na mesma linha ou nas vizinhas (±2).
 */

import { extrairLinhasPdf, type PdfLinha } from './pdf-tabela.ts'
import { dataBrIso, dataIsoBr, diasCorridos, numeroBr, type ArquivoFatores, type LinhaFatores } from './importar-fatores-comum.ts'

export type FatoresSantander = ArquivoFatores & { seguro: boolean; financiaIof: boolean }

const RE_LINHA_DATA = /^(\d{2}\/\d{2}\/\d{4})\s+(.+)$/
const ehLinhaInteiros = (t: string) => /^\d{1,3}(\s+\d{1,3})*$/.test(t)
const ehLinhaDecimais = (t: string) => /^\d+,\d+(\s+\d+,\d+)*$/.test(t)

/** Valores de um rótulo (PRAZO/TAXA): na própria linha ou na vizinha (±2). */
function valoresDoRotulo(linhas: PdfLinha[], i: number, rotulo: RegExp, aceita: (t: string) => boolean): string | null {
  const inline = linhas[i].texto.replace(rotulo, '').trim()
  if (inline && aceita(inline)) return inline
  for (const delta of [-1, 1, -2, 2]) {
    const vizinha = linhas[i + delta]?.texto?.trim()
    if (vizinha && aceita(vizinha)) return vizinha
  }
  return null
}

export function parseFatoresSantanderLinhas(linhasPdf: PdfLinha[]): FatoresSantander {
  const texto = linhasPdf.map((l) => l.texto).join('\n')

  const matchConvenioRegra = texto.match(
    /Conv[êe]nio:\s*(\d+)\s*-\s*([^;]+?)\s*;\s*Regra:\s*(\S+)\s*-\s*([^;]+?)\s*;\s*Seguro:\s*(\w+)\s*;\s*Financia\s*IOF:\s*(\w+)/i,
  )
  if (!matchConvenioRegra) {
    throw new Error('Não encontrei a linha "Convênio / Regra / Seguro / Financia IOF" — formato de PDF inesperado.')
  }
  const [, convenioCodigo, convenioNome, regraCodigo, regraNome, seguroTxt, financiaIofTxt] = matchConvenioRegra

  const matchDatas = texto.match(/Data\.?\s*In[íi]cio:\s*(\d{2}\/\d{2}\/\d{4})\s*;\s*Data Final:\s*(\d{2}\/\d{2}\/\d{4})/i)
  if (!matchDatas) throw new Error('Não encontrei "Data Início / Data Final" no cabeçalho — formato de PDF inesperado.')
  const dataInicio = dataIsoBr(matchDatas[1])
  const dataFinal = dataIsoBr(matchDatas[2])

  // Faixa Parcelas: lista ("12;24;36") ou intervalo ("3-144"). Só conferência —
  // a extração separa cada número/";" em tokens, daí o parseInt tolerante.
  const faixaTexto = (texto.match(/Faixa Parcelas:\s*([\d;\s\-–]+?)\s*;?\s*Data\.?\s*In[íi]cio/i)?.[1] || '').trim().replace(/;\s*$/, '')
  const faixaIntervalo = faixaTexto.match(/^(\d+)\s*[-–]\s*(\d+)$/)
  const faixaLista = !faixaIntervalo && faixaTexto ? faixaTexto.split(';').map((p) => Number.parseInt(p, 10)).filter((p) => p > 0) : []
  const cabeNaFaixa = (prazo: number) =>
    faixaIntervalo ? prazo >= Number(faixaIntervalo[1]) && prazo <= Number(faixaIntervalo[2]) : faixaLista.length ? faixaLista.includes(prazo) : true

  let prazosBloco: number[] | null = null
  const taxas = new Set<number>()
  const porData = new Map<string, Record<number, number>>()

  for (let i = 0; i < linhasPdf.length; i += 1) {
    const linha = linhasPdf[i]
    if (/^PRAZO\b/i.test(linha.texto)) {
      const nums = valoresDoRotulo(linhasPdf, i, /^PRAZO\s*/i, ehLinhaInteiros)
      if (!nums) throw new Error(`Não consegui ler os prazos do cabeçalho "PRAZO" (página ${linha.pagina}).`)
      prazosBloco = nums.split(/\s+/).map((p) => Number.parseInt(p, 10))
      continue
    }
    if (/^TAXA\b/i.test(linha.texto)) {
      const vals = valoresDoRotulo(linhasPdf, i, /^TAXA\s*/i, ehLinhaDecimais)
      if (!vals) throw new Error(`Não consegui ler a taxa do cabeçalho "TAXA" (página ${linha.pagina}).`)
      for (const v of vals.split(/\s+/).map(numeroBr)) if (v > 0) taxas.add(v)
      continue
    }
    const m = linha.texto.match(RE_LINHA_DATA)
    if (!m || !ehLinhaDecimais(m[2].trim())) continue
    if (!prazosBloco) throw new Error(`Linha de fatores (${m[1]}) antes do cabeçalho "PRAZO" — formato de PDF inesperado.`)
    const valores = m[2].trim().split(/\s+/).map(numeroBr)
    if (valores.length !== prazosBloco.length) {
      throw new Error(`Linha ${m[1]} (página ${linha.pagina}): ${valores.length} fator(es) para ${prazosBloco.length} prazo(s) do bloco.`)
    }
    const data = dataIsoBr(m[1])
    const registro = porData.get(data) ?? {}
    prazosBloco.forEach((prazo, k) => {
      const v = valores[k]
      if (!(v > 0)) return
      if (registro[prazo] !== undefined && Math.abs(registro[prazo] - v) > 1e-9) {
        throw new Error(`Fator divergente para ${m[1]} no prazo ${prazo}: ${registro[prazo]} e ${v} — PDF inconsistente.`)
      }
      registro[prazo] = v
    })
    porData.set(data, registro)
  }

  if (porData.size === 0) throw new Error('Não encontrei nenhuma linha de dados (data + fatores) no PDF — confira se é o relatório certo.')
  if (taxas.size === 0) throw new Error('Não consegui ler a taxa na linha "TAXA".')
  if (taxas.size > 1) throw new Error(`O PDF traz taxas diferentes por prazo (${[...taxas].join(', ')}) — formato não suportado.`)

  const prazos = [...new Set([...porData.values()].flatMap((r) => Object.keys(r).map(Number)))].sort((a, b) => a - b)
  const foraDaFaixa = prazos.filter((p) => !cabeNaFaixa(p))
  if (foraDaFaixa.length) {
    throw new Error(`Prazos ${foraDaFaixa.join(', ')} fora da "Faixa Parcelas: ${faixaTexto}" do cabeçalho — PDF inconsistente.`)
  }

  const linhas: LinhaFatores[] = [...porData.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([data, fatoresPorPrazo]) => ({ data, fatoresPorPrazo }))
  const avisos: string[] = []
  if (faixaIntervalo && (prazos[0] > Number(faixaIntervalo[1]) || prazos[prazos.length - 1] < Number(faixaIntervalo[2]))) {
    avisos.push(`O cabeçalho diz "Faixa Parcelas: ${faixaTexto}", mas o PDF só traz fatores dos prazos ${prazos[0]} a ${prazos[prazos.length - 1]}.`)
  }
  const foraDoPeriodo = linhas.filter((l) => l.data < dataInicio || l.data > dataFinal).length
  if (foraDoPeriodo) avisos.push(`${foraDoPeriodo} data(s) fora do período do cabeçalho (${dataBrIso(dataInicio)} a ${dataBrIso(dataFinal)}).`)
  const diasEsperados = diasCorridos(dataInicio, dataFinal)
  if (!foraDoPeriodo && linhas.length < diasEsperados) avisos.push(`${linhas.length} data(s) para um período de ${diasEsperados} dias — dias sem fator ficam sem coeficiente.`)

  return {
    formato: faixaIntervalo ? 'Santander (faixa em intervalo, paginado por colunas)' : 'Santander (faixa em lista)',
    convenioCodigo: convenioCodigo.trim(),
    convenioNome: convenioNome.trim(),
    seguro: /^s/i.test(seguroTxt),
    financiaIof: /^s/i.test(financiaIofTxt),
    tabelas: [
      {
        codigoTabelaBanco: regraCodigo.trim(),
        nomeTabela: regraNome.trim(),
        taxaPercentual: [...taxas][0],
        prazos,
        dataInicio,
        dataFinal,
        linhas,
        avisos,
        bloqueio: null,
      },
    ],
  }
}

export async function parseFatoresSantander(buffer: Buffer): Promise<FatoresSantander> {
  return parseFatoresSantanderLinhas(await extrairLinhasPdf(buffer))
}
