/**
 * Filtros das telas Tabelas de Comissão e Prazos Comissão (referência: os
 * filtros essenciais do ARW, definidos pelo Bruno em 21/09/2026).
 *
 * Módulo PURO — sem Supabase nem React — para poder ser testado: as telas e a
 * server action só o aplicam. Tabelas filtra no cliente (o cadastro é pequeno e
 * já vem inteiro); Prazos filtra no servidor (crescem aos milhares), e a action
 * trata a entrada como não confiável (Server Action é chamável por POST direto).
 */

function normalizar(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const comparaTexto = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })

// ---------------------------------------------------------------------------
// Combobox de busca (Bruno, 21/09/2026): os campos de referência com muitas
// opções (Financeira, Convênio, Forma de Contrato, Tipo de Formalização,
// Promotora, Tabela de Comissão) viram um campo de digitação — abaixo do
// mínimo de caracteres mostra a lista inteira (dá pra rolar e escolher sem
// digitar nada); a partir do mínimo, filtra pelo texto contido no label.
// ---------------------------------------------------------------------------

/** Exportada para a tela medir "faltam N letras" com a MESMA normalização do
 * filtro abaixo — nunca dessincroniza o texto de ajuda do limiar real. */
export function normalizarBuscaCombobox(busca: string): string {
  return normalizar(busca)
}

/** Opções de poucas escolhas fixas (Bloqueado, Tipo de Seguro, Ordenar Por...)
 * continuam como `<select>` comum — não precisam de busca. */
export function filtrarOpcoesCombobox<T extends { label: string }>(opcoes: T[], busca: string, minimoCaracteres = 3): T[] {
  const termo = normalizarBuscaCombobox(busca)
  if (termo.length < minimoCaracteres) return opcoes
  return opcoes.filter((opcao) => normalizar(opcao.label).includes(termo))
}

export type SeguroFiltro = '' | 'com' | 'sem' | 'nao_informado'
/** 'nao' = só os ativos (padrão do ARW), 'sim' = só os bloqueados, 'todos' = sem filtro. */
export type BloqueioFiltro = 'nao' | 'sim' | 'todos'

// ---------------------------------------------------------------------------
// Tabelas de Comissão (filtra no cliente)
// ---------------------------------------------------------------------------

export type OrdemTabelas = 'nome' | 'financeira' | 'codigo_banco' | 'codigo_sistema' | 'recentes'

export const ORDENS_TABELAS: ReadonlyArray<{ valor: OrdemTabelas; label: string }> = [
  { valor: 'nome', label: 'Nome da tabela' },
  { valor: 'financeira', label: 'Financeira' },
  { valor: 'codigo_banco', label: 'Código da tabela (banco)' },
  { valor: 'codigo_sistema', label: 'Nº do sistema' },
  { valor: 'recentes', label: 'Mais recentes' },
]

export type FiltrosTabelas = {
  nome: string
  financeira: string
  convenio: string
  forma: string
  formalizacao: string
  seguro: SeguroFiltro
  /** '' = todas, 'direto' = sem promotora, ou o id da promotora. */
  promotora: string
  bloqueado: BloqueioFiltro
  /** Procura no código do banco e no nº do sistema. */
  codigo: string
  ordenar: OrdemTabelas
}

export const FILTROS_TABELAS_PADRAO: FiltrosTabelas = {
  nome: '',
  financeira: '',
  convenio: '',
  forma: '',
  formalizacao: '',
  seguro: '',
  promotora: '',
  bloqueado: 'nao',
  codigo: '',
  ordenar: 'nome',
}

export type TabelaFiltravel = {
  nome: string
  codigo: number | null
  codigo_tabela_banco: string | null
  institution_id: string
  promotora_id: string | null
  forma_contrato_id: string
  convenio_id: string | null
  tipo_formalizacao_id: string | null
  com_seguro: boolean | null
  is_active: boolean
  created_at?: string | null
  financial_institutions?: { name: string } | null
}

function seguroConfere(comSeguro: boolean | null | undefined, filtro: SeguroFiltro): boolean {
  if (filtro === 'com') return comSeguro === true
  if (filtro === 'sem') return comSeguro === false
  if (filtro === 'nao_informado') return comSeguro === null || comSeguro === undefined
  return true
}

export function ordenarTabelas<T extends TabelaFiltravel>(items: T[], ordem: OrdemTabelas): T[] {
  const porNome = (a: T, b: T) => comparaTexto(a.nome, b.nome)
  const primario: Record<OrdemTabelas, (a: T, b: T) => number> = {
    nome: porNome,
    financeira: (a, b) => comparaTexto(a.financial_institutions?.name || '', b.financial_institutions?.name || ''),
    codigo_banco: (a, b) => comparaTexto(a.codigo_tabela_banco || '', b.codigo_tabela_banco || ''),
    codigo_sistema: (a, b) => Number(a.codigo ?? 0) - Number(b.codigo ?? 0),
    recentes: (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')),
  }
  return [...items].sort((a, b) => primario[ordem](a, b) || porNome(a, b) || Number(a.codigo ?? 0) - Number(b.codigo ?? 0))
}

export function filtrarTabelas<T extends TabelaFiltravel>(items: T[], f: FiltrosTabelas): T[] {
  const nome = normalizar(f.nome)
  const codigo = normalizar(f.codigo)
  const filtradas = items.filter((t) => {
    if (nome && !normalizar(t.nome).includes(nome)) return false
    if (f.financeira && t.institution_id !== f.financeira) return false
    if (f.convenio && t.convenio_id !== f.convenio) return false
    if (f.forma && t.forma_contrato_id !== f.forma) return false
    if (f.formalizacao && t.tipo_formalizacao_id !== f.formalizacao) return false
    if (!seguroConfere(t.com_seguro, f.seguro)) return false
    if (f.promotora === 'direto') {
      if (t.promotora_id) return false
    } else if (f.promotora && t.promotora_id !== f.promotora) return false
    if (f.bloqueado === 'nao' && !t.is_active) return false
    if (f.bloqueado === 'sim' && t.is_active) return false
    if (codigo && !normalizar(t.codigo_tabela_banco).includes(codigo) && !String(t.codigo ?? '').includes(codigo)) return false
    return true
  })
  return ordenarTabelas(filtradas, f.ordenar)
}

// ---------------------------------------------------------------------------
// Prazos Comissão (filtra no servidor)
// ---------------------------------------------------------------------------

export type OrdemPrazos = 'tabela_asc' | 'tabela_desc' | 'prazo_asc' | 'comissao_desc' | 'recentes' | 'codigo_asc'

export const ORDENS_PRAZOS: ReadonlyArray<{ valor: OrdemPrazos; label: string }> = [
  { valor: 'tabela_asc', label: 'Nome da tabela (A–Z)' },
  { valor: 'tabela_desc', label: 'Nome da tabela (Z–A)' },
  { valor: 'prazo_asc', label: 'Prazo (menor primeiro)' },
  { valor: 'comissao_desc', label: 'Comissão (maior primeiro)' },
  { valor: 'recentes', label: 'Mais recentes' },
  { valor: 'codigo_asc', label: 'Código do prazo' },
]

export type CampoDataPrazo = 'data_base' | 'data_bloqueio' | 'created_at' | 'updated_at'

export const CAMPOS_DATA_PRAZO: ReadonlyArray<{ valor: CampoDataPrazo; label: string }> = [
  { valor: 'data_base', label: 'Data base' },
  { valor: 'data_bloqueio', label: 'Data de bloqueio' },
  { valor: 'created_at', label: 'Cadastro' },
  { valor: 'updated_at', label: 'Atualização' },
]

export type FiltrosPrazos = {
  /** Texto do nome da tabela do prazo (o prazo não tem descrição própria). */
  descricao: string
  financeira: string
  convenio: string
  forma: string
  /** '' = todas, 'direto' = sem promotora, ou o id da promotora. */
  promotora: string
  tabela: string
  /** Código do banco ou nº do sistema da tabela. */
  codigoTabela: string
  seguro: SeguroFiltro
  formaPagamento: string
  formaPagamentoSeguro: string
  /** Prazos CONTIDOS no intervalo: prazo_inicial >= de e prazo_final <= até. */
  prazoDe: string
  prazoAte: string
  lote: string
  dataCampo: CampoDataPrazo
  dataDe: string
  dataAte: string
  /** Prazo bloqueado = inativo ou com data de bloqueio já atingida. */
  prazoBloqueado: BloqueioFiltro
  tabelaBloqueada: BloqueioFiltro
  ordenar: OrdemPrazos
}

export const FILTROS_PRAZOS_PADRAO: FiltrosPrazos = {
  descricao: '',
  financeira: '',
  convenio: '',
  forma: '',
  promotora: '',
  tabela: '',
  codigoTabela: '',
  seguro: '',
  formaPagamento: '',
  formaPagamentoSeguro: '',
  prazoDe: '',
  prazoAte: '',
  lote: '',
  dataCampo: 'data_base',
  dataDe: '',
  dataAte: '',
  prazoBloqueado: 'nao',
  tabelaBloqueada: 'todos',
  ordenar: 'tabela_asc',
}

export type OpFiltro =
  | { op: 'eq'; coluna: string; valor: string | number | boolean }
  | { op: 'is_null'; coluna: string }
  | { op: 'gte' | 'lte'; coluna: string; valor: string | number }
  | { op: 'ilike'; coluna: string; valor: string }
  | { op: 'or'; expressao: string; tabela?: string }

export type OrdemOp = { coluna: string; ascending: boolean }

export type ConsultaPrazos = { filtros: OpFiltro[]; ordem: OrdemOp[] }

const TABELA = 'tabelas_comissao'
const FORMAS_PAGAMENTO = ['percentual', 'fixo', 'faixa_percentual', 'faixa_fixo']
const FORMAS_PAGAMENTO_SEGURO = ['percentual', 'fixo']
const CAMPOS_DATA = CAMPOS_DATA_PRAZO.map((c) => c.valor)
const CAMPOS_TIMESTAMP: CampoDataPrazo[] = ['created_at', 'updated_at']
const BLOQUEIOS: BloqueioFiltro[] = ['nao', 'sim', 'todos']
const SEGUROS: SeguroFiltro[] = ['', 'com', 'sem', 'nao_informado']

const ORDEM_PRAZOS: Record<OrdemPrazos, OrdemOp[]> = {
  tabela_asc: [{ coluna: `${TABELA}(nome)`, ascending: true }, { coluna: 'prazo_inicial', ascending: true }, { coluna: 'prazo_final', ascending: true }],
  tabela_desc: [{ coluna: `${TABELA}(nome)`, ascending: false }, { coluna: 'prazo_inicial', ascending: true }, { coluna: 'prazo_final', ascending: true }],
  prazo_asc: [{ coluna: 'prazo_inicial', ascending: true }, { coluna: 'prazo_final', ascending: true }, { coluna: 'codigo', ascending: true }],
  comissao_desc: [{ coluna: 'comissao', ascending: false }, { coluna: 'codigo', ascending: true }],
  recentes: [{ coluna: 'created_at', ascending: false }],
  codigo_asc: [{ coluna: 'codigo', ascending: true }],
}

const texto = (v: unknown) => String(v ?? '').trim()
const uuid = (v: unknown) => (/^[0-9a-f-]{36}$/i.test(texto(v)) ? texto(v) : '')
const inteiroPositivo = (v: unknown) => {
  const n = Number.parseInt(texto(v), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}
const dataValida = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(texto(v)) ? texto(v) : '')
const escolha = <T extends string>(v: unknown, permitidos: readonly T[], padrao: T): T => (permitidos.includes(texto(v) as T) ? (texto(v) as T) : padrao)

/** Data de hoje (AAAA-MM-DD) no fuso de Brasília — a referência do "bloqueado". */
export function hojeSaoPaulo(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)
}

/**
 * Traduz os filtros em operações neutras que a action aplica à consulta. A
 * entrada é NÃO confiável: ids só passam como uuid, listas fechadas são
 * conferidas, números/datas são validados e o texto que entra em expressão `or`
 * perde os caracteres da gramática do PostgREST.
 */
export function montarConsultaPrazos(entrada: Partial<FiltrosPrazos>, hoje: string): ConsultaPrazos {
  const f = { ...FILTROS_PRAZOS_PADRAO, ...entrada }
  const filtros: OpFiltro[] = []
  const daTabela = (coluna: string) => `${TABELA}.${coluna}`

  const descricao = texto(f.descricao)
  if (descricao) filtros.push({ op: 'ilike', coluna: daTabela('nome'), valor: `%${descricao}%` })

  const financeira = uuid(f.financeira)
  if (financeira) filtros.push({ op: 'eq', coluna: daTabela('institution_id'), valor: financeira })
  const convenio = uuid(f.convenio)
  if (convenio) filtros.push({ op: 'eq', coluna: daTabela('convenio_id'), valor: convenio })
  const forma = uuid(f.forma)
  if (forma) filtros.push({ op: 'eq', coluna: daTabela('forma_contrato_id'), valor: forma })
  if (texto(f.promotora) === 'direto') filtros.push({ op: 'is_null', coluna: daTabela('promotora_id') })
  else if (uuid(f.promotora)) filtros.push({ op: 'eq', coluna: daTabela('promotora_id'), valor: uuid(f.promotora) })
  const tabela = uuid(f.tabela)
  if (tabela) filtros.push({ op: 'eq', coluna: 'tabela_comissao_id', valor: tabela })

  const codigoTabela = texto(f.codigoTabela).replace(/[,()*%\\"'\s]/g, '')
  if (codigoTabela) {
    const partes = [`codigo_tabela_banco.ilike.*${codigoTabela}*`]
    if (/^\d{1,15}$/.test(codigoTabela)) partes.push(`codigo.eq.${codigoTabela}`)
    filtros.push({ op: 'or', expressao: partes.join(','), tabela: TABELA })
  }

  const seguro = escolha(f.seguro, SEGUROS, '')
  if (seguro === 'com') filtros.push({ op: 'eq', coluna: daTabela('com_seguro'), valor: true })
  if (seguro === 'sem') filtros.push({ op: 'eq', coluna: daTabela('com_seguro'), valor: false })
  if (seguro === 'nao_informado') filtros.push({ op: 'is_null', coluna: daTabela('com_seguro') })

  const formaPagamento = texto(f.formaPagamento)
  if (FORMAS_PAGAMENTO.includes(formaPagamento)) filtros.push({ op: 'eq', coluna: 'forma_pagamento', valor: formaPagamento })
  const formaPagamentoSeguro = texto(f.formaPagamentoSeguro)
  if (FORMAS_PAGAMENTO_SEGURO.includes(formaPagamentoSeguro)) filtros.push({ op: 'eq', coluna: 'forma_pagamento_seguro', valor: formaPagamentoSeguro })

  const prazoDe = inteiroPositivo(f.prazoDe)
  if (prazoDe !== null) filtros.push({ op: 'gte', coluna: 'prazo_inicial', valor: prazoDe })
  const prazoAte = inteiroPositivo(f.prazoAte)
  if (prazoAte !== null) filtros.push({ op: 'lte', coluna: 'prazo_final', valor: prazoAte })

  const lote = texto(f.lote)
  if (lote) filtros.push({ op: 'eq', coluna: 'lote_importacao', valor: lote })

  const dataCampo = escolha(f.dataCampo, CAMPOS_DATA, 'data_base')
  const dataDe = dataValida(f.dataDe)
  const dataAte = dataValida(f.dataAte)
  const ehTimestamp = CAMPOS_TIMESTAMP.includes(dataCampo)
  if (dataDe) filtros.push({ op: 'gte', coluna: dataCampo, valor: ehTimestamp ? `${dataDe}T00:00:00-03:00` : dataDe })
  if (dataAte) filtros.push({ op: 'lte', coluna: dataCampo, valor: ehTimestamp ? `${dataAte}T23:59:59.999-03:00` : dataAte })

  const dia = dataValida(hoje)
  const prazoBloqueado = escolha(f.prazoBloqueado, BLOQUEIOS, 'nao')
  if (prazoBloqueado === 'nao') {
    filtros.push({ op: 'eq', coluna: 'is_active', valor: true })
    if (dia) filtros.push({ op: 'or', expressao: `data_bloqueio.is.null,data_bloqueio.gt.${dia}` })
  }
  if (prazoBloqueado === 'sim') filtros.push({ op: 'or', expressao: dia ? `is_active.eq.false,data_bloqueio.lte.${dia}` : 'is_active.eq.false' })

  const tabelaBloqueada = escolha(f.tabelaBloqueada, BLOQUEIOS, 'todos')
  if (tabelaBloqueada === 'nao') filtros.push({ op: 'eq', coluna: daTabela('is_active'), valor: true })
  if (tabelaBloqueada === 'sim') filtros.push({ op: 'eq', coluna: daTabela('is_active'), valor: false })

  const ordem = ORDEM_PRAZOS[escolha(f.ordenar, Object.keys(ORDEM_PRAZOS) as OrdemPrazos[], 'tabela_asc')]
  return { filtros, ordem }
}
