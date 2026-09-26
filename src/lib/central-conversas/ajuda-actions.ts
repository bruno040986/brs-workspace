'use server'

/**
 * Central de ajuda (D5, lote 2). Administração exige `central-conversas` (escrita: can_edit);
 * buscar artigo para enviar na conversa exige `conversas`. Retorna `{ok:false,error}` em vez de lançar.
 * URL pública: CHATWOOT_PUBLIC_URL (domínio de marca, quando o DNS estiver ok) ou, se não houver, CHATWOOT_URL.
 */

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { clienteChatwootBrs } from './actions'
import { corpoArtigo, corpoCategoria, corpoPortal, linkArtigo, type ArtigoEntrada } from './ajuda'

type Falha = { ok: false; error: string }
const msg = (e: unknown): Falha => ({ ok: false, error: e instanceof Error ? e.message : 'Falha ao falar com o Chatwoot.' })

async function cliente() {
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  return cli
}

const baseUrl = () => String(process.env.CHATWOOT_PUBLIC_URL || process.env.CHATWOOT_URL || 'https://chat.brspromotora.com.br').replace(/\/$/, '')
const lista = <T>(r: T[] | { payload?: T[] } | null | undefined): T[] => (Array.isArray(r) ? r : r?.payload || [])

export type Portal = { id: number; slug: string; name: string; custom_domain?: string | null }
export type Categoria = { id: number; name: string; slug: string; description?: string | null }
export type Artigo = { id: number; title: string; slug: string; content?: string; description?: string | null; status: number | string; category_id?: number | null; views?: number }

export async function listarPortais(): Promise<{ ok: true; portais: Portal[]; urlBase: string } | Falha> {
  try {
    await requirePermission('central-conversas', 'can_view')
    return { ok: true, portais: lista(await (await cliente()).req<Portal[] | { payload: Portal[] }>('/portals')), urlBase: baseUrl() }
  } catch (e) {
    return msg(e)
  }
}

export async function criarPortal(nome: string): Promise<{ ok: true } | Falha> {
  try {
    await requirePermission('central-conversas', 'can_edit')
    const c = corpoPortal({ nome })
    if (!c.ok) return c
    await (await cliente()).req('/portals', { method: 'POST', body: c.corpo })
    revalidatePath('/central-conversas/ajuda')
    return { ok: true }
  } catch (e) {
    return msg(e)
  }
}

export async function listarCategorias(portalSlug: string): Promise<{ ok: true; categorias: Categoria[] } | Falha> {
  try {
    await requirePermission('central-conversas', 'can_view')
    return { ok: true, categorias: lista(await (await cliente()).req<Categoria[] | { payload: Categoria[] }>(`/portals/${encodeURIComponent(portalSlug)}/categories`)) }
  } catch (e) {
    return msg(e)
  }
}

export async function criarCategoria(portalSlug: string, entrada: { nome: string; descricao?: string }): Promise<{ ok: true } | Falha> {
  try {
    await requirePermission('central-conversas', 'can_edit')
    const c = corpoCategoria(entrada)
    if (!c.ok) return c
    await (await cliente()).req(`/portals/${encodeURIComponent(portalSlug)}/categories`, { method: 'POST', body: c.corpo })
    revalidatePath('/central-conversas/ajuda')
    return { ok: true }
  } catch (e) {
    return msg(e)
  }
}

/** A API pagina de 25 em 25 e ignora per_page (ArticlesController#index): junta até 8 páginas. */
async function todosArtigos(cli: Awaited<ReturnType<typeof cliente>>, portalSlug: string, status?: 'published'): Promise<Artigo[]> {
  const saida: Artigo[] = []
  for (let page = 1; page <= 8; page++) {
    const q = new URLSearchParams({ page: String(page) })
    if (status) q.set('status', status)
    const lote = lista(await cli.req<Artigo[] | { payload: Artigo[] }>(`/portals/${encodeURIComponent(portalSlug)}/articles?${q.toString()}`))
    saida.push(...lote)
    if (lote.length < 25) break
  }
  return saida
}

export async function listarArtigos(portalSlug: string): Promise<{ ok: true; artigos: Artigo[] } | Falha> {
  try {
    await requirePermission('central-conversas', 'can_view')
    return { ok: true, artigos: await todosArtigos(await cliente(), portalSlug) }
  } catch (e) {
    return msg(e)
  }
}

export async function salvarArtigo(portalSlug: string, id: number | null, entrada: ArtigoEntrada): Promise<{ ok: true } | Falha> {
  try {
    await requirePermission('central-conversas', 'can_edit')
    const cli = await cliente()
    const perfil = await cli.perfil()
    if (!perfil?.id) throw new Error('Não foi possível identificar o autor no Chatwoot.')
    const c = corpoArtigo(entrada, perfil.id, id === null)
    if (!c.ok) return c
    const base = `/portals/${encodeURIComponent(portalSlug)}/articles`
    await cli.req(id ? `${base}/${id}` : base, { method: id ? 'PATCH' : 'POST', body: c.corpo })
    revalidatePath('/central-conversas/ajuda')
    return { ok: true }
  } catch (e) {
    return msg(e)
  }
}

export async function excluirArtigo(portalSlug: string, id: number): Promise<{ ok: true } | Falha> {
  try {
    await requirePermission('central-conversas', 'can_edit')
    await (await cliente()).req(`/portals/${encodeURIComponent(portalSlug)}/articles/${id}`, { method: 'DELETE' })
    revalidatePath('/central-conversas/ajuda')
    return { ok: true }
  } catch (e) {
    return msg(e)
  }
}

/** Artigos PUBLICADOS (até 200 por portal) com o link público pronto — alimenta o botão "Enviar artigo" do composer. */
export async function artigosParaEnviar(): Promise<{ ok: true; artigos: Array<{ id: number; titulo: string; url: string }> } | Falha> {
  try {
    await requirePermission('conversas', 'can_view')
    const cli = await cliente()
    const portais = lista(await cli.req<Portal[] | { payload: Portal[] }>('/portals'))
    const saida: Array<{ id: number; titulo: string; url: string }> = []
    for (const p of portais) {
      const artigos = await todosArtigos(cli, p.slug, 'published')
      for (const a of artigos) {
        if (a.status !== 1 && a.status !== 'published') continue
        saida.push({ id: a.id, titulo: a.title, url: linkArtigo({ base: baseUrl(), customDomain: p.custom_domain, portalSlug: p.slug, slugArtigo: a.slug }) })
      }
    }
    return { ok: true, artigos: saida }
  } catch (e) {
    return msg(e)
  }
}
