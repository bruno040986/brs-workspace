import { describe, it } from 'node:test'
import assert from 'node:assert'
import { avaliarObrigatorios, diasParaVencer, pessoaQueCumpre, vigenciaPorTipo } from '../certificacoes.ts'

const tipos = [
  { id: 'consig', nome: 'Crédito Consignado', obrigatorio: true },
  { id: 'cdc', nome: 'CDC', obrigatorio: false },
  { id: 'lgpd', nome: 'LGPD', obrigatorio: true },
  { id: 'pldft', nome: 'PLDFT', obrigatorio: true },
]
// ANEC Consignado + LGPD + PLDFT; FEBRABAN só PLDFT (ex.: 6333)
const vinculos = [
  { certificacao_id: 'anec-consig', tipo_id: 'consig' },
  { certificacao_id: 'anec-consig', tipo_id: 'lgpd' },
  { certificacao_id: 'anec-consig', tipo_id: 'pldft' },
  { certificacao_id: 'febraban-pldft', tipo_id: 'pldft' },
]
const HOJE = '2026-09-25'

describe('certificações (fatia 3)', () => {
  it('vigência por tipo = maior validade; lançamento cobre todos os tipos vinculados', () => {
    const vig = vigenciaPorTipo(
      [
        { cpf: '1', certificacao_id: 'anec-consig', data_validade: '2027-01-10', verificado_em: 'x' },
        { cpf: '1', certificacao_id: 'febraban-pldft', data_validade: '2028-06-21', verificado_em: 'x' },
      ],
      vinculos,
    )
    assert.strictEqual(vig.get('consig'), '2027-01-10')
    assert.strictEqual(vig.get('lgpd'), '2027-01-10')
    assert.strictEqual(vig.get('pldft'), '2028-06-21')
    assert.strictEqual(vig.get('cdc'), undefined)
  })

  it('lançamento não verificado não conta para a exigência', () => {
    const r = avaliarObrigatorios([{ cpf: '1', certificacao_id: 'anec-consig', data_validade: '2027-01-10', verificado_em: null }], vinculos, tipos, HOJE)
    assert.strictEqual(r.cumpre, false)
    assert.deepStrictEqual(r.faltantes.map((t) => t.id), ['consig', 'lgpd', 'pldft'])
  })

  it('vencida aparece como vencida, não como faltante', () => {
    const r = avaliarObrigatorios([{ cpf: '1', certificacao_id: 'anec-consig', data_validade: '2026-09-24', verificado_em: 'x' }], vinculos, tipos, HOJE)
    assert.strictEqual(r.cumpre, false)
    assert.deepStrictEqual(r.vencidos.map((t) => t.id), ['consig', 'lgpd', 'pldft'])
    assert.deepStrictEqual(r.faltantes, [])
  })

  it('vigente no dia da validade ainda cumpre', () => {
    const r = avaliarObrigatorios([{ cpf: '1', certificacao_id: 'anec-consig', data_validade: HOJE, verificado_em: 'x' }], vinculos, tipos, HOJE)
    assert.strictEqual(r.cumpre, true)
  })

  it('obrigatórios precisam estar na MESMA pessoa', () => {
    const lanc = [
      { cpf: 'a', certificacao_id: 'febraban-pldft', data_validade: '2027-01-01', verificado_em: 'x' },
      { cpf: 'b', certificacao_id: 'anec-consig', data_validade: '2027-01-01', verificado_em: 'x' },
    ]
    assert.strictEqual(pessoaQueCumpre(['a', 'b'], lanc, vinculos, tipos, HOJE), 'b')
    assert.strictEqual(pessoaQueCumpre(['a'], lanc, vinculos, tipos, HOJE), null)
  })

  it('sem tipos obrigatórios marcados, cumpre', () => {
    const r = avaliarObrigatorios([], vinculos, tipos.map((t) => ({ ...t, obrigatorio: false })), HOJE)
    assert.strictEqual(r.cumpre, true)
  })

  it('tipo obrigatório inativo não é exigido', () => {
    const r = avaliarObrigatorios(
      [{ cpf: '1', certificacao_id: 'anec-consig', data_validade: '2027-01-01', verificado_em: 'x' }],
      vinculos,
      [...tipos, { id: 'novo', nome: 'Novo', obrigatorio: true, is_active: false }],
      HOJE,
    )
    assert.strictEqual(r.cumpre, true)
  })

  it('diasParaVencer', () => {
    assert.strictEqual(diasParaVencer('2026-10-25', HOJE), 30)
    assert.strictEqual(diasParaVencer('2026-09-24', HOJE), -1)
  })
})
