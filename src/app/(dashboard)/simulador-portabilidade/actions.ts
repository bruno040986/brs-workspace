'use server'

import { createClient } from '@/lib/supabase/server'
import { DEFAULT_BANK_RULES, DEFAULT_GENERAL_RULES, DEFAULT_PORT_COEFF } from '@/lib/portability/evaluator'
import { ConfiguracoesGeraisPortabilidade, RegraBancoPortabilidade } from '@/lib/portability/types'
import { revalidatePath } from 'next/cache'

export async function getPortabilidadeData() {
  try {
    const supabase = await createClient()

    // 1. Buscar instituições financeiras ativas cadastradas no Workspace
    const { data: instituicoesData } = await supabase
      .from('financial_institutions')
      .select('id, name, logo_url, logo_wide_url, is_active')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name')

    const registeredIFs = instituicoesData || []

    // 2. Buscar convênios cadastrados
    const { data: conveniosData } = await supabase
      .from('convenios')
      .select('id, nome, codigo')
      .order('nome')

    // 3. Buscar regras salvas no Supabase (se a tabela regras_portabilidade_ifs existir)
    const { data: regrasDb, error: regrasError } = await supabase
      .from('regras_portabilidade_ifs')
      .select('*')
      .eq('enabled', true)

    // 4. Buscar coeficiente global
    const { data: globalDb } = await supabase
      .from('regras_portabilidade_globais')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const defaultPortCoeff = globalDb?.default_port_coeff ?? DEFAULT_PORT_COEFF

    // Construir lista de regras APENAS para IFs cadastradas no Workspace
    let rules: RegraBancoPortabilidade[] = []

    if (registeredIFs.length > 0) {
      rules = registeredIFs.map((inst) => {
        // Tentar mapear regra customizada salva para essa IF
        const dbRule = regrasDb?.find((r: any) => r.institution_id === inst.id)

        // Procurar semente por nome aproximado se não houver regra no banco
        const defMatch = DEFAULT_BANK_RULES.find(
          (d) => d.name.toLowerCase().includes(inst.name.toLowerCase()) || inst.name.toLowerCase().includes(d.name.toLowerCase())
        )

        return {
          id: inst.id,
          name: inst.name, // Nome Comercial do cadastro
          logoUrl: inst.logo_url || inst.logo_wide_url || null,
          institutionId: inst.id,
          convenioCodigo: dbRule?.convenio_codigo || 'INSS',
          enabled: dbRule?.enabled ?? (defMatch ? defMatch.enabled : true),
          coeficienteNovoMedio: dbRule?.coeficiente_novo_medio ?? (inst.name.toUpperCase().includes('FACTA') ? 0.023896 : inst.name.toUpperCase().includes('BMG') ? 0.02245 : null),
          portCoeff: dbRule?.port_coeff ?? (defMatch ? defMatch.portCoeff : null),
          blockLoas: dbRule?.block_loas ?? (defMatch ? defMatch.blockLoas : false),
          loasSpecies: dbRule?.loas_species ?? (defMatch ? defMatch.loasSpecies : '87,88'),
          loasReason: dbRule?.loas_reason ?? (defMatch ? defMatch.loasReason : 'Não porta LOAS'),
          blockRepresentative: dbRule?.block_representative ?? (defMatch ? defMatch.blockRepresentative : false),
          representativeReason: dbRule?.representative_reason ?? (defMatch ? defMatch.representativeReason : 'Não faz representante'),
          entry: dbRule?.entry ?? (defMatch ? defMatch.entry : null),
          refiMin: dbRule?.refi_min ?? (defMatch ? defMatch.refiMin : null),
          refiMax: dbRule?.refi_max ?? (defMatch ? defMatch.refiMax : null),
          ageMin: dbRule?.age_min ?? (defMatch ? defMatch.ageMin : null),
          ageMaxYears: dbRule?.age_max_years ?? (defMatch ? defMatch.ageMaxYears : null),
          ageMaxMonths: dbRule?.age_max_months ?? (defMatch ? defMatch.ageMaxMonths : null),
          endAgeYears: dbRule?.end_age_years ?? (defMatch ? defMatch.endAgeYears : null),
          endAgeMonths: dbRule?.end_age_months ?? (defMatch ? defMatch.endAgeMonths : null),
          minInstallment: dbRule?.min_installment ?? (defMatch ? defMatch.minInstallment : null),
          minDebt: dbRule?.min_debt ?? (defMatch ? defMatch.minDebt : null),
          minFinanced: dbRule?.min_financed ?? (defMatch ? defMatch.minFinanced : null),
          minRelease: dbRule?.min_release ?? (defMatch ? defMatch.minRelease : null),
          minReleaseMode: dbRule?.min_release_mode ?? (defMatch ? defMatch.minReleaseMode : 'fixed'),
          minReleasePercent: dbRule?.min_release_percent ?? (defMatch ? defMatch.minReleasePercent : null),
          blocked: dbRule?.blocked ?? (defMatch ? defMatch.blocked : []),
          paid: dbRule?.paid ?? (defMatch ? defMatch.paid : {}),
          defaultPaid: dbRule?.default_paid ?? (defMatch ? defMatch.defaultPaid : null),
          networkPaid: dbRule?.network_paid ?? (defMatch ? defMatch.networkPaid : null),
          special: dbRule?.special ?? (defMatch ? defMatch.special : []),
          under12: dbRule?.under12 ?? (defMatch ? defMatch.under12 : []),
          term: dbRule?.term ?? (defMatch ? defMatch.term : 108),
          notes: dbRule?.notes ?? (defMatch ? defMatch.notes : ''),
        }
      })
    }

    // Identificar os códigos dos convênios que possuem IFs ativas configuradas
    const activeConvenioCodes = new Set(rules.map((r) => r.convenioCodigo || 'INSS'))

    // Filtrar a lista de convênios para exibir no seletor apenas os convênios que possuem IFs vinculadas
    const filteredConvenios = (conveniosData && conveniosData.length > 0 ? conveniosData : [
      { id: 'inss', nome: 'INSS', codigo: 'INSS' },
      { id: 'siape', nome: 'SIAPE', codigo: 'SIAPE' },
    ]).filter((c) => activeConvenioCodes.has(c.codigo?.toUpperCase() || c.nome?.toUpperCase()))

    // Garantir que pelo menos INSS apareça se a lista filtrada estivesse vazia
    const finalConvenios = filteredConvenios.length > 0 ? filteredConvenios : [{ id: 'inss', nome: 'INSS', codigo: 'INSS' }]

    return {
      success: true,
      convenios: finalConvenios,
      financialInstitutions: registeredIFs,
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
