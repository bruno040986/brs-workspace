/**
 * Parser do relatório "Fatores Price" do Banco Daycoval (SIC / MPPRICECVA).
 *
 * Layout observado (09/09/2026, PREF SJ CAMPOS, 14 páginas): UMA TABELA POR
 * PÁGINA, identificada pela linha "Convênio: 731701 PREFSJC1DIG" — esse
 * "convênio" do Daycoval é na verdade o código da tabela/tier (Novo 7317xx,
 * Refin 7337xx, fidelidade 830001) e casa com `tabelas_comissao.codigo_tabela_banco`,
 * igual à Regra do Santander. Cabeçalho "Data Base | 1º Venc | Tx Cet | 48
 * meses | 60 meses | ..." e uma linha por DIA ÚTIL; tiers mais altos deixam
 * colunas de prazo VAZIAS — por isso cada valor é casado com a coluna do
 * cabeçalho pela posição X (pdf2json), não pela ordem dos tokens.
 *
 * "Aplicar Fator sobre Valor Liberado + TC": com TC = 0,00 o coeficiente é
 * 1/Fator como no Santander; TC > 0 muda a conta e ainda não é tratado → a
 * tabela sai com `bloqueio` e não é gravada (fail-closed). "1º Venc" e
 * "Tx Cet" vêm prontos por linha, mas `coeficientes` não tem onde guardá-los.
 * Dias sem fator (fim de semana/feriado) ficam sem coeficiente — nada é
 * inventado; o resultado avisa.
 */

import { extrairLinhasPdf, type PdfLinha } from './pdf-tabela.ts'
import { dataIsoBr, diasCorridos, ehDataBr, numeroBr, type ArquivoFatores, type TabelaFatores } from './importar-fatores-comum.ts'

type Coluna = { prazo: number; x: number }
type Bloco = {
  codigo: string
  nome: string
  empregador: string | null
  tc: number | null
  colunas: Coluna[]
  porData: Map<string, Record<number, number>>
}

/** Colunas do relatório distam ~3,6 unidades de X; "Tx Cet" fica a ~2,8 da 1ª coluna de prazo. */
const TOLERANCIA_X = 1.2

function colunaMaisProxima(colunas: Coluna[], x: number): Coluna | null {
  let melhor: Coluna | null = null
  for (const coluna of colunas) {
    const distancia = Math.abs(coluna.x - x)
    if (distancia <= TOLERANCIA_X && (!melhor || distancia < Math.abs(melhor.x - x))) melhor = coluna
  }
  return melhor
}

export function parseFatoresDaycovalLinhas(linhasPdf: PdfLinha[]): ArquivoFatores {
  const blocos = new Map<string, Bloco>()
  let atual: Bloco | null = null

  for (const linha of linhasPdf) {
    const primeiro = linha.tokens[0]?.texto?.trim() || ''
    const mConvenio = linha.texto.match(/^Conv[êe]nio:\s*(\d+)\s+([A-Z0-9_.-]+)/i)
    if (mConvenio) {
      // Mesmo código em página posterior = continuação da mesma tabela.
      atual = blocos.get(mConvenio[1]) ?? { codigo: mConvenio[1], nome: mConvenio[2], empregador: null, tc: null, colunas: [], porData: new Map() }
      blocos.set(atual.codigo, atual)
      continue
    }
    if (!atual) continue
    if (/^Empregador:/i.test(primeiro)) {
      atual.empregador = (primeiro.toLowerCase() === 'empregador:' ? linha.tokens[1]?.texto : linha.texto.replace(/^Empregador:\s*/i, '').split(/\s{2,}/)[0])?.trim() || atual.empregador
      continue
    }
    const mTc = linha.texto.match(/^TC:\s*([\d.]+,\d+|\d+)/i)
    if (mTc) {
      atual.tc = numeroBr(mTc[1])
      continue
    }
    if (/^Data Base/i.test(primeiro)) {
      atual.colunas = linha.tokens.flatMap((token) => {
        const m = token.texto.trim().match(/^(\d{1,3})\s*meses$/i)
        return m ? [{ prazo: Number(m[1]), x: token.x }] : []
      })
      if (atual.colunas.length === 0) throw new Error(`Cabeçalho da tabela ${atual.codigo} sem colunas "N meses" (página ${linha.pagina}).`)
      continue
    }
    if (!ehDataBr(primeiro)) continue
    if (atual.colunas.length === 0) {
      throw new Error(`Linha de fatores (${primeiro}) antes do cabeçalho "Data Base" na tabela ${atual.codigo} (página ${linha.pagina}).`)
    }
    const data = dataIsoBr(primeiro)
    const registro = atual.porData.get(data) ?? {}
    for (const token of linha.tokens.slice(1)) {
      const txt = token.texto.trim()
      if (ehDataBr(txt)) continue // 1º Venc
      const coluna = colunaMaisProxima(atual.colunas, token.x)
      if (!coluna) continue // Tx Cet (fora das colunas de prazo)
      const v = numeroBr(txt)
      if (!(v > 0)) continue
      if (registro[coluna.prazo] !== undefined && Math.abs(registro[coluna.prazo] - v) > 1e-9) {
        throw new Error(`Fator divergente para ${primeiro} no prazo ${coluna.prazo} da tabela ${atual.codigo} — PDF inconsistente.`)
      }
      registro[coluna.prazo] = v
    }
    atual.porData.set(data, registro)
  }

  if (blocos.size === 0) {
    throw new Error('Não encontrei nenhuma tabela (linha "Convênio: <código> <nome>") — confira se é o relatório "Fatores Price" do Daycoval.')
  }

  const tabelas: TabelaFatores[] = []
  for (const bloco of blocos.values()) {
    const linhas = [...bloco.porData.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([data, fatoresPorPrazo]) => ({ data, fatoresPorPrazo }))
    const prazosCabecalho = bloco.colunas.map((c) => c.prazo).sort((a, b) => a - b)
    const prazos = prazosCabecalho.filter((p) => linhas.some((l) => l.fatoresPorPrazo[p] > 0))
    const semFator = prazosCabecalho.filter((p) => !prazos.includes(p))
    const dataInicio = linhas[0]?.data || ''
    const dataFinal = linhas[linhas.length - 1]?.data || ''

    const avisos: string[] = []
    if (semFator.length) avisos.push(`Sem fator para os prazos ${semFator.join(', ')} (colunas vazias no PDF).`)
    if (linhas.length > 1) {
      const dias = diasCorridos(dataInicio, dataFinal)
      if (linhas.length < dias) avisos.push(`${linhas.length} dias úteis num período de ${dias} dias — fins de semana e feriados ficam sem coeficiente.`)
    }

    let bloqueio: string | null = null
    if (linhas.length === 0 || prazos.length === 0) bloqueio = 'Nenhum fator encontrado na tabela.'
    else if (bloco.tc == null) bloqueio = 'Não consegui ler a "TC" da tabela — sem ela não dá pra garantir que coeficiente = 1/Fator.'
    else if (bloco.tc > 0) {
      bloqueio = `TC = ${bloco.tc.toFixed(2).replace('.', ',')} > 0: o fator do Daycoval se aplica sobre "Valor Liberado + TC" e o Workspace ainda não trata TC — tabela não importada.`
    }

    tabelas.push({ codigoTabelaBanco: bloco.codigo, nomeTabela: bloco.nome, taxaPercentual: null, prazos, dataInicio, dataFinal, linhas, avisos, bloqueio })
  }

  return {
    formato: 'Daycoval (Fatores Price, uma tabela por página)',
    convenioCodigo: null,
    convenioNome: [...blocos.values()].find((b) => b.empregador)?.empregador || null,
    tabelas,
  }
}

export async function parseFatoresDaycoval(buffer: Buffer): Promise<ArquivoFatores> {
  return parseFatoresDaycovalLinhas(await extrairLinhasPdf(buffer))
}
