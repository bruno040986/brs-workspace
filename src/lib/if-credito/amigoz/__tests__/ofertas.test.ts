/**
 * normalizarOfertaAmigoz — mapeamento PROVISÓRIO (ver comentário em
 * ../ofertas.ts): a descoberta nunca obteve uma simulação de sucesso real, só
 * o erro AOS002. Este teste cobre o que dá pra garantir sem um exemplo real:
 * nunca inventa valores (devolve null) e, quando reconhece os campos, mapeia
 * certo. Recalibrar os nomes de campo assim que houver uma resposta de
 * sucesso de verdade (ver if_credito_chamadas).
 * Roda com: npm test (node --test --experimental-strip-types)
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarOfertaAmigoz } from '../normalizar-oferta.ts'

const INST = { id: 'inst-amigoz-1', name: 'Amigoz' }

describe('normalizarOfertaAmigoz', () => {
  test('erro AOS002 (único formato real observado na descoberta) não vira oferta', () => {
    const bruto = { detail: 'AOS002 - Esse cliente não possui contrato com cartão criado na processadora' }
    assert.equal(normalizarOfertaAmigoz('cartao_rcc', bruto, INST), null)
  })

  test('resposta vazia ou sem os campos mínimos não vira oferta', () => {
    assert.equal(normalizarOfertaAmigoz('cartao_rcc', {}, INST), null)
    assert.equal(normalizarOfertaAmigoz('cartao_rcc', null, INST), null)
    assert.equal(normalizarOfertaAmigoz('cartao_rcc', 'texto qualquer', INST), null)
  })

  test('mapeia uma resposta hipotética em snake_case (grafia candidata)', () => {
    const bruto = {
      limite_pre_aprovado: 1000,
      valor_saque: 700.5,
      numero_parcelas: 12,
      valor_parcela: 65.3,
      taxa_mes: 1.8,
      cet_mes: 2.1,
      primeiro_vencimento: '10/10/2026',
      id_produto: '7',
    }
    const oferta = normalizarOfertaAmigoz('cartao_rcc', bruto, INST)
    assert.ok(oferta)
    assert.equal(oferta!.produto, 'cartao_rcc')
    assert.equal(oferta!.instituicaoId, INST.id)
    assert.equal(oferta!.instituicaoNome, INST.name)
    assert.equal(oferta!.valorSaque, 700.5)
    assert.equal(oferta!.limitePreAprovado, 1000)
    assert.equal(oferta!.numParcelas, 12)
    assert.equal(oferta!.valorParcela, 65.3)
    assert.equal(oferta!.taxaMes, 1.8)
    assert.equal(oferta!.cetMes, 2.1)
    assert.equal(oferta!.primeiroVencimento, '2026-10-10')
    assert.equal(oferta!.tabelaCodigo, '7')
    assert.deepEqual(oferta!.bruto, bruto)
  })

  test('mapeia uma resposta hipotética em camelCase e aplica tabelaCodigo padrão por produto quando ausente', () => {
    const bruto = { valorSaque: 300, valorParcela: 40 }
    const oferta = normalizarOfertaAmigoz('cartao_rmc', bruto, INST)
    assert.ok(oferta)
    assert.equal(oferta!.valorSaque, 300)
    assert.equal(oferta!.tabelaCodigo, '15')
  })

  test('resposta embrulhada em {simulacao:{...}} também é reconhecida', () => {
    const bruto = { simulacao: { valor_saque: 500 } }
    const oferta = normalizarOfertaAmigoz('cartao_rcc', bruto, INST)
    assert.ok(oferta)
    assert.equal(oferta!.valorSaque, 500)
  })
})
