'use server'

import { createClient } from '@/lib/supabase/server'
import { DEFAULT_BANK_RULES, DEFAULT_GENERAL_RULES, DEFAULT_PORT_COEFF } from '@/lib/portability/evaluator'
import { RegraBancoPortabilidade } from '@/lib/portability/types'
import { revalidatePath } from 'next/cache'

// Lista de padrões de nome de bancos que existem no HTML
const HTML_BANK_PATTERNS = [
  'FACTA',
  'BMG',
  'DAYCOVAL',
  'C6',
  'BRB',
  'ICRED',
  'DIGIO',
  'PARANA',
  'PARANÁ',
  'QUALI',
  'QUERO',
  'SAFRA',
  'PAN',
  'FINANTO',
  'BRASIL',
  'BANCO DO BRASIL',
  'BEM',
  'PLAY',
  'DIGA',
  'HAPPY',
]

export function isIfInHtml(name: string): boolean {
  if (!name) return false
  const upper = name.toUpperCase()
  return HTML_BANK_PATTERNS.some((pat) => upper.includes(pat))
}

export async function getPortabilidadeData() {
  try {
    const supabase = await createClient()

    // 1. Buscar todas as IFs ativas no Workspace
    const { data: instituicoesData } = await supabase
      .from('financial_institutions')
      .select('id, name, logo_url, logo_wide_url, is_active')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name')

    // 2. Interseção Estrita: Apenas IFs que existem no Workspace E que correspondem ao HTML
    const elegibleIFs = (instituicoesData || []).filter((inst) => isIfInHtml(inst.name))

    // 3. Buscar convênios cadastrados
    const { data: conveniosData } = await supabase
      .from('convenios')
      .select('id, nome, codigo')
      .order('nome')

    // 4. Buscar regras efetivamente salvas no Supabase (tabela regras_portabilidade_ifs)
    const { data: regrasDb } = await supabase
      .from('regras_portabilidade_ifs')
      .select('*')
      .eq('enabled', true)

    // 5. Buscar coeficiente global
    const { data: globalDb } = await supabase
      .from('regras_portabilidade_globais')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const defaultPortCoeff = globalDb?.default_port_coeff ?? DEFAULT_PORT_COEFF

    // Construir lista APENAS com as regras salvas ou inicializadas para IFs elegíveis
    let rules: RegraBancoPortabilidade[] = []

    if (regrasDb && regrasDb.length > 0) {
      rules = regrasDb
        .map((dbRule: any) => {
          const inst = elegibleIFs.find((i) => i.id === dbRule.institution_id)
          if (!inst) return null // Se a IF não for elegível (interseção), não exibe

          return {
            id: dbRule.id,
            name: inst.name,
            logoUrl: inst.logo_url || inst.logo_wide_url || null,
            institutionId: inst.id,
            convenioCodigo: dbRule.convenio_codigo || 'INSS',
            enabled: dbRule.enabled !== false,
            coeficienteNovoMedio: dbRule.coeficiente_novo_medio ?? null,
            portCoeff: dbRule.port_coeff ?? null,
            blockLoas: dbRule.block_loas ?? false,
            loasSpecies: dbRule.loas_species || '87,88',
            loasReason: dbRule.loas_reason || 'Não porta LOAS',
            blockRepresentative: dbRule.block_representative ?? false,
            representativeReason: dbRule.representative_reason || 'Não faz representante',
            entry: dbRule.entry ?? null,
            refiMin: dbRule.refi_min ?? null,
            refiMax: dbRule.refi_max ?? null,
            ageMin: dbRule.age_min ?? null,
            ageMaxYears: dbRule.age_max_years ?? null,
            ageMaxMonths: dbRule.age_max_months ?? null,
            endAgeYears: dbRule.end_age_years ?? null,
            endAgeMonths: dbRule.end_age_months ?? null,
            minInstallment: dbRule.min_installment ?? null,
            minDebt: dbRule.min_debt ?? null,
            minFinanced: dbRule.min_financed ?? null,
            minRelease: dbRule.min_release ?? null,
            minReleaseMode: dbRule.min_release_mode || 'fixed',
            minReleasePercent: dbRule.min_release_percent ?? null,
            blocked: dbRule.blocked || [],
            paid: dbRule.paid || {},
            defaultPaid: dbRule.default_paid ?? null,
            networkPaid: dbRule.network_paid ?? null,
            special: dbRule.special || [],
            under12: dbRule.under12 || [],
            term: dbRule.term || 108,
            notes: dbRule.notes || '',
          } as RegraBancoPortabilidade
        })
        .filter(Boolean) as RegraBancoPortabilidade[]
    }

    // Filtrar a lista de convênios para exibir no seletor apenas os convênios com regras cadastradas
    const activeConvenioCodes = new Set(rules.map((r) => r.convenioCodigo || 'INSS'))
    const filteredConvenios = (conveniosData && conveniosData.length > 0 ? conveniosData : [
      { id: 'inss', nome: 'INSS', codigo: 'INSS' },
      { id: 'siape', nome: 'SIAPE', codigo: 'SIAPE' },
    ]).filter((c) => activeConvenioCodes.size === 0 || activeConvenioCodes.has(c.codigo?.toUpperCase() || c.nome?.toUpperCase()))

    const finalConvenios = filteredConvenios.length > 0 ? filteredConvenios : [{ id: 'inss', nome: 'INSS', codigo: 'INSS' }]

    return {
      success: true,
      convenios: finalConvenios,
      financialInstitutions: elegibleIFs, // Retorna APENAS a interseção
      rules,
      generalConfig: {
        ...DEFAULT_GENERAL_RULES,
        defaultPortCoeff,
      },
    }
  } catch (error: any) {
    console.error('Erro ao carregar dados da portabilidade:', error)
    return {
      success: true,
      convenios: [{ id: 'inss', nome: 'INSS', codigo: 'INSS' }],
      financialInstitutions: [],
      rules: [],
      generalConfig: DEFAULT_GENERAL_RULES,
    }
  }
}

export async function saveRegraIfPortabilidade(payload: Partial<RegraBancoPortabilidade>) {
  try {
    const supabase = await createClient()

    if (!payload.institutionId) {
      return { success: false, error: 'Instituição Financeira não informada.' }
    }

    const dbRow = {
      institution_id: payload.institutionId,
      convenio_codigo: payload.convenioCodigo || 'INSS',
      enabled: payload.enabled !== false,
      coeficiente_novo_medio: payload.coeficienteNovoMedio ?? null,
      port_coeff: payload.portCoeff ?? null,
      block_loas: payload.blockLoas ?? false,
      loas_species: payload.loasSpecies || '87,88',
      loas_reason: payload.loasReason || 'Não porta LOAS',
      block_representative: payload.blockRepresentative ?? false,
      representative_reason: payload.representativeReason || 'Não faz representante',
      entry: payload.entry ?? null,
      refi_min: payload.refiMin ?? null,
      refi_max: payload.refiMax ?? null,
      age_min: payload.ageMin ?? null,
      age_max_years: payload.ageMaxYears ?? null,
      age_max_months: payload.ageMaxMonths ?? null,
      end_age_years: payload.endAgeYears ?? null,
      end_age_months: payload.endAgeMonths ?? null,
      term: payload.term || 108,
      min_installment: payload.minInstallment ?? null,
      min_debt: payload.minDebt ?? null,
      min_financed: payload.minFinanced ?? null,
      min_release: payload.minRelease ?? null,
      min_release_mode: payload.minReleaseMode || 'fixed',
      min_release_percent: payload.minReleasePercent ?? null,
      default_paid: payload.defaultPaid ?? null,
      network_paid: payload.networkPaid ?? null,
      blocked: payload.blocked || [],
      paid: payload.paid || {},
      special: payload.special || [],
      under12: payload.under12 || [],
      notes: payload.notes || '',
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('regras_portabilidade_ifs').upsert(dbRow, { onConflict: 'institution_id,convenio_codigo' })

    if (error) throw error

    revalidatePath('/simulador-portabilidade')
    revalidatePath('/simulador-portabilidade/regras-ifs')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar regra por IF:', error)
    return { success: false, error: error?.message || 'Erro ao salvar regra.' }
  }
}

export async function deleteRegraIfPortabilidade(id: string) {
  try {
    const supabase = await createClient()

    const { error } = await supabase.from('regras_portabilidade_ifs').delete().eq('id', id)

    if (error) throw error

    revalidatePath('/simulador-portabilidade')
    revalidatePath('/simulador-portabilidade/regras-ifs')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao excluir regra:', error)
    return { success: false, error: error?.message || 'Erro ao excluir regra.' }
  }
}

export async function saveCoeficienteGlobalPortabilidade(defaultPortCoeff: number) {
  try {
    const supabase = await createClient()

    const { error } = await supabase.from('regras_portabilidade_globais').insert({
      default_port_coeff: defaultPortCoeff,
      updated_at: new Date().toISOString(),
    })

    if (error) throw error

    revalidatePath('/simulador-portabilidade')
    revalidatePath('/simulador-portabilidade/coeficiente-global')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar coeficiente global:', error)
    return { success: false, error: error?.message || 'Erro ao salvar coeficiente global.' }
  }
}
