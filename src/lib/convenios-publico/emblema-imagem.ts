import type { Color } from 'sharp'

const MIN_PX = 16
const MARGEM = 0.02 // por lado (4% do maior lado no total), para o emblema não encostar na borda do cartão

/**
 * Apara a margem transparente (ou de cor uniforme) de logotipo/brasão/bandeira e devolve
 * o arquivo com enquadramento justo, no mesmo formato. Qualquer falha ou resultado
 * suspeito devolve o original (aparada=false). Só para os 3 emblemas, não para galeria/foto.
 */
export async function aparar(buffer: Buffer): Promise<{ buffer: Buffer; aparada: boolean }> {
  const original = { buffer, aparada: false }
  try {
    // Sob demanda: sharp é optionalDependency do next; falha ao carregar não pode derrubar o módulo de upload.
    const { default: sharp } = await import('sharp')
    const meta = await sharp(buffer).metadata()
    const { format, width, height } = meta
    if (!width || !height || (format !== 'png' && format !== 'webp' && format !== 'jpeg')) return original
    const comAlfa = Boolean(meta.hasAlpha)

    // Fundo: transparente se houver alfa; senão a cor do canto (é o que o trim usa por padrão).
    let fundo: Color = { r: 0, g: 0, b: 0, alpha: 0 }
    if (!comAlfa) {
      const [r, g, b] = await sharp(buffer).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
      fundo = { r, g, b, alpha: 1 }
    }

    const { data, info } = await sharp(buffer).rotate().trim({ background: fundo, threshold: 10 }).toBuffer({ resolveWithObject: true })
    const { width: w, height: h } = info
    if (w < MIN_PX || h < MIN_PX) return original
    if (w >= width && h >= height) return original // nada a aparar
    // Sem alfa a "margem" é cor de fundo: se comeu mais da metade, não é margem, é conteúdo.
    if (!comAlfa && (w < width / 2 || h < height / 2)) return original

    const m = Math.max(1, Math.round(Math.max(w, h) * MARGEM))
    let img = sharp(data).extend({ top: m, bottom: m, left: m, right: m, background: fundo })
    img = format === 'png' ? img.png() : format === 'webp' ? img.webp({ quality: 90 }) : img.jpeg({ quality: 90 })
    return { buffer: await img.toBuffer(), aparada: true }
  } catch (e) {
    console.error('Falha ao aparar emblema; mantendo original:', e instanceof Error ? e.message : 'erro')
    return original
  }
}
