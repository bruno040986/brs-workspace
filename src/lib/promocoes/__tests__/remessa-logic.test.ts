/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { agruparPorIndicador, COLUNAS_EXCEL, formatarValorBR, gerarXlsx, transicaoValida, type ItemRemessa } from '../remessa-logic.ts'

const base: ItemRemessa = {
  indicador_id: 'a', indicado_nome: 'Fulano', indicado_cpf: '12345678901', valor_centavos: 5000,
  pix_tipo: 'telefone', pix_chave: '61999990000', banco_codigo: null, banco_nome: null, agencia: null, conta: null,
}
const banc: ItemRemessa = { ...base, indicador_id: 'b', pix_tipo: 'dados_bancarios', pix_chave: null, banco_codigo: '001', banco_nome: 'Banco do Brasil', agencia: '1234', conta: '99887-6' }

const contem = (obj: Record<string, unknown>, esperado: Record<string, unknown>) => { for (const [k, v] of Object.entries(esperado)) assert.equal(obj[k], v, k) }

describe('remessa', () => {
  it('excel com colunas exatas e regra Pix x dados bancários', () => {
    const wb = XLSX.read(gerarXlsx([base, banc]), { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets.Remessa, { defval: '' })
    assert.deepEqual(Object.keys(rows[0]), [...COLUNAS_EXCEL])
    contem(rows[0], { Valor: 50, Banco: '', Pix: '61999990000', 'Tipo de chave': 'Telefone' })
    contem(rows[1], { Banco: '001 - Banco do Brasil', Agência: '1234', 'Conta corrente': '99887-6', Pix: '', 'Tipo de chave': 'Dados Bancários' })
  })
  it('agrupa por indicador e soma', () => {
    const g = agruparPorIndicador([base, { ...base, indicado_nome: 'Ciclano' }, banc])
    assert.deepEqual(g.map(x => [x.indicadorId, x.totalCentavos, x.itens.length]), [['a', 10000, 2], ['b', 5000, 1]])
  })
  it('valor BR e transições', () => {
    assert.equal(formatarValorBR(123456), '1.234,56')
    assert.equal(transicaoValida('gerada', 'exportada'), true)
    assert.equal(transicaoValida('exportada', 'enviada_pagamento'), true)
    assert.equal(transicaoValida('gerada', 'enviada_pagamento'), false)
    assert.equal(transicaoValida('enviada_pagamento', 'gerada'), false)
  })
})
