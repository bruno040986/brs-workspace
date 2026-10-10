// Snapshot público do convênio (contrato v1: docs/projetos/CONTRATO-CONVENIOS-PUBLICO-V1.md).
// Módulo puro (sem alias/IO) para rodar no node:test. Montado por lista de permissão:
// nada é copiado com spread, então campo interno não vaza.

export const SLUG_PUBLICO_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

export const ESFERAS = ['municipal', 'estadual', 'federal', 'inss', 'outro'] as const
export const CTA_TIPOS = ['whatsapp', 'simulador', 'formulario', 'url_customizada', 'link_externo'] as const
const CTA_EXIGE_LINK = new Set(['url_customizada', 'link_externo'])
export const SNAPSHOT_MAX_BYTES = 256 * 1024

export type Situacao = 'confirmado' | 'pendente'
export type Natureza = 'norma_oficial' | 'regra_bancaria'
export type Evidencia = { fonte: string | null; consultado_em: string | null; situacao: Situacao; natureza: Natureza | null }
export type ItemEvidenciado = { titulo: string; texto: string } & Evidencia

export type ConvenioPublicoV1 = {
  contrato: 'v1'
  slug: string
  convenio: { nome: string; esfera: (typeof ESFERAS)[number]; uf: string | null }
  versao: number
  publicado_em: string
  aprovado_por: string
  titulo_destaque: string | null
  subtitulo: string | null
  resumo_publico: string | null
  hero: { headline: string | null; subheadline: string | null; imagem_url: string | null; imagem_alt: string | null }
  vantagens: ItemEvidenciado[]
  faqs: (ItemEvidenciado & { pergunta: string; resposta: string })[]
  publicos: { codigo: string; nome: string }[]
  formas_contratacao: { codigo: string; nome: string }[]
  instituicoes: { nome: string; produtos: string[]; publicos: string[]; formas: string[]; evidencia: Evidencia }[]
  cta: { texto: string; tipo_destino: (typeof CTA_TIPOS)[number]; link: string | null } | null
  seo: { meta_title: string | null; meta_description: string | null; keywords: string[] }
}

export type EntradaSnapshot = {
  slug: string
  convenio: { nome: string; esfera: string; uf: string | null }
  versao: number
  publicado_em: string
  aprovado_por: string
  /** Linha de convenio_conteudo_site (só os campos da lista de permissão são lidos). */
  conteudo: Record<string, unknown>
  publicos: { nome: string }[]
  formas: { nome: string }[]
  instituicoes: { nome: string; publicos: string[]; formas: { nome: string; origem_margem?: string | null }[] }[]
}

export type ResultadoSnapshot = { ok: true; snapshot: ConvenioPublicoV1 } | { ok: false; erro: string }

class ErroSnapshot extends Error {}

/** Texto puro: remove tags, trim; '' vira null. Acima do limite falha (nada é truncado em silêncio). */
function texto(v: unknown, max: number, campo: string): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/<[^>]*>/g, '').trim()
  if (!t) return null
  if (t.length > max) throw new ErroSnapshot(`${campo} passa de ${max} caracteres.`)
  return t
}

/** Só https:// com hostname de domínio (sem IP) e sem usuário/senha; qualquer outra coisa vira null. */
export function urlHttps(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  try {
    const u = new URL(v.trim())
    if (u.protocol !== 'https:' || u.username || u.password) return null
    if (u.hostname.startsWith('[') || /^[\d.]+$/.test(u.hostname) || !u.hostname.includes('.')) return null
    return u.toString()
  } catch {
    return null
  }
}

/** `fonte` só é URL se começar com http(s):// ou www.; o resto (ex.: "Resolução: ...") é texto. */
function pareceUrl(v: string): boolean {
  return /^https?:\/\//i.test(v) || /^www\./i.test(v)
}

/** Código público derivado do nome: minúsculas, sem acento, '-' como separador. */
export function codigoDoNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Evidência de vantagens/faqs; null = item fora do snapshot (pendente, ausente ou fonte-URL inválida). */
function evidencia(item: Record<string, unknown>): Evidencia | null {
  if (item.situacao !== 'confirmado') return null
  let fonte = texto(item.fonte, 2048, 'Fonte')
  if (fonte && pareceUrl(fonte)) {
    fonte = urlHttps(fonte)
    if (!fonte) return null
  }
  const consultado = typeof item.consultado_em === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.consultado_em) ? item.consultado_em : null
  const natureza = item.natureza === 'norma_oficial' || item.natureza === 'regra_bancaria' ? item.natureza : null
  return { fonte, consultado_em: consultado, situacao: 'confirmado', natureza }
}

function limite<T>(lista: T[], max: number, campo: string): T[] {
  if (lista.length > max) throw new ErroSnapshot(`${campo}: máximo de ${max} itens.`)
  return lista
}

const unicos = (l: string[]) => Array.from(new Set(l))

const PRODUTO_POR_ORIGEM: Record<string, string> = {
  novo: 'Empréstimo consignado',
  cartao_rmc: 'Cartão consignado',
  cartao_rcc: 'Cartão benefício',
}

const VARIAVEL_RE = /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/

export function montarSnapshotPublico(e: EntradaSnapshot): ResultadoSnapshot {
  try {
    if (!SLUG_PUBLICO_RE.test(e.slug)) throw new ErroSnapshot('Slug público inválido.')
    const c = e.conteudo
    const vis = (c.secoes_visibilidade && typeof c.secoes_visibilidade === 'object' ? c.secoes_visibilidade : {}) as Record<string, unknown>
    const visivel = (s: string) => vis[s] !== false

    const nome = texto(e.convenio.nome, 200, 'Nome do convênio')
    if (!nome) throw new ErroSnapshot('Convênio sem nome.')
    if (!(ESFERAS as readonly string[]).includes(e.convenio.esfera)) throw new ErroSnapshot('Esfera do convênio inválida.')
    const uf = typeof e.convenio.uf === 'string' && /^[A-Z]{2}$/.test(e.convenio.uf) ? e.convenio.uf : null
    const aprovadoPor = texto(e.aprovado_por, 200, 'Aprovado por')
    if (!aprovadoPor) throw new ErroSnapshot('Responsável pela publicação sem nome.')

    const vantagens: ItemEvidenciado[] = []
    if (visivel('vantagens')) {
      for (const bruto of Array.isArray(c.vantagens) ? c.vantagens : []) {
        if (!bruto || typeof bruto !== 'object') continue
        const v = bruto as Record<string, unknown>
        const ev = evidencia(v)
        const titulo = texto(v.titulo, 120, 'Título da vantagem')
        const corpo = texto(v.descricao ?? v.texto, 600, 'Texto da vantagem')
        if (ev && titulo && corpo) vantagens.push({ titulo, texto: corpo, ...ev })
      }
    }

    const faqs: ConvenioPublicoV1['faqs'] = []
    if (visivel('faq')) {
      for (const bruto of Array.isArray(c.faqs) ? c.faqs : []) {
        if (!bruto || typeof bruto !== 'object') continue
        const f = bruto as Record<string, unknown>
        const ev = evidencia(f)
        const pergunta = texto(f.pergunta, 300, 'Pergunta do FAQ')
        const resposta = texto(f.resposta, 2000, 'Resposta do FAQ')
        if (ev && pergunta && resposta) faqs.push({ pergunta, resposta, titulo: pergunta, texto: resposta, ...ev })
      }
    }

    let cta: ConvenioPublicoV1['cta'] = null
    if (visivel('cta')) {
      const tipo = String(c.cta_tipo_destino ?? '')
      if (!(CTA_TIPOS as readonly string[]).includes(tipo)) throw new ErroSnapshot('Tipo de destino do CTA inválido.')
      const ctaTexto = texto(c.cta_texto_botao, 60, 'Texto do botão CTA')
      if (!ctaTexto) throw new ErroSnapshot('Texto do botão CTA é obrigatório.')
      const link = urlHttps(c.cta_link_destino)
      if (CTA_EXIGE_LINK.has(tipo) && !link) throw new ErroSnapshot('O destino do CTA exige um link https:// válido.')
      cta = { texto: ctaTexto, tipo_destino: tipo as (typeof CTA_TIPOS)[number], link }
    }

    const hero = visivel('hero')
    const resumo = visivel('resumo')
    const seo = visivel('seo')
    const nomes = (l: { nome: string }[]) => l.map((x) => texto(x.nome, 200, 'Nome do cadastro')).filter((x): x is string => !!x)

    const snapshot: ConvenioPublicoV1 = {
      contrato: 'v1',
      slug: e.slug,
      convenio: { nome, esfera: e.convenio.esfera as ConvenioPublicoV1['convenio']['esfera'], uf },
      versao: e.versao,
      publicado_em: e.publicado_em,
      aprovado_por: aprovadoPor,
      titulo_destaque: resumo ? texto(c.titulo_destaque, 200, 'Título destaque') : null,
      subtitulo: resumo ? texto(c.subtitulo, 300, 'Subtítulo') : null,
      resumo_publico: resumo ? texto(c.resumo_publico, 2000, 'Resumo público') : null,
      hero: {
        headline: hero ? texto(c.hero_headline, 200, 'Headline do hero') : null,
        subheadline: hero ? texto(c.hero_subheadline, 300, 'Sub-headline do hero') : null,
        imagem_url: hero ? urlHttps(c.imagem_destaque_url) : null,
        imagem_alt: hero ? texto(c.imagem_destaque_alt, 200, 'Texto alternativo da imagem') : null,
      },
      vantagens: limite(vantagens, 12, 'Vantagens'),
      faqs: limite(faqs, 20, 'FAQs'),
      // Cadastro conta como confirmado pelo ato de publicar (decisão Bruno 10/10). Lista vazia = nenhum, nunca "todos".
      publicos: limite(unicos(nomes(e.publicos)), 50, 'Públicos').map((n) => ({ codigo: codigoDoNome(n), nome: n })),
      formas_contratacao: limite(unicos(nomes(e.formas)), 30, 'Formas de contratação').map((n) => ({ codigo: codigoDoNome(n), nome: n })),
      instituicoes: limite(
        e.instituicoes
          .map((i) => ({ nomeIf: texto(i.nome, 200, 'Nome da instituição'), i }))
          .filter((x): x is { nomeIf: string; i: EntradaSnapshot['instituicoes'][number] } => !!x.nomeIf)
          .map(({ nomeIf, i }) => ({
            nome: nomeIf,
            produtos: unicos(i.formas.map((f) => PRODUTO_POR_ORIGEM[f.origem_margem ?? '']).filter(Boolean)),
            publicos: unicos(nomes(i.publicos.map((n) => ({ nome: n })))),
            formas: unicos(nomes(i.formas)),
            evidencia: { fonte: null, consultado_em: null, situacao: 'confirmado' as const, natureza: null },
          })),
        30,
        'Instituições',
      ),
      cta,
      seo: {
        meta_title: seo ? texto(c.meta_title, 70, 'Meta title') : null,
        meta_description: seo ? texto(c.meta_description, 170, 'Meta description') : null,
        keywords: seo
          ? limite(
              unicos(
                String(c.keywords ?? '')
                  .split(',')
                  .map((k) => texto(k, 60, 'Palavra-chave'))
                  .filter((k): k is string => !!k),
              ),
              20,
              'Palavras-chave',
            )
          : [],
      },
    }

    const json = JSON.stringify(snapshot)
    // O snapshot é por convênio, não por parceiro: placeholder apareceria literal no site.
    const variavel = json.match(VARIAVEL_RE)
    if (variavel) throw new ErroSnapshot(`Remova a variável ${variavel[0]} dos textos publicados (o conteúdo público não é personalizado por parceiro).`)
    if (new TextEncoder().encode(json).length > SNAPSHOT_MAX_BYTES) throw new ErroSnapshot('Conteúdo público passa de 256 KB.')
    return { ok: true, snapshot }
  } catch (err) {
    if (err instanceof ErroSnapshot) return { ok: false, erro: err.message }
    throw err
  }
}
