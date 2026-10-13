import type { Color } from 'sharp'

const MIN_PX = 16
const LIMITE_PIXELS = 25_000_000 // 5000x5000: barra decompression bomb (PNG/WebP pequeno que declara dimensão gigante)
const MARGEM = 1.08 // quadrado: 4% por lado, para o emblema não encostar na borda do cartão
const BANDEIRA = 10 / 7 // largura:altura oficial da bandeira

const LADO_MAX = 5000

export type Proporcao = 'quadrado' | 'bandeira'
export type ResultadoAparar = { buffer: Buffer; aparada: boolean; rejeitada?: undefined } | { rejeitada: true; motivo: 'pixels' | 'leitura' }

export const MSG_REJEICAO: Record<'pixels' | 'leitura', string> = {
  pixels: 'Imagem muito grande em pixels (máximo 5000 × 5000). Reduza a imagem e envie de novo.',
  leitura: 'Não foi possível ler a imagem. Envie PNG, JPEG ou WebP válido.',
}

/**
 * Apara a margem transparente (ou de cor uniforme) de logotipo/brasão/bandeira e devolve
 * o arquivo em proporção fixa (quadrado 1:1 ou bandeira 10:7), centralizado e sem distorcer,
 * no mesmo formato. Qualquer falha ou resultado suspeito devolve o original (aparada=false).
 * Só para os 3 emblemas, não para galeria/foto.
 */
export async function aparar(buffer: Buffer, proporcao: Proporcao = 'quadrado'): Promise<ResultadoAparar> {
  const original = { buffer, aparada: false }
  // Sob demanda: sharp é optionalDependency do next; falha ao carregar não pode derrubar o módulo de upload.
  let sharp: typeof import('sharp')
  try {
    sharp = (await import('sharp')).default
  } catch (e) {
    console.error('sharp indisponível; emblema gravado sem processar:', e instanceof Error ? e.message : 'erro')
    return original
  }
  try {
    // pages:1 ignora frames extras (WebP/GIF animado); sequentialRead e o teto de pixels limitam memória.
    const abrir = (b: Buffer) => sharp(b, { limitInputPixels: LIMITE_PIXELS, sequentialRead: true, pages: 1 })
    const meta = await abrir(buffer).metadata()
    const { format, width, height } = meta
    if (!width || !height || (format !== 'png' && format !== 'webp' && format !== 'jpeg')) return { rejeitada: true, motivo: 'leitura' }
    if (width * height > LIMITE_PIXELS || width > LADO_MAX || height > LADO_MAX) return { rejeitada: true, motivo: 'pixels' } // não decodifica
    const comAlfa = Boolean(meta.hasAlpha)

    // Fundo: transparente se houver alfa; senão a cor do canto (é o que o trim usa por padrão).
    let fundo: Color = { r: 0, g: 0, b: 0, alpha: 0 }
    if (!comAlfa) {
      const [r, g, b] = await abrir(buffer).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
      fundo = { r, g, b, alpha: 1 }
    }

    const { data, info } = await abrir(buffer).rotate().trim({ background: fundo, threshold: 10 }).toBuffer({ resolveWithObject: true })
    const { width: w, height: h } = info
    if (w < MIN_PX || h < MIN_PX) return original
    // Sem alfa a "margem" é cor de fundo: se comeu mais da metade, não é margem, é conteúdo.
    if (!comAlfa && (w < width / 2 || h < height / 2)) return original

    let cw: number
    let ch: number
    if (proporcao === 'quadrado') {
      cw = Math.ceil(Math.max(w, h) * MARGEM)
      ch = cw
    } else if (Math.abs(w / h / BANDEIRA - 1) <= 0.02) {
      cw = w
      ch = h
    } else {
      cw = Math.max(w, Math.round(h * BANDEIRA))
      ch = Math.max(h, Math.round(cw / BANDEIRA))
    }
    if (cw * ch > LIMITE_PIXELS || cw > LADO_MAX || ch > LADO_MAX) return { rejeitada: true, motivo: 'pixels' }
    if (cw === width && ch === height && w === width && h === height) return original // nada a mudar

    const left = Math.floor((cw - w) / 2)
    const top = Math.floor((ch - h) / 2)
    let img = abrir(data).extend({ top, bottom: ch - h - top, left, right: cw - w - left, background: fundo })
    img = format === 'png' ? img.png() : format === 'webp' ? img.webp({ quality: 90 }) : img.jpeg({ quality: 90 })
    return { buffer: await img.toBuffer(), aparada: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro'
    console.error('Falha ao aparar emblema; rejeitado:', msg)
    return { rejeitada: true, motivo: /pixel/i.test(msg) ? 'pixels' : 'leitura' }
  }
}
