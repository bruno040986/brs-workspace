'use server'

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import {
  normalizeInstituicaoFinanceiraRecord,
  vinculoHabilitaCamposFinanceiros,
  vinculoHabilitaPromotora,
  type InstituicaoFinanceiraRecord,
} from '@/lib/financial-institutions'
import { impostoComissaoDaInstituicao } from '@/lib/comissao-liquida'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
)

const PERMISSION_RESOURCE = 'sistema-config-instituicoes'

export type InstituicaoLookupPayload = {
  companies: Array<{
    id: string
    nickname: string
    display_name: string
    cnpj: string | null
    is_active: boolean
    company_data?: any
  }>
  commercialTypes: Array<{ id: string; name: string; is_active: boolean }>
  sectors: Array<{ id: string; name: string; is_active: boolean }>
  nfseEmissionTypes: Array<{ id: string; name: string; is_active: boolean }>
  remunerationTypes: Array<{ id: string; name: string; is_active: boolean }>
  receiptMethods: Array<{ id: string; name: string; is_active: boolean }>
  systemTypes: Array<{ id: string; name: string; is_active: boolean }>
  promotoras: Array<{ id: string; name: string; logo_url: string; is_active: boolean }>
}

async function safeLookup<T>(query: PromiseLike<{ data: T | null; error: any }>) {
  try {
    const res = await query
    return { data: res.data || null, error: res.error || null }
  } catch (error: any) {
    return { data: null, error }
  }
}

function validateFinancialConfigurations(payload: InstituicaoFinanceiraRecord) {
  const configurations = Array.isArray(payload.financial_data?.configurations)
    ? payload.financial_data.configurations
    : []

  const seen = new Set<string>()
  configurations.forEach((config, index) => {
    const remunerationTypeId = String(config.remuneration_type_id || '').trim()
    const vinculo = config.vinculo_tipo

    if (!remunerationTypeId) {
      throw new Error(`Informe o Tipo de Remuneração na Configuração Financeira ${index + 1}.`)
    }
    if (!vinculo) {
      throw new Error(`Informe o Tipo de Vínculo na Configuração Financeira ${index + 1}.`)
    }
    if (vinculoHabilitaPromotora(vinculo) && !String(config.promotora_id || '').trim()) {
      throw new Error(`Selecione a Promotora na Configuração Financeira ${index + 1} (obrigatória para vínculo subestabelecido).`)
    }
    if (!vinculoHabilitaCamposFinanceiros(vinculo)) {
      // Subestabelecido Zero: campos financeiros ficam na Promotora
      config.prazo_repasse_enabled = false
      config.prazo_repasse_para_agente = ''
      config.conta_bancaria_index = ''
      config.forma_recebimento_id = ''
    }

    const key = `${remunerationTypeId}::${vinculo}::${String(config.promotora_id || '').trim()}`
    if (seen.has(key)) {
      throw new Error('Não é permitido salvar duas configurações financeiras com a mesma combinação de Tipo de Remuneração, Tipo de Vínculo e Promotora.')
    }
    seen.add(key)
  })
}

export async function getInstituicoesFinanceiras() {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const { data, error } = await supabaseAdmin
      .from('financial_institutions')
      .select('id, name, cnpj, razao_social, institution_type, logo_url, logo_wide_url, is_active')
      .order('is_active', { ascending: false })
      .order('name', { ascending: true })
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar instituições financeiras:', error)
    return { success: false, error: error.message }
  }
}

export async function getInstituicaoFinanceira(id: string) {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    if (!id || id === 'novo') {
      return { success: true, item: null }
    }

    const { data, error } = await supabaseAdmin
      .from('financial_institutions')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return { success: true, item: data || null }
  } catch (error: any) {
    console.error('Erro ao buscar instituição financeira:', error)
    return { success: false, error: error.message }
  }
}

export async function getInstituicaoLookups() {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const [companiesRes, commercialRes, sectorsRes, nfseRes, remunerationRes, receiptRes, systemRes, promotorasRes] = await Promise.all([
      safeLookup(supabaseAdmin.from('company_profiles').select('id, nickname, cnpj, is_active, company_data').order('nickname', { ascending: true })),
      safeLookup(supabaseAdmin.from('commercial_types').select('id, name, is_active').order('is_active', { ascending: false }).order('name', { ascending: true })),
      safeLookup(supabaseAdmin.from('company_sectors').select('id, name, is_active').order('is_active', { ascending: false }).order('name', { ascending: true })),
      safeLookup(supabaseAdmin.from('nfse_emission_types').select('id, name, is_active').order('is_active', { ascending: false }).order('name', { ascending: true })),
      safeLookup(supabaseAdmin.from('remuneration_types').select('id, name, is_active').order('is_active', { ascending: false }).order('name', { ascending: true })),
      safeLookup(supabaseAdmin.from('receipt_methods').select('id, name, is_active').order('is_active', { ascending: false }).order('name', { ascending: true })),
      safeLookup(supabaseAdmin.from('system_types').select('id, name, is_active').order('is_active', { ascending: false }).order('name', { ascending: true })),
      safeLookup(supabaseAdmin.from('promotoras').select('id, razao_social, nome_fantasia, logo_url, is_active').order('is_active', { ascending: false }).order('razao_social', { ascending: true })),
    ])

    if (companiesRes.error) throw companiesRes.error

    const reportLookupError = (label: string, error: any) => {
      if (error) console.error(`Erro ao carregar lookup de ${label}:`, error)
    }

    reportLookupError('tipos de comercial', commercialRes.error)
    reportLookupError('setores', sectorsRes.error)
    reportLookupError('tipos de emissão NFS-e', nfseRes.error)
    reportLookupError('tipos de remuneração', remunerationRes.error)
    reportLookupError('formas de recebimento', receiptRes.error)
    reportLookupError('tipos de sistema', systemRes.error)
    reportLookupError('promotoras', promotorasRes.error)

    const companies = ((companiesRes.data || []) as any[]).map((company: any) => {
      const nickname = String(company?.nickname || '').trim()
      const companyName = String(company?.company_data?.name || '').trim()
      const cnpj = String(company?.cnpj || '').trim()
      return {
        ...company,
        nickname,
        display_name: nickname || companyName || cnpj || 'Empresa sem identificação',
      }
    })

    const promotoras = ((promotorasRes.data || []) as any[]).map((row: any) => ({
      id: String(row.id),
      name: String(row.nome_fantasia || '').trim() || String(row.razao_social || '').trim(),
      logo_url: String(row.logo_url || '').trim(),
      is_active: row.is_active !== false,
    }))

    const payload: InstituicaoLookupPayload = {
      companies,
      commercialTypes: (commercialRes.data || []) as InstituicaoLookupPayload['commercialTypes'],
      sectors: (sectorsRes.data || []) as InstituicaoLookupPayload['sectors'],
      nfseEmissionTypes: (nfseRes.data || []) as InstituicaoLookupPayload['nfseEmissionTypes'],
      remunerationTypes: (remunerationRes.data || []) as InstituicaoLookupPayload['remunerationTypes'],
      receiptMethods: (receiptRes.data || []) as InstituicaoLookupPayload['receiptMethods'],
      systemTypes: (systemRes.data || []) as InstituicaoLookupPayload['systemTypes'],
      promotoras,
    }

    return { success: true, lookups: payload }
  } catch (error: any) {
    console.error('Erro ao carregar lookups da instituição financeira:', error)
    return { success: false, error: error.message }
  }
}

export async function saveInstituicaoFinanceira(payload: InstituicaoFinanceiraRecord) {
  try {
    await requirePermission(PERMISSION_RESOURCE, payload.id ? 'can_edit' : 'can_include')

    const row = normalizeInstituicaoFinanceiraRecord(payload)
    if (!row.name) return { success: false, error: 'O Nome Comercial é obrigatório.' }
    validateFinancialConfigurations(row)

    // Imposto da comissão líquida: flag exclusiva nas configurações fiscais e
    // total recalculado a cada salvamento (cache canônico p/ o Comissionamento).
    const configuracoesFiscais = Array.isArray((row.fiscal_data as any)?.configurations)
      ? ((row.fiscal_data as any).configurations as any[])
      : []
    let flagJaMarcada = false
    for (const config of configuracoesFiscais) {
      if (config?.usar_para_comissao === true) {
        if (flagJaMarcada) config.usar_para_comissao = false
        flagJaMarcada = true
      }
    }
    const impostoComissao = impostoComissaoDaInstituicao(configuracoesFiscais as any)

    const dbRow: Record<string, any> = {
      imposto_comissao_percent: impostoComissao,
      name: row.name,
      cnpj: row.cnpj,
      razao_social: row.razao_social,
      institution_type: row.institution_type,
      linked_bank_code: row.linked_bank_code,
      linked_bank_name: row.linked_bank_name,
      logo_url: row.logo_url,
      logo_wide_url: row.logo_wide_url,
      general_data: row.general_data,
      contacts_commercial: row.contacts_commercial,
      contacts_operational: row.contacts_operational,
      social_media: row.social_media,
      sac_ouvidoria: row.sac_ouvidoria,
      fiscal_data: row.fiscal_data,
      financial_data: row.financial_data,
      systems: row.systems,
      links_data: row.links_data,
      api_conexao: row.api_conexao,
      is_active: row.is_active !== false,
      deleted_at: row.is_active === false ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }

    let savedId = row.id || ''
    if (row.id) {
      const { error } = await supabaseAdmin.from('financial_institutions').update(dbRow).eq('id', row.id)
      if (error) throw error
    } else {
      const { data, error } = await supabaseAdmin
        .from('financial_institutions')
        .insert({ ...dbRow, created_at: new Date().toISOString() })
        .select('id')
        .single()
      if (error) throw error
      savedId = data?.id || ''
    }

    revalidatePath('/instituicoes-financeiras')
    if (savedId) revalidatePath(`/instituicoes-financeiras/${savedId}`)
    return { success: true, id: savedId }
  } catch (error: any) {
    console.error('Erro ao salvar instituição financeira:', error)
    if (String(error?.message || '').includes('general_data')) {
      return {
        success: false,
        error: 'A tabela financial_institutions ainda não foi ampliada. Aplique a migration 20260814090000_expand_financial_institutions.sql no Supabase.',
      }
    }
    if ((error as any)?.code === '23505') {
      return { success: false, error: 'Já existe uma instituição financeira cadastrada com esse CNPJ ou nome.' }
    }
    return { success: false, error: error.message }
  }
}

export async function setInstituicaoFinanceiraStatus(id: string, isActive: boolean) {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_activate_inactivate')

    if (!id) return { success: false, error: 'ID inválido.' }
    const { error } = await supabaseAdmin
      .from('financial_institutions')
      .update({
        is_active: isActive,
        deleted_at: isActive ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) throw error

    revalidatePath('/instituicoes-financeiras')
    revalidatePath(`/instituicoes-financeiras/${id}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alterar status da instituição financeira:', error)
    return { success: false, error: error.message }
  }
}
