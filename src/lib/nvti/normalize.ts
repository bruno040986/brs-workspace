import { XMLParser } from 'fast-xml-parser'
import type {
  NvtiCadastro,
  NvtiCelular,
  NvtiCredito,
  NvtiEmpresa,
  NvtiEndereco,
  NvtiResultado,
  NvtiTelefone,
} from './types'

// parseTagValue: false é essencial — CPF/CEP/telefone não podem virar number
// (perderiam zeros à esquerda).
const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ['ENDERECO', 'CELULAR', 'TELEFONE', 'EMAIL', 'EMPRESA'].includes(name),
})

type XmlNode = Record<string, unknown>

function asNode(value: unknown): XmlNode {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as XmlNode) : {}
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null || value === '') return []
  return [value]
}

function text(node: XmlNode, key: string): string {
  let value = node[key]
  // Tag aninhada de mesmo nome (ex.: <TELEFONE><TELEFONE>x</TELEFONE></TELEFONE>)
  // vira array por causa do isArray — pega o primeiro valor escalar.
  if (Array.isArray(value)) {
    value = value.find((item) => item !== null && typeof item !== 'object') ?? value[0]
  }
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return ''
  return String(value).trim()
}

function flag(node: XmlNode, key: string): boolean | null {
  const value = text(node, key).toUpperCase()
  if (value === 'S' || value === 'SIM') return true
  if (value === 'N' || value === 'NAO' || value === 'NÃO') return false
  return null
}

/** Extrai strings de estruturas como <EMAILS><EMAIL><EMAIL>x</EMAIL></EMAIL></EMAILS>. */
function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === undefined || value === null) return []
  if (typeof value === 'string' || typeof value === 'number') {
    const str = String(value).trim()
    return str ? [str] : []
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectStrings(item, depth + 1))
  if (typeof value === 'object') {
    return Object.values(value as XmlNode).flatMap((item) => collectStrings(item, depth + 1))
  }
  return []
}

export function parseXmlDocument(xml: string): XmlNode {
  return asNode(parser.parse(xml))
}

/**
 * Converte o XML da CONSULTA (NVBOOK CEL OBG / OBG WHATS) no formato
 * normalizado usado pelo restante do sistema. Lança se não houver <CONSULTA>.
 */
export function normalizeConsulta(xml: string, cpfConsultado: string): NvtiResultado {
  const doc = parseXmlDocument(xml)
  const consulta = asNode(doc.CONSULTA)
  if (!doc.CONSULTA) {
    throw new Error('Resposta da NVTI sem o bloco CONSULTA.')
  }

  const cadastroNode = asNode(consulta.CADASTRO)
  const cadastro: NvtiCadastro = {
    cpf: text(cadastroNode, 'CPF') || cpfConsultado,
    nome: text(cadastroNode, 'NOME'),
    nome_mae: text(cadastroNode, 'NOME_MAE'),
    sexo: text(cadastroNode, 'SEXO'),
    nascimento: text(cadastroNode, 'NASC'),
    idade: text(cadastroNode, 'IDADE'),
    geracao: text(cadastroNode, 'GERACAO'),
    classe_economica: text(cadastroNode, 'CLASSE_ECONOMICA'),
    demografica: text(cadastroNode, 'DEMOGRAFICA'),
    descricao_cbo: text(cadastroNode, 'DESCRICAO_CBO'),
  }

  const enderecos: NvtiEndereco[] = asArray(asNode(consulta.ENDERECOS).ENDERECO).map((raw) => {
    const node = asNode(raw)
    return {
      tipo: text(node, 'TIPO'),
      titulo: text(node, 'TITULO'),
      logradouro: text(node, 'LOGRADOURO'),
      numero: text(node, 'NUMERO'),
      complemento: text(node, 'COMPLEMENTO'),
      bairro: text(node, 'BAIRRO'),
      cidade: text(node, 'CIDADE'),
      uf: text(node, 'UF'),
      cep: text(node, 'CEP'),
      latitude: text(node, 'LATITUDE'),
      longitude: text(node, 'LONGITUDE'),
    }
  })

  const celulares: NvtiCelular[] = asArray(asNode(consulta.CELULARES).CELULAR)
    .map((raw) => {
      const node = asNode(raw)
      return {
        ddd: text(node, 'DDDCEL'),
        numero: text(node, 'CEL'),
        procon: flag(node, 'PROCON') === true,
        whatsapp: flag(node, 'FLWHATSAPP') === true,
      }
    })
    .filter((cel) => cel.numero)

  const telefones: NvtiTelefone[] = asArray(asNode(consulta.TELEFONES).TELEFONE)
    .map((raw) => {
      const node = asNode(raw)
      return {
        ddd: text(node, 'DDD'),
        numero: text(node, 'TELEFONE'),
        procon: flag(node, 'PROCON') === true,
      }
    })
    .filter((tel) => tel.numero)

  const emails = Array.from(new Set(collectStrings(consulta.EMAILS).filter((item) => item.includes('@'))))

  const creditoNode = asNode(consulta.CREDITO)
  const credito: NvtiCredito = {
    possui_veiculo: flag(creditoNode, 'FLVEICULO'),
    bolsa_familia: flag(creditoNode, 'FLBOLSAFAMILIA'),
    obito: flag(creditoNode, 'FLOBITO'),
    possui_imovel: flag(creditoNode, 'FLIMOVEL'),
    fonte_renda: text(creditoNode, 'FONTE_RENDA'),
    score: text(creditoNode, 'SCORE'),
    faixa_score: text(creditoNode, 'FAIXA_SCORE'),
    persona_credito: text(creditoNode, 'CREDITO'),
    score_digital: text(creditoNode, 'SCORE_DIGITAL'),
    propensao_pagamento: text(creditoNode, 'PROPENSAO_PAGAMENTO'),
  }

  const empresas: NvtiEmpresa[] = asArray(asNode(consulta.EMPRESAS).EMPRESA).map((raw) => {
    const node = asNode(raw)
    return {
      possui_fgts: flag(node, 'FLFGTS'),
      fgts_valor_presumido: text(node, 'VALOR_PRESUMIDO'),
      fgts_probabilidade_saque: text(node, 'PROBABILIDADE_SAQUE'),
      cnpj: text(node, 'CNPJ'),
      razao: text(node, 'RAZAO'),
    }
  })

  return { cpf: cadastro.cpf, cadastro, enderecos, celulares, telefones, emails, credito, empresas }
}

export function cleanCpf(value: string): string {
  return String(value || '').replace(/\D/g, '')
}

/** Validação de CPF com dígitos verificadores — evita gastar consulta com CPF inválido. */
export function isValidCpf(raw: string): boolean {
  const cpf = cleanCpf(raw).padStart(11, '0')
  if (cpf.length !== 11) return false
  if (/^(\d)\1{10}$/.test(cpf)) return false
  for (const factor of [10, 11]) {
    let sum = 0
    for (let i = 0; i < factor - 1; i += 1) sum += Number(cpf[i]) * (factor - i)
    const digit = ((sum * 10) % 11) % 10
    if (digit !== Number(cpf[factor - 1])) return false
  }
  return true
}

const CSV_SEPARATOR = ';'

function csvCell(value: string): string {
  const str = String(value ?? '')
  if (str.includes(CSV_SEPARATOR) || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function phone(ddd: string, numero: string): string {
  return numero ? `${ddd}${numero}` : ''
}

function boolLabel(value: boolean | null): string {
  if (value === true) return 'SIM'
  if (value === false) return 'NAO'
  return ''
}

export const CSV_HEADERS = [
  'CPF', 'NOME', 'NASCIMENTO', 'IDADE', 'SEXO', 'NOME_MAE', 'CLASSE_ECONOMICA', 'OCUPACAO',
  'OBITO', 'SCORE', 'FAIXA_SCORE', 'FONTE_RENDA', 'PROPENSAO_PAGAMENTO', 'SCORE_DIGITAL',
  'POSSUI_VEICULO', 'POSSUI_IMOVEL', 'BOLSA_FAMILIA',
  'CELULAR_WHATSAPP_1', 'CELULAR_WHATSAPP_2',
  'CELULAR_1', 'CELULAR_1_WHATSAPP', 'CELULAR_1_PROCON',
  'CELULAR_2', 'CELULAR_2_WHATSAPP', 'CELULAR_2_PROCON',
  'CELULAR_3', 'CELULAR_3_WHATSAPP', 'CELULAR_3_PROCON',
  'TELEFONE_1', 'TELEFONE_2',
  'EMAIL_1', 'EMAIL_2',
  'ENDERECO', 'NUMERO', 'COMPLEMENTO', 'BAIRRO', 'CIDADE', 'UF', 'CEP',
  'EMPRESA_CNPJ', 'EMPRESA_RAZAO', 'POSSUI_FGTS', 'FGTS_VALOR_PRESUMIDO',
] as const

/** Achata o resultado em uma linha de CSV (ordem de CSV_HEADERS). */
export function flattenForCsv(resultado: NvtiResultado): string {
  const { cadastro, credito, celulares, telefones, emails, enderecos, empresas } = resultado
  const endereco = enderecos[0]
  const empresa = empresas[0]
  const comWhats = celulares.filter((cel) => cel.whatsapp)
  const cel = (index: number) => celulares[index]

  const cells: string[] = [
    cadastro.cpf, cadastro.nome, cadastro.nascimento, cadastro.idade, cadastro.sexo,
    cadastro.nome_mae, cadastro.classe_economica, cadastro.descricao_cbo,
    boolLabel(credito.obito), credito.score, credito.faixa_score, credito.fonte_renda,
    credito.propensao_pagamento, credito.score_digital,
    boolLabel(credito.possui_veiculo), boolLabel(credito.possui_imovel), boolLabel(credito.bolsa_familia),
    comWhats[0] ? phone(comWhats[0].ddd, comWhats[0].numero) : '',
    comWhats[1] ? phone(comWhats[1].ddd, comWhats[1].numero) : '',
    cel(0) ? phone(cel(0).ddd, cel(0).numero) : '', cel(0) ? boolLabel(cel(0).whatsapp) : '', cel(0) ? boolLabel(cel(0).procon) : '',
    cel(1) ? phone(cel(1).ddd, cel(1).numero) : '', cel(1) ? boolLabel(cel(1).whatsapp) : '', cel(1) ? boolLabel(cel(1).procon) : '',
    cel(2) ? phone(cel(2).ddd, cel(2).numero) : '', cel(2) ? boolLabel(cel(2).whatsapp) : '', cel(2) ? boolLabel(cel(2).procon) : '',
    telefones[0] ? phone(telefones[0].ddd, telefones[0].numero) : '',
    telefones[1] ? phone(telefones[1].ddd, telefones[1].numero) : '',
    emails[0] || '', emails[1] || '',
    endereco ? [endereco.tipo, endereco.titulo, endereco.logradouro].filter(Boolean).join(' ') : '',
    endereco?.numero || '', endereco?.complemento || '', endereco?.bairro || '',
    endereco?.cidade || '', endereco?.uf || '', endereco?.cep || '',
    empresa?.cnpj || '', empresa?.razao || '',
    empresa ? boolLabel(empresa.possui_fgts) : '', empresa?.fgts_valor_presumido || '',
  ]

  return cells.map(csvCell).join(CSV_SEPARATOR)
}

export function csvHeaderLine(): string {
  return CSV_HEADERS.join(CSV_SEPARATOR)
}
