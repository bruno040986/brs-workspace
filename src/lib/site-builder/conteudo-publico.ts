/* eslint-disable @typescript-eslint/no-explicit-any */
// =============================================================================
// Serviço, DTO e Validações de Runtime do Conteúdo Central (T02 - E4/E5 / R2-4)
// Repositório: brs-workspace
// =============================================================================

export const SERVER_WHITELIST_VARIAVEIS = [
  'nome_parceiro',
  'whatsapp',
  'email',
  'cidade',
  'uf',
  'cnpj_cpf',
  'slogan',
  'razao_social',
  'endereco_completo',
] as const

export type VariavelPermitida = (typeof SERVER_WHITELIST_VARIAVEIS)[number]

export const SECOES_VALIDAS = ['hero', 'resumo', 'vantagens', 'faq', 'cta', 'seo'] as const
export type SecaoKey = (typeof SECOES_VALIDAS)[number]

export const CTA_DESTINOS_VALIDOS = ['whatsapp', 'simulador', 'formulario', 'url_customizada', 'link_externo'] as const
export type CtaTipoDestino = (typeof CTA_DESTINOS_VALIDOS)[number]

/** Evidência do item (contrato público v1). Sem situacao ou 'pendente' = fora do conteúdo público. */
export type EvidenciaItem = {
  fonte?: string | null
  consultado_em?: string | null
  situacao?: 'confirmado' | 'pendente' | null
  natureza?: 'norma_oficial' | 'regra_bancaria' | null
}

export type VantagemItem = EvidenciaItem & {
  titulo: string
  descricao: string
  icone?: string
}

export type FaqItem = EvidenciaItem & {
  pergunta: string
  resposta: string
  categoria?: string
}

function erroEvidencia(item: any, rotulo: string): string | null {
  if (item.situacao != null && item.situacao !== 'confirmado' && item.situacao !== 'pendente') return `${rotulo}: situação inválida.`
  if (item.natureza != null && item.natureza !== 'norma_oficial' && item.natureza !== 'regra_bancaria') return `${rotulo}: natureza inválida.`
  if (item.fonte != null && typeof item.fonte !== 'string') return `${rotulo}: fonte deve ser texto.`
  if (item.consultado_em != null && (typeof item.consultado_em !== 'string' || !/^(\d{4}-\d{2}-\d{2})?$/.test(item.consultado_em))) {
    return `${rotulo}: data de consulta inválida.`
  }
  return null
}

export type SecoesVisibilidadeMap = {
  hero: boolean
  resumo: boolean
  vantagens: boolean
  faq: boolean
  cta: boolean
  seo: boolean
  [key: string]: boolean
}

export type ConteudoPublicoDTO = {
  convenioId: string
  versao: number
  isPublicado: boolean
  publishedAt: string | null
  tituloDestaque: string
  subtitulo: string
  resumoPublico: string
  heroHeadline: string | null
  heroSubheadline: string | null
  vantagens: VantagemItem[]
  faqs: FaqItem[]
  secoesOrdem: SecaoKey[]
  secoesVisibilidade: SecoesVisibilidadeMap
  metaTitle: string | null
  metaDescription: string | null
  keywords: string | null
  ctaTextoBotao: string
  ctaTipoDestino: CtaTipoDestino
  ctaLinkDestino: string | null
  imagemDestaqueUrl: string | null
  imagemDestaqueAlt: string | null
}

export type ContextoParceiro = {
  nome_parceiro?: string
  whatsapp?: string
  email?: string
  cidade?: string
  uf?: string
  cnpj_cpf?: string
  slogan?: string
  razao_social?: string
  endereco_completo?: string
  [key: string]: string | undefined
}

/**
 * Valida o formato e esquema de URLs para botões CTA e mídias em runtime (R2-4)
 */
export function validarUrlDestino(url: string | null | undefined): boolean {
  if (!url || url.trim() === '') return true
  const u = url.trim()

  // Âncoras locais ou caminhos relativos
  if (u.startsWith('#') || u.startsWith('/')) return true

  // Esquema mailto / tel / WhatsApp direct
  if (u.startsWith('tel:') || u.startsWith('mailto:') || u.startsWith('https://wa.me/')) return true

  // Protocolo HTTP/HTTPS com validação estrita via construtor URL do navegador/Node
  if (u.startsWith('https://') || u.startsWith('http://')) {
    try {
      const parsed = new URL(u)
      return Boolean(parsed.hostname && parsed.hostname.length > 0 && parsed.hostname.includes('.'))
    } catch {
      return false
    }
  }

  return false
}

/**
 * Extrai todas as variáveis no formato {{nome_variavel}} encontradas em uma string.
 */
export function extrairVariaveisDoTexto(texto: string | null | undefined): string[] {
  if (!texto) return []
  const matches = texto.match(/\{\{([a-zA-Z0-9_]+)\}\}/g)
  if (!matches) return []
  return Array.from(new Set(matches.map((m) => m.replace(/[\{\}]/g, '').trim())))
}

/**
 * Valida se todas as variáveis no texto pertencem à whitelist fixa do servidor (E4).
 */
export function validarVariaveisNoTexto(
  texto: string | null | undefined,
  whitelist: string[] = [...SERVER_WHITELIST_VARIAVEIS],
): { valido: boolean; invalidas: string[] } {
  const encontradas = extrairVariaveisDoTexto(texto)
  const invalidas = encontradas.filter((v) => !whitelist.includes(v))
  return {
    valido: invalidas.length === 0,
    invalidas,
  }
}

/**
 * Valida o formato e esquema de URLs para mídias e imagens em runtime (R3-3)
 * Rejeita esquemas de ação/navegação (mailto:, tel:, #, javascript:) e exige HTTP(S) válido ou caminho relativo.
 */
export function validarUrlMedia(url: string | null | undefined): boolean {
  if (!url || url.trim() === '') return true
  const u = url.trim()

  if (u.startsWith('#') || u.startsWith('mailto:') || u.startsWith('tel:') || u.startsWith('javascript:')) {
    return false
  }

  if (u.startsWith('/') && !u.startsWith('//')) {
    return true
  }

  if (u.startsWith('https://') || u.startsWith('http://')) {
    try {
      const parsed = new URL(u)
      return Boolean(parsed.hostname && parsed.hostname.length > 0 && parsed.hostname.includes('.'))
    } catch {
      return false
    }
  }

  return false
}

/**
 * Validação de runtime estrita de payload (R2-4 / R3-3)
 */
export function validarRuntimePayload(payload: any): { valido: boolean; erro?: string } {
  if (!payload || typeof payload !== 'object') {
    return { valido: false, erro: 'Payload inválido: deve ser um objeto JSON.' }
  }

  // 0. Validação de Tipos de Campos Escalares de Texto (R3-3)
  const camposTexto = [
    'titulo_destaque',
    'subtitulo',
    'subtitulo_destaque',
    'resumo_publico',
    'hero_headline',
    'hero_subheadline',
    'meta_title',
    'meta_description',
    'keywords',
    'cta_texto_botao',
    'cta_link_destino',
    'imagem_destaque_url',
    'imagem_destaque_alt',
    'termo_busca_modulo_convenio',
    'mensagem_sem_convenios',
    'mensagem_erro_busca_convenios',
    'termo_busca_modulo_faq',
    'mensagem_duvida_nao_encontrada',
    'seo_titulo',
    'seo_descricao',
    'seo_canonical_url',
    'og_image_url',
    'cor_primaria',
    'cor_secundaria',
    'cor_fundo',
    'cor_texto',
    'cor_destaque',
    'cor_botao',
    'cor_texto_botao',
  ]

  for (const campo of camposTexto) {
    if (payload[campo] !== undefined && payload[campo] !== null && typeof payload[campo] !== 'string') {
      return { valido: false, erro: `Campo '${campo}' deve ser texto.` }
    }
  }

  // 1. Validação de Vantagens (Array de objetos)
  if (payload.vantagens !== undefined) {
    if (!Array.isArray(payload.vantagens)) {
      return { valido: false, erro: 'Vantagens deve ser um array.' }
    }
    if (payload.vantagens.length > 15) {
      return { valido: false, erro: 'Número máximo de vantagens excedido (máx 15).' }
    }
    for (const [idx, item] of payload.vantagens.entries()) {
      if (typeof item !== 'object' || item === null) {
        return { valido: false, erro: `Vantagem no índice ${idx} é inválida.` }
      }
      if (typeof item.titulo !== 'string' || item.titulo.trim() === '') {
        return { valido: false, erro: `Título da vantagem no índice ${idx} é obrigatório.` }
      }
      if (typeof item.descricao !== 'string') {
        return { valido: false, erro: `Descrição da vantagem no índice ${idx} deve ser texto.` }
      }
      const ev = erroEvidencia(item, `Vantagem no índice ${idx}`)
      if (ev) return { valido: false, erro: ev }
    }
  }

  // 2. Validação de FAQs (Array de objetos)
  if (payload.faqs !== undefined) {
    if (!Array.isArray(payload.faqs)) {
      return { valido: false, erro: 'FAQs deve ser um array.' }
    }
    if (payload.faqs.length > 25) {
      return { valido: false, erro: 'Número máximo de FAQs excedido (máx 25).' }
    }
    for (const [idx, item] of payload.faqs.entries()) {
      if (typeof item !== 'object' || item === null) {
        return { valido: false, erro: `FAQ no índice ${idx} é inválido.` }
      }
      if (typeof item.pergunta !== 'string' || item.pergunta.trim() === '') {
        return { valido: false, erro: `Pergunta do FAQ no índice ${idx} é obrigatória.` }
      }
      if (typeof item.resposta !== 'string') {
        return { valido: false, erro: `Resposta do FAQ no índice ${idx} deve ser texto.` }
      }
      const ev = erroEvidencia(item, `FAQ no índice ${idx}`)
      if (ev) return { valido: false, erro: ev }
    }
  }

  // 3. Validação de Ordem das Seções (Enum + Unicidade)
  if (payload.secoes_ordem !== undefined) {
    if (!Array.isArray(payload.secoes_ordem)) {
      return { valido: false, erro: 'secoes_ordem deve ser um array.' }
    }
    const setOrdem = new Set<string>()
    for (const secao of payload.secoes_ordem) {
      if (!SECOES_VALIDAS.includes(secao as any)) {
        return { valido: false, erro: `Seção '${secao}' não é reconhecida no catálogo.` }
      }
      if (setOrdem.has(secao)) {
        return { valido: false, erro: `Seção duplicada '${secao}' na ordem.` }
      }
      setOrdem.add(secao)
    }
  }

  // 4. Validação de Visibilidade das Seções (Objeto com booleanos)
  if (payload.secoes_visibilidade !== undefined) {
    if (typeof payload.secoes_visibilidade !== 'object' || payload.secoes_visibilidade === null || Array.isArray(payload.secoes_visibilidade)) {
      return { valido: false, erro: 'secoes_visibilidade deve ser um objeto JSON.' }
    }
    for (const [key, val] of Object.entries(payload.secoes_visibilidade)) {
      if (typeof val !== 'boolean') {
        return { valido: false, erro: `Visibilidade da seção '${key}' deve ser um booleano.` }
      }
    }
  }

  // 5. Validação do Tipo de Destino do CTA
  if (payload.cta_tipo_destino !== undefined) {
    if (!CTA_DESTINOS_VALIDOS.includes(payload.cta_tipo_destino)) {
      return { valido: false, erro: `cta_tipo_destino '${payload.cta_tipo_destino}' é inválido.` }
    }
  }

  // 6. Validação de URLs
  if (payload.cta_link_destino && !validarUrlDestino(payload.cta_link_destino)) {
    return { valido: false, erro: 'URL de destino do CTA é inválida.' }
  }
  if (payload.imagem_destaque_url && !validarUrlMedia(payload.imagem_destaque_url)) {
    return { valido: false, erro: 'URL da imagem de destaque é inválida para mídias.' }
  }
  if (payload.og_image_url && !validarUrlMedia(payload.og_image_url)) {
    return { valido: false, erro: 'URL de og:image é inválida para mídias.' }
  }

  return { valido: true }
}

/**
 * Substitui de forma segura as variáveis {{nome_variavel}} pelos valores fornecidos no contexto do parceiro.
 */
export function interpolarTexto(
  texto: string | null | undefined,
  contexto: ContextoParceiro = {},
): string {
  if (!texto) return ''
  return texto.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, varName) => {
    return contexto[varName] !== undefined ? String(contexto[varName]) : `{{${varName}}}`
  })
}

/**
 * Processa todo o DTO de Conteúdo Central aplicando interpolação segura nos campos de texto.
 */
export function interpolarConteudoDTO(
  dto: ConteudoPublicoDTO,
  contexto: ContextoParceiro,
): ConteudoPublicoDTO {
  return {
    ...dto,
    tituloDestaque: interpolarTexto(dto.tituloDestaque, contexto),
    subtitulo: interpolarTexto(dto.subtitulo, contexto),
    resumoPublico: interpolarTexto(dto.resumoPublico, contexto),
    heroHeadline: dto.heroHeadline ? interpolarTexto(dto.heroHeadline, contexto) : null,
    heroSubheadline: dto.heroSubheadline ? interpolarTexto(dto.heroSubheadline, contexto) : null,
    vantagens: dto.vantagens.map((v) => ({
      ...v,
      titulo: interpolarTexto(v.titulo, contexto),
      descricao: interpolarTexto(v.descricao, contexto),
    })),
    faqs: dto.faqs.map((f) => ({
      ...f,
      pergunta: interpolarTexto(f.pergunta, contexto),
      resposta: interpolarTexto(f.resposta, contexto),
    })),
    metaTitle: dto.metaTitle ? interpolarTexto(dto.metaTitle, contexto) : null,
    metaDescription: dto.metaDescription ? interpolarTexto(dto.metaDescription, contexto) : null,
    keywords: dto.keywords ? interpolarTexto(dto.keywords, contexto) : null,
    ctaTextoBotao: interpolarTexto(dto.ctaTextoBotao, contexto),
    ctaLinkDestino: dto.ctaLinkDestino ? interpolarTexto(dto.ctaLinkDestino, contexto) : null,
  }
}

