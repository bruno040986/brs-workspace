/**
 * Importador de Tabelas de Comissão — modelo padronizado (CSV/XLSX).
 * Regras (Bruno, 24/08/2026): referência não reconhecida CRITICA e o operador
 * aponta o cadastro certo (nunca auto-cadastra); registro existente (match por
 * id_arw → financeira+código → financeira+nome) vira ATUALIZAÇÃO com diff
 * aprovável; aplicar exige tudo resolvido.
 */

export const MODELO_TABELAS_HEADERS = [
  // Identidade/atributos da TABELA DE COMISSÃO (passo 1)
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
  // Campos do PRAZO COMISSÃO (passo 2 — ignorados no passo 1)
  'forma_pagamento',
  'valor_inicial',
  'valor_final',
  'prazo_inicial',
  'prazo_final',
  'data_base',
  'manter_enquadramento',
  'comissao',
  'emissao',
  'seguro_valor',
  'forma_pagamento_seguro',
  'data_bloqueio',
] as const

/** Colunas exigidas no passo 1 (Tabelas). As demais são toleradas/ignoradas. */
export const COLUNAS_TABELA = [
  'codigo_tabela_banco', 'nome', 'financeira', 'promotora', 'forma_contrato',
  'convenio', 'tipo_formalizacao', 'seguro', 'taxa_juros_tipo', 'taxa_juros',
  'taxa_juros_min', 'taxa_juros_max', 'observacao',
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
  'faixa_percentual',
  '10000,00',
  '100000,00',
  '1',
  '10',
  '19/02/2026',
  'sim',
  '6,85',
  '0',
  '0',
  '',
  '',
]

export function gerarModeloCsv(): string {
  return `${MODELO_TABELAS_HEADERS.join(';')}\n${MODELO_TABELAS_EXEMPLO.join(';')}\n`
}

/** Linha de tabela cadastrada, já com os vínculos resolvidos para nome (como a tela lista). */
export type TabelaParaExportar = {
  codigo_tabela_banco: string | null
  nome: string
  financeira: string
  promotora: string
  forma_contrato: string
  convenio: string
  tipo_formalizacao: string
  com_seguro: boolean | null
  taxa_juros_tipo: 'fixa' | 'faixa' | null
  taxa_juros: number | null
  taxa_juros_min: number | null
  taxa_juros_max: number | null
  observacao: string | null
}

function csvCelula(value: unknown): string {
  const texto = value === null || value === undefined ? '' : String(value)
  // Aspas quando houver separador, quebra de linha ou aspas — padrão CSV.
  return /[;"\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

function taxaCsv(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value).replace('.', ',')
}

/**
 * Exporta as tabelas cadastradas no MESMO layout do modelo de importação:
 * as 13 colunas de tabela preenchidas, as 12 de prazo em branco — o operador
 * completa só os prazos e sobe a planilha direto no Passo 2 do importador.
 */
export function gerarCsvTabelasCadastradas(tabelas: TabelaParaExportar[]): string {
  const colunasPrazo = MODELO_TABELAS_HEADERS.length - COLUNAS_TABELA.length
  const linhas = tabelas.map((t) => {
    const celulas = [
      t.codigo_tabela_banco,
      t.nome,
      t.financeira,
      t.promotora,
      t.forma_contrato,
      t.convenio,
      t.tipo_formalizacao,
      t.com_seguro === true ? 'com' : t.com_seguro === false ? 'sem' : '',
      t.taxa_juros_tipo || '',
      t.taxa_juros_tipo === 'fixa' ? taxaCsv(t.taxa_juros) : '',
      t.taxa_juros_tipo === 'faixa' ? taxaCsv(t.taxa_juros_min) : '',
      t.taxa_juros_tipo === 'faixa' ? taxaCsv(t.taxa_juros_max) : '',
      t.observacao,
      ...Array.from({ length: colunasPrazo }, () => ''),
    ]
    return celulas.map(csvCelula).join(';')
  })
  // BOM para o Excel abrir acentos corretamente.
  return `﻿${MODELO_TABELAS_HEADERS.join(';')}\n${linhas.join('\n')}\n`
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
  status: 'nova' | 'atualizacao' | 'sem_mudanca' | 'pendencia' | 'invalida' | 'repetida'
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
  repetidas: number
}

/** Resoluções apontadas pelo operador: `${campo}::${textoNormalizado}` -> id. */
export type Resolucoes = Record<string, string>

export function chaveResolucao(campo: CampoReferencia, textoNormalizado: string) {
  return `${campo}::${textoNormalizado}`
}

// ---------------------------------------------------------------------------
// Parsers do passo 2 (Prazo Comissão)
// ---------------------------------------------------------------------------

export function parseFormaPagamentoPlanilha(value: unknown): string | null {
  const texto = normalizarTexto(value)
  if (!texto) return 'percentual'
  if (texto === '1' || texto.includes('percentual') && !texto.includes('faixa')) return 'percentual'
  if (texto === '2' || (texto.includes('fixo') && !texto.includes('faixa'))) return 'fixo'
  if (texto === '3' || (texto.includes('faixa') && texto.includes('percentual'))) return 'faixa_percentual'
  if (texto === '4' || (texto.includes('faixa') && (texto.includes('fixo') || texto.includes('valor')))) return 'faixa_fixo'
  return null
}

export function parseDataPlanilha(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  // Datas numéricas do Excel (dias desde 1899-12-30).
  if (typeof value === 'number' && Number.isFinite(value) && value > 20000 && value < 80000) {
    const base = Date.UTC(1899, 11, 30)
    return new Date(base + Math.round(value) * 86400000).toISOString().slice(0, 10)
  }
  const texto = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10)
  const br = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`
  return null
}

export function parseSimNao(value: unknown, padrao: boolean): boolean {
  const texto = normalizarTexto(value)
  if (!texto) return padrao
  if (['sim', 's', 'true', '1'].includes(texto)) return true
  if (['nao', 'não', 'n', 'false', '0'].includes(texto)) return false
  return padrao
}

export function parseIntPlanilha(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
