// Entrada do snapshot público a partir da base: a MESMA montagem serve a publicação
// (site-actions.ts) e o preview do rascunho (rota .../[slug]/rascunho).
// Sem import de runtime com alias: roda no node:test.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { timingSafeEqual } from 'node:crypto'
import type { createAdminClient } from '@/lib/supabase/server'
import { montarSnapshotPublico, type ConvenioPublicoV1, type EntradaSnapshot } from './snapshot.ts'

type Db = Awaited<ReturnType<typeof createAdminClient>>

export type FaqBaseItem = { id: string; pergunta: string; resposta: string; importada: boolean }

/**
 * FAQ ativo da Base de Conhecimento do convênio, na ordem da base: próprias do convênio
 * (ordem) e depois as gerais importadas (convenio_faq_vinculos, ordem). Mesma fonte da publicação.
 */
export async function buscarFaqBase(supabase: Db, convenioId: string): Promise<FaqBaseItem[]> {
  const [propriasRes, vinculosRes] = await Promise.all([
    supabase
      .from('faq_itens')
      .select('id, pergunta, resposta')
      .eq('escopo', 'convenio')
      .eq('convenio_id', convenioId)
      .eq('status', 'ativo')
      .order('ordem')
      .order('created_at'),
    supabase
      .from('convenio_faq_vinculos')
      .select('faq:faq_item_id(id, pergunta, resposta, ordem, status)')
      .eq('convenio_id', convenioId)
      .order('created_at'),
  ])
  if (propriasRes.error) throw propriasRes.error
  if (vinculosRes.error) throw vinculosRes.error
  const vinculadas = ((vinculosRes.data || []) as any[])
    .map((v) => v.faq)
    .filter((f) => f && f.status === 'ativo')
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
  return [
    ...((propriasRes.data || []) as any[]).map((f) => ({ id: f.id, pergunta: f.pergunta, resposta: f.resposta, importada: false })),
    ...vinculadas.map((f) => ({ id: f.id, pergunta: f.pergunta, resposta: f.resposta, importada: true })),
  ]
}

/** Colunas de `convenios` que a montagem usa (publicação lê também is_active/deleted_at para validar). */
export const CONVENIO_COLS_SNAPSHOT = 'nome, esfera, uf, slug_publico, is_active, deleted_at, logotipo_url, brasao_url, bandeira_url'

export type ConvenioSnapshot = { nome: string; esfera: string; uf: string | null; logotipo_url?: unknown; brasao_url?: unknown; bandeira_url?: unknown }

/** Cadastro vivo que entra no snapshot (linhas cruas do PostgREST). */
export type DadosSnapshot = { publicos: any[]; formas: any[]; instituicoes: any[]; imagens: any[]; faqsBase: FaqBaseItem[] }

export async function lerDadosSnapshot(supabase: Db, convenioId: string): Promise<DadosSnapshot> {
  const [publicosRes, formasRes, instRes, imagensRes, faqsBase] = await Promise.all([
    supabase.from('convenio_publicos').select('publicos_atendidos(id, nome, is_active, deleted_at)').eq('convenio_id', convenioId),
    supabase.from('convenio_formas_contrato').select('formas_contrato(nome, is_active)').eq('convenio_id', convenioId),
    supabase
      .from('convenio_instituicoes')
      .select(
        'financial_institutions(id, name, logo_url, is_active, deleted_at), ' +
          'convenio_instituicao_publicos(publicos_atendidos(id, nome, is_active, deleted_at)), ' +
          'convenio_instituicao_formas(publicos_restritos, formas_contrato(nome, is_active))',
      )
      .eq('convenio_id', convenioId)
      .eq('is_active', true),
    supabase.from('convenio_imagens').select('url, legenda, tipo').eq('convenio_id', convenioId).order('ordem').order('created_at'),
    buscarFaqBase(supabase, convenioId),
  ])
  for (const r of [publicosRes, formasRes, instRes, imagensRes]) if (r.error) throw r.error
  return { publicos: publicosRes.data || [], formas: formasRes.data || [], instituicoes: instRes.data || [], imagens: imagensRes.data || [], faqsBase }
}

const ativo = (r: any) => r && r.is_active !== false && !r.deleted_at
const porNome = (a: { nome: string }, b: { nome: string }) => a.nome.localeCompare(b.nome, 'pt-BR')

/** Pura: junta conteúdo + convênio + cadastro na entrada de montarSnapshotPublico. */
export function montarEntradaSnapshot(
  d: DadosSnapshot,
  convenio: ConvenioSnapshot,
  slug: string,
  conteudo: Record<string, any>,
  publicadoEm: string,
): EntradaSnapshot {
  // id → nome dos públicos ativos (convênio + vínculos), para resolver publicos_restritos (uuid[]).
  const publicosConvenio = d.publicos.map((r: any) => r.publicos_atendidos).filter(ativo).sort(porNome)
  const nomePublico = new Map<string, string>()
  for (const p of publicosConvenio) nomePublico.set(p.id, p.nome)
  for (const i of d.instituicoes) {
    for (const r of i.convenio_instituicao_publicos || []) if (ativo(r.publicos_atendidos)) nomePublico.set(r.publicos_atendidos.id, r.publicos_atendidos.nome)
  }
  const nomesOrdenados = (l: string[]) => l.sort((a, b) => a.localeCompare(b, 'pt-BR'))

  return {
    slug,
    convenio: { nome: convenio.nome, esfera: convenio.esfera, uf: convenio.uf },
    versao: conteudo.versao,
    publicado_em: publicadoEm,
    // conteudo.publicos_destaque vai cru; o snapshot resolve publico_id → nome com os ids destes públicos.
    conteudo,
    publicos: publicosConvenio,
    formas: d.formas.map((r: any) => r.formas_contrato).filter(ativo).sort(porNome),
    base_publica: process.env.NEXT_PUBLIC_APP_URL || undefined,
    logotipo_url: convenio.logotipo_url,
    brasao_url: convenio.brasao_url,
    bandeira_url: convenio.bandeira_url,
    imagens: d.imagens,
    faqs_base: d.faqsBase,
    instituicoes: d.instituicoes
      .filter((i) => ativo(i.financial_institutions))
      .map((i) => ({
        id: i.financial_institutions.id as string,
        nome: i.financial_institutions.name as string,
        logo_url: (i.financial_institutions.logo_url as string | null) ?? null,
        // Vínculo sem público no cadastro = todos do convênio (null); a resolução é no snapshot.
        publicos: (i.convenio_instituicao_publicos || []).length
          ? (i.convenio_instituicao_publicos as any[])
              .map((p) => p.publicos_atendidos)
              .filter(ativo)
              .sort(porNome)
              .map((p) => p.nome as string)
          : null,
        ofertas: ((i.convenio_instituicao_formas || []) as any[])
          .filter((f) => ativo(f.formas_contrato))
          .map((f) => ({
            forma: f.formas_contrato.nome as string,
            // Restrito a público inativo/excluído some; se sobrar nenhum, a oferta sai (nunca alarga para a base).
            publicos_restritos:
              Array.isArray(f.publicos_restritos) && f.publicos_restritos.length
                ? nomesOrdenados((f.publicos_restritos as string[]).map((id) => nomePublico.get(id)).filter((n): n is string => !!n))
                : null,
          }))
          .sort((a, b) => a.forma.localeCompare(b.forma, 'pt-BR')),
      }))
      .sort(porNome),
  }
}

// ---------------------------------------------------------------------------
// Preview do rascunho por token (contrato v1, seção 14)
// ---------------------------------------------------------------------------

/** 32 bytes em base64url = 43 caracteres. */
export const TOKEN_PREVIEW_RE = /^[A-Za-z0-9_-]{43}$/
export const PREVIEW_VALIDADE_MS = 2 * 60 * 60 * 1000
export const PREVIEW_REUSO_MIN_MS = 30 * 60 * 1000

/** Reaproveita o token do rascunho enquanto faltar mais de 30 min para expirar; senão, gera um novo. */
export function decidirTokenPreview(atual: string | null | undefined, expiraEm: string | null | undefined, agora: number): 'reutilizar' | 'novo' {
  if (!atual || !expiraEm) return 'novo'
  const t = Date.parse(expiraEm)
  return Number.isFinite(t) && t - agora > PREVIEW_REUSO_MIN_MS ? 'reutilizar' : 'novo'
}

/** Token recebido bate com o salvo (tempo constante) e ainda não expirou. */
export function tokenPreviewValido(recebido: string, salvo: unknown, expiraEm: unknown, agora: number = Date.now()): boolean {
  if (!TOKEN_PREVIEW_RE.test(recebido) || typeof salvo !== 'string' || !TOKEN_PREVIEW_RE.test(salvo)) return false
  const expira = typeof expiraEm === 'string' ? Date.parse(expiraEm) : NaN
  if (!(expira > agora)) return false
  return timingSafeEqual(Buffer.from(recebido), Buffer.from(salvo))
}

export type ConvenioPublicoPreview = ConvenioPublicoV1 & { preview: true }

/** Snapshot do RASCUNHO com a mesma montagem da publicação; não olha revisão nem grava nada. */
export function montarPreview(
  d: DadosSnapshot,
  convenio: ConvenioSnapshot,
  slug: string,
  conteudo: Record<string, any>,
  agora: Date = new Date(),
): { ok: true; snapshot: ConvenioPublicoPreview } | { ok: false; erro: string } {
  const r = montarSnapshotPublico(montarEntradaSnapshot(d, convenio, slug, conteudo, agora.toISOString()))
  return r.ok ? { ok: true, snapshot: { ...r.snapshot, preview: true } } : r
}
