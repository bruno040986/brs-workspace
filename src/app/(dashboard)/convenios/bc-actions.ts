'use server'

/**
 * Convênio — Base de Conhecimento, Fase 1 (núcleo).
 * Spec: docs/SPEC-CONVENIO-BASE-CONHECIMENTO.md §2.1–2.8, §3, §7.1.
 * Permissão: workspace-convenios (mesma do cadastro básico de Convênios).
 *
 * Duas camadas de regra: aqui (TypeScript) valida com mensagem amigável
 * ANTES de gravar; a trigger no banco (convenio_bc_valida_*) é a rede de
 * segurança. Escrita por seção via RPC `convenio_bc_salvar_secao`
 * (substitui a seção inteira, nunca o convênio todo).
 */

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const RESOURCE = 'workspace-convenios'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
export type ConvenioBcGeral = {
  max_comprometimento_salarial: number | null
  prazo_minimo_geral: number | null
  prazo_maximo_geral: number | null
  bc_observacoes: string | null
}

export type ConvenioBcPublico = { publico_id: string; observacao?: string | null }

export type ConvenioBcForma = { forma_contrato_id: string; percentual_margem: number | null; observacao?: string | null }

export type ConvenioBcInstituicaoForma = {
  forma_contrato_id: string
  margem_considerada: number | null
  prazo_minimo: number | null
  prazo_maximo: number | null
  publicos_restritos: string[] | null
  observacao?: string | null
}

export type ConvenioBcInstituicao = {
  id?: string
  financial_institution_id: string
  canais_quitacao: string[]
  modo_orgaos: 'exceto' | 'somente'
  observacao?: string | null
  is_active: boolean
  publicos: string[]
  orgaos: string[]
  formas: ConvenioBcInstituicaoForma[]
}

export type ConvenioBc = {
  geral: ConvenioBcGeral
  publicos: ConvenioBcPublico[]
  formas: ConvenioBcForma[]
  instituicoes: ConvenioBcInstituicao[]
}

export type FormaContratoAtiva = { id: string; nome: string }
export type InstituicaoAtiva = { id: string; name: string; logo_url: string | null }

// ---------------------------------------------------------------------------
// Leitura consolidada
// ---------------------------------------------------------------------------
export async function getConvenioBc(convenioId: string): Promise<{ success: boolean; bc?: ConvenioBc; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    if (!convenioId) return { success: false, error: 'ID de convênio inválido.' }

    const [{ data: convenioRow, error: convenioErr }, { data: publicosRow }, { data: formasRow }, { data: instRows, error: instErr }] =
      await Promise.all([
        admin
          .from('convenios')
          .select('max_comprometimento_salarial, prazo_minimo_geral, prazo_maximo_geral, bc_observacoes')
          .eq('id', convenioId)
          .maybeSingle(),
        admin.from('convenio_publicos').select('publico_id, observacao').eq('convenio_id', convenioId),
        admin.from('convenio_formas_contrato').select('forma_contrato_id, percentual_margem, observacao').eq('convenio_id', convenioId),
        admin
          .from('convenio_instituicoes')
          .select(
            'id, financial_institution_id, canais_quitacao, modo_orgaos, observacao, is_active, ' +
              'publicos:convenio_instituicao_publicos(publico_id), ' +
              'orgaos:convenio_instituicao_orgaos(orgao_id), ' +
              'formas:convenio_instituicao_formas(forma_contrato_id, margem_considerada, prazo_minimo, prazo_maximo, publicos_restritos, observacao)',
          )
          .eq('convenio_id', convenioId),
      ])
    if (convenioErr) throw convenioErr
    if (instErr) throw instErr
    if (!convenioRow) return { success: false, error: 'Convênio não encontrado.' }

    const bc: ConvenioBc = {
      geral: {
        max_comprometimento_salarial: convenioRow.max_comprometimento_salarial,
        prazo_minimo_geral: convenioRow.prazo_minimo_geral,
        prazo_maximo_geral: convenioRow.prazo_maximo_geral,
        bc_observacoes: convenioRow.bc_observacoes,
      },
      publicos: (publicosRow || []) as ConvenioBcPublico[],
      formas: (formasRow || []) as ConvenioBcForma[],
      instituicoes: (instRows || []).map((r: any) => ({
        id: r.id,
        financial_institution_id: r.financial_institution_id,
        canais_quitacao: r.canais_quitacao || [],
        modo_orgaos: r.modo_orgaos,
        observacao: r.observacao,
        is_active: r.is_active,
        publicos: (r.publicos || []).map((p: any) => p.publico_id),
        orgaos: (r.orgaos || []).map((o: any) => o.orgao_id),
        formas: (r.formas || []).map((f: any) => ({
          forma_contrato_id: f.forma_contrato_id,
          margem_considerada: f.margem_considerada,
          prazo_minimo: f.prazo_minimo,
          prazo_maximo: f.prazo_maximo,
          publicos_restritos: f.publicos_restritos,
          observacao: f.observacao,
        })),
      })),
    }
    return { success: true, bc }
  } catch (error: any) {
    console.error('Erro ao buscar base de conhecimento do convênio:', error)
    return { success: false, error: error.message }
  }
}

// ---------------------------------------------------------------------------
// Listas de apoio (dropdowns/checklists)
// ---------------------------------------------------------------------------
export async function getFormasContratoAtivas(): Promise<FormaContratoAtiva[]> {
  try {
    await requirePermission(RESOURCE)
    const { data } = await admin.from('formas_contrato').select('id, nome').eq('is_active', true).order('nome')
    return (data || []) as FormaContratoAtiva[]
  } catch {
    return []
  }
}

export async function getInstituicoesAtivas(): Promise<InstituicaoAtiva[]> {
  try {
    await requirePermission(RESOURCE)
    const { data } = await admin
      .from('financial_institutions')
      .select('id, name, logo_url')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name')
    return (data || []) as InstituicaoAtiva[]
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Escrita — seção "geral" (teto/prazos/observações), direto na tabela pai
// ---------------------------------------------------------------------------
export async function salvarConvenioBcGeral(
  convenioId: string,
  geral: ConvenioBcGeral,
): Promise<{ success: boolean; error?: string; inconsistencias?: string[] }> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    if (!convenioId) return { success: false, error: 'ID de convênio inválido.' }

    const teto = geral.max_comprometimento_salarial
    const min = geral.prazo_minimo_geral
    const max = geral.prazo_maximo_geral

    if (teto != null && (teto <= 0 || teto > 100)) {
      return { success: false, error: 'O teto de comprometimento deve estar entre 0 e 100%.' }
    }
    if (min != null && max != null && min > max) {
      return { success: false, error: 'O prazo mínimo geral não pode ser maior que o máximo.' }
    }

    // Revalida os filhos (R1 se o teto vai diminuir; R5 se os prazos vão apertar)
    // antes de gravar — evita que o convênio fique com dados inconsistentes.
    const inconsistencias: string[] = []

    if (teto != null) {
      const { data: formasRow } = await admin.from('convenio_formas_contrato').select('percentual_margem').eq('convenio_id', convenioId)
      const soma = (formasRow || []).reduce((s, f: any) => s + (Number(f.percentual_margem) || 0), 0)
      if (soma > teto) {
        inconsistencias.push(
          `A soma das margens já destinadas nas Formas & Margens (${soma.toFixed(2)}%) passaria a exceder o novo teto (${teto}%). Ajuste as margens antes.`,
        )
      }
    }

    if (min != null || max != null) {
      const { data: instRows } = await admin
        .from('convenio_instituicoes')
        .select(
          'financial_institutions(name), convenio_instituicao_formas(prazo_minimo, prazo_maximo, formas_contrato(nome))',
        )
        .eq('convenio_id', convenioId)
      for (const inst of (instRows || []) as any[]) {
        const nomeIf = inst.financial_institutions?.name || 'instituição'
        for (const f of inst.convenio_instituicao_formas || []) {
          const nomeForma = f.formas_contrato?.nome || 'forma'
          if (min != null && f.prazo_minimo != null && f.prazo_minimo < min) {
            inconsistencias.push(`O prazo mínimo de "${nomeForma}" em ${nomeIf} (${f.prazo_minimo} meses) ficaria abaixo do novo prazo mínimo geral (${min} meses).`)
          }
          if (max != null && f.prazo_maximo != null && f.prazo_maximo > max) {
            inconsistencias.push(`O prazo máximo de "${nomeForma}" em ${nomeIf} (${f.prazo_maximo} meses) ficaria acima do novo prazo máximo geral (${max} meses).`)
          }
        }
      }
    }

    if (inconsistencias.length > 0) {
      return {
        success: false,
        error: 'Não foi possível salvar: os dados já cadastrados na aba Instituições ficariam inconsistentes.',
        inconsistencias,
      }
    }

    const { error } = await admin
      .from('convenios')
      .update({
        max_comprometimento_salarial: teto,
        prazo_minimo_geral: min,
        prazo_maximo_geral: max,
        bc_observacoes: String(geral.bc_observacoes || '').trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', convenioId)
    if (error) throw error

    revalidatePath(`/convenios/${convenioId}`)
    revalidatePath('/convenios')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar dados gerais da base de conhecimento:', error)
    return { success: false, error: error.message }
  }
}

// ---------------------------------------------------------------------------
// Escrita por seção — publicos | formas | instituicoes
// ---------------------------------------------------------------------------
export async function salvarConvenioBcSecao(
  convenioId: string,
  secao: 'publicos' | 'formas' | 'instituicoes',
  payload: ConvenioBcPublico[] | ConvenioBcForma[] | ConvenioBcInstituicao[],
): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    if (!convenioId) return { success: false, error: 'ID de convênio inválido.' }
    if (!Array.isArray(payload)) return { success: false, error: 'Payload inválido.' }

    if (secao === 'formas') {
      const formas = payload as ConvenioBcForma[]
      const { data: convenioRow } = await admin
        .from('convenios')
        .select('max_comprometimento_salarial')
        .eq('id', convenioId)
        .maybeSingle()
      const teto = convenioRow?.max_comprometimento_salarial
      const soma = formas.reduce((s, f) => s + (Number(f.percentual_margem) || 0), 0)
      if (teto != null && soma > teto) {
        return {
          success: false,
          error: `A soma das margens destinadas (${soma.toFixed(2)}%) excede o teto de comprometimento do convênio (${teto}%).`,
        }
      }
    }

    if (secao === 'instituicoes') {
      // "Restringir público" marcado sem nenhum público escolhido = não restringe
      // (NULL herda o público do vínculo). Evita gravar "restrito a ninguém".
      const instituicoes = (payload as ConvenioBcInstituicao[]).map((inst) => ({
        ...inst,
        formas: (inst.formas || []).map((f) => ({
          ...f,
          publicos_restritos: Array.isArray(f.publicos_restritos) && f.publicos_restritos.length > 0 ? f.publicos_restritos : null,
        })),
      }))
      payload = instituicoes
      const [{ data: convenioRow }, { data: publicosRow }, { data: formasRow }] = await Promise.all([
        admin.from('convenios').select('prazo_minimo_geral, prazo_maximo_geral').eq('id', convenioId).maybeSingle(),
        admin.from('convenio_publicos').select('publico_id').eq('convenio_id', convenioId),
        admin.from('convenio_formas_contrato').select('forma_contrato_id, percentual_margem').eq('convenio_id', convenioId),
      ])
      const publicosConvenio = new Set((publicosRow || []).map((p: any) => p.publico_id))
      const formasConvenio = new Map((formasRow || []).map((f: any) => [f.forma_contrato_id, f.percentual_margem]))
      const prazoMinGeral = convenioRow?.prazo_minimo_geral ?? null
      const prazoMaxGeral = convenioRow?.prazo_maximo_geral ?? null

      for (const inst of instituicoes) {
        const publicosVinculo = new Set(inst.publicos || [])
        // R2: público do vínculo ⊆ público elegível do convênio
        for (const p of publicosVinculo) {
          if (!publicosConvenio.has(p)) {
            return { success: false, error: 'Existe um público selecionado numa instituição que não está entre os públicos elegíveis do convênio.' }
          }
        }
        for (const f of inst.formas || []) {
          // R3: forma operada ∈ formas permitidas do convênio
          if (!formasConvenio.has(f.forma_contrato_id)) {
            return { success: false, error: 'Existe uma forma de contrato marcada numa instituição que não está entre as formas permitidas do convênio.' }
          }
          const tetoForma = formasConvenio.get(f.forma_contrato_id)
          // R4: margem considerada ≤ margem destinada pelo convênio
          if (f.margem_considerada != null && tetoForma != null && f.margem_considerada > tetoForma) {
            return {
              success: false,
              error: `A margem considerada (${f.margem_considerada}%) de uma forma excede a margem que o convênio destina a ela (${tetoForma}%).`,
            }
          }
          // R5: prazos dentro do intervalo geral
          if (prazoMinGeral != null && f.prazo_minimo != null && f.prazo_minimo < prazoMinGeral) {
            return { success: false, error: `Um prazo mínimo informado (${f.prazo_minimo} meses) é menor que o prazo mínimo geral do convênio (${prazoMinGeral} meses).` }
          }
          if (prazoMaxGeral != null && f.prazo_maximo != null && f.prazo_maximo > prazoMaxGeral) {
            return { success: false, error: `Um prazo máximo informado (${f.prazo_maximo} meses) é maior que o prazo máximo geral do convênio (${prazoMaxGeral} meses).` }
          }
          // R6: públicos restritos ⊆ público do vínculo (ou do convênio, se vínculo vazio)
          if (Array.isArray(f.publicos_restritos) && f.publicos_restritos.length > 0) {
            const base = publicosVinculo.size > 0 ? publicosVinculo : publicosConvenio
            for (const pr of f.publicos_restritos) {
              if (!base.has(pr)) {
                return { success: false, error: 'Existe um público restrito de uma forma que não está entre os públicos atendidos pela instituição (ou pelo convênio).' }
              }
            }
          }
        }
      }
    }

    const { error } = await admin.rpc('convenio_bc_salvar_secao', {
      p_convenio_id: convenioId,
      p_secao: secao,
      p_payload: payload,
    })
    if (error) throw error

    revalidatePath(`/convenios/${convenioId}`)
    revalidatePath('/convenios')
    return { success: true }
  } catch (error: any) {
    console.error(`Erro ao salvar seção "${secao}" da base de conhecimento:`, error)
    return { success: false, error: error.message }
  }
}
