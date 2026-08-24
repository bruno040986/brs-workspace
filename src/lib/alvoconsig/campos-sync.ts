/**
 * Regra de DONO DE CAMPO entre a cópia de trabalho (crm_contatos) e o WeSales.
 * Ver docs/SPEC-CRM-WESALES-CAMPANHAS.md §2. Consumido pelo worker da fila
 * (outbound) e pelo webhook (inbound) nas Fases 2–3.
 *
 * • WeSales é dono dos dados do contato: o webhook SOBRESCREVE a cópia local.
 * • CRM é dono do atendimento durante a campanha: a fila LEVA ao WeSales; o
 *   webhook NÃO sobrescreve esses campos enquanto a campanha estiver ativa.
 * • Tags parceiro:/cliente: são do Workspace (alocação/certificação).
 */

export const CAMPOS_DO_WESALES = [
  'nome',
  'telefone',
  'cpf',
  'convenio_id',
  'codigo_empregador',
  'matricula',
  'margem_novo',
  'margem_cartao_rmc',
  'margem_cartao_rcc',
  'refin_troco',
  'refin',
] as const

export const CAMPOS_DO_CRM = ['funil_estagio', 'funil_atualizado_em', 'estado_local', 'ofertas'] as const

/** Tags gerenciadas exclusivamente pelo Workspace. */
export const TAG_PARCEIRO_PREFIXO = 'parceiro:'
export const TAG_CLIENTE_PREFIXO = 'cliente:'
export const TAG_BASE_PREFIXO = 'base:'
/**
 * Tag "disponivel": bookkeeping da alocação. O WeSales não tem exclusão de
 * tag por prefixo/wildcard (só valor exato), então não dá para perguntar
 * "sem nenhuma tag parceiro:*" diretamente. Em vez disso, todo contato
 * elegível para campanha carrega esta tag; alocar REMOVE "disponivel" e
 * ADICIONA "parceiro:<arw>"; encerrar campanha sem certificação faz o
 * inverso (volta pro pool — nunca se descarta lead, só se libera de novo).
 * Contato com tag `cliente:*` NUNCA recebe "disponivel" de volta.
 */
export const TAG_DISPONIVEL = 'disponivel'

export function tagParceiro(arwCode: string) {
  return `${TAG_PARCEIRO_PREFIXO}${String(arwCode || '').trim().toLowerCase()}`
}
export function tagCliente(arwCode: string) {
  return `${TAG_CLIENTE_PREFIXO}${String(arwCode || '').trim().toLowerCase()}`
}
export function tagBase(slug: string) {
  return `${TAG_BASE_PREFIXO}${String(slug || '').trim().toLowerCase().replace(/\s+/g, '-')}`
}

/**
 * Campos personalizados do WeSales usados pelo AlvoConsig (Fase 2). `cpf` e
 * `dono_alvoconsig` já existiam (worker da fila, Fase 1 do CRM); os demais
 * nascem sob demanda via `ensureCustomField` na importação/campanha.
 */
export const WESALES_FIELD_KEYS = {
  cpf: 'cpf',
  matricula: 'alvoconsig_matricula',
  convenioCodigo: 'alvoconsig_convenio_codigo',
  margemNovo: 'alvoconsig_margem_novo',
  margemCartaoRmc: 'alvoconsig_margem_cartao_rmc',
  margemCartaoRcc: 'alvoconsig_margem_cartao_rcc',
  refinTroco: 'alvoconsig_refin_troco',
  refinParcela: 'alvoconsig_refin_parcela',
  refinPrazo: 'alvoconsig_refin_prazo',
  refinTaxa: 'alvoconsig_refin_taxa',
} as const

/** Estágios em que a cópia local NÃO pode ser expurgada no fim da campanha. */
export const ESTAGIOS_NEGOCIACAO_ABERTA = [
  'oferta_realizada',
  'documentos_enviados',
  'em_digitacao',
  'em_formalizacao',
  'aguardando_pagamento',
] as const

/** Volume máximo para importação via API (acima disso: CSV nativo do WeSales). */
export const LIMITE_IMPORTACAO_API = 2000

/** Ritmo do worker: limite real do WeSales ≈ 100 req/10 s; margem de segurança. */
export const WORKER_OPS_POR_MINUTO = 300
