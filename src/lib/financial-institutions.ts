import {
  normalizeCommercialContacts,
  normalizeFinancialDirectData,
  normalizeFinancialIndirectData,
  normalizeOperationalContacts,
  normalizePromotoraFiscalData,
  normalizeSystems,
  type PromotoraCommercialContact,
  type PromotoraFinancialDirectData,
  type PromotoraFinancialIndirectData,
  type PromotoraFinancialPaymentMode,
  type PromotoraFinancialWeekDay,
  type PromotoraFiscalData,
  type PromotoraOperationalContact,
  type PromotoraSystemEntry,
} from '@/lib/promotoras'
import type { CnaeInfo, InscricaoEstadualInfo, SocioReceitaInfo } from '@/lib/cnpj-consulta'

// ---------------------------------------------------------------------------
// Tipos básicos (compatibilidade com o cadastro mínimo anterior)
// ---------------------------------------------------------------------------

export type FinancialInstitutionRecord = {
  id?: string
  name: string
  logo_url?: string
  is_active?: boolean
  deleted_at?: string | null
  created_at?: string
  updated_at?: string
}

export function normalizeFinancialInstitutionName(value: string) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeFinancialInstitutionLogo(value: string) {
  return String(value || '').trim()
}

// ---------------------------------------------------------------------------
// Cadastro completo da Instituição Financeira parceira
// ---------------------------------------------------------------------------

export type InstituicaoTipo = '' | 'banco' | 'financeira' | 'fintech'

export const INSTITUICAO_TIPOS: Array<{ value: InstituicaoTipo; label: string }> = [
  { value: 'banco', label: 'Banco' },
  { value: 'financeira', label: 'Financeira' },
  { value: 'fintech', label: 'Fintech' },
]

export type InstituicaoVinculoTipo = '' | 'direto' | 'sub_grade' | 'sub_indicado' | 'sub_zero'

export const INSTITUICAO_VINCULO_TIPOS: Array<{ value: Exclude<InstituicaoVinculoTipo, ''>; label: string }> = [
  { value: 'direto', label: 'Direto' },
  { value: 'sub_grade', label: 'Subestabelecido Grade' },
  { value: 'sub_indicado', label: 'Subestabelecido Indicado' },
  { value: 'sub_zero', label: 'Subestabelecido Zero' },
]

export function vinculoTipoLabel(value: InstituicaoVinculoTipo) {
  return INSTITUICAO_VINCULO_TIPOS.find((item) => item.value === value)?.label || ''
}

// Direto: recebimento direto da instituição, sem promotora intermediária.
export function vinculoHabilitaPromotora(value: InstituicaoVinculoTipo) {
  return value === 'sub_grade' || value === 'sub_indicado' || value === 'sub_zero'
}

// Subestabelecido Zero: o recebimento vem da promotora — os campos financeiros
// são preenchidos no cadastro da Promotora, não aqui.
export function vinculoHabilitaCamposFinanceiros(value: InstituicaoVinculoTipo) {
  return value === 'direto' || value === 'sub_grade' || value === 'sub_indicado'
}

export type InstituicaoGeneralData = {
  data_abertura: string
  natureza_juridica: string
  natureza_juridica_codigo: string
  porte: string
  capital_social: string
  situacao_cadastral: string
  situacao_cadastral_data: string
  situacao_cadastral_motivo: string
  tipo_estabelecimento: string
  cnae_principal_codigo: string
  cnae_principal_descricao: string
  cnaes_secundarios: CnaeInfo[]
  simples_optante: boolean
  simples_data_opcao: string
  simples_data_exclusao: string
  is_mei: boolean
  mei_data_opcao: string
  mei_data_exclusao: string
  inscricoes_estaduais: InscricaoEstadualInfo[]
  email_rfb: string
  telefone_rfb_1: string
  telefone_rfb_2: string
  socios: SocioReceitaInfo[]
  receita_consultado_em: string
  // Endereço
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  // Institucional
  site_institucional: string
  email_principal: string
}

export type InstituicaoSocialMedia = {
  instagram: string
  facebook: string
  tiktok: string
  discord: string
}

export type InstituicaoAtendimentoLine = {
  enabled: boolean
  dia_da_semana: PromotoraFinancialWeekDay | ''
  hora_inicial: string
  hora_final: string
}

export type InstituicaoSacChannel = {
  card_enabled: boolean
  telefone: string
  whatsapp: string
  telegram: string
  email: string
  url: string
  atendimento: InstituicaoAtendimentoLine[]
}

export type InstituicaoSacOuvidoria = {
  sac: InstituicaoSacChannel
  ouvidoria: InstituicaoSacChannel
}

export type InstituicaoMarketingLink = {
  id: string
  descricao: string
  url: string
}

export type InstituicaoTarifaArquivo = {
  id: string
  descricao: string
  file_name: string
  file_data_url: string
}

export type InstituicaoLinksData = {
  marketing_links: InstituicaoMarketingLink[]
  tabela_tarifas_url: string
  tabela_tarifas_arquivos: InstituicaoTarifaArquivo[]
}

export type InstituicaoFinancialConfiguration = {
  id: string
  remuneration_type_id: string
  remuneration_type_name: string
  vinculo_tipo: InstituicaoVinculoTipo
  promotora_id: string
  promotora_name: string
  promotora_logo_url: string
  prazo_repasse_enabled: boolean
  prazo_repasse_para_agente: string
  conta_bancaria_index: string
  forma_recebimento_id: string
  payment_mode: PromotoraFinancialPaymentMode
  direct: PromotoraFinancialDirectData
  indirect: PromotoraFinancialIndirectData
}

export type InstituicaoFinancialData = {
  empresa_contratada_id: string
  configurations: InstituicaoFinancialConfiguration[]
}

export type InstituicaoFinanceiraRecord = {
  id?: string
  name: string // Nome Comercial
  cnpj: string
  razao_social: string
  institution_type: InstituicaoTipo
  linked_bank_code: string
  linked_bank_name: string
  logo_url: string // 500x500px (quadrado)
  logo_wide_url: string // 500x200px (horizontal)
  general_data: InstituicaoGeneralData
  contacts_commercial: PromotoraCommercialContact[]
  contacts_operational: PromotoraOperationalContact[]
  social_media: InstituicaoSocialMedia
  sac_ouvidoria: InstituicaoSacOuvidoria
  fiscal_data: PromotoraFiscalData
  financial_data: InstituicaoFinancialData
  systems: PromotoraSystemEntry[]
  links_data: InstituicaoLinksData
  is_active?: boolean
  deleted_at?: string | null
  created_at?: string
  updated_at?: string
}

// ---------------------------------------------------------------------------
// Fábricas
// ---------------------------------------------------------------------------

function createId(prefix = 'fi') {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createEmptyGeneralData(): InstituicaoGeneralData {
  return {
    data_abertura: '',
    natureza_juridica: '',
    natureza_juridica_codigo: '',
    porte: '',
    capital_social: '',
    situacao_cadastral: '',
    situacao_cadastral_data: '',
    situacao_cadastral_motivo: '',
    tipo_estabelecimento: '',
    cnae_principal_codigo: '',
    cnae_principal_descricao: '',
    cnaes_secundarios: [],
    simples_optante: false,
    simples_data_opcao: '',
    simples_data_exclusao: '',
    is_mei: false,
    mei_data_opcao: '',
    mei_data_exclusao: '',
    inscricoes_estaduais: [],
    email_rfb: '',
    telefone_rfb_1: '',
    telefone_rfb_2: '',
    socios: [],
    receita_consultado_em: '',
    cep: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    uf: '',
    site_institucional: '',
    email_principal: '',
  }
}

export function createEmptyAtendimentoLines(): InstituicaoAtendimentoLine[] {
  return Array.from({ length: 7 }, () => ({
    enabled: false,
    dia_da_semana: '',
    hora_inicial: '',
    hora_final: '',
  }))
}

export function createEmptySacChannel(): InstituicaoSacChannel {
  return {
    card_enabled: false,
    telefone: '',
    whatsapp: '',
    telegram: '',
    email: '',
    url: '',
    atendimento: createEmptyAtendimentoLines(),
  }
}

export function createEmptyInstituicaoFinancialConfiguration(): InstituicaoFinancialConfiguration {
  return {
    id: createId('fi-fin'),
    remuneration_type_id: '',
    remuneration_type_name: '',
    vinculo_tipo: '',
    promotora_id: '',
    promotora_name: '',
    promotora_logo_url: '',
    prazo_repasse_enabled: false,
    prazo_repasse_para_agente: '',
    conta_bancaria_index: '',
    forma_recebimento_id: '',
    payment_mode: 'direto',
    direct: createEmptyDirect(),
    indirect: createEmptyIndirect(),
  }
}

function createEmptyDirect(): PromotoraFinancialDirectData {
  return normalizeFinancialDirectData(null)
}

function createEmptyIndirect(): PromotoraFinancialIndirectData {
  return normalizeFinancialIndirectData(null)
}

export function createEmptyInstituicaoFinanceira(): InstituicaoFinanceiraRecord {
  return {
    name: '',
    cnpj: '',
    razao_social: '',
    institution_type: '',
    linked_bank_code: '',
    linked_bank_name: '',
    logo_url: '',
    logo_wide_url: '',
    general_data: createEmptyGeneralData(),
    contacts_commercial: [],
    contacts_operational: [],
    social_media: { instagram: '', facebook: '', tiktok: '', discord: '' },
    sac_ouvidoria: { sac: createEmptySacChannel(), ouvidoria: createEmptySacChannel() },
    fiscal_data: { configurations: [] },
    financial_data: { empresa_contratada_id: '', configurations: [] },
    systems: [],
    links_data: { marketing_links: [], tabela_tarifas_url: '', tabela_tarifas_arquivos: [] },
    is_active: true,
  }
}

export function createEmptyMarketingLink(): InstituicaoMarketingLink {
  return { id: createId('fi-mkt'), descricao: '', url: '' }
}

export function createEmptyTarifaArquivo(): InstituicaoTarifaArquivo {
  return { id: createId('fi-tarifa'), descricao: '', file_name: '', file_data_url: '' }
}

export function normalizeLinksData(raw: any): InstituicaoLinksData {
  const value = raw && typeof raw === 'object' ? raw : {}
  const marketingLinks: InstituicaoMarketingLink[] = Array.isArray(value.marketing_links)
    ? value.marketing_links
        .map((item: any) => ({
          id: String(item?.id || '').trim() || createId('fi-mkt'),
          descricao: String(item?.descricao || '').replace(/\s+/g, ' ').trim().slice(0, 200),
          url: String(item?.url || '').trim().slice(0, 500),
        }))
        .filter((item: InstituicaoMarketingLink) => item.descricao || item.url)
    : []

  // Migração do formato antigo (campo único marketing_url)
  const legacyMarketingUrl = String(value.marketing_url || '').trim()
  if (legacyMarketingUrl && !marketingLinks.some((item) => item.url === legacyMarketingUrl)) {
    marketingLinks.unshift({ id: createId('fi-mkt'), descricao: 'Marketing', url: legacyMarketingUrl.slice(0, 500) })
  }

  const arquivos: InstituicaoTarifaArquivo[] = Array.isArray(value.tabela_tarifas_arquivos)
    ? value.tabela_tarifas_arquivos
        .map((item: any) => ({
          id: String(item?.id || '').trim() || createId('fi-tarifa'),
          descricao: String(item?.descricao || '').replace(/\s+/g, ' ').trim().slice(0, 200),
          file_name: String(item?.file_name || '').trim().slice(0, 200),
          file_data_url: String(item?.file_data_url || '').trim(),
        }))
        .filter((item: InstituicaoTarifaArquivo) => item.descricao || item.file_data_url)
    : []

  return {
    marketing_links: marketingLinks,
    tabela_tarifas_url: String(value.tabela_tarifas_url || '').trim().slice(0, 500),
    tabela_tarifas_arquivos: arquivos,
  }
}

// ---------------------------------------------------------------------------
// Normalização (aplicada no servidor antes de salvar)
// ---------------------------------------------------------------------------

function text(value: any, max = 300) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function digits(value: any, max = 20) {
  return String(value ?? '').replace(/\D/g, '').slice(0, max)
}

function normalizeAtendimentoLines(raw: any): InstituicaoAtendimentoLine[] {
  const rows = Array.isArray(raw) ? raw : []
  const base = createEmptyAtendimentoLines()
  return base.map((line, index) => {
    const row = rows[index] && typeof rows[index] === 'object' ? rows[index] : {}
    return {
      enabled: !!row.enabled,
      dia_da_semana: text(row.dia_da_semana, 30) as InstituicaoAtendimentoLine['dia_da_semana'],
      hora_inicial: /^\d{2}:\d{2}$/.test(String(row.hora_inicial || '')) ? String(row.hora_inicial) : '',
      hora_final: /^\d{2}:\d{2}$/.test(String(row.hora_final || '')) ? String(row.hora_final) : '',
    }
  })
}

function normalizeSacChannel(raw: any): InstituicaoSacChannel {
  const value = raw && typeof raw === 'object' ? raw : {}
  return {
    card_enabled: !!value.card_enabled,
    telefone: digits(value.telefone, 11),
    whatsapp: digits(value.whatsapp, 13),
    telegram: text(value.telegram, 120),
    email: text(value.email, 120).toLowerCase(),
    url: text(value.url, 500),
    atendimento: normalizeAtendimentoLines(value.atendimento),
  }
}

function normalizeGeneralData(raw: any): InstituicaoGeneralData {
  const value = raw && typeof raw === 'object' ? raw : {}
  const empty = createEmptyGeneralData()
  return {
    ...empty,
    data_abertura: text(value.data_abertura, 10),
    natureza_juridica: text(value.natureza_juridica, 200),
    natureza_juridica_codigo: text(value.natureza_juridica_codigo, 10),
    porte: text(value.porte, 80),
    capital_social: text(value.capital_social, 30),
    situacao_cadastral: text(value.situacao_cadastral, 40),
    situacao_cadastral_data: text(value.situacao_cadastral_data, 10),
    situacao_cadastral_motivo: text(value.situacao_cadastral_motivo, 200),
    tipo_estabelecimento: text(value.tipo_estabelecimento, 20),
    cnae_principal_codigo: text(value.cnae_principal_codigo, 10),
    cnae_principal_descricao: text(value.cnae_principal_descricao, 300),
    cnaes_secundarios: Array.isArray(value.cnaes_secundarios)
      ? value.cnaes_secundarios
          .map((item: any) => ({ code: text(item?.code, 10), desc: text(item?.desc, 300) }))
          .filter((item: CnaeInfo) => item.code || item.desc)
      : [],
    simples_optante: !!value.simples_optante,
    simples_data_opcao: text(value.simples_data_opcao, 10),
    simples_data_exclusao: text(value.simples_data_exclusao, 10),
    is_mei: !!value.is_mei,
    mei_data_opcao: text(value.mei_data_opcao, 10),
    mei_data_exclusao: text(value.mei_data_exclusao, 10),
    inscricoes_estaduais: Array.isArray(value.inscricoes_estaduais)
      ? value.inscricoes_estaduais
          .map((item: any) => ({
            numero: text(item?.numero, 30),
            uf: text(item?.uf, 2).toUpperCase(),
            ativo: item?.ativo !== false,
          }))
          .filter((item: InscricaoEstadualInfo) => item.numero)
      : [],
    email_rfb: text(value.email_rfb, 120).toLowerCase(),
    telefone_rfb_1: digits(value.telefone_rfb_1, 11),
    telefone_rfb_2: digits(value.telefone_rfb_2, 11),
    socios: Array.isArray(value.socios)
      ? value.socios
          .map((item: any) => ({
            nome: text(item?.nome, 200),
            cpf_cnpj: text(item?.cpf_cnpj, 20),
            tipo: text(item?.tipo, 40),
            qualificacao: text(item?.qualificacao, 120),
            data_entrada: text(item?.data_entrada, 10),
            faixa_etaria: text(item?.faixa_etaria, 40),
          }))
          .filter((item: SocioReceitaInfo) => item.nome)
      : [],
    receita_consultado_em: text(value.receita_consultado_em, 40),
    cep: digits(value.cep, 8),
    logradouro: text(value.logradouro, 200),
    numero: text(value.numero, 20),
    complemento: text(value.complemento, 120),
    bairro: text(value.bairro, 120),
    cidade: text(value.cidade, 120),
    uf: text(value.uf, 2).toUpperCase(),
    site_institucional: text(value.site_institucional, 500),
    email_principal: text(value.email_principal, 120).toLowerCase(),
  }
}

function normalizeVinculoTipo(value: any): InstituicaoVinculoTipo {
  const raw = String(value || '').trim()
  return (['direto', 'sub_grade', 'sub_indicado', 'sub_zero'].includes(raw) ? raw : '') as InstituicaoVinculoTipo
}

function normalizeFinancialConfigurations(raw: any): InstituicaoFinancialConfiguration[] {
  const rows = Array.isArray(raw?.configurations) ? raw.configurations : []
  return rows.map((config: any) => {
    const value = config && typeof config === 'object' ? config : {}
    return {
      ...createEmptyInstituicaoFinancialConfiguration(),
      id: text(value.id, 80) || createId('fi-fin'),
      remuneration_type_id: text(value.remuneration_type_id, 80),
      remuneration_type_name: text(value.remuneration_type_name, 120),
      vinculo_tipo: normalizeVinculoTipo(value.vinculo_tipo),
      promotora_id: text(value.promotora_id, 80),
      promotora_name: text(value.promotora_name, 200),
      promotora_logo_url: String(value.promotora_logo_url || '').trim(),
      prazo_repasse_enabled: !!value.prazo_repasse_enabled,
      prazo_repasse_para_agente: digits(value.prazo_repasse_para_agente, 3),
      conta_bancaria_index: text(value.conta_bancaria_index, 80),
      forma_recebimento_id: text(value.forma_recebimento_id, 80),
      payment_mode: value.payment_mode === 'indireto' ? 'indireto' : 'direto',
      direct: normalizeFinancialDirectData(value.direct),
      indirect: normalizeFinancialIndirectData(value.indirect),
    }
  })
}

export function normalizeInstituicaoFinanceiraRecord(
  input: Partial<InstituicaoFinanceiraRecord> & Record<string, any>,
): InstituicaoFinanceiraRecord {
  const social = input.social_media && typeof input.social_media === 'object' ? input.social_media : ({} as any)
  const sacOuvidoria = input.sac_ouvidoria && typeof input.sac_ouvidoria === 'object' ? input.sac_ouvidoria : ({} as any)
  const links = input.links_data && typeof input.links_data === 'object' ? input.links_data : ({} as any)
  const financial = input.financial_data && typeof input.financial_data === 'object' ? input.financial_data : ({} as any)

  return {
    id: input.id,
    name: normalizeFinancialInstitutionName(String(input.name || '')),
    cnpj: digits(input.cnpj, 14),
    razao_social: text(input.razao_social, 200),
    institution_type: (['banco', 'financeira', 'fintech'].includes(String(input.institution_type || '')) ? input.institution_type : '') as InstituicaoTipo,
    linked_bank_code: digits(input.linked_bank_code, 3),
    linked_bank_name: text(input.linked_bank_name, 120),
    logo_url: String(input.logo_url || '').trim(),
    logo_wide_url: String(input.logo_wide_url || '').trim(),
    general_data: normalizeGeneralData(input.general_data),
    contacts_commercial: normalizeCommercialContacts(input.contacts_commercial),
    contacts_operational: normalizeOperationalContacts(input.contacts_operational),
    social_media: {
      instagram: text(social.instagram, 200),
      facebook: text(social.facebook, 200),
      tiktok: text(social.tiktok, 200),
      discord: text(social.discord, 200),
    },
    sac_ouvidoria: {
      sac: normalizeSacChannel(sacOuvidoria.sac),
      ouvidoria: normalizeSacChannel(sacOuvidoria.ouvidoria),
    },
    fiscal_data: normalizePromotoraFiscalData(input.fiscal_data),
    financial_data: {
      empresa_contratada_id: text(financial.empresa_contratada_id, 80),
      configurations: normalizeFinancialConfigurations(financial),
    },
    systems: normalizeSystems(input.systems),
    links_data: normalizeLinksData(links),
    is_active: input.is_active !== false,
    deleted_at: input.deleted_at ?? null,
    created_at: input.created_at,
    updated_at: input.updated_at,
  }
}
