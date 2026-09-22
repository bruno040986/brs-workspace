/**
 * Reconstrução de linhas de texto a partir de um PDF tabular (relatórios de
 * fatores dos bancos), agrupando os tokens extraídos por posição (Y = linha,
 * X = ordem das colunas) — mais robusto que confiar na ordem de extração
 * crua do PDF, que nem sempre preserva a leitura visual esquerda→direita.
 *
 * Cada linha guarda também a página e os tokens com X: leitores de layouts
 * com células vazias (Daycoval) casam cada valor com a coluna do cabeçalho
 * pela posição horizontal, em vez de confiar na ordem dos tokens.
 */

import PDFParser from 'pdf2json'

export type PdfToken = { x: number; texto: string }
export type PdfLinha = { pagina: number; y: number; texto: string; tokens: PdfToken[] }

export async function extrairLinhasPdf(buffer: Buffer): Promise<PdfLinha[]> {
  const pdfParser = new (PDFParser as unknown as { new (): any })()
  const dados = await new Promise<any>((resolve, reject) => {
    pdfParser.on('pdfParser_dataError', (err: any) => reject(new Error(err?.parserError?.message || 'Falha ao ler o PDF.')))
    pdfParser.on('pdfParser_dataReady', (dados: any) => resolve(dados))
    pdfParser.parseBuffer(buffer)
  })

  const linhas: PdfLinha[] = []
  let pagina = 0
  for (const pag of dados?.Pages || []) {
    pagina += 1
    const porY = new Map<number, PdfToken[]>()
    for (const item of pag.Texts || []) {
      // Tolerância pequena pra tokens da "mesma linha visual" com Y ligeiramente diferente.
      const y = Math.round(item.y * 20) / 20
      const texto = (item.R || []).map((r: any) => decodeURIComponent(r.T)).join('')
      if (!texto.trim()) continue
      if (!porY.has(y)) porY.set(y, [])
      porY.get(y)!.push({ x: Number(item.x), texto })
    }
    const ysOrdenados = [...porY.keys()].sort((a, b) => a - b)
    for (const y of ysOrdenados) {
      const tokens = porY.get(y)!.sort((a, b) => a.x - b.x)
      linhas.push({ pagina, y, tokens, texto: tokens.map((t) => t.texto).join(' ').replace(/\s+/g, ' ').trim() })
    }
  }
  return linhas
}
