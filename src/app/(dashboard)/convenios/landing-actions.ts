'use server'

/**
 * Aba Landing Page: dados do convênio (básicos + Base de Conhecimento) para o bloco
 * "Sobre o convênio" (só leitura) e para o "Preencher automaticamente".
 */

import { requirePermission } from '@/lib/auth/server'
import type { DadosConvenioLanding } from '@/lib/convenios-landing/preencher'
import { admin } from './supabase-admin'

type Linha = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const ativo = (r: Linha | null | undefined) => !!r && r.is_active !== false && !r.deleted_at
const porNome = (a: { nome: string }, b: { nome: string }) => a.nome.localeCompare(b.nome, 'pt-BR')
const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

export async function getDadosLanding(convenioId: string): Promise<{ success: boolean; dados?: DadosConvenioLanding; error?: string }> {
  try {
    await requirePermission('workspace-convenios')
    if (!convenioId) return { success: false, error: 'ID de convênio inválido.' }
    const [conv, publicos, formas, normas] = await Promise.all([
      admin
        .from('convenios')
        .select('nome, esfera, uf, cidade, razao_social, max_comprometimento_salarial, prazo_minimo_geral, prazo_maximo_geral')
        .eq('id', convenioId)
        .maybeSingle(),
      admin.from('convenio_publicos').select('publicos_atendidos(id, nome, is_active, deleted_at)').eq('convenio_id', convenioId),
      admin.from('convenio_formas_contrato').select('percentual_margem, formas_contrato(nome, is_active)').eq('convenio_id', convenioId),
      admin
        .from('convenio_documentos')
        .select('titulo, url')
        .eq('convenio_id', convenioId)
        .eq('tipo', 'decreto')
        .eq('is_active', true)
        .order('ordem')
        .order('created_at'),
    ])
    for (const r of [conv, publicos, formas, normas]) if (r.error) throw r.error
    const c = conv.data as Linha | null
    if (!c) return { success: false, error: 'Convênio não encontrado.' }

    return {
      success: true,
      dados: {
        nome: c.nome || '',
        esfera: c.esfera ? String(c.esfera).toLowerCase() : null,
        uf: c.uf || null,
        cidade: c.cidade || null,
        orgao: c.razao_social || null,
        teto_margem: num(c.max_comprometimento_salarial),
        prazo_min: num(c.prazo_minimo_geral),
        prazo_max: num(c.prazo_maximo_geral),
        publicos: ((publicos.data || []) as Linha[])
          .map((r) => r.publicos_atendidos)
          .filter(ativo)
          .map((p) => ({ id: p.id as string, nome: p.nome as string }))
          .sort(porNome),
        formas: ((formas.data || []) as Linha[])
          .filter((r) => ativo(r.formas_contrato))
          .map((r) => ({ nome: r.formas_contrato.nome as string, margem: num(r.percentual_margem) }))
          .sort(porNome),
        normas: ((normas.data || []) as Linha[]).map((d) => ({ titulo: d.titulo as string, url: (d.url as string | null) || null })),
      },
    }
  } catch (error) {
    console.error('Erro ao carregar dados do convênio para a landing:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Erro ao carregar os dados do convênio.' }
  }
}
