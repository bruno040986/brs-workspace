'use server'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { dispararRebuildNuAzul } from '@/lib/convenios-publico/deploy-hook'
import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { montarSnapshotPublico, SLUG_PUBLICO_RE } from '@/lib/convenios-publico/snapshot'
import {
  SERVER_WHITELIST_VARIAVEIS,
  SECOES_VALIDAS,
  validarVariaveisNoTexto,
  validarRuntimePayload,
  type FaqItem,
  type VantagemItem,
  type SecaoKey,
  type SecoesVisibilidadeMap,
  type CtaTipoDestino,
} from '@/lib/site-builder/conteudo-publico'

const PERMISSION_RESOURCE = 'workspace-convenios'

const rotaPublica = (slug: string) => `/api/convenios/publico/v1/${slug}`

async function nomeUsuario(admin: Awaited<ReturnType<typeof createAdminClient>>, id: string | null | undefined): Promise<string | null> {
  if (!id) return null
  const { data } = await admin.from('users').select('name').eq('id', id).maybeSingle()
  return (data?.name as string | undefined) || null
}

export type ConvenioConteudoSiteRecord = {
  id?: string
  convenio_id: string
  versao: number
  is_publicado: boolean
  is_draft?: boolean
  pendente_revisao_humana: boolean
  published_at?: string | null
  published_by?: string | null
  revisado_por?: string | null
  revisado_em?: string | null
  created_by?: string | null
  titulo_destaque: string
  subtitulo: string
  resumo_publico: string
  hero_headline?: string | null
  hero_subheadline?: string | null
  vantagens: VantagemItem[]
  faqs: FaqItem[]
  secoes_ordem: SecaoKey[]
  secoes_visibilidade: SecoesVisibilidadeMap
  meta_title?: string | null
  meta_description?: string | null
  keywords?: string | null
  cta_texto_botao: string
  cta_tipo_destino: CtaTipoDestino
  cta_link_destino?: string | null
  imagem_destaque_url?: string | null
  imagem_destaque_alt?: string | null
  variaveis_permitidas: string[]
  created_at?: string
  updated_at?: string
  expected_updated_at?: string
}

/**
 * Retorna o rascunho ativo ou a versão mais recente para edição no Workspace.
 * Exige permissão de leitura em 'workspace-convenios'.
 */
export type ConvenioConteudoSiteInfo = {
  slugPublico: string | null
  revisadoPorNome: string | null
  publicado: { versao: number; publicadoEm: string | null; publicadoPorNome: string | null } | null
}

export async function getConvenioConteudoSite(convenioId: string): Promise<{
  success: boolean
  item?: ConvenioConteudoSiteRecord
  info?: ConvenioConteudoSiteInfo
  error?: string
}> {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_view')
    if (!convenioId) return { success: false, error: 'ID do convênio é obrigatório.' }

    const supabase = await createAdminClient()

    const [{ data: convenioRow }, { data: publicadoRow }] = await Promise.all([
      supabase.from('convenios').select('slug_publico').eq('id', convenioId).maybeSingle(),
      supabase
        .from('convenio_conteudo_site')
        .select('versao, published_at, published_by')
        .eq('convenio_id', convenioId)
        .eq('is_publicado', true)
        .maybeSingle(),
    ])

    // 1. Tenta buscar rascunho ativo primeiro (is_draft = true)
    const { data: draftData } = await supabase
      .from('convenio_conteudo_site')
      .select('*')
      .eq('convenio_id', convenioId)
      .eq('is_draft', true)
      .maybeSingle()

    let data = draftData

    // 2. Se não houver rascunho ativo, busca a versão mais recente registrada no histórico
    if (!data) {
      const { data: latestData, error: latestErr } = await supabase
        .from('convenio_conteudo_site')
        .select('*')
        .eq('convenio_id', convenioId)
        .order('versao', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (latestErr) throw latestErr
      data = latestData
    }

    const info: ConvenioConteudoSiteInfo = {
      slugPublico: convenioRow?.slug_publico ?? null,
      revisadoPorNome: data && !data.pendente_revisao_humana ? await nomeUsuario(supabase, data.revisado_por) : null,
      publicado: publicadoRow
        ? {
            versao: publicadoRow.versao,
            publicadoEm: publicadoRow.published_at,
            publicadoPorNome: await nomeUsuario(supabase, publicadoRow.published_by),
          }
        : null,
    }

    if (data) {
      const { snapshot_publico: _snapshot, ...semSnapshot } = data
      void _snapshot
      return {
        success: true,
        info,
        item: {
          ...semSnapshot,
          vantagens: Array.isArray(data.vantagens) ? data.vantagens : [],
          faqs: Array.isArray(data.faqs) ? data.faqs : [],
          secoes_ordem: Array.isArray(data.secoes_ordem) ? data.secoes_ordem : [...SECOES_VALIDAS],
          secoes_visibilidade: typeof data.secoes_visibilidade === 'object' && data.secoes_visibilidade !== null
            ? data.secoes_visibilidade
            : { hero: true, resumo: true, vantagens: true, faq: true, cta: true, seo: true },
          variaveis_permitidas: [...SERVER_WHITELIST_VARIAVEIS],
        },
      }
    }

    // Se não existir registro no banco, retorna modelo inicial neutro para revisão (R2-5).
    // Sem {{variáveis}}: o conteúdo público v1 é por convênio e recusa placeholders na publicação.
    return {
      success: true,
      info,
      item: {
        convenio_id: convenioId,
        versao: 1,
        is_publicado: false,
        is_draft: true,
        pendente_revisao_humana: true,
        titulo_destaque: 'Crédito Consignado',
        subtitulo: 'Informações e atendimento sobre a modalidade de crédito.',
        resumo_publico: 'Página informativa para simulação e orientação sobre o convênio.',
        hero_headline: 'Crédito consignado',
        hero_subheadline: 'Tire suas dúvidas e solicite uma simulação.',
        vantagens: [
          { titulo: 'Desconto em Folha', descricao: 'Amortização direta conforme regramento.', icone: 'ShieldCheck', situacao: 'pendente' },
        ],
        faqs: [],
        secoes_ordem: [...SECOES_VALIDAS],
        secoes_visibilidade: { hero: true, resumo: true, vantagens: true, faq: true, cta: true, seo: true },
        meta_title: 'Empréstimo Consignado',
        meta_description: 'Informações sobre crédito consignado.',
        keywords: 'consignado, emprestimo',
        cta_texto_botao: 'Simular via WhatsApp',
        cta_tipo_destino: 'whatsapp',
        cta_link_destino: null,
        imagem_destaque_url: null,
        imagem_destaque_alt: null,
        variaveis_permitidas: [...SERVER_WHITELIST_VARIAVEIS],
      },
    }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Erro ao carregar conteúdo do convênio.' }
  }
}

/**
 * Salva um RASCUNHO (is_publicado = false, is_draft = true).
 * Preserva o histórico de versões publicadas anteriores (R2-1).
 * Permissão é estritamente resolvida no servidor após consultar o banco real (R2-2).
 * Proteção de concorrência com verificação de expected_updated_at / updated_at (R3-1).
 */
export async function saveConvenioConteudoSiteDraft(
  payload: Partial<ConvenioConteudoSiteRecord> & { convenio_id: string },
): Promise<{ success: boolean; item?: ConvenioConteudoSiteRecord; error?: string }> {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_view')
    if (!payload.convenio_id) return { success: false, error: 'ID do convênio é obrigatório.' }

    // R2-4 / R3-3: Validação completa de runtime de tipos, shapes, enums, limites e URLs
    const valRes = validarRuntimePayload(payload)
    if (!valRes.valido) {
      return { success: false, error: `Payload inválido: ${valRes.erro}` }
    }

    // E4 / R3-3: Validação estrita de variáveis de template contra a Whitelist fixa do servidor (inclui alt da imagem)
    const camposParaValidar = [
      payload.titulo_destaque,
      payload.subtitulo,
      payload.resumo_publico,
      payload.hero_headline,
      payload.hero_subheadline,
      payload.meta_title,
      payload.meta_description,
      payload.keywords,
      payload.cta_texto_botao,
      payload.cta_link_destino,
      payload.imagem_destaque_alt,
      ...(payload.vantagens || []).flatMap((v) => [v.titulo, v.descricao]),
      ...(payload.faqs || []).flatMap((f) => [f.pergunta, f.resposta]),
    ]

    const invalidas = new Set<string>()
    for (const campo of camposParaValidar) {
      const res = validarVariaveisNoTexto(campo, [...SERVER_WHITELIST_VARIAVEIS])
      if (!res.valido) {
        res.invalidas.forEach((inv) => invalidas.add(inv))
      }
    }

    if (invalidas.size > 0) {
      const lista = Array.from(invalidas).map((v) => `{{${v}}}`).join(', ')
      return {
        success: false,
        error: `Salvamento de rascunho bloqueado: variáveis não autorizadas no servidor: ${lista}.`,
      }
    }

    const supabase = await createAdminClient()

    // R2-1 / R2-2: Busca se existe um RASCUNHO ATIVO (is_draft = true) no banco de dados para este convênio
    const { data: draftExistente } = await supabase
      .from('convenio_conteudo_site')
      .select('id, versao, created_by, updated_at')
      .eq('convenio_id', payload.convenio_id)
      .eq('is_draft', true)
      .maybeSingle()

    // R4-2 / R5-1: Token de revisão obrigatório para atualizar rascunho existente
    const expectedUpdatedAt = payload.expected_updated_at || (payload as any).updated_at
    if (draftExistente?.id) {
      if (!expectedUpdatedAt || typeof expectedUpdatedAt !== 'string' || !expectedUpdatedAt.trim()) {
        return {
          success: false,
          error: 'CONFLITO_CONCORRENCIA: O token de revisão (updated_at/expected_updated_at) é obrigatório para atualizar um rascunho existente.',
        }
      }
    }

    // R2-2: A permissão necessária é decidida no servidor com base na presença do rascunho real no banco
    const acaoNecessaria = draftExistente?.id ? 'can_edit' : 'can_include'
    const { user } = await requirePermission(PERMISSION_RESOURCE, acaoNecessaria)

    // R2-1: Busca a maior versão registrada para calcular a próxima versão se for um novo rascunho
    const { data: maiorVersaoRow } = await supabase
      .from('convenio_conteudo_site')
      .select('versao')
      .eq('convenio_id', payload.convenio_id)
      .order('versao', { ascending: false })
      .limit(1)
      .maybeSingle()

    const versao = draftExistente?.versao || (maiorVersaoRow?.versao || 0) + 1
    const created_by = draftExistente?.created_by || user.id

    const recordData = {
      convenio_id: payload.convenio_id,
      versao,
      is_publicado: false,
      is_draft: true,
      // Qualquer edição do rascunho invalida a revisão humana anterior.
      pendente_revisao_humana: true,
      revisado_por: null,
      revisado_em: null,
      created_by,
      titulo_destaque: payload.titulo_destaque || '',
      subtitulo: payload.subtitulo || '',
      resumo_publico: payload.resumo_publico || '',
      hero_headline: payload.hero_headline || null,
      hero_subheadline: payload.hero_subheadline || null,
      vantagens: payload.vantagens || [],
      faqs: payload.faqs || [],
      secoes_ordem: payload.secoes_ordem || [...SECOES_VALIDAS],
      secoes_visibilidade: payload.secoes_visibilidade || { hero: true, resumo: true, vantagens: true, faq: true, cta: true, seo: true },
      meta_title: payload.meta_title || null,
      meta_description: payload.meta_description || null,
      keywords: payload.keywords || null,
      cta_texto_botao: payload.cta_texto_botao || 'Simular Agora',
      cta_tipo_destino: payload.cta_tipo_destino || 'whatsapp',
      cta_link_destino: payload.cta_link_destino || null,
      imagem_destaque_url: payload.imagem_destaque_url || null,
      imagem_destaque_alt: payload.imagem_destaque_alt || null,
      variaveis_permitidas: [...SERVER_WHITELIST_VARIAVEIS],
      updated_at: new Date().toISOString(),
    }

    let result
    if (draftExistente?.id) {
      // R4-2 / R5-1: Atomic Compare-And-Swap (CAS) em SQL usando exatamente o token do editor (expectedUpdatedAt) no predicado updated_at
      result = await supabase
        .from('convenio_conteudo_site')
        .update(recordData)
        .eq('id', draftExistente.id)
        .eq('is_draft', true)
        .eq('updated_at', expectedUpdatedAt)
        .select()
        .maybeSingle()

      // R5-3: Inspeciona result.error retornado pelo cliente Supabase JS
      if (result.error) {
        const errCode = result.error.code
        const errMsg = result.error.message || ''
        if (errCode === '23505' || errMsg.includes('convenio_conteudo_site_draft_unique_idx') || errMsg.includes('CONFLITO_CONCORRENCIA')) {
          return {
            success: false,
            error: 'CONFLITO_CONCORRENCIA: O rascunho foi alterado simultaneamente por outro usuário. Recarregue a página.',
          }
        }
        throw result.error
      }

      if (!result.data) {
        return {
          success: false,
          error: 'CONFLITO_CONCORRENCIA: O rascunho foi alterado por outro usuário desde a sua leitura. Atualize a página antes de salvar.',
        }
      }
    } else {
      result = await supabase
        .from('convenio_conteudo_site')
        .insert(recordData)
        .select()
        .maybeSingle()

      // R5-3: Inspeciona result.error retornado pelo cliente Supabase JS (sem depender unicamente de try/catch throw)
      if (result.error) {
        const errCode = result.error.code
        const errMsg = result.error.message || ''
        if (errCode === '23505' || errMsg.includes('convenio_conteudo_site_draft_unique_idx') || errMsg.includes('CONFLITO_CONCORRENCIA')) {
          return {
            success: false,
            error: 'CONFLITO_CONCORRENCIA: Um rascunho foi criado simultaneamente por outro usuário. Recarregue a página.',
          }
        }
        throw result.error
      }
    }

    const { snapshot_publico: _snapshot, ...item } = (result.data ?? {}) as any
    void _snapshot
    return { success: true, item: item as ConvenioConteudoSiteRecord }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Erro ao salvar rascunho.' }
  }
}

/**
 * Marca o rascunho salvo como revisado (qualquer usuário com can_edit em workspace-convenios).
 * CAS em updated_at: só vale para exatamente o que o revisor viu.
 */
export async function marcarConvenioConteudoSiteRevisado(
  convenioId: string,
  conteudoId: string,
  expectedUpdatedAt: string,
): Promise<{ success: boolean; item?: ConvenioConteudoSiteRecord; revisadoPorNome?: string | null; error?: string }> {
  try {
    const { user } = await requirePermission(PERMISSION_RESOURCE, 'can_edit')
    if (!convenioId || !conteudoId || !expectedUpdatedAt) return { success: false, error: 'Salve o rascunho antes de marcar como revisado.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
      .from('convenio_conteudo_site')
      .update({ pendente_revisao_humana: false, revisado_por: user.id, revisado_em: new Date().toISOString() })
      .eq('id', conteudoId)
      .eq('convenio_id', convenioId)
      .eq('is_draft', true)
      .eq('updated_at', expectedUpdatedAt)
      .select()
      .maybeSingle()
    if (error) throw error
    if (!data) {
      return { success: false, error: 'CONFLITO_CONCORRENCIA: O rascunho mudou desde a sua leitura. Recarregue e revise de novo.' }
    }
    const { snapshot_publico: _snapshot, ...item } = data
    void _snapshot
    return { success: true, item: item as ConvenioConteudoSiteRecord, revisadoPorNome: await nomeUsuario(supabase, user.id) }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Erro ao marcar como revisado.' }
  }
}

const ativo = (r: any) => r && r.is_active !== false && !r.deleted_at
const porNome = (a: { nome: string }, b: { nome: string }) => a.nome.localeCompare(b.nome, 'pt-BR')

/**
 * Publica o rascunho JÁ SALVO E REVISADO (não regrava o rascunho: isso desfaria a revisão).
 * Monta o snapshot público no servidor e grava na mesma transação da troca de publicação.
 * Exige permissão 'can_activate_inactivate' em 'workspace-convenios'.
 */
export async function publishConvenioConteudoSite(
  convenioId: string,
  conteudoId: string,
  expectedUpdatedAt: string,
): Promise<{ success: boolean; item?: ConvenioConteudoSiteRecord; publicadoPorNome?: string | null; error?: string }> {
  try {
    const { user } = await requirePermission(PERMISSION_RESOURCE, 'can_activate_inactivate')
    if (!convenioId || !conteudoId || !expectedUpdatedAt) return { success: false, error: 'Salve o rascunho antes de publicar.' }

    const supabase = await createAdminClient()

    const [conteudoRes, convenioRes, publicosRes, formasRes, instRes, aprovadoPor] = await Promise.all([
      supabase.from('convenio_conteudo_site').select('*').eq('id', conteudoId).eq('convenio_id', convenioId).maybeSingle(),
      supabase.from('convenios').select('nome, esfera, uf, slug_publico, is_active, deleted_at').eq('id', convenioId).maybeSingle(),
      supabase.from('convenio_publicos').select('publicos_atendidos(id, nome, is_active, deleted_at)').eq('convenio_id', convenioId),
      supabase.from('convenio_formas_contrato').select('formas_contrato(nome, is_active)').eq('convenio_id', convenioId),
      supabase
        .from('convenio_instituicoes')
        .select(
          'financial_institutions(name, is_active, deleted_at), ' +
            'convenio_instituicao_publicos(publicos_atendidos(id, nome, is_active, deleted_at)), ' +
            'convenio_instituicao_formas(publicos_restritos, formas_contrato(nome, is_active))',
        )
        .eq('convenio_id', convenioId)
        .eq('is_active', true),
      nomeUsuario(supabase, user.id),
    ])
    for (const r of [conteudoRes, convenioRes, publicosRes, formasRes, instRes]) if (r.error) throw r.error

    const conteudo = conteudoRes.data
    const convenio = convenioRes.data
    if (!conteudo || !convenio) return { success: false, error: 'Conteúdo ou convênio não encontrado.' }
    if (!conteudo.is_draft) return { success: false, error: 'Só um rascunho pode ser publicado. Salve uma nova versão antes.' }
    if (conteudo.pendente_revisao_humana) {
      return { success: false, error: 'O conteúdo ainda não foi revisado. Marque como revisado antes de publicar.' }
    }
    if (convenio.is_active === false || convenio.deleted_at) {
      return { success: false, error: 'Convênio inativo ou excluído não pode ter conteúdo publicado.' }
    }
    if (!convenio.slug_publico) return { success: false, error: 'Defina o slug público do convênio antes de publicar.' }

    // id → nome dos públicos ativos (convênio + vínculos), para resolver publicos_restritos (uuid[]).
    const publicosConvenio = (publicosRes.data || []).map((r: any) => r.publicos_atendidos).filter(ativo).sort(porNome)
    const nomePublico = new Map<string, string>()
    for (const p of publicosConvenio) nomePublico.set(p.id, p.nome)
    for (const i of (instRes.data || []) as any[]) {
      for (const r of i.convenio_instituicao_publicos || []) if (ativo(r.publicos_atendidos)) nomePublico.set(r.publicos_atendidos.id, r.publicos_atendidos.nome)
    }
    const nomesOrdenados = (l: string[]) => l.sort((a, b) => a.localeCompare(b, 'pt-BR'))

    const montado = montarSnapshotPublico({
      slug: convenio.slug_publico,
      convenio: { nome: convenio.nome, esfera: convenio.esfera, uf: convenio.uf },
      versao: conteudo.versao,
      publicado_em: new Date().toISOString(),
      conteudo,
      publicos: publicosConvenio,
      formas: (formasRes.data || []).map((r: any) => r.formas_contrato).filter(ativo).sort(porNome),
      instituicoes: ((instRes.data || []) as any[])
        .filter((i) => ativo(i.financial_institutions))
        .map((i) => ({
          nome: i.financial_institutions.name as string,
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
    })
    if (!montado.ok) return { success: false, error: `Publicação bloqueada: ${montado.erro}` }

    const { data: publishedRow, error: rpcErr } = await supabase.rpc('convenio_conteudo_site_publicar', {
      p_convenio_id: convenioId,
      p_conteudo_id: conteudoId,
      p_user_id: user.id,
      p_expected_updated_at: expectedUpdatedAt,
      p_snapshot: montado.snapshot,
    })

    if (rpcErr) {
      const errMsg = rpcErr.message || ''
      if (errMsg.includes('slug_divergente')) {
        return { success: false, error: 'O slug público mudou durante a publicação. Recarregue e publique de novo.' }
      }
      if (errMsg.includes('snapshot_obrigatorio')) {
        return { success: false, error: 'Falha ao montar o conteúdo público. Recarregue e tente de novo.' }
      }
      if (errMsg.includes('conteudo_nao_revisado')) {
        return { success: false, error: 'O conteúdo ainda não foi revisado. Marque como revisado antes de publicar.' }
      }
      if (rpcErr.code === '23505' || errMsg.includes('CONFLITO_CONCORRENCIA')) {
        return {
          success: false,
          error: 'CONFLITO_CONCORRENCIA: A publicação foi abortada porque o rascunho foi alterado depois da sua leitura. Recarregue.',
        }
      }
      throw rpcErr
    }

    revalidatePath(rotaPublica(convenio.slug_publico))
    after(() => dispararRebuildNuAzul('publicar', convenio.slug_publico))

    const { snapshot_publico: _snapshot, ...item } = publishedRow as any
    void _snapshot
    return { success: true, item: item as ConvenioConteudoSiteRecord, publicadoPorNome: aprovadoPor }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Erro ao publicar versão.' }
  }
}

/**
 * RETIRADA ATÔMICA DO AR VIA RPC (E2 / R2-1 / R5-2).
 * Exige permissão 'can_activate_inactivate' em 'workspace-convenios'.
 */
export async function unpublishConvenioConteudoSite(
  convenioId: string,
  expectedUpdatedAt?: string,
): Promise<{
  success: boolean
  error?: string
}> {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_activate_inactivate')
    if (!convenioId) return { success: false, error: 'ID do convênio é obrigatório.' }

    const supabase = await createAdminClient()
    const { error: rpcErr } = await supabase.rpc('convenio_conteudo_site_desativar', {
      p_convenio_id: convenioId,
      p_expected_updated_at: expectedUpdatedAt || null,
    })

    if (rpcErr) {
      const errMsg = rpcErr.message || ''
      if (rpcErr.code === '23505' || errMsg.includes('CONFLITO_CONCORRENCIA')) {
        return {
          success: false,
          error: 'CONFLITO_CONCORRENCIA: A versão publicada foi alterada por outro usuário antes da desativação.',
        }
      }
      throw rpcErr
    }

    const { data: convenio } = await supabase.from('convenios').select('slug_publico').eq('id', convenioId).maybeSingle()
    if (convenio?.slug_publico) {
      const slug = convenio.slug_publico
      revalidatePath(rotaPublica(slug))
      after(() => dispararRebuildNuAzul('retirar', slug))
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Erro ao retirar do ar.' }
  }
}

/**
 * Define o slug da rota pública (null limpa). Bloqueado enquanto houver versão publicada com snapshot,
 * porque o snapshot congela o slug: retire do ar, troque e publique de novo.
 */
export async function salvarSlugPublicoConvenio(
  convenioId: string,
  slug: string | null,
): Promise<{ success: boolean; slugPublico?: string | null; error?: string }> {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_edit')
    if (!convenioId) return { success: false, error: 'ID do convênio é obrigatório.' }
    const novo = slug?.trim().toLowerCase() || null
    if (novo && !SLUG_PUBLICO_RE.test(novo)) {
      return { success: false, error: 'Slug inválido: use letras minúsculas, números e hífen (sem hífen nas pontas, até 63 caracteres).' }
    }

    const supabase = await createAdminClient()
    const [{ data: atual, error: errAtual }, { data: publicado, error: errPub }] = await Promise.all([
      supabase.from('convenios').select('slug_publico').eq('id', convenioId).maybeSingle(),
      supabase
        .from('convenio_conteudo_site')
        .select('id')
        .eq('convenio_id', convenioId)
        .eq('is_publicado', true)
        .not('snapshot_publico', 'is', null)
        .maybeSingle(),
    ])
    if (errAtual) throw errAtual
    if (errPub) throw errPub
    if ((atual?.slug_publico ?? null) === novo) return { success: true, slugPublico: novo }
    if (publicado) {
      return { success: false, error: 'Há uma versão publicada com o slug atual. Retire do ar, troque o slug e publique de novo.' }
    }

    const { error } = await supabase.from('convenios').update({ slug_publico: novo }).eq('id', convenioId)
    if (error) {
      if (error.code === '23505') return { success: false, error: 'Esse slug já está em uso por outro convênio.' }
      if (error.code === '23514') return { success: false, error: 'Slug inválido.' }
      throw error
    }
    if (atual?.slug_publico) revalidatePath(rotaPublica(atual.slug_publico))
    if (novo) revalidatePath(rotaPublica(novo))
    return { success: true, slugPublico: novo }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Erro ao salvar o slug público.' }
  }
}
