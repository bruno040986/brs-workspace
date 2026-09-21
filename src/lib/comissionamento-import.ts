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

function celulasTabela(t: TabelaParaExportar): unknown[] {
  return [
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
  ]
}

function montarCsv(linhas: unknown[][]): string {
  // BOM para o Excel abrir acentos corretamente.
  return `﻿${MODELO_TABELAS_HEADERS.join(';')}\n${linhas.map((l) => l.map(csvCelula).join(';')).join('\n')}\n`
}

/**
 * Exporta as tabelas cadastradas no MESMO layout do modelo de importação:
 * as 13 colunas de tabela preenchidas, as 12 de prazo em branco — o operador
 * completa só os prazos e sobe a planilha direto no Passo 2 do importador.
 */
export function gerarCsvTabelasCadastradas(tabelas: TabelaParaExportar[]): string {
  const colunasPrazo = MODELO_TABELAS_HEADERS.length - COLUNAS_TABELA.length
  return montarCsv(tabelas.map((t) => [...celulasTabela(t), ...Array.from({ length: colunasPrazo }, () => '')]))
}

/** Prazo cadastrado + a tabela dele, para exportação completa. */
export type PrazoParaExportar = {
  tabela: TabelaParaExportar
  forma_pagamento: string | null
  valor_inicial: number | null
  valor_final: number | null
  prazo_inicial: number | null
  prazo_final: number | null
  data_base: string | null
  manter_enquadramento: boolean | null
  comissao: number | null
  emissao: number | null
  seguro: number | null
  forma_pagamento_seguro: string | null
  data_bloqueio: string | null
}

function dataCsv(value: string | null | undefined): string {
  // ISO (yyyy-mm-dd) -> dd/mm/yyyy, formato que o importador aceita.
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/**
 * Exporta os PRAZOS cadastrados com as 25 colunas preenchidas (tabela + prazo).
 * Reimportável direto no Passo 2: cada linha casa pela identidade da tabela +
 * intervalo de prazo + faixa de valores, e vira ATUALIZAÇÃO com diff aprovável
 * — é o caminho para atualização de comissão em lote.
 */
export function gerarCsvPrazosCadastrados(prazos: PrazoParaExportar[]): string {
  return montarCsv(
    prazos.map((p) => [
      ...celulasTabela(p.tabela),
      p.forma_pagamento || '',
      taxaCsv(p.valor_inicial),
      taxaCsv(p.valor_final),
      p.prazo_inicial ?? '',
      p.prazo_final ?? '',
      dataCsv(p.data_base),
      p.manter_enquadramento === false ? 'nao' : 'sim',
      taxaCsv(p.comissao),
      taxaCsv(p.emissao),
      taxaCsv(p.seguro),
      p.forma_pagamento_seguro || '',
      dataCsv(p.data_bloqueio),
    ]),
  )
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

/**
 * Discriminador da Tabela de Comissão dentro da combinação financeira +
 * promotora + forma + convênio. O código no banco é a identidade quando existe;
 * o banco nem sempre informa código (coluna nula) e aí o NOME assume o papel —
 * sem isso duas tabelas sem código da mesma combinação colapsariam numa só. O
 * prefixo impede que uma tabela sem código case com uma que tem código.
 */
export function discriminadorTabela(codigoBanco: unknown, nome: unknown): string {
  const codigo = normalizarTexto(codigoBanco)
  return codigo ? `cod:${codigo}` : `nome:${normalizarTexto(nome)}`
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
// Passo 2 (Prazos): qual Tabela de Comissão a linha está "pedindo"
// ---------------------------------------------------------------------------
// (Bruno, 21/09/2026) A tabela é um cadastro único e os prazos (inicial/final)
// se repetem nela: cada linha da planilha repete a tabela e traz um prazo.
// COM código no banco: financeira + promotora + forma + convênio + código — nome
// e juros continuam atualizáveis pelo passo 1 (com aprovação), então não entram.
// SEM código: nada identifica a tabela sozinho, então os demais campos são
// validados TODOS (menos observação); se algum não bate, NÃO é a mesma tabela.
// Só o passo 2 usa isto — o passo 1 (Tabelas) não muda.

/** Campos da tabela comparados quando a linha não tem código (tudo, menos observação). */
export type CamposTabela = {
  codigo_tabela_banco: string | null
  nome: string
  institution_id: string | null
  promotora_id: string | null
  forma_contrato_id: string | null
  convenio_id: string | null
  tipo_formalizacao_id: string | null
  com_seguro: boolean | null
  taxa_juros_tipo: string | null
  taxa_juros: number | null
  taxa_juros_min: number | null
  taxa_juros_max: number | null
}

/** Tabela já cadastrada: os campos acima + chaves de acesso. */
export type TabelaCadastrada = CamposTabela & { id: string; id_arw: string | null }

type CampoTabela = {
  label: string
  chave: (t: CamposTabela) => string
  exibir: (t: CamposTabela, nomes: Map<string, string>) => string
}

// As taxas são numeric(8,4) no banco: comparar na mesma escala.
function numeroChave(valor: number | string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return ''
  const n = Number(valor)
  return Number.isFinite(n) ? String(Math.round(n * 10000) / 10000) : ''
}

function taxaTexto(valor: number | null): string {
  const chave = numeroChave(valor)
  return chave ? chave.replace('.', ',') : '-'
}

// Valores de juros que não pertencem ao tipo escolhido (sobra de edição) não contam.
function jurosChave(t: CamposTabela): string {
  if (t.taxa_juros_tipo === 'fixa') return `fixa:${numeroChave(t.taxa_juros)}`
  if (t.taxa_juros_tipo === 'faixa') return `faixa:${numeroChave(t.taxa_juros_min)}:${numeroChave(t.taxa_juros_max)}`
  return ''
}

function jurosTexto(t: CamposTabela): string {
  if (t.taxa_juros_tipo === 'fixa') return `Fixa ${taxaTexto(t.taxa_juros)}%`
  if (t.taxa_juros_tipo === 'faixa') return `Faixa ${taxaTexto(t.taxa_juros_min)}% a ${taxaTexto(t.taxa_juros_max)}%`
  return '-'
}

const nomeRef = (id: string | null, nomes: Map<string, string>, vazio = '-') => (id ? nomes.get(id) || id : vazio)

const CAMPOS_TABELA: CampoTabela[] = [
  { label: 'Código no banco', chave: (t) => normalizarTexto(t.codigo_tabela_banco), exibir: (t) => t.codigo_tabela_banco || '-' },
  { label: 'Nome', chave: (t) => normalizarTexto(t.nome), exibir: (t) => t.nome || '-' },
  { label: 'Financeira', chave: (t) => t.institution_id || '', exibir: (t, nomes) => nomeRef(t.institution_id, nomes) },
  { label: 'Promotora', chave: (t) => t.promotora_id || '', exibir: (t, nomes) => nomeRef(t.promotora_id, nomes, 'Direto') },
  { label: 'Forma de contrato', chave: (t) => t.forma_contrato_id || '', exibir: (t, nomes) => nomeRef(t.forma_contrato_id, nomes) },
  { label: 'Convênio', chave: (t) => t.convenio_id || '', exibir: (t, nomes) => nomeRef(t.convenio_id, nomes) },
  { label: 'Formalização', chave: (t) => t.tipo_formalizacao_id || '', exibir: (t, nomes) => nomeRef(t.tipo_formalizacao_id, nomes) },
  {
    label: 'Seguro',
    chave: (t) => (t.com_seguro === true ? 'com' : t.com_seguro === false ? 'sem' : ''),
    exibir: (t) => (t.com_seguro === true ? 'Com seguro' : t.com_seguro === false ? 'Sem seguro' : '-'),
  },
  { label: 'Taxa de juros', chave: jurosChave, exibir: jurosTexto },
]

/** Todos os campos da tabela (menos observação): igual aqui = mesma tabela, quando não há código. */
export function chaveTabelaCompleta(t: CamposTabela): string {
  return JSON.stringify(CAMPOS_TABELA.map((campo) => campo.chave(t)))
}

/** Regra de sempre para tabela COM código: financeira + promotora + forma + convênio + código. */
function chaveComCodigo(t: CamposTabela): string {
  return JSON.stringify([t.institution_id || '', t.promotora_id || '', t.forma_contrato_id || '', t.convenio_id || '', normalizarTexto(t.codigo_tabela_banco)])
}

/** Campos em que duas tabelas diferem, com o valor de cada lado (para mensagens). */
export function camposDiferentes(a: CamposTabela, b: CamposTabela, nomes: Map<string, string>): Array<{ label: string; a: string; b: string }> {
  return CAMPOS_TABELA.filter((campo) => campo.chave(a) !== campo.chave(b)).map((campo) => ({
    label: campo.label,
    a: campo.exibir(a, nomes),
    b: campo.exibir(b, nomes),
  }))
}

export type IndiceTabelas<T extends TabelaCadastrada> = {
  tabelas: T[]
  porCodigo: Map<string, T[]>
  porChave: Map<string, T[]>
  porArw: Map<string, T>
}

function agrupar<T>(mapa: Map<string, T[]>, chave: string, item: T) {
  const grupo = mapa.get(chave)
  if (grupo) grupo.push(item)
  else mapa.set(chave, [item])
}

export function indexarTabelas<T extends TabelaCadastrada>(tabelas: T[]): IndiceTabelas<T> {
  const porCodigo = new Map<string, T[]>()
  const porChave = new Map<string, T[]>()
  const porArw = new Map<string, T>()
  for (const tabela of tabelas) {
    if (normalizarTexto(tabela.codigo_tabela_banco)) agrupar(porCodigo, chaveComCodigo(tabela), tabela)
    agrupar(porChave, chaveTabelaCompleta(tabela), tabela)
    const arw = normalizarTexto(tabela.id_arw)
    if (arw && !porArw.has(arw)) porArw.set(arw, tabela)
  }
  return { tabelas, porCodigo, porChave, porArw }
}

/**
 * Cadastros que são a tabela pedida pela linha: o id_arw manda quando bate;
 * com código, vale financeira + promotora + forma + convênio + código; sem
 * código, todos os demais campos precisam bater (e só casa com tabela que também
 * não tem código). Mais de uma = cópias idênticas no cadastro, na ordem indexada.
 */
export function candidatasDaLinha<T extends TabelaCadastrada>(indice: IndiceTabelas<T>, campos: CamposTabela, idArw: string | null): T[] {
  const arw = normalizarTexto(idArw)
  const porArw = arw ? indice.porArw.get(arw) : undefined
  if (porArw) return [porArw]
  if (normalizarTexto(campos.codigo_tabela_banco)) return indice.porCodigo.get(chaveComCodigo(campos)) || []
  return indice.porChave.get(chaveTabelaCompleta(campos)) || []
}

/** Mensagem para linha sem tabela: sem código, mostra em que campos a de mesmo nome mais parecida difere. */
export function explicarTabelaNaoEncontrada<T extends TabelaCadastrada>(indice: IndiceTabelas<T>, campos: CamposTabela, nomes: Map<string, string>): string {
  if (normalizarTexto(campos.codigo_tabela_banco)) {
    return 'Tabela de Comissão não encontrada com essa combinação (financeira + promotora + forma + convênio + código no banco). Rode primeiro o passo 1 — Tabelas.'
  }
  const nome = normalizarTexto(campos.nome)
  if (!nome) return 'Linha sem código no banco e sem nome da tabela: preencha "nome" (ou "id_arw") para localizar a Tabela de Comissão.'
  const mesmoNome = indice.tabelas.filter((t) => normalizarTexto(t.nome) === nome)
  if (mesmoNome.length === 0) return `Não há Tabela de Comissão com o nome "${campos.nome}". Rode primeiro o passo 1 — Tabelas.`
  let melhor = camposDiferentes(campos, mesmoNome[0], nomes)
  for (const t of mesmoNome.slice(1)) {
    const diferencas = camposDiferentes(campos, t, nomes)
    if (diferencas.length < melhor.length) melhor = diferencas
  }
  const detalhe = melhor.map((d) => `${d.label} (planilha: ${d.a} × cadastro: ${d.b})`).join('; ')
  return `Sem código no banco, todos os campos da tabela precisam bater. A tabela de mesmo nome mais parecida difere em: ${detalhe}. Corrija a linha ou rode o passo 1 — Tabelas.`
}

export type CamposTabelaLidos = Omit<LinhaAnalisada['dados'], 'observacao' | 'id_arw'>

/**
 * Lê da linha da planilha os campos da tabela (com os textos originais, para as
 * pendências). É a MESMA leitura que o passo 1 faz em import-tabelas/route.ts:
 * manter as duas em sincronia, senão a tabela criada no passo 1 não bate no passo 2.
 */
export function lerCamposTabela(
  coluna: (nome: string) => unknown,
  resolver: (campo: CampoReferencia, texto: string) => string | null,
): CamposTabelaLidos {
  const texto = (nome: string) => String(coluna(nome) ?? '').trim()
  const financeira = texto('financeira')
  const promotora = texto('promotora')
  const forma = texto('forma_contrato')
  const convenio = texto('convenio')
  const formalizacao = texto('tipo_formalizacao')
  const jurosTipoTexto = normalizarTexto(coluna('taxa_juros_tipo'))
  const jurosTipo = jurosTipoTexto === 'fixa' ? 'fixa' : jurosTipoTexto === 'faixa' ? 'faixa' : null

  return {
    codigo_tabela_banco: texto('codigo_tabela_banco') || null,
    nome: texto('nome'),
    financeira_texto: financeira,
    promotora_texto: promotora,
    forma_texto: forma,
    convenio_texto: convenio,
    formalizacao_texto: formalizacao,
    institution_id: resolver('financeira', financeira),
    promotora_id: promotora ? resolver('promotora', promotora) : null,
    forma_contrato_id: resolver('forma_contrato', forma),
    convenio_id: convenio ? resolver('convenio', convenio) : null,
    tipo_formalizacao_id: formalizacao ? resolver('tipo_formalizacao', formalizacao) : null,
    com_seguro: parseSeguro(coluna('seguro')),
    taxa_juros_tipo: jurosTipo,
    taxa_juros: jurosTipo === 'fixa' ? parseTaxaPlanilha(coluna('taxa_juros')) : null,
    taxa_juros_min: jurosTipo === 'faixa' ? parseTaxaPlanilha(coluna('taxa_juros_min')) : null,
    taxa_juros_max: jurosTipo === 'faixa' ? parseTaxaPlanilha(coluna('taxa_juros_max')) : null,
  }
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
