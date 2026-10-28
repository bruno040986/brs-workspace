/**
 * Biblioteca padrão de templates do sistema (crm_templates_mensagem.sistema = true).
 * Funções puras: chave kebab, versionamento, variáveis e mídia. As server actions
 * ficam em app/(dashboard)/alvoconsig/templates/actions.ts.
 * Variáveis = espelho de VARIAVEIS_TEMPLATE do CRM (brs-alvoconsig/.../crm/disparo.ts).
 */

export const VARIAVEIS_BIBLIOTECA = {
  nome: 'Maria da Silva Souza',
  primeiro_nome: 'Maria',
  atendente: 'Carlos',
  parceiro: 'Alvo Consig',
  convenio: 'INSS',
  margem_novo: 'R$ 350,00',
  margem_rmc: 'R$ 120,00',
  margem_rcc: 'R$ 90,00',
  troco_refin: 'R$ 2.500,00',
  cidade: 'Goiânia',
} as const

export const LIMITES = { nome: 80, categoria: 60, corpo: 4000 } as const

/** "Olá, Maria!" -> "ola-maria". Vazio vira "template". */
export function gerarChave(nome: string): string {
  const base = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return base || 'template'
}

/** Tira o sufixo -vN: "boas-vindas-v3" -> "boas-vindas". */
export function chaveBase(chave: string): string {
  return chave.replace(/-v\d+$/, '')
}

/** Primeira chave livre entre `base`, `base-v2`, `base-v3`... (`usadas` inclui arquivadas). */
export function proximaChave(base: string, usadas: Iterable<string>): string {
  const set = new Set(usadas)
  if (!set.has(base)) return base
  for (let n = 2; ; n++) if (!set.has(`${base}-v${n}`)) return `${base}-v${n}`
}

/** Chave da nova versão de um template: base sem sufixo + próximo -vN livre. */
export function chaveNovaVersao(chaveAtual: string, usadas: Iterable<string>): string {
  const base = chaveBase(chaveAtual)
  const set = new Set(usadas)
  for (let n = 2; ; n++) if (!set.has(`${base}-v${n}`)) return `${base}-v${n}`
}

/** Variáveis {{x}} encontradas, separando conhecidas e desconhecidas. */
export function analisarVariaveis(corpo: string): { usadas: string[]; desconhecidas: string[] } {
  const usadas = new Set<string>()
  const desconhecidas = new Set<string>()
  for (const m of corpo.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) {
    if (m[1] in VARIAVEIS_BIBLIOTECA) usadas.add(m[1])
    else desconhecidas.add(m[1])
  }
  return { usadas: [...usadas], desconhecidas: [...desconhecidas] }
}

/** Prévia: troca variáveis conhecidas por exemplo; desconhecidas ficam cruas (para o master ver). */
export function previaCorpo(corpo: string): string {
  return corpo.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (todo, k: string) =>
    k in VARIAVEIS_BIBLIOTECA ? VARIAVEIS_BIBLIOTECA[k as keyof typeof VARIAVEIS_BIBLIOTECA] : todo,
  )
}

export type DadosTemplate = { nome: string; categoria: string | null; corpo: string }

/** Normaliza e valida. Variável desconhecida BLOQUEIA o salvar (o disparo apagaria o texto). */
export function validarTemplate(
  input: { nome?: string; categoria?: string | null; corpo?: string },
): { ok: true; dados: DadosTemplate; variaveis: string[] } | { ok: false; error: string } {
  const nome = String(input.nome ?? '').trim()
  const categoria = String(input.categoria ?? '').trim() || null
  const corpo = String(input.corpo ?? '').trim()
  if (!nome) return { ok: false, error: 'Dê um nome ao template.' }
  if (nome.length > LIMITES.nome) return { ok: false, error: `Nome acima de ${LIMITES.nome} caracteres.` }
  if (categoria && categoria.length > LIMITES.categoria) return { ok: false, error: `Categoria acima de ${LIMITES.categoria} caracteres.` }
  if (!corpo) return { ok: false, error: 'Escreva a mensagem.' }
  if (corpo.length > LIMITES.corpo) return { ok: false, error: `Mensagem acima de ${LIMITES.corpo} caracteres.` }
  const { usadas, desconhecidas } = analisarVariaveis(corpo)
  if (desconhecidas.length) {
    return { ok: false, error: `Variável desconhecida: ${desconhecidas.map((v) => `{{${v}}}`).join(', ')}.` }
  }
  return { ok: true, dados: { nome, categoria, corpo }, variaveis: usadas }
}

export const MIDIAS = {
  png: { mime: 'image/png', tipo: 'imagem' },
  jpg: { mime: 'image/jpeg', tipo: 'imagem' },
  webp: { mime: 'image/webp', tipo: 'imagem' },
  ogg: { mime: 'audio/ogg', tipo: 'audio' },
  mp3: { mime: 'audio/mpeg', tipo: 'audio' },
  m4a: { mime: 'audio/mp4', tipo: 'audio' },
} as const
export type FormatoMidia = keyof typeof MIDIAS
const LIMITE_MIDIA = { imagem: 5 * 1024 * 1024, audio: 16 * 1024 * 1024 }

/** Tipo pelos BYTES (mesma regra do CRM), nunca pela extensão. */
export function detectarMidia(b: Uint8Array): FormatoMidia | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp'
  if (b.length >= 4 && b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'ogg'
  if (b.length >= 3 && ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0))) return 'mp3'
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'm4a'
  return null
}

export function validarMidia(cabecalho: Uint8Array, tamanho: number): { ok: true; formato: FormatoMidia } | { ok: false; error: string } {
  const formato = detectarMidia(cabecalho)
  if (!formato) return { ok: false, error: 'Formato não aceito. Imagem: PNG/JPG/WebP. Áudio: OGG (opus), MP3 ou M4A.' }
  const tipo = MIDIAS[formato].tipo
  if (tamanho > LIMITE_MIDIA[tipo]) return { ok: false, error: `Arquivo acima do limite (${tipo === 'imagem' ? '5' : '16'}MB).` }
  return { ok: true, formato }
}
