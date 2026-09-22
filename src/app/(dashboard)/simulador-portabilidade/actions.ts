'use server'

import { createClient } from '@/lib/supabase/server'
import { DEFAULT_BANK_RULES, DEFAULT_GENERAL_RULES } from '@/lib/portability/evaluator'
import { ConfiguracoesGeraisPortabilidade, RegraBancoPortabilidade } from '@/lib/portability/types'

export async function getPortabilidadeData() {
  try {
    const supabase = await createClient()

    // 1. Buscar convênios cadastrados
    const { data: conveniosData } = await supabase
      .from('convenios')
      .select('id, nome, codigo')
      .order('nome')

    // 2. Buscar instituições financeiras cadastradas
    const { data: instituicoesData } = await supabase
      .from('financial_institutions')
      .select('id, name, logo_url, is_active')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name')

    // 3. Buscar regras personalizadas se a tabela existir
    const { data: regrasCustom } = await supabase
      .from('regras_portabilidade')
      .select('*')
      .eq('ativo', true)

    let rules: RegraBancoPortabilidade[] = DEFAULT_BANK_RULES

    if (regrasCustom && regrasCustom.length > 0) {
      rules = DEFAULT_BANK_RULES.map((defRule) => {
        const custom = regrasCustom.find((r: any) => r.banco_id === defRule.id)
        if (!custom) return defRule
        return {
          ...defRule,
          enabled: custom.enabled ?? defRule.enabled,
          portCoeff: custom.port_coeff ?? defRule.portCoeff,
          ageMin: custom.age_min ?? defRule.ageMin,
          ageMaxYears: custom.age_max_years ?? defRule.ageMaxYears,
          minInstallment: custom.min_installment ?? defRule.minInstallment,
          minDebt: custom.min_debt ?? defRule.minDebt,
          minRelease: custom.min_release ?? defRule.minRelease,
          notes: custom.notes ?? defRule.notes,
        }
      })
    }

    return {
      success: true,
      convenios: conveniosData && conveniosData.length > 0 ? conveniosData : [
        { id: 'inss', nome: 'INSS', codigo: 'INSS' },
        { id: 'siape', nome: 'SIAPE', codigo: 'SIAPE' },
      ],
      financialInstitutions: instituicoesData || [],
      rules,
      generalConfig: DEFAULT_GENERAL_RULES,
    }
  } catch (error: any) {
    console.error('Erro ao carregar dados da portabilidade:', error)
    return {
      success: true,
      convenios: [
        { id: 'inss', nome: 'INSS', codigo: 'INSS' },
        { id: 'siape', nome: 'SIAPE', codigo: 'SIAPE' },
      ],
      financialInstitutions: [],
      rules: DEFAULT_BANK_RULES,
      generalConfig: DEFAULT_GENERAL_RULES,
    }
  }
}

export async function saveRegraPortabilidade(bancoId: string, payload: Partial<RegraBancoPortabilidade>) {
  try {
    const supabase = await createClient()

    const { error } = await supabase.from('regras_portabilidade').upsert(
      {
        banco_id: bancoId,
        enabled: payload.enabled,
        port_coeff: payload.portCoeff,
        age_min: payload.ageMin,
        age_max_years: payload.ageMaxYears,
        min_installment: payload.minInstallment,
        min_debt: payload.minDebt,
        min_release: payload.minRelease,
        notes: payload.notes,
        ativo: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'banco_id' }
    )

    if (error) throw error
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error?.message || 'Erro ao salvar regra.' }
  }
}
