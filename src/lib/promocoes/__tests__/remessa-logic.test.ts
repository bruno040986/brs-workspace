import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { agruparPorIndicador, COLUNAS_EXCEL, formatarValorBR, gerarXlsx, transicaoValida, type ItemRemessa } from '../remessa-logic'

const base: ItemRemessa = {
  indicador_id: 'a', indicado_nome: 'Fulano', indicado_cpf: '12345678901', valor_centavos: 5000,
  pix_tipo: 'telefone', pix_chave: '61999990000', banco_codigo: null, banco_nome: null, agencia: null, conta: null,
}
const banc: ItemRemessa = { ...base, indicador_id: 'b', pix_tipo: 'dados_bancarios', pix_chave: null, banco_codigo: '001', banco_nome: 'Banco do Brasil', agencia: '1234', conta: '99887-6' }

describe('remessa', () => {
  it('excel com colunas exatas e regra Pix x dados bancários', () => {
    const wb = XLSX.read(gerarXlsx([base, banc]), { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets.Remessa, { defval: '' })
    expect(Object.keys(rows[0])).toEqual([...COLUNAS_EXCEL])
    expect(rows[0]).toMatchObject({ Valor: 50, Banco: '', Pix: '61999990000', 'Tipo de chave': 'Telefone' })
    expect(rows[1]).toMatchObject({ Banco: '001 - Banco do Brasil', Agência: '1234', 'Conta corrente': '99887-6', Pix: '', 'Tipo de chave': 'Dados Bancários' })
  })
  it('agrupa por indicador e soma', () => {
    const g = agruparPorIndicador([base, { ...base, indicado_nome: 'Ciclano' }, banc])
    expect(g.map(x => [x.indicadorId, x.totalCentavos, x.itens.length])).toEqual([['a', 10000, 2], ['b', 5000, 1]])
  })
  it('valor BR e transições', () => {
    expect(formatarValorBR(123456)).toBe('1.234,56')
    expect(transicaoValida('gerada', 'exportada')).toBe(true)
    expect(transicaoValida('exportada', 'enviada_pagamento')).toBe(true)
    expect(transicaoValida('gerada', 'enviada_pagamento')).toBe(false)
    expect(transicaoValida('enviada_pagamento', 'gerada')).toBe(false)
  })
})
