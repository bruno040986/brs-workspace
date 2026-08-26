/**
 * Reconstrução de linhas de texto a partir de um PDF tabular (relatórios de
 * fatores dos bancos), agrupando os tokens extraídos por posição (Y = linha,
 * X = ordem das colunas) — mais robusto que confiar na ordem de extração
 * crua do PDF, que nem sempre preserva a leitura visual esquerda→direita.
 */

import PDFParser from 'pdf2json'

export type PdfLinha = { y: number; texto: string }

export async function extrairLinhasPdf(buffer: Buffer): Promise<PdfLinha[]> {
  const pdfParser = new (PDFParser as unknown as { new (): any })()
  const dados = await new Promise<any>((resolve, reject) => {
    pdfParser.on('pdfParser_dataError', (err: any) => reject(new Error(err?.parserError?.message || 'Falha ao ler o PDF.')))
    pdfParser.on('pdfParser_dataReady', (dados: any) => resolve(dados))
    pdfParser.parseBuffer(buffer)
  })

  const linhas: PdfLinha[] = []
  for (const pagina of dados?.Pages || []) {
    const porY = new Map<number, Array<{ x: number; texto: string }>>()
    for (const item of pagina.Texts || []) {
      // Tolerância pequena pra tokens da "mesma linha visual" com Y ligeiramente diferente.
      const y = Math.round(item.y * 20) / 20
      const texto = (item.R || []).map((r: any) => decodeURIComponent(r.T)).join('')
      if (!texto.trim()) continue
      if (!porY.has(y)) porY.set(y, [])
      porY.get(y)!.push({ x: item.x, texto })
    }
    const ysOrdenados = [...porY.keys()].sort((a, b) => a - b)
    for (const y of ysOrdenados) {
      const tokens = porY.get(y)!.sort((a, b) => a.x - b.x)
      linhas.push({ y, texto: tokens.map((t) => t.texto).join(' ').replace(/\s+/g, ' ').trim() })
    }
  }
  return linhas
}
