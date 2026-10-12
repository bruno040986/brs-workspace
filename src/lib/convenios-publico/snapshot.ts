// Snapshot público do convênio (contrato v1: docs/projetos/CONTRATO-CONVENIOS-PUBLICO-V1.md).
// Módulo puro (sem alias/IO) para rodar no node:test. Montado por lista de permissão:
// nada é copiado com spread, então campo interno não vaza.

export const SLUG_PUBLICO_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

export const ESFERAS = ['municipal', 'estadual', 'federal', 'inss', 'outro'] as const
export const CTA_TIPOS = ['whatsapp', 'simulador', 'formulario', 'url_customizada', 'link_externo'] as const
const CTA_EXIGE_LINK = new Set(['url_customizada', 'link_externo'])
export const SNAPSHOT_MAX_BYTES = 256 * 1024
/** Máximo de perguntas publicadas: Base de Conhecimento (não ocultas) + só da landing. */
export const FAQ_MAX = 20
export const IMAGEM_TIPOS = ['predio', 'bandeira', 'cidade', 'outro'] as const
export type ImagemTipo = (typeof IMAGEM_TIPOS)[number]
export type ImagemPublica = { url: string; legenda: string | null; tipo: ImagemTipo }
export const PUBLICOS_DESTAQUE_MAX = 8
/** Card de público em destaque: `publico` = nome do público ativo do convênio (o id nunca sai). */
export type PublicoDestaquePublico = { publico: string; titulo: string; texto: string; imagem_url: string | null }

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
  /** Aditivo (T-21): logotipo e brasão 1:1 do convênio (URL https do bucket público) ou null. */
  logotipo_url: string | null
  brasao_url: string | null
  /** Aditivo (T-21): bandeira do convênio (proporção livre, recomendado 3:2) ou null. */
  bandeira_url: string | null
  /** Aditivo (T-21): galeria do convênio, máx. 12, só https válidas, na ordem do cadastro. */
  imagens: ImagemPublica[]
  vantagens: ItemEvidenciado[]
  faqs: (ItemEvidenciado & { pergunta: string; resposta: string })[]
  /** Aditivo: cards de públicos em destaque (máx. 8, ordem da landing); seção `publicos` oculta = []. */
  publicos_destaque: PublicoDestaquePublico[]
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
  /** Públicos ativos do convênio; `id` (publicos_atendidos.id) só resolve conteudo.publicos_destaque[].publico_id → nome. */
  publicos: { id?: string; nome: string }[]
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
  /** convenios.logotipo_url / brasao_url / bandeira_url (URL pública do bucket); inválida vira null. */
  logotipo_url?: unknown
  brasao_url?: unknown
  bandeira_url?: unknown
  /** convenio_imagens já em ordem; url inválida sai, tipo desconhecido vira 'outro'. */
  imagens?: { url: unknown; legenda: unknown; tipo: unknown }[]
  /** Origem absoluta do Workspace para montar a URL da logo; padrão BASE_PUBLICA_PADRAO. */
  base_publica?: string
  /**
   * FAQ ativo da Base de Conhecimento do convênio (faq_itens), já na ordem da base.
   * Os ids em conteudo.faq_ocultas saem; o id nunca vai para o snapshot.
   */
  faqs_base?: { id: string; pergunta: unknown; resposta: unknown }[]
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
      // 1º a Base de Conhecimento (menos as ocultadas nesta versão), depois as perguntas só da landing.
      const ocultas = new Set(Array.isArray(c.faq_ocultas) ? c.faq_ocultas.map(String) : [])
      for (const b of e.faqs_base ?? []) {
        if (ocultas.has(b.id)) continue
        const pergunta = texto(b.pergunta, 300, 'Pergunta do FAQ (Base de Conhecimento)')
        const resposta = texto(b.resposta, 2000, 'Resposta do FAQ (Base de Conhecimento)')
        // faq_itens não tem campos de evidência: conta como confirmado pelo ato de publicar (como o cadastro).
        if (pergunta && resposta) {
          faqs.push({ pergunta, resposta, titulo: pergunta, texto: resposta, fonte: null, consultado_em: null, situacao: 'confirmado', natureza: null })
        }
      }
      const daBase = faqs.length
      for (const bruto of Array.isArray(c.faqs) ? c.faqs : []) {
        if (!bruto || typeof bruto !== 'object') continue
        const f = bruto as Record<string, unknown>
        const ev = evidencia(f)
        const pergunta = texto(f.pergunta, 300, 'Pergunta do FAQ')
        const resposta = texto(f.resposta, 2000, 'Resposta do FAQ')
        if (ev && pergunta && resposta) faqs.push({ pergunta, resposta, titulo: pergunta, texto: resposta, ...ev })
      }
      if (faqs.length > FAQ_MAX) {
        throw new ErroSnapshot(
          `FAQ: ${daBase} da Base de Conhecimento + ${faqs.length - daBase} só da landing = ${faqs.length}; o máximo publicado é ${FAQ_MAX}. ` +
            'Oculte perguntas da base ou remova perguntas da landing.',
        )
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

    // publico_id → nome só entre os públicos ativos do convênio: desvinculado/inativo/repetido sai; sem título sai.
    const publicosDestaque: PublicoDestaquePublico[] = []
    if (visivel('publicos')) {
      const nomePorId = new Map(e.publicos.filter((p) => typeof p.id === 'string').map((p) => [p.id!.toLowerCase(), p.nome]))
      const vistos = new Set<string>()
      for (const bruto of Array.isArray(c.publicos_destaque) ? c.publicos_destaque : []) {
        if (!bruto || typeof bruto !== 'object') continue
        const p = bruto as Record<string, unknown>
        const id = typeof p.publico_id === 'string' ? p.publico_id.toLowerCase() : ''
        const publico = texto(nomePorId.get(id), 200, 'Nome do público')
        const titulo = texto(p.titulo, 60, 'Título do público em destaque')
        if (!publico || !titulo || vistos.has(id)) continue
        vistos.add(id)
        publicosDestaque.push({ publico, titulo, texto: texto(p.texto, 300, 'Texto do público em destaque') ?? '', imagem_url: urlHttps(p.imagem_url) })
      }
    }

    const imagens: ImagemPublica[] = []
    for (const i of e.imagens ?? []) {
      const url = urlHttps(i.url)
      if (!url) continue
      const tipo = (IMAGEM_TIPOS as readonly string[]).includes(String(i.tipo)) ? (i.tipo as ImagemTipo) : 'outro'
      imagens.push({ url, legenda: texto(i.legenda, 120, 'Legenda da imagem'), tipo })
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
      logotipo_url: urlHttps(e.logotipo_url),
      brasao_url: urlHttps(e.brasao_url),
      bandeira_url: urlHttps(e.bandeira_url),
      imagens: limite(imagens, 12, 'Imagens'),
      vantagens: limite(vantagens, 12, 'Vantagens'),
      faqs,
      publicos_destaque: limite(publicosDestaque, PUBLICOS_DESTAQUE_MAX, 'Públicos em destaque'),
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
