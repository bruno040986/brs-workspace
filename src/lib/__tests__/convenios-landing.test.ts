import { describe, it } from 'node:test'
import assert from 'node:assert'
import { lista, preencherLanding, type CamposPreenchiveis, type DadosConvenioLanding } from '../convenios-landing/preencher.ts'

const P1 = '3f2b8c1e-1111-4222-8333-444455556666'
const P2 = '3f2b8c1e-1111-4222-8333-444455556667'

const completo: DadosConvenioLanding = {
  nome: 'Prefeitura de Mesquita',
  esfera: 'municipal',
  uf: 'RJ',
  cidade: 'Mesquita',
  orgao: 'Município de Mesquita',
  teto_margem: 35,
  prazo_min: 6,
  prazo_max: 96,
  formas: [
    { nome: 'Empréstimo consignado', margem: 30 },
    { nome: 'Cartão benefício', margem: 5 },
  ],
  publicos: [
    { id: P1, nome: 'Servidores efetivos' },
    { id: P2, nome: 'Aposentados' },
  ],
  normas: [
    { titulo: 'Decreto sem link', url: null },
    { titulo: 'Decreto Municipal nº 1.234/2020', url: 'https://mesquita.rj.gov.br/decreto-1234' },
  ],
}

const minimo: DadosConvenioLanding = {
  nome: 'INSS',
  esfera: 'inss',
  uf: null,
  cidade: null,
  orgao: null,
  teto_margem: null,
  prazo_min: null,
  prazo_max: null,
  formas: [],
  publicos: [],
  normas: [],
}

const vazio = (): CamposPreenchiveis => ({
  titulo_destaque: '',
  subtitulo: '  ',
  resumo_publico: '',
  vantagens: [],
  publicos_destaque: [],
  meta_title: null,
  meta_description: null,
})

describe('preencherLanding', () => {
  it('preenche tudo a partir dos dados completos', () => {
    const { valor, preenchidos } = preencherLanding(vazio(), completo)
    assert.strictEqual(valor.titulo_destaque, 'Consignado Prefeitura de Mesquita')
    assert.match(valor.subtitulo, /Servidores efetivos e Aposentados, em até 96 meses\.$/)
    assert.match(valor.resumo_publico, /\(Mesquita\/RJ\)/)
    assert.match(valor.resumo_publico, /Até 35% da remuneração/)
    assert.match(valor.resumo_publico, /Prazos de 6 a 96 meses\./)
    assert.ok(valor.vantagens.length >= 4 && valor.vantagens.length <= 6)
    assert.ok(valor.vantagens.every((v) => v.situacao === 'confirmado'))
    const norma = valor.vantagens.find((v) => v.natureza === 'norma_oficial')
    assert.ok(norma)
    assert.strictEqual(norma.fonte, 'https://mesquita.rj.gov.br/decreto-1234')
    assert.ok(!JSON.stringify(valor.vantagens).includes('Decreto sem link'))
    assert.deepStrictEqual(
      valor.publicos_destaque.map((p) => [p.publico_id, p.titulo, p.imagem_url]),
      [
        [P1, 'Servidores efetivos', null],
        [P2, 'Aposentados', null],
      ],
    )
    assert.ok(valor.publicos_destaque.every((p) => p.texto.length > 0 && p.texto.length <= 300))
    assert.strictEqual(valor.meta_title, 'Consignado Prefeitura de Mesquita - Mesquita/RJ')
    assert.strictEqual(preenchidos.length, 7)
  })

  it('não sobrescreve campo já preenchido', () => {
    const atual = { ...vazio(), titulo_destaque: 'Meu título', vantagens: [{ titulo: 'A', descricao: 'B' }] }
    const { valor, preenchidos } = preencherLanding(atual, completo)
    assert.strictEqual(valor.titulo_destaque, 'Meu título')
    assert.deepStrictEqual(valor.vantagens, [{ titulo: 'A', descricao: 'B' }])
    assert.ok(!preenchidos.includes('título') && !preenchidos.includes('vantagens'))
  })

  it('com dados mínimos completa 4 vantagens e não sugere públicos', () => {
    const { valor, preenchidos } = preencherLanding(vazio(), minimo)
    assert.strictEqual(valor.vantagens.length, 4)
    assert.ok(valor.vantagens.every((v) => v.natureza === 'regra_bancaria' && v.fonte === null))
    assert.deepStrictEqual(valor.publicos_destaque, [])
    assert.ok(!preenchidos.includes('públicos em destaque'))
    assert.strictEqual(valor.subtitulo, 'Crédito com desconto em folha.')
  })

  it('respeita os limites de tamanho', () => {
    const longo = 'X'.repeat(500)
    const { valor } = preencherLanding(vazio(), { ...completo, nome: longo, publicos: [{ id: P1, nome: longo }] })
    assert.ok(valor.titulo_destaque.length <= 200)
    assert.ok((valor.meta_title ?? '').length <= 70)
    assert.ok((valor.meta_description ?? '').length <= 170)
    assert.ok(valor.publicos_destaque[0].titulo.length <= 60)
    assert.ok(valor.vantagens.every((v) => v.titulo.length <= 120 && v.descricao.length <= 600))
  })

  it('só cita norma com link https (www. ganha https://)', () => {
    const http = preencherLanding(vazio(), { ...minimo, normas: [{ titulo: 'Lei X', url: 'http://inseguro.gov.br' }] }).valor
    assert.ok(!http.vantagens.some((v) => v.natureza === 'norma_oficial'))
    const www = preencherLanding(vazio(), { ...minimo, normas: [{ titulo: 'Lei Y', url: 'www.planalto.gov.br/lei' }] }).valor
    assert.strictEqual(www.vantagens.find((v) => v.natureza === 'norma_oficial')?.fonte, 'https://www.planalto.gov.br/lei')
  })

  it('é determinístico', () => {
    assert.deepStrictEqual(preencherLanding(vazio(), completo), preencherLanding(vazio(), completo))
  })
})

describe('lista', () => {
  it('junta com vírgula e "e"', () => {
    assert.strictEqual(lista([]), '')
    assert.strictEqual(lista(['a']), 'a')
    assert.strictEqual(lista(['a', 'b', 'c']), 'a, b e c')
  })
})
