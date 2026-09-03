'use server'

/**
 * Folha — Etapa 1: configuração que o Quark não fornece.
 * Faixas INSS/IR (versionadas por vigência) + parâmetros por competência
 * mensal (aba DADOS da planilha). Permissão: `rh-folha`.
 */
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'

const RESOURCE = 'rh-folha'

export type InssFaixa = { id?: string; ordem: number; limite_ate: number; aliquota: number }
export type IrrfFaixa = { id?: string; ordem: number; base_ate: number; aliquota: number; parcela_deduzir: number }
export type ParametroCompetencia = {
  id?: string
  competencia: string
  dias_calculo_salario: number
  dias_uteis_mes: number
  dias_beneficios: number
  taxa_va_vr: number
  taxa_vt: number
  taxa_vc: number
  taxa_pds: number
  taxa_adm: number
  data_venc_salario: string | null
  data_comp_salario: string | null
  data_venc_fgts: string | null
  observacao: string
}

// ---------- Faixas INSS/IR (por vigência) ----------

export async function getFaixasVigentes(vigencia?: string): Promise<{
  success: boolean
  vigencias?: string[]
  vigenciaAtual?: string
  inss?: InssFaixa[]
  irrf?: IrrfFaixa[]
  irrfParam?: { deducao_por_dependente: number; desconto_simplificado: number }
  error?: string
}> {
  try {
    await requirePermission(RESOURCE)
    const admin = await createAdminClient()
    const [{ data: vigInss }, { data: vigIrrf }] = await Promise.all([
      admin.from('folha_inss_faixas').select('vigencia_inicio'),
      admin.from('folha_irrf_faixas').select('vigencia_inicio'),
    ])
    const vigencias = [...new Set([...(vigInss || []), ...(vigIrrf || [])].map((r: any) => String(r.vigencia_inicio)))].sort().reverse()
    const alvo = vigencia || vigencias[0] || ''

    let inss: InssFaixa[] = []
    let irrf: IrrfFaixa[] = []
    let irrfParam = { deducao_por_dependente: 0, desconto_simplificado: 0 }
    if (alvo) {
      const [{ data: fi }, { data: fr }, { data: pr }] = await Promise.all([
        admin.from('folha_inss_faixas').select('*').eq('vigencia_inicio', alvo).order('ordem'),
        admin.from('folha_irrf_faixas').select('*').eq('vigencia_inicio', alvo).order('ordem'),
        admin.from('folha_irrf_parametros').select('*').eq('vigencia_inicio', alvo).maybeSingle(),
      ])
      inss = (fi || []).map((r: any) => ({ id: r.id, ordem: r.ordem, limite_ate: Number(r.limite_ate), aliquota: Number(r.aliquota) }))
      irrf = (fr || []).map((r: any) => ({ id: r.id, ordem: r.ordem, base_ate: Number(r.base_ate), aliquota: Number(r.aliquota), parcela_deduzir: Number(r.parcela_deduzir) }))
      if (pr) irrfParam = { deducao_por_dependente: Number(pr.deducao_por_dependente), desconto_simplificado: Number(pr.desconto_simplificado) }
    }
    return { success: true, vigencias, vigenciaAtual: alvo, inss, irrf, irrfParam }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function salvarFaixas(input: {
  vigencia_inicio: string
  inss: InssFaixa[]
  irrf: IrrfFaixa[]
  deducao_por_dependente: number
  desconto_simplificado: number
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    if (!input.vigencia_inicio) throw new Error('Informe a data de vigência.')
    const admin = await createAdminClient()

    // substitui as faixas dessa vigência (replace-all)
    await admin.from('folha_inss_faixas').delete().eq('vigencia_inicio', input.vigencia_inicio)
    await admin.from('folha_irrf_faixas').delete().eq('vigencia_inicio', input.vigencia_inicio)

    if (input.inss.length) {
      const { error } = await admin.from('folha_inss_faixas').insert(
        input.inss.map((f, i) => ({ vigencia_inicio: input.vigencia_inicio, ordem: i + 1, limite_ate: f.limite_ate, aliquota: f.aliquota })),
      )
      if (error) throw error
    }
    if (input.irrf.length) {
      const { error } = await admin.from('folha_irrf_faixas').insert(
        input.irrf.map((f, i) => ({ vigencia_inicio: input.vigencia_inicio, ordem: i + 1, base_ate: f.base_ate, aliquota: f.aliquota, parcela_deduzir: f.parcela_deduzir })),
      )
      if (error) throw error
    }
    await admin.from('folha_irrf_parametros').upsert(
      { vigencia_inicio: input.vigencia_inicio, deducao_por_dependente: input.deducao_por_dependente, desconto_simplificado: input.desconto_simplificado },
      { onConflict: 'vigencia_inicio' },
    )
    revalidatePath('/rh/folha/configuracoes')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ---------- Parâmetros por competência ----------

export async function listarParametros(): Promise<{ success: boolean; data?: ParametroCompetencia[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const admin = await createAdminClient()
    const { data, error } = await admin.from('folha_parametros_competencia').select('*').order('competencia', { ascending: false }).limit(36)
    if (error) throw error
    return { success: true, data: (data || []) as ParametroCompetencia[] }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function salvarParametros(input: ParametroCompetencia): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    if (!/^\d{4}-\d{2}$/.test(input.competencia)) throw new Error('Competência inválida (use AAAA-MM).')
    const admin = await createAdminClient()
    const { error } = await admin.from('folha_parametros_competencia').upsert(
      {
        competencia: input.competencia,
        dias_calculo_salario: input.dias_calculo_salario,
        dias_uteis_mes: input.dias_uteis_mes,
        dias_beneficios: input.dias_beneficios,
        taxa_va_vr: input.taxa_va_vr,
        taxa_vt: input.taxa_vt,
        taxa_vc: input.taxa_vc,
        taxa_pds: input.taxa_pds,
        taxa_adm: input.taxa_adm,
        data_venc_salario: input.data_venc_salario || null,
        data_comp_salario: input.data_comp_salario || null,
        data_venc_fgts: input.data_venc_fgts || null,
        observacao: input.observacao || '',
        created_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'competencia' },
    )
    if (error) throw error
    revalidatePath('/rh/folha/configuracoes')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
