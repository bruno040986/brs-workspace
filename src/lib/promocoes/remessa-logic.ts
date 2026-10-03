import * as XLSX from 'xlsx'

export type PixTipo = 'cpf' | 'telefone' | 'email' | 'aleatoria' | 'dados_bancarios'

export type ItemRemessa = {
  indicador_id: string
  indicado_nome: string
  indicado_cpf: string
  valor_centavos: number
  pix_tipo: PixTipo
  pix_chave: string | null
  banco_codigo: string | null
  banco_nome: string | null
  agencia: string | null
  conta: string | null
}

export const TIPO_CHAVE_LABEL: Record<PixTipo, string> = {
  cpf: 'CPF',
  telefone: 'Telefone',
  email: 'E-mail',
  aleatoria: 'Aleatória',
  dados_bancarios: 'Dados Bancários',
}

export const COLUNAS_EXCEL = ['CPF', 'Nome Completo', 'Valor', 'Banco', 'Agência', 'Conta corrente', 'Pix', 'Tipo de chave'] as const

export function formatarValorBR(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Banco/Agência/Conta só em dados_bancarios; Pix só nos demais. Valor em reais (número). */
export function linhaExcel(i: ItemRemessa): Record<(typeof COLUNAS_EXCEL)[number], string | number> {
  const bancario = i.pix_tipo === 'dados_bancarios'
  return {
    CPF: i.indicado_cpf,
    'Nome Completo': i.indicado_nome,
    Valor: i.valor_centavos / 100,
    Banco: bancario ? [i.banco_codigo, i.banco_nome].filter(Boolean).join(' - ') : '',
    Agência: bancario ? i.agencia ?? '' : '',
    'Conta corrente': bancario ? i.conta ?? '' : '',
    Pix: bancario ? '' : i.pix_chave ?? '',
    'Tipo de chave': TIPO_CHAVE_LABEL[i.pix_tipo],
  }
}

export function gerarXlsx(itens: ItemRemessa[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(itens.map(linhaExcel), { header: [...COLUNAS_EXCEL] })
  for (let r = 1; r <= itens.length; r++) {
    const c = ws[XLSX.utils.encode_cell({ r, c: 2 })]
    if (c) c.z = '#,##0.00'
  }
  ws['!cols'] = [{ wch: 14 }, { wch: 36 }, { wch: 12 }, { wch: 24 }, { wch: 10 }, { wch: 14 }, { wch: 36 }, { wch: 16 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Remessa')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

export type GrupoIndicador = { indicadorId: string; totalCentavos: number; itens: ItemRemessa[] }

export function agruparPorIndicador(itens: ItemRemessa[]): GrupoIndicador[] {
  const m = new Map<string, GrupoIndicador>()
  for (const i of itens) {
    const g = m.get(i.indicador_id) ?? { indicadorId: i.indicador_id, totalCentavos: 0, itens: [] }
    g.totalCentavos += i.valor_centavos
    g.itens.push(i)
    m.set(i.indicador_id, g)
  }
  return [...m.values()]
}

/** Transições só para frente. */
const PROXIMO = { gerada: 'exportada', exportada: 'enviada_pagamento' } as const
export function transicaoValida(de: string, para: string): boolean {
  return (PROXIMO as Record<string, string>)[de] === para
}

export function hojeSaoPaulo(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now)
}
