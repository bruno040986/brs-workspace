/**
 * Central de ajuda do Chatwoot (D5, lote 2) — helpers PUROS: slug, validação dos corpos e link público.
 * API: /portals (o "id" no caminho é o SLUG do portal), /portals/{slug}/categories, /portals/{slug}/articles.
 * Conteúdo publicado é PÚBLICO na URL do portal (acesso "por link": não listamos o portal em site nenhum).
 */

export const LOCALE_PADRAO = 'pt_BR'
export const STATUS_ARTIGO = { rascunho: 0, publicado: 1, arquivado: 2 } as const

/** minúsculas, sem acento, só [a-z0-9-]; nunca vazio. */
export function slugify(texto: string): string {
  const s = String(texto || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'item'
}

export type Validado<T> = { ok: true; corpo: T } | { ok: false; error: string }

export function corpoPortal(e: { nome: string; slug?: string }): Validado<Record<string, unknown>> {
  const nome = String(e.nome || '').trim()
  if (!nome) return { ok: false, error: 'Dê um nome à central de ajuda.' }
  return { ok: true, corpo: { name: nome, slug: slugify(e.slug || nome), page_title: nome, header_text: nome, config: { allowed_locales: [LOCALE_PADRAO], default_locale: LOCALE_PADRAO } } }
}

export function corpoCategoria(e: { nome: string; descricao?: string }): Validado<Record<string, unknown>> {
  const nome = String(e.nome || '').trim()
  if (!nome) return { ok: false, error: 'Dê um nome à categoria.' }
  return { ok: true, corpo: { name: nome, slug: slugify(nome), description: String(e.descricao || '').trim(), locale: LOCALE_PADRAO } }
}

export type ArtigoEntrada = { titulo: string; conteudo: string; descricao?: string; categoriaId: number | null; publicado: boolean }

/** `authorId` = id do agente do token (o Chatwoot exige autor). O slug nasce do título só na criação. */
export function corpoArtigo(e: ArtigoEntrada, authorId: number, criando: boolean): Validado<Record<string, unknown>> {
  const titulo = String(e.titulo || '').trim()
  const conteudo = String(e.conteudo || '').trim()
  if (!titulo) return { ok: false, error: 'Dê um título ao artigo.' }
  if (!conteudo) return { ok: false, error: 'Escreva o conteúdo do artigo.' }
  if (titulo.length > 200) return { ok: false, error: 'O título passa de 200 caracteres.' }
  const corpo: Record<string, unknown> = { title: titulo, content: conteudo, description: String(e.descricao || '').trim(), author_id: authorId, status: e.publicado ? STATUS_ARTIGO.publicado : STATUS_ARTIGO.rascunho, locale: LOCALE_PADRAO }
  if (e.categoriaId) corpo.category_id = e.categoriaId
  if (criando) corpo.slug = `${slugify(titulo)}-${Date.now().toString(36)}`
  return { ok: true, corpo }
}

/** URL pública: `<base>/hc/<portal>/<locale>/articles/<slug>`; com domínio próprio do portal, `https://<domínio>/hc/...` idem. */
export function linkArtigo(p: { base: string; customDomain?: string | null; portalSlug: string; locale?: string; slugArtigo: string }): string {
  const raiz = p.customDomain ? `https://${p.customDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : p.base.replace(/\/$/, '')
  return `${raiz}/hc/${p.portalSlug}/${p.locale || LOCALE_PADRAO}/articles/${p.slugArtigo}`
}
