/**
 * Importador de mailing do AlvoConsig — mapeamento configurável de colunas.
 *
 * Dois tipos de planilha:
 * - `margem`: margens disponíveis do lead (Novo e, quando houver, Cartão RMC e
 *   Cartão Consignado RCC) — as ofertas são calculadas por coeficiente.
 * - `refin`: mailing do motor de crédito com o REFIN JÁ CALCULADO — só entram
 *   linhas com troco (`refin_troco` > 0).
 *
 * Cabeçalhos variam entre sistemas de origem; a detecção automática sugere o
 * mapeamento pelos aliases abaixo e o operador ajusta na tela antes de
 * confirmar.
 */

export type TipoImport = 'refin' | 'margem'

export type CampoImport = {
  key: string
  label: string
  obrigatorio?: boolean
  tipos: TipoImport[]
  aliases: string[]
}

export const CAMPOS_IMPORT: CampoImport[] = [
  {
    key: 'cpf',
    label: 'CPF',
    obrigatorio: true,
    tipos: ['refin', 'margem'],
    aliases: ['cpf', 'documento', 'doc', 'cpf_cliente'],
  },
  {
    key: 'nome',
    label: 'Nome',
    tipos: ['refin', 'margem'],
    aliases: ['nome', 'nome_cliente', 'cliente', 'name'],
  },
  {
    key: 'telefone',
    label: 'Telefone',
    tipos: ['refin', 'margem'],
    aliases: ['telefone', 'fone', 'celular', 'telefone1', 'tel', 'phone', 'whatsapp'],
  },
  {
    key: 'matricula',
    label: 'Matrícula',
    tipos: ['refin', 'margem'],
    aliases: ['matricula', 'matr', 'matricula_servidor'],
  },
  {
    key: 'codigo_convenio',
    label: 'Código do Convênio',
    tipos: ['refin', 'margem'],
    aliases: ['codigo_convenio', 'cod_convenio', 'convenio', 'cod_empregador', 'codigo_empregador', 'empregador'],
  },
  {
    key: 'margem_novo',
    label: 'Margem — Empréstimo Novo',
    tipos: ['margem'],
    aliases: ['margem', 'margem_novo', 'margem_disponivel', 'margem_emprestimo', 'vlr_margem'],
  },
  {
    key: 'margem_cartao_rmc',
    label: 'Margem — Cartão de Crédito (RMC)',
    tipos: ['margem'],
    aliases: ['margem_rmc', 'margem_cartao', 'rmc', 'margem_cartao_credito'],
  },
  {
    key: 'margem_cartao_rcc',
    label: 'Margem — Cartão Consignado (RCC)',
    tipos: ['margem'],
    aliases: ['margem_rcc', 'rcc', 'margem_cartao_consignado', 'margem_beneficio'],
  },
  {
    key: 'refin_troco',
    label: 'REFIN — Valor do Troco',
    obrigatorio: true,
    tipos: ['refin'],
    aliases: ['oferta_valor_troco', 'valor_troco', 'troco', 'vlr_troco'],
  },
  {
    key: 'refin_parcela',
    label: 'REFIN — Valor da Parcela',
    tipos: ['refin'],
    aliases: ['oferta_valor_parcela', 'valor_parcela', 'parcela', 'parcela_contrato'],
  },
  {
    key: 'refin_prazo',
    label: 'REFIN — Prazo (parcelas)',
    tipos: ['refin'],
    aliases: ['oferta_parcelas', 'prazo', 'parcelas', 'qtd_parcelas', 'parcelas_contrato'],
  },
  {
    key: 'refin_taxa',
    label: 'REFIN — Taxa',
    tipos: ['refin'],
    aliases: ['oferta_taxa', 'taxa', 'taxa_contrato'],
  },
  {
    key: 'refin_tabela',
    label: 'REFIN — Tabela/Regra da Oferta',
    tipos: ['refin'],
    aliases: ['oferta_regra', 'regra_parcela_refin', 'tabela_selecionada', 'tabela', 'oferta'],
  },
  {
    key: 'refin_saldo_devedor',
    label: 'REFIN — Saldo Devedor',
    tipos: ['refin'],
    aliases: ['oferta_saldo_devedor', 'saldo_devedor', 'saldo'],
  },
  {
    key: 'refin_parcelas_pagas',
    label: 'REFIN — Parcelas Pagas',
    tipos: ['refin'],
    aliases: ['parcelas_pagas', 'qtd_parcelas_pagas', 'parcelas_pagas_refin'],
  },
  {
    key: 'refin_contrato',
    label: 'REFIN — Contrato',
    tipos: ['refin'],
    aliases: ['contrato', 'numero_contrato', 'contrato_atual'],
  },
  {
    key: 'refin_contrato_elegivel',
    label: 'REFIN — Contrato Elegível',
    tipos: ['refin'],
    aliases: ['contrato_elegivel', 'elegivel'],
  },
  {
    key: 'refin_seguro_valor',
    label: 'REFIN — Valor do Seguro',
    tipos: ['refin'],
    aliases: ['oferta_valor_seguro', 'valor_seguro', 'seguro_valor'],
  },
  {
    key: 'refin_seguro_sim_nao',
    label: 'REFIN — Tem Seguro',
    tipos: ['refin'],
    aliases: ['oferta_com_seguro', 'com_seguro', 'tem_seguro'],
  },
]

export function camposParaTipo(tipo: TipoImport) {
  return CAMPOS_IMPORT.filter((campo) => campo.tipos.includes(tipo))
}

function normalizeHeader(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Sugere o mapeamento { campo -> índice da coluna } a partir dos cabeçalhos.
 * Match exato pelos aliases primeiro; depois por inclusão (cabeçalho contém o
 * alias), sem sobrescrever um match exato.
 */
export function sugerirMapeamento(headers: string[], tipo: TipoImport): Record<string, number> {
  const normalizados = headers.map(normalizeHeader)
  const mapeamento: Record<string, number> = {}
  const usados = new Set<number>()

  for (const campo of camposParaTipo(tipo)) {
    for (const alias of campo.aliases) {
      const idx = normalizados.findIndex((header, i) => header === alias && !usados.has(i))
      if (idx >= 0) {
        mapeamento[campo.key] = idx
        usados.add(idx)
        break
      }
    }
  }

  for (const campo of camposParaTipo(tipo)) {
    if (mapeamento[campo.key] !== undefined) continue
    for (const alias of campo.aliases) {
      const idx = normalizados.findIndex((header, i) => header.includes(alias) && !usados.has(i))
      if (idx >= 0) {
        mapeamento[campo.key] = idx
        usados.add(idx)
        break
      }
    }
  }

  return mapeamento
}

export function cleanDigits(value: unknown) {
  return String(value ?? '').replace(/\D/g, '')
}

export function isValidCpf(cpf: string) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false
  let sum = 0
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i)
  let check = (sum * 10) % 11
  if (check === 10) check = 0
  if (check !== Number(cpf[9])) return false
  sum = 0
  for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i)
  check = (sum * 10) % 11
  if (check === 10) check = 0
  return check === Number(cpf[10])
}

export function normalizeCpfCell(value: unknown): string | null {
  const digits = cleanDigits(value)
  if (digits.length < 9 || digits.length > 11) return null
  const cpf = digits.padStart(11, '0')
  return isValidCpf(cpf) ? cpf : null
}

/**
 * Converte valores monetários vindos de planilha: aceita number direto,
 * "R$ 1.234,56", "1234.56", "1.234,56" e negativo.
 */
export function parseMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  let text = String(value).trim().replace(/r\$/i, '').trim()
  if (!text) return null
  const negativo = text.startsWith('-')
  text = text.replace(/[^\d.,]/g, '')
  if (!text) return null
  if (text.includes(',')) {
    text = text.replace(/\./g, '').replace(',', '.')
  }
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) return null
  return negativo ? -parsed : parsed
}

export function parseIntSafe(value: unknown): number | null {
  const digits = cleanDigits(value)
  if (!digits) return null
  const parsed = Number.parseInt(digits, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
