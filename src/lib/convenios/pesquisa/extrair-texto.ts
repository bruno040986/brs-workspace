/**
 * Convênio — Base de Conhecimento, Fase 3. Extração de texto de PDF/HTML/
 * texto puro baixados por `baixarSeguro`. PDF via `pdf2json` (mesma lib já
 * usada em src/lib/comissionamento/pdf-tabela.ts).
 */
import PDFParser from 'pdf2json'

export type TextoExtraido = { texto: string; paginas: number }

const MIN_CARACTERES_UTEIS = 200

async function extrairTextoPdf(buffer: Buffer): Promise<TextoExtraido> {
  const pdfParser = new (PDFParser as unknown as { new (): any })()
  const dados = await new Promise<any>((resolve, reject) => {
    pdfParser.on('pdfParser_dataError', (err: any) => reject(new Error(err?.parserError?.message || 'Falha ao ler o PDF.')))
    pdfParser.on('pdfParser_dataReady', (dados: any) => resolve(dados))
    pdfParser.parseBuffer(buffer)
  })

  const paginasTexto: string[] = []
  for (const pagina of dados?.Pages || []) {
    const partes: string[] = []
    for (const item of pagina.Texts || []) {
      const texto = (item.R || [])
        .map((r: any) => {
          try {
            return decodeURIComponent(r.T)
          } catch {
            return String(r.T || '')
          }
        })
        .join('')
      if (texto.trim()) partes.push(texto)
    }
    paginasTexto.push(partes.join(' '))
  }
  const texto = paginasTexto
    .join('\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { texto, paginas: dados?.Pages?.length || 0 }
}

const ENTIDADES_HTML: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  atilde: 'ã', otilde: 'õ', ccedil: 'ç', acirc: 'â', ecirc: 'ê', ocirc: 'ô',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  Atilde: 'Ã', Otilde: 'Õ', Ccedil: 'Ç',
}

function extrairTextoHtml(html: string): TextoExtraido {
  let limpo = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<(br|p|div|li|tr|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&([a-zA-Z]+|#\d+);/g, (m, code) => {
      if (ENTIDADES_HTML[code]) return ENTIDADES_HTML[code]
      if (/^#\d+$/.test(code)) return String.fromCodePoint(Number(code.slice(1)))
      return m
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim()
  return { texto: limpo, paginas: 1 }
}

export async function extrairTexto(bytes: Buffer, mime: string): Promise<TextoExtraido> {
  if (mime === 'application/pdf') return extrairTextoPdf(bytes)
  if (mime === 'text/html') return extrairTextoHtml(bytes.toString('utf-8'))
  return { texto: bytes.toString('utf-8').trim(), paginas: 1 }
}

export function textoUtilSuficiente(texto: string): boolean {
  return texto.replace(/\s+/g, ' ').trim().length >= MIN_CARACTERES_UTEIS
}
