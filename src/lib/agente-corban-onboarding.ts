/**
 * Domínio compartilhado do pipeline "Cadastros Recebidos" (Agente Corban).
 *
 * Espelha as tabelas de `supabase/migrations/20260825120000_cadastros_recebidos.sql`
 * e concentra a lógica de geração do checklist da etapa `validacao`.
 *
 * A tela de revisão espelha, seção por seção e na mesma ordem, o formulário
 * do Portal Parceiro (`brs-portal-parceiro/src/app/cadastro/[tipo]/formulario/_steps`,
 * fluxo "CNPJ com Ponto Comercial"): Compliance → Empresa → Comercial →
 * Bancário → Sociedade → Signatários → Documentos. Os nomes de campo e a
 * ordem seguem o que o parceiro realmente viu — não uma taxonomia própria.
 *
 * A proveniência de cada campo (veio de consulta API × foi preenchido/alterado
 * pelo parceiro) NÃO é inferida aqui — vem pronta, carimbada no servidor pelo
 * próprio portal no submit, em `corban_data.field_provenance` e
 * `corban_data.divergencias_receita` (ver `agente-corban-provenance.ts`).
 * Regra de negócio (decisão do Bruno, 24/08/2026): só entra no checklist de
 * aprovação/reprovação/edição quem foi preenchido ou alterado pelo parceiro.
 * Dado de API não alterado é só exibido — nunca demanda aprovação.
 */

import { getFieldByPath, getValueAtPath, type FieldKind } from './agente-corban-fields'
import { formatCpfOrCnpjDisplay, formatCurrencyDisplay, formatDateDisplay } from './agente-corban'
import { maskPhone } from './company-bank-accounts'
import { getFieldProvenance, provenanceValuesDiffer, type FieldProvenanceEntry } from './agente-corban-provenance'
import {
  getAdministracao,
  getPessoasExternas,
  getSignatarios,
  getSocios,
  type AdministracaoItem,
  type SocioItem,
} from './agente-corban-signatarios'

// =========================================================================
// Tipos — espelham as colunas das tabelas corban_onboarding_*
// =========================================================================

export type CorbanOnboardingEtapa =
  | 'validacao'
  | 'analise'
  | 'nuvidio'
  | 'arw'
  | 'contrato'
  | 'termo'
  | 'boas_vindas'
  | 'concluido'

export const CORBAN_ONBOARDING_ETAPAS: CorbanOnboardingEtapa[] = [
  'validacao',
  'analise',
  'nuvidio',
  'arw',
  'contrato',
  'termo',
  'boas_vindas',
  'concluido',
]

export const CORBAN_ONBOARDING_ETAPA_LABELS: Record<CorbanOnboardingEtapa, string> = {
  validacao: 'Validação',
  analise: 'Análise',
  nuvidio: 'Nuvidio',
  arw: 'Cadastro ARW',
  contrato: 'Contrato',
  termo: 'Termo de Usuário',
  boas_vindas: 'Boas-vindas',
  concluido: 'Concluído',
}

/** Etapas com tela funcional nesta fase (B). As demais existem só no stepper. */
// Fases C–E implementadas em 02/09/2026 — pipeline completo ativo.
export const CORBAN_ONBOARDING_ETAPAS_ATIVAS: CorbanOnboardingEtapa[] = [...CORBAN_ONBOARDING_ETAPAS]

export type CorbanOnboardingProcessoStatus =
  | 'em_andamento'
  | 'aguardando_correcao'
  | 'correcao_recebida'
  | 'concluido'
  | 'cancelado'

export const CORBAN_ONBOARDING_STATUS_LABELS: Record<CorbanOnboardingProcessoStatus, string> = {
  em_andamento: 'Em andamento',
  aguardando_correcao: 'Aguardando correção',
  correcao_recebida: 'Correção recebida',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
}

export const CORBAN_ONBOARDING_STATUS_BADGE: Record<CorbanOnboardingProcessoStatus, string> = {
  em_andamento: 'badge-info',
  aguardando_correcao: 'badge-warning',
  correcao_recebida: 'badge-gold',
  concluido: 'badge-success',
  cancelado: 'badge-danger',
}

export type CorbanOnboardingItemEtapa = 'validacao' | 'analise'
export type CorbanOnboardingItemTipo = 'informacao' | 'documento' | 'analise'
export type CorbanOnboardingItemStatus = 'pendente' | 'aprovado' | 'reprovado' | 'corrigido'

export const CORBAN_ONBOARDING_ITEM_STATUS_LABELS: Record<CorbanOnboardingItemStatus, string> = {
  pendente: 'Pendente',
  aprovado: 'Aprovado',
  reprovado: 'Reprovado',
  corrigido: 'Corrigido',
}

export const CORBAN_ONBOARDING_ITEM_STATUS_BADGE: Record<CorbanOnboardingItemStatus, string> = {
  pendente: 'badge-gray',
  aprovado: 'badge-success',
  reprovado: 'badge-danger',
  corrigido: 'badge-gold',
}

export type CorbanOnboardingProcesso = {
  id: string
  agente_parceiro_id: string
  etapa_atual: CorbanOnboardingEtapa
  status: CorbanOnboardingProcessoStatus
  etapas: Record<string, { started_at?: string; completed_at?: string; completed_by?: string }>
  nuvidio_link: string | null
  nuvidio_video_url: string | null
  contrato_assinafy_document_id: string | null
  contrato_status: string | null
  termo_assinafy_document_id: string | null
  termo_status: string | null
  contrato_pdf_assinado_url: string | null
  termo_pdf_assinado_url: string | null
  responsavel_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type CorbanOnboardingItem = {
  id: string
  processo_id: string
  etapa: CorbanOnboardingItemEtapa
  chave: string
  rotulo: string
  tipo: CorbanOnboardingItemTipo
  valor: any
  status: CorbanOnboardingItemStatus
  motivo_reprovacao: string | null
  instrucoes_correcao: string | null
  avaliado_por: string | null
  avaliado_em: string | null
  correcao_id: string | null
  created_at: string
}

export type CorbanOnboardingDocAnaliseAlvoTipo = 'cpf' | 'cnpj' | 'processo'
export type CorbanOnboardingDocAnaliseTipoDocumento = 'serasa' | 'cartao_cnpj' | 'video_nuvidio' | 'outro'
export type CorbanOnboardingDocAnaliseStatus = 'pendente' | 'aprovado' | 'reprovado'

export type CorbanOnboardingDocAnalise = {
  id: string
  processo_id: string
  alvo_tipo: CorbanOnboardingDocAnaliseAlvoTipo
  alvo_valor: string
  tipo_documento: CorbanOnboardingDocAnaliseTipoDocumento
  /** Path dentro do bucket privado `partner-analise` — nunca uma URL pública. */
  arquivo_url: string
  file_name: string
  status: CorbanOnboardingDocAnaliseStatus
  observacao: string | null
  created_by: string | null
  created_at: string
  avaliado_por: string | null
  avaliado_em: string | null
}

export type CorbanOnboardingEvento = {
  id: number
  processo_id: string
  tipo: string
  detalhe: Record<string, any>
  actor_id: string | null
  created_at: string
}

const DOC_ANALISE_TIPO_LABELS: Record<string, string> = {
  serasa: 'Serasa',
  cartao_cnpj: 'Cartão CNPJ',
  video_nuvidio: 'Vídeo Nuvidio',
  outro: 'Outro',
}

/** Traduz um evento de `corban_onboarding_eventos` para uma frase legível no histórico. */
export function formatEventoDescricao(evento: Pick<CorbanOnboardingEvento, 'tipo' | 'detalhe'>): string {
  const detalhe = evento.detalhe || {}

  switch (evento.tipo) {
    case 'processo_criado':
      return 'Cadastro recebido — processo de aprovação iniciado'
    case 'item_avaliado': {
      const alvo = detalhe.rotulo ? `: ${detalhe.rotulo}` : ''
      return detalhe.status === 'aprovado' ? `Item aprovado${alvo}` : `Item reprovado${alvo}`
    }
    case 'item_editado': {
      const alvo = detalhe.rotulo ? `: ${detalhe.rotulo}` : ''
      const anterior = detalhe.valor_anterior === undefined || detalhe.valor_anterior === null || detalhe.valor_anterior === ''
        ? '—'
        : String(detalhe.valor_anterior)
      const novo = detalhe.valor_novo === undefined || detalhe.valor_novo === null || detalhe.valor_novo === ''
        ? '—'
        : String(detalhe.valor_novo)
      return `Item editado${alvo} ("${anterior}" → "${novo}")`
    }
    case 'etapa_concluida': {
      const etapaLabel = CORBAN_ONBOARDING_ETAPA_LABELS[detalhe.etapa as CorbanOnboardingEtapa] || detalhe.etapa
      return `Etapa concluída: ${etapaLabel}`
    }
    case 'doc_analise_enviado': {
      const tipoLabel = DOC_ANALISE_TIPO_LABELS[detalhe.tipo_documento] || detalhe.tipo_documento
      return `Documento de análise enviado: ${tipoLabel}`
    }
    case 'doc_analise_avaliado':
      return detalhe.status === 'aprovado' ? 'Documento de análise aprovado' : 'Documento de análise reprovado'
    case 'responsavel_assumido':
      return 'Cadastro com responsável definido'
    case 'processo_resetado_para_teste':
      return 'Processo resetado para novo teste (itens voltaram a pendente)'
    default:
      return evento.tipo
  }
}

export function diasEmAberto(createdAt: string | null | undefined): number {
  if (!createdAt) return 0
  const start = new Date(createdAt).getTime()
  if (!Number.isFinite(start)) return 0
  return Math.max(0, Math.floor((Date.now() - start) / (1000 * 60 * 60 * 24)))
}

// =========================================================================
// Seções da tela de validação — espelham as etapas do Portal Parceiro
// =========================================================================

export type ChecklistPortalStep = 'compliance' | 'empresa' | 'comercial' | 'bancario' | 'sociedade' | 'signatarios' | 'documentos'

export const CHECKLIST_PORTAL_STEPS: ChecklistPortalStep[] = [
  'compliance',
  'empresa',
  'comercial',
  'bancario',
  'sociedade',
  'signatarios',
  'documentos',
]

export const CHECKLIST_PORTAL_STEP_LABELS: Record<ChecklistPortalStep, string> = {
  compliance: 'Compliance',
  empresa: 'Empresa',
  comercial: 'Comercial',
  bancario: 'Bancário',
  sociedade: 'Sociedade',
  signatarios: 'Signatários',
  documentos: 'Documentos',
}

/** Passos que têm itens de aprovação (compliance/comercial informativos não geram checklist além de Presença Digital). */
export function resolveItemPortalStep(item: { chave: string; tipo: CorbanOnboardingItemTipo }): ChecklistPortalStep {
  if (item.tipo === 'documento') return 'documentos'
  const c = item.chave
  if (c.startsWith('bank.')) return 'bancario'
  if (c.startsWith('commercial.')) return 'comercial'
  if (c.startsWith('socios.') || c.startsWith('administracao.')) return 'sociedade'
  if (c.startsWith('pessoas.') || c.startsWith('witness.')) return 'signatarios'
  // master.capital_social (divergência × Receita) fica em Empresa, junto do
  // resto dos dados da RFB — cai no default abaixo.
  return 'empresa'
}

/** Campos de Presença Digital ({texto,classificacao}) — chave e rótulo, na ordem do portal. */
export const PRESENCA_DIGITAL_FIELDS: Array<{ chave: string; rotulo: string }> = [
  { chave: 'commercial.instagram', rotulo: 'Instagram' },
  { chave: 'commercial.tiktok', rotulo: 'TikTok' },
  { chave: 'commercial.facebook', rotulo: 'Página do Facebook' },
  { chave: 'commercial.linkedin', rotulo: 'LinkedIn' },
  { chave: 'commercial.site', rotulo: 'Site' },
  { chave: 'commercial.whatsapp_atendimento', rotulo: 'WhatsApp principal de atendimento' },
]

export type PresencaDigitalClassificacao = 'verificado' | 'nao_existe' | 'fora_do_ar' | 'inconsistente'

export const PRESENCA_DIGITAL_CLASSIFICACAO_LABELS: Record<PresencaDigitalClassificacao, string> = {
  verificado: 'Verificado',
  nao_existe: 'Não Existe',
  fora_do_ar: 'Fora do Ar',
  inconsistente: 'Inconsistente',
}

/** Um item de Presença Digital ({texto,classificacao}) — validado por classificação, não pelo fluxo genérico de aprovar/reprovar. */
export function isPresencaDigitalChave(chave: string): boolean {
  return PRESENCA_DIGITAL_FIELDS.some((f) => f.chave === chave)
}

/** O item da Chave PIX ({pix_type,pix_key,respostas}) — validado pelas 3 perguntas de conferência, não pelo fluxo genérico. */
export function isChavePixChave(chave: string): boolean {
  return chave === 'bank.pix_key'
}

/** Itens com fluxo de validação próprio — ficam fora do aprovar/reprovar/editar genérico e da aprovação em lote. */
export function isValidacaoEspecial(chave: string): boolean {
  return isPresencaDigitalChave(chave) || isChavePixChave(chave)
}

// =========================================================================
// Proveniência — flag de origem exibida junto de cada campo
// =========================================================================

export type ChecklistProvenancia = 'consulta_api' | 'preenchido' | 'consulta_api_alterado'

export const CHECKLIST_PROVENANCIA_LABELS: Record<ChecklistProvenancia, string> = {
  consulta_api: 'Consulta API',
  preenchido: 'Preenchido',
  consulta_api_alterado: 'Consulta API Alterado',
}

export const CHECKLIST_PROVENANCIA_BADGE: Record<ChecklistProvenancia, string> = {
  consulta_api: 'badge-info',
  preenchido: 'badge-gray',
  consulta_api_alterado: 'badge-warning',
}

/**
 * Flag de origem de um campo. A entrada `field_provenance[chave]` (carimbada
 * pelo portal no servidor, no submit — nunca inferida aqui) traz o valor
 * original da API; comparamos com o valor ATUAL (`valorAtual` — que pode já
 * ter sido corrigido pelo backoffice depois do submit) para decidir se ainda
 * está alterado. Sem entrada de proveniência = sempre foi preenchimento
 * manual do parceiro.
 */
export function resolveItemProvenancia(
  chave: string,
  valorAtual: any,
  corbanData: Record<string, any> | null | undefined,
): { provenancia: ChecklistProvenancia; entry: FieldProvenanceEntry | null } {
  const entry = getFieldProvenance(corbanData)[chave] || null
  if (!entry) return { provenancia: 'preenchido', entry: null }
  const alterado = provenanceValuesDiffer(entry.valor_api, String(valorAtual ?? ''))
  return { provenancia: alterado ? 'consulta_api_alterado' : 'consulta_api', entry }
}

/**
 * Campo com proveniência de API e SEM alteração (nem na origem, nem depois
 * pelo backoffice) dispensa aprovação — só é exibido (regra do Bruno). O item
 * continua existindo no checklist (para nunca sumir da tela), só não entra na
 * contagem obrigatória para concluir a etapa.
 */
export function itemDispensaAprovacao(
  item: { chave: string; valor: any },
  corbanData: Record<string, any> | null | undefined,
): boolean {
  return resolveItemProvenancia(item.chave, item.valor, corbanData).provenancia === 'consulta_api'
}

// =========================================================================
// Agrupamento visual — campos intimamente ligados numa mesma caixa
// =========================================================================

export type ChecklistBlock =
  | { type: 'single'; item: CorbanOnboardingItem }
  | { type: 'group'; rotulo: string; items: CorbanOnboardingItem[] }

function resolveVisualGroupKey(chave: string): { key: string; rotulo: string } | null {
  if (chave.startsWith('address.')) return { key: 'endereco-empresa', rotulo: 'Endereço' }

  const socioAddrMatch = chave.match(/^socios\.(\d+)\.residential_/)
  if (socioAddrMatch) return { key: `endereco-socio-${socioAddrMatch[1]}`, rotulo: 'Endereço' }

  const pessoaAddrMatch = chave.match(/^pessoas\.(\d+)\.(cep|address_)/)
  if (pessoaAddrMatch) return { key: `endereco-pessoa-${pessoaAddrMatch[1]}`, rotulo: 'Endereço' }

  if (/^witness\.(cep|address_)/.test(chave)) return { key: 'endereco-witness', rotulo: 'Endereço' }

  if (chave === 'bank.bank_code' || chave === 'bank.bank_name') return { key: 'banco', rotulo: 'Instituição Financeira' }

  return null
}

/**
 * Agrupa itens intimamente ligados (endereço, banco) numa mesma caixa visual
 * — cada campo continua individualmente aprovável/editável/reprovável, só a
 * apresentação em tela é conjunta.
 */
export function groupChecklistItems(items: CorbanOnboardingItem[]): ChecklistBlock[] {
  const porGrupo = new Map<string, CorbanOnboardingItem[]>()
  for (const item of items) {
    const grupo = resolveVisualGroupKey(item.chave)
    if (!grupo) continue
    porGrupo.set(grupo.key, [...(porGrupo.get(grupo.key) || []), item])
  }

  const blocks: ChecklistBlock[] = []
  const emitidos = new Set<string>()
  for (const item of items) {
    const grupo = resolveVisualGroupKey(item.chave)
    if (!grupo) {
      blocks.push({ type: 'single', item })
      continue
    }
    if (emitidos.has(grupo.key)) continue
    emitidos.add(grupo.key)
    blocks.push({ type: 'group', rotulo: grupo.rotulo, items: porGrupo.get(grupo.key)! })
  }
  return blocks
}

// =========================================================================
// Geração do checklist — etapa `validacao`
// =========================================================================

export type ChecklistItemSpec = {
  etapa: CorbanOnboardingItemEtapa
  chave: string
  rotulo: string
  tipo: CorbanOnboardingItemTipo
  valor: any
}

type FileRef = { fileName?: string; url: string }

function normalizeFiles(value: any): FileRef[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? { url: item } : { fileName: item?.fileName, url: item?.url }))
      .filter((item): item is FileRef => !!item.url)
  }
  if (typeof value === 'string' && value.trim()) return [{ url: value.trim() }]
  return []
}

function onlyDigits(value: any): string {
  return String(value ?? '').replace(/\D/g, '')
}

function hasValue(v: any): boolean {
  return v !== null && v !== undefined && String(v).trim() !== ''
}

/**
 * Empurra um item "campo simples" sempre que tem valor (ou `always`) — nunca
 * desaparece da tela, mesmo quando é dado de API não alterado. A dispensa de
 * aprovação para esses casos é decidida depois, ao vivo, por
 * `itemDispensaAprovacao` (compara contra o valor atual, não uma flag
 * carimbada uma única vez no submit).
 */
function pushCampo(
  specs: ChecklistItemSpec[],
  corbanData: Record<string, any>,
  chave: string,
  rotulo: string,
  opts?: { always?: boolean; tipo?: CorbanOnboardingItemTipo },
) {
  const valor = getValueAtPath(corbanData, chave)
  if (!opts?.always && !hasValue(valor)) return
  specs.push({ etapa: 'validacao', chave, rotulo, tipo: opts?.tipo || 'informacao', valor })
}

/** Campos de uma pessoa física (sócio PF, pessoa externa, testemunha) — mesmo conjunto do `PersonFields` do portal. */
function pushPersonFields(
  specs: ChecklistItemSpec[],
  corbanData: Record<string, any>,
  prefix: string,
  rotuloPessoa: string,
  addressPrefix: 'residential_' | '',
) {
  pushCampo(specs, corbanData, `${prefix}.cpf`, `CPF (${rotuloPessoa})`)
  pushCampo(specs, corbanData, `${prefix}.name`, `Nome completo (${rotuloPessoa})`)
  pushCampo(specs, corbanData, `${prefix}.gender`, `Sexo (${rotuloPessoa})`)
  pushCampo(specs, corbanData, `${prefix}.birth_date`, `Data de nascimento (${rotuloPessoa})`)
  pushCampo(specs, corbanData, `${prefix}.marital_status`, `Estado civil (${rotuloPessoa})`)
  pushCampo(specs, corbanData, `${prefix}.profession`, `Profissão (${rotuloPessoa})`)
  pushCampo(specs, corbanData, `${prefix}.phone`, `WhatsApp pessoal (${rotuloPessoa})`)
  pushCampo(specs, corbanData, `${prefix}.email`, `E-mail pessoal (${rotuloPessoa})`)
  pushCampo(specs, corbanData, `${prefix}.${addressPrefix}cep`, `CEP residencial (${rotuloPessoa})`)
  pushCampo(specs, corbanData, `${prefix}.${addressPrefix}address_street`, `Logradouro (${rotuloPessoa})`)
  pushCampo(specs, corbanData, `${prefix}.${addressPrefix}address_number`, `Número (${rotuloPessoa})`)
  pushCampo(specs, corbanData, `${prefix}.${addressPrefix}address_complement`, `Complemento (${rotuloPessoa})`)
  pushCampo(specs, corbanData, `${prefix}.${addressPrefix}address_neighborhood`, `Bairro (${rotuloPessoa})`)
  pushCampo(specs, corbanData, `${prefix}.${addressPrefix}address_city`, `Cidade (${rotuloPessoa})`)
  pushCampo(specs, corbanData, `${prefix}.${addressPrefix}address_state`, `Estado (UF) (${rotuloPessoa})`)
}

/** Chaves fixas de `documents.arquivos_por_documento` mapeadas para o path canônico + rótulo do portal. */
const DOCUMENT_KEY_MAP: Array<{ arquivoKey: string; path: string; rotulo: string }> = [
  { arquivoKey: 'social_contract', path: 'documents.social_contract_url', rotulo: 'Contrato Social ou Documento de Constituição' },
  { arquivoKey: 'address_proof_empresa', path: 'documents.address_proof_url', rotulo: 'Comprovante de Endereço da Empresa' },
  { arquivoKey: 'bank_proof', path: 'documents.bank_proof_url', rotulo: 'Comprovante de Titularidade Bancária' },
  { arquivoKey: 'front_photo', path: 'documents.front_photo_url', rotulo: 'Foto da Fachada do Estabelecimento' },
  { arquivoKey: 'external_number_photo', path: 'documents.external_number_photo_url', rotulo: 'Foto selfie externa com Placa de Endereço ou pelo menos o número' },
  { arquivoKey: 'internal_photo', path: 'documents.internal_photo_url', rotulo: 'Foto selfie do Espaço Interno de Trabalho' },
]

/**
 * Gera a especificação do checklist da etapa `validacao`, seção por seção,
 * na mesma ordem e com os mesmos nomes de campo do formulário do Portal
 * Parceiro (fluxo CNPJ com Ponto Comercial). Só entram no checklist campos
 * preenchidos ou alterados pelo parceiro — dado de API não alterado é
 * puramente informativo e fica de fora (decisão do Bruno, 24/08/2026).
 */
export function buildValidacaoChecklistSpec(corbanData: Record<string, any> | null | undefined): ChecklistItemSpec[] {
  const data = corbanData || {}
  const specs: ChecklistItemSpec[] = []
  // Fase atual cobre só o fluxo "CNPJ com Ponto Comercial" (decisão do Bruno,
  // 24/08/2026) — o fluxo "Pessoa Física Home Office" fica para depois. Os
  // trechos abaixo específicos de CNPJ (CNAE, capital social, sócios,
  // administração) só rodam para PJ; o resto (endereço/contatos/bancário/
  // documentos) é genérico o bastante para não quebrar num cadastro PF.
  const isPJ = getValueAtPath(data, 'master.person_type') === 'PJ'

  // ----- Empresa -----------------------------------------------------------
  pushCampo(specs, data, 'master.cpf_cnpj', isPJ ? 'CNPJ' : 'CPF')
  pushCampo(specs, data, 'master.name', isPJ ? 'Razão Social' : 'Nome Completo')
  pushCampo(specs, data, 'master.fantasy_name', 'Nome Fantasia')
  pushCampo(specs, data, 'master.data_abertura', 'Data de Abertura')

  if (isPJ) {
    // CNAE de correspondente bancário — única exceção do bloco Receita
    // Federal que sempre precisa de aprovação com justificativa (ou reprovação).
    specs.push({
      etapa: 'validacao',
      chave: 'master.tem_cnae_corban',
      rotulo: 'Possui CNAE de Correspondente Bancário (6619-3/02)',
      tipo: 'informacao',
      valor: getValueAtPath(data, 'master.tem_cnae_corban') === true,
    })

    // Divergência de capital social × Receita (quando o portal a sinalizou).
    const divergencias = getDivergenciasReceitaLocal(data)
    if (divergencias.some((d) => d.tipo === 'capital_social')) {
      pushCampo(specs, data, 'master.capital_social', 'Capital Social', { always: true })
    }
  }

  pushCampo(specs, data, 'address.cep', 'CEP')
  pushCampo(specs, data, 'address.address_street', 'Endereço / Logradouro')
  pushCampo(specs, data, 'address.address_number', 'Número')
  pushCampo(specs, data, 'address.address_complement', 'Complemento')
  pushCampo(specs, data, 'address.address_neighborhood', 'Bairro')
  pushCampo(specs, data, 'address.address_city', 'Cidade')
  pushCampo(specs, data, 'address.address_state', 'Estado (UF)')

  pushCampo(specs, data, 'contacts.email_comissao', 'E-mail principal da empresa')
  pushCampo(specs, data, 'contacts.phone_commercial', 'Telefone principal')
  pushCampo(specs, data, 'contacts.phone_whatsapp', 'WhatsApp para informes operacionais')
  pushCampo(specs, data, 'contacts.phone_whatsapp_financeiro', 'WhatsApp para informes financeiros')

  // ----- Comercial: Presença Digital ---------------------------------------
  // Todos os campos aparecem, mesmo vazios — ausência também é informação
  // (decisão do Bruno: fraudadores tendem a não expor redes/atuação).
  const presencaDigital: Array<[string, string]> = [
    ['commercial.instagram', 'Instagram'],
    ['commercial.tiktok', 'TikTok'],
    ['commercial.facebook', 'Página do Facebook'],
    ['commercial.linkedin', 'LinkedIn'],
    ['commercial.site', 'Site'],
    ['commercial.whatsapp_atendimento', 'WhatsApp principal de atendimento'],
  ]
  for (const [chave, rotulo] of presencaDigital) {
    specs.push({
      etapa: 'validacao',
      chave,
      rotulo,
      tipo: 'informacao',
      valor: { texto: getValueAtPath(data, chave) || '', classificacao: null },
    })
  }

  // ----- Bancário -----------------------------------------------------------
  pushCampo(specs, data, 'bank.bank_code', 'Código do Banco')
  pushCampo(specs, data, 'bank.bank_name', 'Instituição Financeira')
  pushCampo(specs, data, 'bank.bank_agency', 'Agência com dígito')
  pushCampo(specs, data, 'bank.bank_account', 'Conta corrente com dígito')

  if (hasValue(getValueAtPath(data, 'bank.pix_key'))) {
    specs.push({
      etapa: 'validacao',
      chave: 'bank.pix_key',
      rotulo: 'Chave PIX da Empresa',
      tipo: 'informacao',
      valor: {
        pix_type: getValueAtPath(data, 'bank.pix_type'),
        pix_key: getValueAtPath(data, 'bank.pix_key'),
        respostas: null,
      },
    })
  }

  // ----- Sociedade ------------------------------------------------------------
  const socios: SocioItem[] = getSocios(data)
  socios.forEach((socio, index) => {
    const kind = socio.person_kind === 'PJ' ? 'PJ' : 'PF'
    const rotuloSocio = index === 0 ? 'Sócio Principal' : `Sócio ${index + 1}`
    const prefix = `socios.${index}`

    if (kind === 'PJ') {
      pushCampo(specs, data, `${prefix}.cnpj`, `CNPJ (${rotuloSocio})`)
      pushCampo(specs, data, `${prefix}.name`, `Razão Social (${rotuloSocio})`)
      pushCampo(specs, data, `${prefix}.capital_share`, `% do Capital Social (${rotuloSocio})`)
      ;(socio.socios_pf_relacionados || []).forEach((pf, pfIndex) => {
        pushCampo(specs, data, `${prefix}.socios_pf_relacionados.${pfIndex}.cpf`, `CPF do Sócio PF de "${socio.name || rotuloSocio}"`)
        pushCampo(specs, data, `${prefix}.socios_pf_relacionados.${pfIndex}.name`, `Nome do Sócio PF de "${socio.name || rotuloSocio}"`)
      })
    } else {
      pushPersonFields(specs, data, prefix, rotuloSocio, 'residential_')
      pushCampo(specs, data, `${prefix}.capital_share`, `% do Capital Social (${rotuloSocio})`)
      specs.push({
        etapa: 'validacao',
        chave: `${prefix}.is_administrador`,
        rotulo: `Administra a empresa? (${rotuloSocio})`,
        tipo: 'informacao',
        valor: socio.is_administrador === true,
      })
    }
  })

  const administracao: AdministracaoItem[] = getAdministracao(data)
  administracao.forEach((admin, index) => {
    const rotuloAdmin = admin.tipo === 'procurador' ? `Procurador ${index + 1}` : admin.tipo === 'diretor' ? `Diretor ${index + 1}` : `Administrador ${index + 1}`
    const prefix = `administracao.${index}`
    pushCampo(specs, data, `${prefix}.cpf`, `CPF (${rotuloAdmin})`)
    pushCampo(specs, data, `${prefix}.name`, `Nome completo (${rotuloAdmin})`)
    pushCampo(specs, data, `${prefix}.cargo`, `Cargo/Função (${rotuloAdmin})`)
    pushCampo(specs, data, `${prefix}.representacao`, `Forma de assinatura (${rotuloAdmin})`)
    pushCampo(specs, data, `${prefix}.email`, `E-mail (${rotuloAdmin})`)
    pushCampo(specs, data, `${prefix}.phone`, `Telefone (${rotuloAdmin})`)
    if (admin.tipo === 'procurador') {
      pushCampo(specs, data, `${prefix}.procuracao.validade`, `Validade da procuração (${rotuloAdmin})`)
    }
  })

  // ----- Signatários ----------------------------------------------------------
  const signatarios = getSignatarios(data)
  const pessoas = getPessoasExternas(data)

  // Representante e Coobrigado 1 são só referência a alguém já validado como
  // sócio/administrador acima — informativo, sem item de aprovação.

  // Coobrigado 2: só vira validação completa quando é pessoa nova ("externo").
  if (signatarios.coobrigado_solidario_2?.fonte === 'pessoas') {
    const cpf = onlyDigits(signatarios.coobrigado_solidario_2.cpf)
    const pessoaIndex = pessoas.findIndex((p) => onlyDigits(p.cpf) === cpf)
    if (pessoaIndex >= 0) {
      pushPersonFields(specs, data, `pessoas.${pessoaIndex}`, 'Coobrigado Solidário 2', '')
    }
  }

  // Testemunha do parceiro: sempre pessoa nova, sempre validação completa.
  if (hasValue(getValueAtPath(data, 'witness.cpf'))) {
    pushPersonFields(specs, data, 'witness', 'Testemunha do Parceiro', '')
  }

  // ----- Documentos -------------------------------------------------------
  const arquivosPorDocumento = data?.documents?.arquivos_por_documento || {}

  for (const map of DOCUMENT_KEY_MAP) {
    const files = normalizeFiles(arquivosPorDocumento[map.arquivoKey])
    const finalFiles = files.length > 0 ? files : normalizeFiles(getValueAtPath(data, map.path))
    if (finalFiles.length === 0) continue
    specs.push({ etapa: 'validacao', chave: map.path, rotulo: map.rotulo, tipo: 'documento', valor: finalFiles })
  }

  socios.forEach((socio) => {
    if (socio.person_kind === 'PJ') {
      const cnpj = onlyDigits(socio.cnpj)
      if (!cnpj) return
      const files = normalizeFiles(arquivosPorDocumento[`socio_pj_contrato:${cnpj}`])
      if (files.length > 0) {
        specs.push({
          etapa: 'validacao',
          chave: `documents.arquivos_por_documento.socio_pj_contrato:${cnpj}`,
          rotulo: `Contrato Social da PJ sócia — ${socio.name || cnpj}`,
          tipo: 'documento',
          valor: files,
        })
      }
      return
    }
    const cpf = onlyDigits(socio.cpf)
    if (!cpf) return
    const docFiles = normalizeFiles(arquivosPorDocumento[`socio_pf_doc:${cpf}`])
    const addrFiles = normalizeFiles(arquivosPorDocumento[`socio_pf_endereco:${cpf}`])
    if (docFiles.length > 0) {
      specs.push({
        etapa: 'validacao',
        chave: `documents.arquivos_por_documento.socio_pf_doc:${cpf}`,
        rotulo: `Documento com foto — ${socio.name || cpf}`,
        tipo: 'documento',
        valor: docFiles,
      })
    }
    if (addrFiles.length > 0) {
      specs.push({
        etapa: 'validacao',
        chave: `documents.arquivos_por_documento.socio_pf_endereco:${cpf}`,
        rotulo: `Comprovante de endereço residencial — ${socio.name || cpf}`,
        tipo: 'documento',
        valor: addrFiles,
      })
    }
  })

  if (signatarios.coobrigado_solidario_2?.fonte === 'pessoas') {
    const files = normalizeFiles(arquivosPorDocumento.coobrigado2_doc)
    if (files.length > 0) {
      const cpf = onlyDigits(signatarios.coobrigado_solidario_2.cpf)
      const pessoa = pessoas.find((p) => onlyDigits(p.cpf) === cpf)
      specs.push({
        etapa: 'validacao',
        chave: 'documents.arquivos_por_documento.coobrigado2_doc',
        rotulo: `Documento com foto — ${pessoa?.name || 'Coobrigado Solidário 2'}`,
        tipo: 'documento',
        valor: files,
      })
    }
  }

  const witnessFiles = normalizeFiles(arquivosPorDocumento.witness_doc)
  if (witnessFiles.length > 0) {
    specs.push({
      etapa: 'validacao',
      chave: 'documents.arquivos_por_documento.witness_doc',
      rotulo: `Documento com foto — ${getValueAtPath(data, 'witness.name') || 'Testemunha do Parceiro'}`,
      tipo: 'documento',
      valor: witnessFiles,
    })
  }

  return specs
}

/** Leitura mínima de `corban_data.divergencias_receita`, sem depender do módulo de provenance para o tipo completo. */
function getDivergenciasReceitaLocal(corbanData: Record<string, any>): Array<{ tipo: string }> {
  const raw = corbanData?.divergencias_receita
  return Array.isArray(raw) ? raw : []
}

// =========================================================================
// Geração do checklist — etapa `analise`
// =========================================================================

/**
 * Gera a especificação do checklist da etapa `analise`: 1 Serasa por CPF de
 * sócio/administrador/testemunha (+ CPF do titular quando PF), 1 cartão CNPJ
 * e a conferência de telefones/e-mails declarados contra os dados da Receita.
 */
export function buildAnaliseChecklistSpec(
  corbanData: Record<string, any> | null | undefined,
  personType: 'PF' | 'PJ',
  cpfCnpj: string,
): ChecklistItemSpec[] {
  const data = corbanData || {}
  const specs: ChecklistItemSpec[] = []

  const cpfsAnalisados = new Set<string>()
  for (const socio of getSocios(data)) {
    const cpf = onlyDigits(socio.cpf)
    if (cpf) cpfsAnalisados.add(cpf)
  }
  for (const admin of getAdministracao(data)) {
    const cpf = onlyDigits(admin.cpf)
    if (cpf) cpfsAnalisados.add(cpf)
  }
  const witnessCpf = onlyDigits(data?.witness?.cpf)
  if (witnessCpf) cpfsAnalisados.add(witnessCpf)
  if (personType === 'PF') {
    const masterCpf = onlyDigits(cpfCnpj)
    if (masterCpf) cpfsAnalisados.add(masterCpf)
  }

  for (const cpf of cpfsAnalisados) {
    specs.push({
      etapa: 'analise',
      chave: `analise:serasa:cpf:${cpf}`,
      rotulo: `Consulta Serasa — CPF ${cpf}`,
      tipo: 'analise',
      valor: null,
    })
  }

  if (personType === 'PJ') {
    const cnpj = onlyDigits(cpfCnpj)
    if (cnpj) {
      specs.push({
        etapa: 'analise',
        chave: `analise:cartao_cnpj:cnpj:${cnpj}`,
        rotulo: `Cartão CNPJ — ${cnpj}`,
        tipo: 'analise',
        valor: null,
      })
    }
  }

  specs.push({
    etapa: 'analise',
    chave: 'analise:conferencia:telefones',
    rotulo: 'Conferência de Telefones (declarado × Receita)',
    tipo: 'analise',
    valor: {
      declarados: [data?.contacts?.phone_whatsapp, data?.contacts?.phone_commercial].filter(Boolean),
      receita: [data?.contacts?.phone_rfb_1, data?.contacts?.phone_rfb_2].filter(Boolean),
    },
  })

  specs.push({
    etapa: 'analise',
    chave: 'analise:conferencia:emails',
    rotulo: 'Conferência de E-mails (declarado × Receita)',
    tipo: 'analise',
    valor: {
      declarados: [data?.contacts?.email_comissao, data?.contacts?.email_informe].filter(Boolean),
      receita: [data?.contacts?.email_rfb].filter(Boolean),
    },
  })

  return specs
}

// =========================================================================
// Formatação de exibição do checklist
// =========================================================================

/** CEP no padrão pedido para a revisão (`72.549-525`) — diferente da máscara de input (`72549-525`). */
function formatCepChecklist(value: any): string {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 8)
  if (digits.length !== 8) return String(value ?? '')
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}-${digits.slice(5, 8)}`
}

function formatBooleanChecklist(value: any): string {
  if (value === true || value === 'true') return 'Sim'
  if (value === false || value === 'false') return 'Não'
  return String(value ?? '—')
}

const GENDER_LABELS: Record<string, string> = { feminino: 'Feminino', masculino: 'Masculino' }

/**
 * `kind` de exibição pelo SUFIXO do path (último segmento, ignorando índices
 * numéricos) — cobre `socios.N.*`, `administracao.N.*`, `pessoas.N.*` e
 * `witness.*` com um único mapa, sem depender de índices fixos 0/1.
 */
const SUFFIX_KEY_KIND: Partial<Record<string, FieldKind>> = {
  cpf: 'cpf',
  cnpj: 'cnpj',
  birth_date: 'date',
  email: 'email',
  phone: 'phone',
  cep: 'cep',
  residential_cep: 'cep',
  address_state: 'uf',
  residential_address_state: 'uf',
  is_administrador: 'boolean',
  tem_cnae_corban: 'boolean',
}

/**
 * Resolve o `kind` de exibição de um item do checklist a partir da sua
 * `chave`: busca no dicionário canônico pelo path exato e, quando não acha
 * (sócios/administração/pessoas/testemunha usam índices dinâmicos que o
 * dicionário não cobre), cai no mapa `SUFFIX_KEY_KIND` pelo último segmento.
 */
export function resolveChecklistFieldKind(chave: string): FieldKind | undefined {
  const dictField = getFieldByPath(chave)
  if (dictField) return dictField.kind

  const segments = chave.split('.')
  const last = segments[segments.length - 1]
  return SUFFIX_KEY_KIND[last]
}

/**
 * Formata listas vindas de consulta automática que guardam objetos (CNAEs
 * secundários `{code,desc}`, inscrições estaduais `{numero,uf,ativo}`) como
 * texto legível, 1 por linha — em vez do JSON cru. Use com `white-space:
 * pre-line` na exibição.
 */
function formatArrayValue(valor: any[]): string {
  return valor
    .map((item) => {
      if (item && typeof item === 'object') {
        if ('code' in item && 'desc' in item) return `${item.code} — ${item.desc}`
        if ('numero' in item) {
          const uf = item.uf ? ` (${item.uf})` : ''
          const status = item.ativo === false ? ' — inativa' : ''
          return `${item.numero}${uf}${status}`
        }
        return JSON.stringify(item)
      }
      return String(item)
    })
    .join('\n')
}

/** Formata o valor de um item do checklist para exibição, conforme o `kind` do campo de origem. */
export function formatChecklistItemValue(chave: string, valor: any): string {
  if (valor === null || valor === undefined || valor === '') return '—'

  const kind = resolveChecklistFieldKind(chave)
  switch (kind) {
    case 'date':
      return formatDateDisplay(valor) || String(valor)
    case 'currency':
      return formatCurrencyDisplay(valor) || String(valor)
    case 'phone':
      return maskPhone(String(valor)) || String(valor)
    case 'cep':
      return formatCepChecklist(valor)
    case 'cpf':
    case 'cnpj':
    case 'cpf_cnpj':
      return formatCpfOrCnpjDisplay(valor) || String(valor)
    case 'boolean':
      return formatBooleanChecklist(valor)
    case 'multiselect':
      return Array.isArray(valor) ? valor.join(', ') : String(valor)
    default:
      if (chave.endsWith('.gender') && typeof valor === 'string') return GENDER_LABELS[valor] || valor
      if (Array.isArray(valor)) return formatArrayValue(valor)
      if (typeof valor === 'object') return JSON.stringify(valor)
      return String(valor)
  }
}

// =========================================================================
// Re-exports de conveniência (evita import duplicado nas telas)
// =========================================================================

export { getFieldProvenance, getDivergenciasReceita, hasCnaeCorban, type DivergenciaReceita } from './agente-corban-provenance'
export {
  getAdministracao,
  getPessoasExternas,
  getSignatarios,
  getSocios,
  getSociosPF,
  getSociosPJ,
  resolvePersonByCpf,
  resolveSignatario,
  sumCapitalShare,
  validateCapitalSocial,
  EMPRESA_TIPO_LABELS,
  type AdministracaoItem,
  type PersonRef,
  type PessoaExterna,
  type SocioItem,
} from './agente-corban-signatarios'
