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
] as const

export const CAMPOS_DO_CRM = ['funil_estagio', 'funil_atualizado_em', 'estado_local', 'ofertas'] as const

/** Tags gerenciadas exclusivamente pelo Workspace. */
export const TAG_PARCEIRO_PREFIXO = 'parceiro:'
export const TAG_CLIENTE_PREFIXO = 'cliente:'
export const TAG_BASE_PREFIXO = 'base:'
export const TAG_CAMPANHA_PREFIXO = 'campanha:'
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
export function tagCampanha(codigo: string) {
  return `${TAG_CAMPANHA_PREFIXO}${String(codigo || '').trim().toLowerCase()}`
}

/**
 * Campos personalizados de CONTATO usados pelo AlvoConsig. `cpf` e
 * `dono_alvoconsig` já existiam (worker da fila, Fase 1 do CRM); os demais
 * nascem sob demanda via `ensureCustomField` na importação/campanha.
 *
 * Margem (foto sem histórico) e as ofertas (REFIN/Novo/Cartão, cada uma sua
 * própria Oportunidade) ficam em src/lib/alvoconsig/ofertas-wesales.ts.
 */
export const WESALES_FIELD_KEYS = {
  cpf: 'cpf',
  /** "Matrícula Funcional" (Dados de Crédito, TEXT). */
  matricula: 'matricula_funcional',
  /**
   * "Convênio (Código Workspace)" — Dados de Crédito, NUMERICAL. Grava
   * `convenios.codigo_sistema` ("00001"); como o campo é numérico, o WeSales
   * guarda 1 (perde os zeros). A busca `eq "00001"` continua funcionando
   * (a API converte), mas ao LER use `indexarConveniosPorCodigo` /
   * `codigoConvenioChave` pra casar "1" com "00001".
   */
  convenioCodigo: 'convenio_codigo',
  // Reaproveita o MESMO fieldKey que o CLT já usa (nome_convenio="CLT" fixo) —
  // decisão do Bruno 29/08/2026: é o mesmo conceito ("nome do convênio/vínculo
  // do contato"), só a origem do valor muda (CLT: constante; AlvoConsig: o
  // nome_reduzido cadastrado no convênio, pra ficar padronizado).
  nomeConvenio: 'nome_convenio',
  // Demografia copiada pra crm_contatos na alocação (filtros de campanha do
  // parceiro). Vêm da higienização NVTI, que não é obrigatória — ausência
  // vira NULL ("não informado").
  sexo: 'nvti_sexo',
  /** "Vínculo Funcional" — SINGLE_OPTIONS: CLT | Efetivo | Temporário | Comissionado | Emprestado | Aposentado | Pensionista. */
  vinculo: 'vinculo_funcional',
  /**
   * "Código de Parceiro BRS" — código ARW do parceiro DONO do contato
   * (espelho legível da tag `parceiro:<arw>`); gravado na alocação da
   * campanha e limpo na devolução pro pool.
   */
  codigoParceiro: 'codigo_de_parceiro_brs',
} as const

/**
 * Chave de comparação do código de convênio: o WeSales devolve o NUMERICAL
 * sem zeros à esquerda ("1"), o Workspace guarda "00001". Normaliza os dois
 * lados pro mesmo inteiro em texto ("1").
 */
export function codigoConvenioChave(valor: string | number | null | undefined): string | null {
  const digitos = String(valor ?? '').replace(/\D/g, '')
  if (!digitos) return null
  return String(Number.parseInt(digitos, 10))
}

/** Map código_sistema (normalizado) → convenio.id, pra casar o valor lido do WeSales. */
export function indexarConveniosPorCodigo(rows: Array<{ id: string; codigo_sistema: string | null }> | null | undefined): Map<string, string> {
  const map = new Map<string, string>()
  for (const conv of rows || []) {
    const chave = codigoConvenioChave(conv.codigo_sistema)
    if (chave) map.set(chave, String(conv.id))
  }
  return map
}

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
