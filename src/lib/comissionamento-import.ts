/**
 * Importador de Tabelas de Comissão — modelo padronizado (CSV/XLSX).
 * Regras (Bruno, 24/08/2026): referência não reconhecida CRITICA e o operador
 * aponta o cadastro certo (nunca auto-cadastra); registro existente (match por
 * id_arw → financeira+código → financeira+nome) vira ATUALIZAÇÃO com diff
 * aprovável; aplicar exige tudo resolvido.
 */

export const MODELO_TABELAS_HEADERS = [
  'codigo_tabela_banco',
  'nome',
  'financeira',
  'promotora',
  'forma_contrato',
  'convenio',
  'tipo_formalizacao',
  'seguro',
  'taxa_juros_tipo',
  'taxa_juros',
  'taxa_juros_min',
  'taxa_juros_max',
  'observacao',
  'id_arw',
] as const

export const MODELO_TABELAS_EXEMPLO = [
  '827004875',
  'REFIN 1 OFERTA C/ SEGURO TX 2,38%',
  'BANCO SANTANDER',
  '',
  'Refin',
  'Prefeitura de Salto/SP',
  'Digital',
  'com',
  'fixa',
  '2,38',
  '',
  '',
  '',
  '113149',
]

export function gerarModeloCsv(): string {
  return `${MODELO_TABELAS_HEADERS.join(';')}\n${MODELO_TABELAS_EXEMPLO.join(';')}\n`
}

/** Normalização para casar nomes/códigos e memorizar de-paras. */
export function normalizarTexto(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseSeguro(value: unknown): boolean | null {
  const texto = normalizarTexto(value)
  if (!texto) return null
  if (['com', 'com seguro', 'sim', 's', 'true', '1'].includes(texto)) return true
  if (['sem', 'sem seguro', 'nao', 'não', 'n', 'false', '0'].includes(texto)) return false
  return null
}

export function parseTaxaPlanilha(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null
  const texto = String(value).trim().replace(/%/g, '').replace(/\./g, '').replace(',', '.')
  const parsed = Number.parseFloat(texto)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export type CampoReferencia = 'financeira' | 'promotora' | 'convenio' | 'forma_contrato' | 'tipo_formalizacao'

export type PendenciaLinha = {
  campo: CampoReferencia
  texto: string
  textoNormalizado: string
}

export type DiffCampo = {
  campo: string
  label: string
  atual: string
  novo: string
}

export type LinhaAnalisada = {
  n: number
  status: 'nova' | 'atualizacao' | 'sem_mudanca' | 'pendencia' | 'invalida'
  erro?: string
  dados: {
    codigo_tabela_banco: string | null
    nome: string
    financeira_texto: string
    promotora_texto: string
    forma_texto: string
    convenio_texto: string
    formalizacao_texto: string
    institution_id: string | null
    promotora_id: string | null
    forma_contrato_id: string | null
    convenio_id: string | null
    tipo_formalizacao_id: string | null
    com_seguro: boolean | null
    taxa_juros_tipo: 'fixa' | 'faixa' | null
    taxa_juros: number | null
    taxa_juros_min: number | null
    taxa_juros_max: number | null
    observacao: string
    id_arw: string | null
  }
  pendencias: PendenciaLinha[]
  matchId: string | null
  diff: DiffCampo[]
}

export type ResumoAnalise = {
  total: number
  novas: number
  atualizacoes: number
  semMudanca: number
  pendencias: number
  invalidas: number
}

/** Resoluções apontadas pelo operador: `${campo}::${textoNormalizado}` -> id. */
export type Resolucoes = Record<string, string>

export function chaveResolucao(campo: CampoReferencia, textoNormalizado: string) {
  return `${campo}::${textoNormalizado}`
}
