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
  titulo_destaque: string | null
  subtitulo: string | null
  resumo_publico: string | null
  hero: { headline: string | null; subheadline: string | null; imagem_url: string | null; imagem_alt: string | null }
  vantagens: ItemEvidenciado[]
  faqs: (ItemEvidenciado & { pergunta: string; resposta: string })[]
  publicos: { codigo: string; nome: string }[]
  formas_contratacao: { codigo: string; nome: string }[]
  instituicoes: InstituicaoPublica[]
  cta: { texto: string; tipo_destino: (typeof CTA_TIPOS)[number]; link: string | null } | null
  seo: { meta_title: string | null; meta_description: string | null; keywords: string[] }
}

/** Cada oferta = uma forma operada pela instituição, com os públicos elegíveis JÁ resolvidos (nunca vazio). */
export type OfertaPublica = { forma: string; codigo_forma: string; publicos: string[] }
/** logo_url: URL absoluta https da logo (rota pública de logo ou https real do cadastro) ou null. */
export type InstituicaoPublica = { nome: string; logo_url: string | null; publicos_base: string[]; ofertas: OfertaPublica[]; evidencia: Evidencia }

export type EntradaSnapshot = {
  slug: string
  convenio: { nome: string; esfera: string; uf: string | null }
  versao: number
  publicado_em: string
  /** Linha de convenio_conteudo_site (só os campos da lista de permissão são lidos). */
  conteudo: Record<string, unknown>
  publicos: { nome: string }[]
  formas: { nome: string }[]
  /**
   * publicos: nomes ativos de convenio_instituicao_publicos; null = vínculo sem público no cadastro
   * (= todos os públicos do convênio). ofertas[].publicos_restritos: nomes ativos de publicos_restritos;
   * null = forma sem restrição (= publicos_base).
   */
  instituicoes: {
    /** financial_institutions.id: só aparece dentro da URL da rota de logo. */
    id?: string
    nome: string
    /** financial_institutions.logo_url cru (data URL hoje); resolvido por logoPublico. */
    logo_url?: string | null
    publicos: string[] | null
    ofertas: { forma: string; publicos_restritos: string[] | null }[]
  }[]
  /** Origem absoluta do Workspace para montar a URL da logo; padrão BASE_PUBLICA_PADRAO. */
  base_publica?: string
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
  if (CONTROLE_OU_INVISIVEL_RE.test(v.trim())) return null
  try {
    const u = new URL(v.trim())
    if (u.protocol !== 'https:' || u.username || u.password) return null
    if (u.hostname.startsWith('[') || /^[\d.]+$/.test(u.hostname) || !u.hostname.includes('.')) return null
    return u.toString()
  } catch {
    return null
  }
}

export const BASE_PUBLICA_PADRAO = 'https://workspace.brspromotora.com.br'
export const LOGO_MAX_BYTES = 300 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const ehUuid = (v: string) => UUID_RE.test(v)
const LOGO_DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,([A-Za-z0-9+/]+={0,2})$/
const MIME_LOGO: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', webp: 'image/webp', 'svg+xml': 'image/svg+xml' }

/** Data URL de logo aceita (tipo de imagem permitido, base64 válido, ≤ 300 KB decodificado) ou null. */
export function logoDataUrl(v: unknown): { mime: string; base64: string } | null {
  if (typeof v !== 'string') return null
  const m = LOGO_DATA_URL_RE.exec(v)
  if (!m || m[2].length % 4 !== 0) return null
  const bytes = (m[2].length / 4) * 3 - (m[2].endsWith('==') ? 2 : m[2].endsWith('=') ? 1 : 0)
  if (bytes > LOGO_MAX_BYTES) return null
  return { mime: MIME_LOGO[m[1]], base64: m[2] }
}

/** URL pública da logo: data URL válida → rota de logo (absoluta); https real → ela mesma; resto → null. */
export function logoPublico(id: string, logoUrlBanco: unknown, base: string = BASE_PUBLICA_PADRAO, wide = false): string | null {
  if (logoDataUrl(logoUrlBanco)) {
    if (!ehUuid(id)) return null
    return `${base.replace(/\/+$/, '')}/api/convenios/publico/v1/instituicoes/${id.toLowerCase()}/logo${wide ? '?v=wide' : ''}`
  }
  return urlHttps(logoUrlBanco)
}

const DIAS = ['Segunda-Feira', 'Terça-Feira', 'Quarta-Feira', 'Quinta-Feira', 'Sexta-Feira', 'Sábado', 'Domingo']
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** Horário do SAC em texto ("Segunda-Feira a Sexta-Feira, 08:00–20:00; Sábado, 09:00–14:00"). Linha ativa incompleta = dado incerto → null. */
export function horarioPublico(linhas: unknown): string | null {
  if (!Array.isArray(linhas)) return null
  const porDia = new Map<number, string>()
  for (const l of linhas) {
    if (!l || typeof l !== 'object' || !(l as Record<string, unknown>).enabled) continue
    const { dia_da_semana, hora_inicial, hora_final } = l as Record<string, unknown>
    const d = DIAS.indexOf(String(dia_da_semana))
    if (d < 0 || !HORA_RE.test(String(hora_inicial)) || !HORA_RE.test(String(hora_final)) || porDia.has(d)) return null
    porDia.set(d, `${hora_inicial}–${hora_final}`)
  }
  if (!porDia.size) return null
  const faixas: { de: number; ate: number; h: string }[] = []
  for (let d = 0; d < 7; d++) {
    const h = porDia.get(d)
    if (!h) continue
    const ult = faixas[faixas.length - 1]
    if (ult && ult.ate === d - 1 && ult.h === h) ult.ate = d
    else faixas.push({ de: d, ate: d, h })
  }
  if (faixas.length === 1 && faixas[0].de === 0 && faixas[0].ate === 6) return `Todos os dias, ${faixas[0].h}`
  return faixas.map((f) => `${f.de === f.ate ? DIAS[f.de] : `${DIAS[f.de]} a ${DIAS[f.ate]}`}, ${f.h}`).join('; ')
}

/**
 * Campos opcionais da lista pública de instituições (cadastro da IF):
 * site = general_data.site_institucional (https; "www.x" ganha https://);
 * sac/horario = sac_ouvidoria.sac, só com "Exibir no card do site" (card_enabled). Ausente = chave omitida.
 */
export function extrasInstituicaoPublica(siteBanco: unknown, sacBanco: unknown): { site?: string; sac?: string; horario?: string } {
  const out: { site?: string; sac?: string; horario?: string } = {}
  const bruto = typeof siteBanco === 'string' ? siteBanco.trim() : ''
  const site = urlHttps(/^www\./i.test(bruto) ? `https://${bruto}` : bruto)
  if (site) out.site = site
  const sac = sacBanco && typeof sacBanco === 'object' ? (sacBanco as Record<string, unknown>) : null
  if (sac?.card_enabled === true) {
    const tel = String(sac.telefone ?? '').replace(/\D/g, '')
    if (tel.length >= 8 && tel.length <= 13) out.sac = tel
    const horario = horarioPublico(sac.atendimento)
    if (horario) out.horario = horario
  }
  return out
}

/** Controles, espaços e invisíveis Unicode comuns: somem na comparação de esquema e tornam uma URL inválida. */
const CONTROLE_OU_INVISIVEL_RE = /[\u0000- \u007f-\u009f\s\u00a0\u200b\u200c\u200d\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2060\u2028\u2029\ufeff]/
const CONTROLE_OU_INVISIVEL_G = new RegExp(CONTROLE_OU_INVISIVEL_RE.source, 'g')
const ESQUEMA_PROIBIDO_RE = /^(javascript|data|vbscript|file|blob|about):/

/** Forma comparável: sem controles/espaços/invisíveis, minúsculas. "java\tscript:" vira "javascript:". */
function normalizado(s: string): string {
  return s.replace(CONTROLE_OU_INVISIVEL_G, '').toLowerCase()
}

/** Esquema perigoso em `fonte` (ignora controles, espaços e maiúsculas): o item é descartado. */
export function esquemaProibido(s: string): boolean {
  return ESQUEMA_PROIBIDO_RE.test(normalizado(s))
}

/** `fonte` só é URL se começar com http(s):// ou www.; o resto (ex.: "Resolução: ...") é texto. */
function pareceUrl(v: string): boolean {
  const n = normalizado(v)
  return /^https?:\/\//.test(n) || /^www\./.test(n)
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
  if (typeof item.fonte === 'string' && esquemaProibido(item.fonte)) return null
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
    const publicosConvenio = limite(unicos(nomes(e.publicos)), 50, 'Públicos')

    // Semântica do cadastro resolvida aqui (o consumidor nunca deduz "todos"):
    // vínculo sem público = públicos do convênio; forma sem restrição = publicos_base.
    // Oferta que fica sem público sai; instituição sem oferta sai.
    const instituicoes: InstituicaoPublica[] = []
    for (const i of e.instituicoes) {
      const nomeIf = texto(i.nome, 200, 'Nome da instituição')
      if (!nomeIf) continue
      const base = i.publicos === null ? publicosConvenio : unicos(nomes(i.publicos.map((n) => ({ nome: n }))))
      const ofertas: OfertaPublica[] = []
      for (const o of i.ofertas) {
        const forma = texto(o.forma, 200, 'Nome da forma')
        if (!forma) continue
        const publicos =
          o.publicos_restritos === null ? base : unicos(nomes(o.publicos_restritos.map((n) => ({ nome: n })))).filter((p) => base.includes(p))
        if (publicos.length) ofertas.push({ forma, codigo_forma: codigoDoNome(forma), publicos })
      }
      if (ofertas.length) {
        instituicoes.push({
          nome: nomeIf,
          logo_url: logoPublico(i.id ?? '', i.logo_url, e.base_publica),
          publicos_base: base,
          ofertas: limite(ofertas, 30, `Formas de ${nomeIf}`),
          evidencia: { fonte: null, consultado_em: null, situacao: 'confirmado', natureza: null },
        })
      }
    }

    const snapshot: ConvenioPublicoV1 = {
      contrato: 'v1',
      slug: e.slug,
      convenio: { nome, esfera: e.convenio.esfera as ConvenioPublicoV1['convenio']['esfera'], uf },
      versao: e.versao,
      publicado_em: e.publicado_em,
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
      publicos: publicosConvenio.map((n) => ({ codigo: codigoDoNome(n), nome: n })),
      formas_contratacao: limite(unicos(nomes(e.formas)), 30, 'Formas de contratação').map((n) => ({ codigo: codigoDoNome(n), nome: n })),
      instituicoes: limite(instituicoes, 30, 'Instituições'),
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
