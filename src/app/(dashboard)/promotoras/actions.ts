'use server'

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { findFiscalOverlaps, isFiscalConfigVigente, normalizePromotoraRecord, todaySaoPauloISO, type FiscalPagador, type FiscalVinculoTipo, type PromotoraRecord } from '@/lib/promotoras'
import { normalizeInstituicaoFinanceiraRecord } from '@/lib/financial-institutions'
import { impostoComissaoDaInstituicaoComPromotora } from '@/lib/comissao-liquida'

export type InstituicaoVinculadaPromotora = {
  financial_institution_id: string
  financial_institution_name: string
  financial_institution_logo_url: string
  vinculo_tipo: FiscalVinculoTipo
  remuneration_type_name: string
  pagador: FiscalPagador | undefined
  effective_from: string
  effective_to: string | null
  vigente: boolean
}

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

export type PromotoraLookupPayload = {
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
  financialInstitutions: Array<{ id: string; name: string; logo_url: string; is_active: boolean }>
}

async function safeLookup<T>(query: PromiseLike<{ data: T | null; error: any } | { data: T | null; error: any }>) {
  try {
    const res = await query
    return { data: res.data || null, error: res.error || null }
  } catch (error: any) {
    return { data: null, error }
  }
}

function validateFiscalOverlaps(payload: PromotoraRecord) {
  const overlaps = findFiscalOverlaps(payload.fiscal_data?.configurations || [], (config) => config.remuneration_type_id)
  if (overlaps.length > 0) {
    const { a, b } = overlaps[0]
    throw new Error(
      `Vigências sobrepostas na aba Fiscal para "${a.remuneration_type_name || 'remuneração'}": ` +
        `${a.effective_from || 'sem início'}–${a.effective_to || 'aberta'} e ${b.effective_from || 'sem início'}–${b.effective_to || 'aberta'}.`,
    )
  }
}

async function carregarInstituicoes() {
  const { data, error } = await supabaseAdmin.from('financial_institutions').select('*')
  if (error) throw error
  return (data || []).map((raw: any) => normalizeInstituicaoFinanceiraRecord(raw))
}

export async function getInstituicoesVinculadasPromotora(promotoraId: string) {
  try {
    await requirePermission('promotoras')
    if (!promotoraId) return { success: true, items: [] as InstituicaoVinculadaPromotora[] }
    const hoje = todaySaoPauloISO()
    const items: InstituicaoVinculadaPromotora[] = (await carregarInstituicoes()).flatMap((instituicao) =>
      instituicao.fiscal_data.configurations
        .filter((config) => config.promotora_id === promotoraId)
        .map((config) => ({
          financial_institution_id: String(instituicao.id || ''),
          financial_institution_name: instituicao.name,
          financial_institution_logo_url: instituicao.logo_url,
          vinculo_tipo: config.vinculo_tipo || '',
          remuneration_type_name: config.remuneration_type_name,
          pagador: config.pagador,
          effective_from: config.effective_from,
          effective_to: config.effective_to,
          vigente: isFiscalConfigVigente(config, hoje),
        })),
    )
    return { success: true, items }
  } catch (error: any) {
    console.error('Erro ao buscar instituições vinculadas:', error)
    return { success: false, error: error.message, items: [] as InstituicaoVinculadaPromotora[] }
  }
}

// Recalcula o cache imposto_comissao_percent das IFs cuja config "usar para
// comissão" é paga por esta promotora (null = promotora sem config marcada/vigente).
async function recalcularImpostoDasInstituicoes(promotora: PromotoraRecord, promotoraId: string) {
  const configs = promotora.fiscal_data?.configurations || []
  for (const instituicao of await carregarInstituicoes()) {
    const marcada = instituicao.fiscal_data.configurations.find((config) => config.usar_para_comissao === true)
    if (!marcada || marcada.pagador !== 'promotora' || marcada.promotora_id !== promotoraId) continue
    const imposto = impostoComissaoDaInstituicaoComPromotora(instituicao.fiscal_data.configurations, () => configs)
    const { error } = await supabaseAdmin
      .from('financial_institutions')
      .update({ imposto_comissao_percent: imposto, updated_at: new Date().toISOString() })
      .eq('id', instituicao.id)
    if (error) throw error
  }
}

function validateFinancialConfigurations(payload: PromotoraRecord) {
  validateFiscalOverlaps(payload)
  const configurations = Array.isArray(payload.financial_data?.configurations) ? payload.financial_data.configurations : []
  if (configurations.length === 0) {
    throw new Error('Adicione pelo menos uma Configuração Financeira.')
  }

  const allowedRemunerationIds = new Set(
    (payload.fiscal_data?.configurations || [])
      .map((config) => String(config.remuneration_type_id || '').trim())
      .filter(Boolean),
  )
  const seen = new Set<string>()

  configurations.forEach((config, index) => {
    const remunerationTypeId = String(config.remuneration_type_id || '').trim()
    const institutionId = String(config.financial_institution_id || '').trim()

    if (!remunerationTypeId) {
      throw new Error(`Informe o Tipo de Remuneração na Configuração Financeira ${index + 1}.`)
    }
    if (!institutionId) {
      throw new Error(`Informe a Instituição Financeira na Configuração Financeira ${index + 1}.`)
    }
    if (allowedRemunerationIds.size > 0 && !allowedRemunerationIds.has(remunerationTypeId)) {
      throw new Error(`O Tipo de Remuneração da Configuração Financeira ${index + 1} precisa estar vinculado à aba Fiscal.`)
    }

    const key = `${remunerationTypeId}::${institutionId}`
    if (seen.has(key)) {
      throw new Error('Não é permitido salvar duas configurações financeiras com a mesma combinação de Tipo de Remuneração e Instituição Financeira.')
    }
    seen.add(key)
  })
}

export async function getPromotoras() {
  try {
    await requirePermission('promotoras')

    const { data, error } = await supabaseAdmin
      .from('promotoras')
      .select('*')
      .order('is_active', { ascending: false })
      .order('razao_social', { ascending: true })
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar promotoras:', error)
    return { success: false, error: error.message }
  }
}

export async function getPromotora(id: string) {
  try {
    await requirePermission('promotoras')

    if (!id || id === 'novo') {
      return { success: true, item: null }
    }

    const { data, error } = await supabaseAdmin
      .from('promotoras')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return { success: true, item: data || null }
  } catch (error: any) {
    console.error('Erro ao buscar promotora:', error)
    return { success: false, error: error.message }
  }
}

export async function getPromotoraLookups() {
  try {
    await requirePermission('promotoras')

    const [companiesRes, commercialRes, sectorsRes, nfseRes, remunerationRes, receiptRes, systemRes, financialInstitutionsRes] = await Promise.all([
      safeLookup(supabaseAdmin.from('company_profiles').select('id, nickname, cnpj, is_active, company_data').order('nickname', { ascending: true })),
      safeLookup(supabaseAdmin.from('commercial_types').select('id, name, is_active').order('is_active', { ascending: false }).order('name', { ascending: true })),
      safeLookup(supabaseAdmin.from('company_sectors').select('id, name, is_active').order('is_active', { ascending: false }).order('name', { ascending: true })),
      safeLookup(supabaseAdmin.from('nfse_emission_types').select('id, name, is_active').order('is_active', { ascending: false }).order('name', { ascending: true })),
      safeLookup(supabaseAdmin.from('remuneration_types').select('id, name, is_active').order('is_active', { ascending: false }).order('name', { ascending: true })),
      safeLookup(supabaseAdmin.from('receipt_methods').select('id, name, is_active').order('is_active', { ascending: false }).order('name', { ascending: true })),
      safeLookup(supabaseAdmin.from('system_types').select('id, name, is_active').order('is_active', { ascending: false }).order('name', { ascending: true })),
      safeLookup(supabaseAdmin.from('financial_institutions').select('id, name, logo_url, is_active').order('is_active', { ascending: false }).order('name', { ascending: true })),
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
    reportLookupError('instituições financeiras', financialInstitutionsRes.error)

    const companies = (companiesRes.data || []).map((company: any) => {
      const nickname = String(company?.nickname || '').trim()
      const companyName = String(company?.company_data?.name || '').trim()
      const cnpj = String(company?.cnpj || '').trim()
      return {
        ...company,
        nickname,
        display_name: nickname || companyName || cnpj || 'Empresa sem identificação',
      }
    })

    const payload: PromotoraLookupPayload = {
      companies,
      commercialTypes: (commercialRes.data || []) as PromotoraLookupPayload['commercialTypes'],
      sectors: (sectorsRes.data || []) as PromotoraLookupPayload['sectors'],
      nfseEmissionTypes: (nfseRes.data || []) as PromotoraLookupPayload['nfseEmissionTypes'],
      remunerationTypes: (remunerationRes.data || []) as PromotoraLookupPayload['remunerationTypes'],
      receiptMethods: (receiptRes.data || []) as PromotoraLookupPayload['receiptMethods'],
      systemTypes: (systemRes.data || []) as PromotoraLookupPayload['systemTypes'],
      financialInstitutions: (financialInstitutionsRes.data || []) as PromotoraLookupPayload['financialInstitutions'],
    }

    return { success: true, lookups: payload }
  } catch (error: any) {
    console.error('Erro ao carregar lookups da promotora:', error)
    return { success: false, error: error.message }
  }
}

export async function savePromotora(payload: PromotoraRecord) {
  try {
    await requirePermission('promotoras', payload.id ? 'can_edit' : 'can_include')

    const row = normalizePromotoraRecord(payload)
    if (!row.cnpj) return { success: false, error: 'O CNPJ é obrigatório.' }
    if (!row.razao_social) return { success: false, error: 'A razão social é obrigatória.' }
    validateFinancialConfigurations(row)

    const dbRow: Record<string, any> = {
      cnpj: row.cnpj,
      razao_social: row.razao_social,
      nome_fantasia: row.nome_fantasia,
      logo_url: row.logo_url,
      address_data: row.address_data,
      contacts_commercial: row.contacts_commercial,
      contacts_operational: row.contacts_operational,
      fiscal_data: row.fiscal_data,
      financial_data: row.financial_data,
      bank_accounts: row.bank_accounts,
      systems: row.systems,
      is_active: row.is_active !== false,
      deleted_at: row.is_active === false ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }

    let savedId = row.id || ''
    if (row.id) {
      const { error } = await supabaseAdmin.from('promotoras').update(dbRow).eq('id', row.id)
      if (error) throw error
    } else {
      const { data, error } = await supabaseAdmin
        .from('promotoras')
        .insert({ ...dbRow, created_at: new Date().toISOString() })
        .select('id')
        .single()
      if (error) throw error
      savedId = data?.id || ''
    }

    if (savedId) await recalcularImpostoDasInstituicoes(row, savedId)

    revalidatePath('/promotoras')
    revalidatePath('/instituicoes-financeiras')
    if (savedId) revalidatePath(`/promotoras/${savedId}`)
    revalidatePath('/')
    return { success: true, id: savedId }
  } catch (error: any) {
    console.error('Erro ao salvar promotora:', error)
    if (String(error?.message || '').includes("Could not find the 'promotoras'")) {
      return {
        success: false,
        error:
          "A tabela 'promotoras' ainda não existe. Aplique a migration do Supabase criada para Promotoras.",
      }
    }
    if ((error as any)?.code === '23505') {
      return { success: false, error: 'Já existe uma promotora cadastrada com esse CNPJ.' }
    }
    return { success: false, error: error.message }
  }
}

export async function setPromotoraStatus(id: string, isActive: boolean) {
  try {
    await requirePermission('promotoras', 'can_activate_inactivate')

    if (!id) return { success: false, error: 'ID inválido.' }
    const { error } = await supabaseAdmin
      .from('promotoras')
      .update({
        is_active: isActive,
        deleted_at: isActive ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) throw error

    revalidatePath('/promotoras')
    revalidatePath(`/promotoras/${id}`)
    revalidatePath('/')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alterar status da promotora:', error)
    return { success: false, error: error.message }
  }
}
