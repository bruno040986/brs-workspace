// Projeção da lista pública de convênios (contrato v1, seção 14). Pura: roda no node:test.
import { ESFERAS, SLUG_PUBLICO_RE, urlHttps } from './snapshot.ts'

export type ConvenioListaPublica = {
  slug: string
  nome: string
  nome_reduzido: string | null
  esfera: (typeof ESFERAS)[number]
  uf: string | null
  logotipo_url: string | null
  brasao_url: string | null
  /** logotipo → brasão → primeira imagem tipo 'predio' (ordem do cadastro) → null; só https. */
  imagem_card_url: string | null
  publicado_em: string
}

/** Linha crua do banco → item da lista (lista de permissão); inválida → null. */
export function itemListaPublica(r: {
  slug_publico: unknown
  nome: unknown
  nome_reduzido?: unknown
  esfera: unknown
  uf?: unknown
  logotipo_url?: unknown
  brasao_url?: unknown
  imagens_predio?: { url: unknown }[] | null
  publicado_em: unknown
}): ConvenioListaPublica | null {
  const slug = typeof r.slug_publico === 'string' ? r.slug_publico : ''
  const nome = typeof r.nome === 'string' ? r.nome.trim() : ''
  const esfera = String(r.esfera) as ConvenioListaPublica['esfera']
  const t = typeof r.publicado_em === 'string' ? Date.parse(r.publicado_em) : NaN
  if (!SLUG_PUBLICO_RE.test(slug) || !nome || !ESFERAS.includes(esfera) || Number.isNaN(t)) return null
  const logotipo = urlHttps(r.logotipo_url)
  const brasao = urlHttps(r.brasao_url)
  const predio = (r.imagens_predio ?? []).map((i) => urlHttps(i.url)).find((u) => u) ?? null
  return {
    slug,
    nome,
    nome_reduzido: (typeof r.nome_reduzido === 'string' && r.nome_reduzido.trim()) || null,
    esfera,
    uf: typeof r.uf === 'string' && /^[A-Z]{2}$/.test(r.uf) ? r.uf : null,
    logotipo_url: logotipo,
    brasao_url: brasao,
    imagem_card_url: logotipo ?? brasao ?? predio,
    publicado_em: new Date(t).toISOString(),
  }
}

/** Ordem: esfera na ordem de ESFERAS (municipal, estadual, federal, inss, outro), depois nome (pt-BR). */
export function ordenarListaPublica(l: ConvenioListaPublica[]): ConvenioListaPublica[] {
  return l.sort((a, b) => ESFERAS.indexOf(a.esfera) - ESFERAS.indexOf(b.esfera) || a.nome.localeCompare(b.nome, 'pt-BR'))
}
