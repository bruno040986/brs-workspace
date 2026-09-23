'use server'

import { createClient } from '@/lib/supabase/server'
import { DEFAULT_BANK_RULES, DEFAULT_GENERAL_RULES, DEFAULT_PORT_COEFF } from '@/lib/portability/evaluator'
import { RegraBancoPortabilidade } from '@/lib/portability/types'
import { revalidatePath } from 'next/cache'

// Padrões de bancos que existem no HTML
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

function matchesHtmlBank(name: string): boolean {
  if (!name) return false
  const upper = name.toUpperCase()
  return HTML_BANK_PATTERNS.some((pat) => upper.includes(pat))
}

export async function getPortabilidadeData() {
  try {
    const supabase = await createClient()

    // 1. Buscar TODAS as IFs ativas no Workspace (Sem restrição de exibição no dropdown)
    const { data: instituicoesData } = await supabase
      .from('financial_institutions')
      .select('id, name, logo_url, logo_wide_url, is_active')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name')

    const allWorkspaceIFs = instituicoesData || []

    // 2. Buscar convênios cadastrados
    const { data: conveniosData } = await supabase
      .from('convenios')
      .select('id, nome, codigo')
      .order('nome')

    // 3. Buscar regras salvas na tabela `regras_portabilidade_ifs`
    const { data: regrasDb } = await supabase
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

    // 5. Montar lista de regras cadastradas + pré-cadastradas de fábrica (INSS)
    const rulesMap = new Map<string, RegraBancoPortabilidade>()

    // A) Primeiro carregar as regras efetivamente salvas no banco
    if (regrasDb && regrasDb.length > 0) {
      regrasDb.forEach((dbRule: any) => {
        const inst = allWorkspaceIFs.find((i) => i.id === dbRule.institution_id)
        const name = inst ? inst.name : 'Instituição Financeira'
        const logoUrl = inst ? inst.logo_url || inst.logo_wide_url || null : null

        const ruleObj: RegraBancoPortabilidade = {
          id: dbRule.id,
          name,
          logoUrl,
          institutionId: dbRule.institution_id,
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
        }

        rulesMap.set(`${dbRule.institution_id}::${dbRule.convenio_codigo || 'INSS'}`, ruleObj)
      })
    }

    // B) Para IFs que existem no HTML E no Workspace, garantir que venham pré-cadastradas para o convênio INSS se ainda não houver regra salva
    allWorkspaceIFs.forEach((inst) => {
      if (!matchesHtmlBank(inst.name)) return

      const key = `${inst.id}::INSS`
      if (!rulesMap.has(key)) {
        // Encontrar modelo correspondente no HTML
        const defMatch = DEFAULT_BANK_RULES.find(
          (d) => d.name.toLowerCase().includes(inst.name.toLowerCase()) || inst.name.toLowerCase().includes(d.name.toLowerCase())
        )

        const seededRule: RegraBancoPortabilidade = {
          id: `seed-${inst.id}-INSS`,
          name: inst.name,
          logoUrl: inst.logo_url || inst.logo_wide_url || null,
          institutionId: inst.id,
          convenioCodigo: 'INSS',
          enabled: true,
          coeficienteNovoMedio: inst.name.toUpperCase().includes('FACTA') ? 0.023896 : inst.name.toUpperCase().includes('BMG') ? 0.02245 : null,
          portCoeff: defMatch ? defMatch.portCoeff : null,
          blockLoas: defMatch ? defMatch.blockLoas : false,
          loasSpecies: defMatch ? defMatch.loasSpecies : '87,88',
          loasReason: defMatch ? defMatch.loasReason : 'Não porta LOAS',
          blockRepresentative: defMatch ? defMatch.blockRepresentative : false,
          representativeReason: defMatch ? defMatch.representativeReason : 'Não faz representante',
          entry: defMatch ? defMatch.entry : null,
          refiMin: defMatch ? defMatch.refiMin : null,
          refiMax: defMatch ? defMatch.refiMax : null,
          ageMin: defMatch ? defMatch.ageMin : null,
          ageMaxYears: defMatch ? defMatch.ageMaxYears : null,
          ageMaxMonths: defMatch ? defMatch.ageMaxMonths : null,
          endAgeYears: defMatch ? defMatch.endAgeYears : null,
          endAgeMonths: defMatch ? defMatch.endAgeMonths : null,
          minInstallment: defMatch ? defMatch.minInstallment : null,
          minDebt: defMatch ? defMatch.minDebt : null,
          minFinanced: defMatch ? defMatch.minFinanced : null,
          minRelease: defMatch ? defMatch.minRelease : null,
          minReleaseMode: defMatch ? defMatch.minReleaseMode : 'fixed',
          minReleasePercent: defMatch ? defMatch.minReleasePercent : null,
          blocked: defMatch ? defMatch.blocked : [],
          paid: defMatch ? defMatch.paid : {},
          defaultPaid: defMatch ? defMatch.defaultPaid : null,
          networkPaid: defMatch ? defMatch.networkPaid : null,
          special: defMatch ? defMatch.special : [],
          under12: defMatch ? defMatch.under12 : [],
          term: defMatch ? defMatch.term : 108,
          notes: defMatch ? defMatch.notes : '',
        }

        rulesMap.set(key, seededRule)
      }
    })

    const finalRules = Array.from(rulesMap.values())

    // Identificar códigos de convênios ativos
    const activeConvenioCodes = new Set(finalRules.map((r) => r.convenioCodigo || 'INSS'))
    const filteredConvenios = (conveniosData && conveniosData.length > 0 ? conveniosData : [
      { id: 'inss', nome: 'INSS', codigo: 'INSS' },
      { id: 'siape', nome: 'SIAPE', codigo: 'SIAPE' },
    ]).filter((c) => activeConvenioCodes.size === 0 || activeConvenioCodes.has(c.codigo?.toUpperCase() || c.nome?.toUpperCase()))

    const finalConvenios = filteredConvenios.length > 0 ? filteredConvenios : [{ id: 'inss', nome: 'INSS', codigo: 'INSS' }]

    return {
      success: true,
      convenios: finalConvenios,
      financialInstitutions: allWorkspaceIFs, // TODAS as IFs do Workspace ficam disponíveis no dropdown de cadastro
      rules: finalRules,
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

    const convenioCodigo = payload.convenioCodigo || 'INSS'

    // Validação de Duplicidade: Verificar se já existe uma regra salva para esta IF e Convênio
    const { data: existing } = await supabase
      .from('regras_portabilidade_ifs')
      .select('id')
      .eq('institution_id', payload.institutionId)
      .eq('convenio_codigo', convenioCodigo)
      .maybeSingle()

    // Se existe uma regra diferente da que está sendo editada (UUID real vs seed)
    if (existing && payload.id && payload.id !== existing.id && !payload.id.startsWith('seed-')) {
      return { success: false, error: 'Já existe uma regra cadastrada para esta Instituição Financeira e Convênio. Edite a regra existente na lista.' }
    }

    const dbRow = {
      institution_id: payload.institutionId,
      convenio_codigo: convenioCodigo,
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

    // Se for uma regra temporária de semente (seed-...), apenas limpa da tela sem erro
    if (!id.startsWith('seed-')) {
      const { error } = await supabase.from('regras_portabilidade_ifs').delete().eq('id', id)
      if (error) throw error
    }

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

export async function parsePdfExtratoAction(formData: FormData) {
  try {
    const file = formData.get('file') as File | null
    if (!file) {
      return { success: false, error: 'Nenhum arquivo PDF selecionado.' }
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const mime = file.type || 'application/pdf'

    const { extrairTexto } = await import('@/lib/convenios/pesquisa/extrair-texto')
    const { parseClient, parseLoans } = await import('@/lib/portability/parser')

    const { texto } = await extrairTexto(bytes, mime)
    if (!texto || texto.trim().length === 0) {
      return { success: false, error: 'Não foi possível extrair texto legível do PDF enviado.' }
    }

    const convenioInput = (formData.get('convenio') as any) || 'INSS'
    const client = parseClient(texto, convenioInput)
    const loans = parseLoans(texto)

    return {
      success: true,
      rawText: texto,
      client,
      loans,
    }
  } catch (error: any) {
    console.error('Erro ao ler PDF do extrato:', error)
    return { success: false, error: error?.message || 'Falha ao processar arquivo PDF.' }
  }
}

