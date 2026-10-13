// Fonte única das medidas ideais de imagem da landing de convênio (puro TS: importável pelo client).
// Medidas conferidas no site (NuAzul-Site-Geral): ConvenioHero, [landing].astro, ConvenioCard. Valores = 2x da área exibida (retina).
// Limites reais de validação: imagens-actions.ts (2 MB; PNG/JPEG/WebP) e emblema-imagem.ts (5000 × 5000 px).
import type { ImagemTipo } from './snapshot'

export type ImagemSlot =
  | 'destaque'
  | 'publico_destaque'
  | 'logotipo'
  | 'brasao'
  | 'bandeira'
  | 'card'
  | `galeria_${ImagemTipo}`

export type ImagemSpec = {
  rotulo: string
  largura: number
  altura: number
  proporcao: string
  formatos: string
  pesoMaxMb: number
  dica: string
}

const FORMATOS = 'PNG, JPG ou WebP'
const GALERIA = { largura: 1200, altura: 900, proporcao: '4:3', formatos: FORMATOS, pesoMaxMb: 2 }
const SEM_TEXTO = 'sem texto dentro da imagem'

export const IMAGEM_SPECS: Record<ImagemSlot, ImagemSpec> = {
  destaque: {
    rotulo: 'Foto de destaque (topo da página)',
    largura: 1080, altura: 1440, proporcao: '3:4', formatos: FORMATOS, pesoMaxMb: 2,
    dica: `assunto principal centralizado, ${SEM_TEXTO}. Também aparece ao compartilhar o link (WhatsApp, redes sociais)`,
  },
  publico_destaque: {
    rotulo: 'Foto do público em destaque',
    largura: 1200, altura: 800, proporcao: '3:2', formatos: FORMATOS, pesoMaxMb: 2,
    dica: `assunto no centro: o site pode cortar as bordas, ${SEM_TEXTO}`,
  },
  logotipo: {
    rotulo: 'Logotipo',
    largura: 1000, altura: 1000, proporcao: '1:1', formatos: FORMATOS, pesoMaxMb: 2,
    dica: 'fundo transparente (PNG); o sistema apara a margem e ajusta',
  },
  brasao: {
    rotulo: 'Brasão',
    largura: 1000, altura: 1000, proporcao: '1:1', formatos: FORMATOS, pesoMaxMb: 2,
    dica: 'fundo transparente (PNG); o sistema apara a margem e ajusta',
  },
  bandeira: {
    rotulo: 'Bandeira',
    largura: 1000, altura: 700, proporcao: '10:7', formatos: FORMATOS, pesoMaxMb: 2,
    dica: 'bandeira inteira, sem moldura; o sistema apara a margem e ajusta',
  },
  // Upload próprio (imagem_card_url). Sem ela, o card de /solucoes/consignado-* usa logotipo, senão brasão, senão a foto "Prédio" da galeria.
  card: {
    rotulo: 'Imagem do card (página Consignado Estadual/Municipal)',
    largura: 1200, altura: 600, proporcao: '2:1', formatos: FORMATOS, pesoMaxMb: 2,
    dica: `faixa 2:1, o site corta as bordas: assunto no centro, ${SEM_TEXTO}. Sem esta imagem, o card usa logotipo, brasão ou foto do Prédio`,
  },
  galeria_predio: {
    rotulo: 'Galeria: Prédio', ...GALERIA,
    dica: 'assunto no centro, o site corta em 4:3; sem foto de destaque, esta foto vira a do topo e a do card',
  },
  galeria_bandeira: { rotulo: 'Galeria: Bandeira', ...GALERIA, dica: 'assunto no centro, o site corta em 4:3 (a bandeira tem campo próprio)' },
  galeria_cidade: {
    rotulo: 'Galeria: Cidade', ...GALERIA,
    dica: 'assunto no centro, o site corta em 4:3; sem foto de destaque nem Prédio, esta foto vira a do topo',
  },
  galeria_outro: { rotulo: 'Galeria: Outro', ...GALERIA, dica: `assunto no centro, o site corta em 4:3, ${SEM_TEXTO}` },
}

/** "Tamanho ideal: 1080 × 1440 px (3:4) · PNG, JPG ou WebP · até 2 MB" */
export function textoSpec(slot: ImagemSlot): string {
  const s = IMAGEM_SPECS[slot]
  return `Tamanho ideal: ${s.largura} × ${s.altura} px (${s.proporcao}) · ${s.formatos} · até ${s.pesoMaxMb} MB`
}

/** Frase pronta para colar no ChatGPT/Canva. */
export function fraseCopiavel(slot: ImagemSlot): string {
  const s = IMAGEM_SPECS[slot]
  return `Imagem ${s.largura} × ${s.altura} px (proporção ${s.proporcao}), formato ${s.formatos}, até ${s.pesoMaxMb} MB, ${s.dica}`
}
