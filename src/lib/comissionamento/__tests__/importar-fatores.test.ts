/**
 * Regressão dos leitores de PDF de Fatores (Santander lista/intervalo, Daycoval).
 * Os testes de fixture leem PDFs REAIS em ../__fixtures__ (ver README lá) e são
 * pulados quando o arquivo não existe; os sintéticos rodam sempre.
 * Roda com: npm test  (node --test --experimental-strip-types)
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseFatoresSantander, parseFatoresSantanderLinhas } from '../importar-fatores-santander.ts'
import { parseFatoresDaycoval, parseFatoresDaycovalLinhas } from '../importar-fatores-daycoval.ts'
import type { PdfLinha, PdfToken } from '../pdf-tabela.ts'

const fixture = (nome: string) => fileURLToPath(new URL(`../__fixtures__/${nome}`, import.meta.url))
const semFixture = (nome: string) => (existsSync(fixture(nome)) ? false : `fixture ausente: ${nome}`)

/** Linhas "reconstruídas" a partir de texto simples (tokens separados por espaço, X = ordem). */
const linhasDeTexto = (textos: string[], pagina = 1): PdfLinha[] =>
  textos.map((texto, i) => ({
    pagina,
    y: i,
    texto,
    tokens: texto.split(' ').map((t, k): PdfToken => ({ x: k, texto: t })),
  }))

/** Linha com tokens em posições X explícitas (layout do Daycoval). */
const linhaX = (tokens: Array<[string, number]>, y: number, pagina = 1): PdfLinha => ({
  pagina,
  y,
  texto: tokens.map(([t]) => t).join(' '),
  tokens: tokens.map(([texto, x]) => ({ x, texto })),
})

const CABECALHO_SANTANDER = [
  'BANCO SANTANDER (BRASIL) S.A. Pg. 1',
  'Convênio: 21522 - PREFEITURA MUNICIPAL DE SAO JOSE DOS CAM ; Regra: 860021522 - 1 Oferta Novo sem Seguro; Seguro: S; Financia IOF: S',
  'Faixa Parcelas: 3-144 ; Data. Inicio: 03/09/2026 ; Data Final: 04/09/2026',
]

describe('Santander — sintético', () => {
  test('intervalo paginado por colunas: blocos somam por data, taxa única, faixa conferida', () => {
    const r = parseFatoresSantanderLinhas(
      linhasDeTexto([
        ...CABECALHO_SANTANDER,
        '17 18', 'PRAZO', 'TAXA', '2,2300 2,2300',
        '03/09/2026 0,0779624 0,0744308',
        '04/09/2026 0,0779006 0,074372',
        ...CABECALHO_SANTANDER,
        '19', 'PRAZO', 'TAXA', '2,2300',
        '03/09/2026 0,0712727',
        '04/09/2026 0,0712166',
      ]),
    )
    assert.equal(r.formato, 'Santander (faixa em intervalo, paginado por colunas)')
    assert.equal(r.convenioCodigo, '21522')
    assert.equal(r.tabelas.length, 1)
    const t = r.tabelas[0]
    assert.equal(t.codigoTabelaBanco, '860021522')
    assert.equal(t.nomeTabela, '1 Oferta Novo sem Seguro')
    assert.equal(t.taxaPercentual, 2.23)
    assert.deepEqual(t.prazos, [17, 18, 19])
    assert.equal(t.linhas.length, 2)
    assert.deepEqual(t.linhas[0], { data: '2026-09-03', fatoresPorPrazo: { 17: 0.0779624, 18: 0.0744308, 19: 0.0712727 } })
    assert.equal(t.linhas[1].fatoresPorPrazo[19], 0.0712166)
    assert.equal(t.bloqueio, null)
    assert.ok(t.avisos.some((a) => a.includes('só traz fatores dos prazos 17 a 19')))
  })

  test('lista inline ("PRAZO 12 24" na mesma linha) continua lendo', () => {
    const r = parseFatoresSantanderLinhas(
      linhasDeTexto([
        'Convênio: 4875 - MUNICIPIO DE MESQUITA ; Regra: 8104875 - 1 Oferta Novo Com Seguro; Seguro: S; Financia IOF: S',
        'Faixa Parcelas: 12 ; 24 ; Data. Inicio: 25/08/2026 ; Data Final: 25/08/2026',
        'PRAZO 12 24',
        'TAXA 2,3800 2,3800',
        '25/08/2026 0,106263 0,0609326',
      ]),
    )
    assert.equal(r.formato, 'Santander (faixa em lista)')
    assert.deepEqual(r.tabelas[0].prazos, [12, 24])
    assert.equal(r.tabelas[0].taxaPercentual, 2.38)
    assert.equal(r.tabelas[0].linhas[0].fatoresPorPrazo[24], 0.0609326)
  })

  test('taxas diferentes por prazo → erro (fail-closed)', () => {
    assert.throws(
      () => parseFatoresSantanderLinhas(linhasDeTexto([...CABECALHO_SANTANDER, '17 18', 'PRAZO', 'TAXA', '2,2300 2,3800', '03/09/2026 0,07 0,07'])),
      /taxas diferentes/,
    )
  })

  test('prazo fora da Faixa Parcelas → erro', () => {
    assert.throws(
      () => parseFatoresSantanderLinhas(linhasDeTexto([...CABECALHO_SANTANDER, '2 3', 'PRAZO', 'TAXA', '2,2300 2,2300', '03/09/2026 0,5 0,4'])),
      /fora da "Faixa Parcelas: 3-144"/,
    )
  })

  test('quantidade de fatores diferente da de prazos do bloco → erro', () => {
    assert.throws(
      () => parseFatoresSantanderLinhas(linhasDeTexto([...CABECALHO_SANTANDER, '17 18 19', 'PRAZO', 'TAXA', '2,2300 2,2300 2,2300', '03/09/2026 0,07 0,07'])),
      /2 fator\(es\) para 3 prazo\(s\)/,
    )
  })
})

describe('Daycoval — sintético', () => {
  const cabecalho = (codigo: string, nome: string, tc: string) => [
    linhaX([['Convênio:', 1.69], [`${codigo}  ${nome}`, 6.65], ['Para tipo de seguro T - Tabela, o valor do seguro não é embutido no fator price.', 27]], 8.2),
    linhaX([['Empregador:', 1.69], ['PREF SJ CAMPOS', 6.65], ['Aplicar Fator sobre Valor Liberado + TC.', 27]], 8.9),
    linhaX([['TC:', 1.69], [tc, 6.65], ['09/09/2026 Tabela sujeita a alteração sem prévio aviso.', 27]], 9.6),
    linhaX([['Data Base', 1.69], ['1º Venc', 6.65], ['Tx Cet', 9.63], ['48 meses', 12.43], ['60 meses', 16.07], ['72 meses', 19.71]], 10.35),
  ]

  test('colunas vazias casadas pelo X, 1º Venc e Tx Cet ignorados, só dias úteis avisado', () => {
    const r = parseFatoresDaycovalLinhas([
      ...cabecalho('731703', 'PREFSJC3DIG', '0,00'),
      linhaX([['11/09/2026', 1.69], ['15/10/2026', 6.65], ['0,00', 9.63], ['0,03285', 16.07], ['0,03049', 19.71]], 11.5),
      linhaX([['14/09/2026', 1.69], ['15/10/2026', 6.65], ['38,92', 9.63], ['0,03277', 16.07], ['0,03042', 19.71]], 12.45),
    ])
    assert.equal(r.convenioNome, 'PREF SJ CAMPOS')
    assert.equal(r.tabelas.length, 1)
    const t = r.tabelas[0]
    assert.equal(t.codigoTabelaBanco, '731703')
    assert.equal(t.nomeTabela, 'PREFSJC3DIG')
    assert.equal(t.taxaPercentual, null)
    assert.deepEqual(t.prazos, [60, 72])
    assert.deepEqual(t.linhas, [
      { data: '2026-09-11', fatoresPorPrazo: { 60: 0.03285, 72: 0.03049 } },
      { data: '2026-09-14', fatoresPorPrazo: { 60: 0.03277, 72: 0.03042 } },
    ])
    assert.equal(t.dataInicio, '2026-09-11')
    assert.equal(t.dataFinal, '2026-09-14')
    assert.equal(t.bloqueio, null)
    assert.ok(t.avisos.some((a) => a.includes('Sem fator para os prazos 48')))
    assert.ok(t.avisos.some((a) => a.includes('2 dias úteis num período de 4 dias')))
  })

  test('TC > 0 bloqueia a tabela (fator sobre Valor Liberado + TC não tratado)', () => {
    const r = parseFatoresDaycovalLinhas([
      ...cabecalho('731701', 'PREFSJC1DIG', '12,50'),
      linhaX([['09/09/2026', 1.69], ['15/10/2026', 6.65], ['38,91', 9.63], ['0,03817', 12.43]], 11.5),
    ])
    assert.match(r.tabelas[0].bloqueio || '', /TC = 12,50 > 0/)
  })

  test('duas páginas com o mesmo código = continuação da mesma tabela', () => {
    const r = parseFatoresDaycovalLinhas([
      ...cabecalho('731701', 'PREFSJC1DIG', '0,00'),
      linhaX([['09/09/2026', 1.69], ['15/10/2026', 6.65], ['38,91', 9.63], ['0,03817', 12.43]], 11.5),
      ...cabecalho('731701', 'PREFSJC1DIG', '0,00').map((l) => ({ ...l, pagina: 2 })),
      linhaX([['10/09/2026', 1.69], ['15/10/2026', 6.65], ['38,91', 9.63], ['0,03814', 12.43]], 11.5, 2),
    ])
    assert.equal(r.tabelas.length, 1)
    assert.equal(r.tabelas[0].linhas.length, 2)
  })

  test('sem linha "Convênio:" → erro', () => {
    assert.throws(() => parseFatoresDaycovalLinhas(linhasDeTexto(['BANCO SANTANDER', 'PRAZO 12'])), /Fatores Price.*Daycoval/)
  })
})

describe('Santander — PDFs reais', () => {
  const lista = 'santander-lista-mesquita-8104875.pdf'
  test('faixa em lista (Mesquita, formato que já funcionava)', { skip: semFixture(lista) }, async () => {
    const r = await parseFatoresSantander(readFileSync(fixture(lista)))
    const t = r.tabelas[0]
    assert.equal(r.convenioCodigo, '4875')
    assert.equal(t.codigoTabelaBanco, '8104875')
    assert.equal(t.taxaPercentual, 2.38)
    assert.deepEqual(t.prazos, [12, 24, 36, 48, 60, 72, 84, 96, 120])
    assert.equal(t.linhas.length, 21)
    assert.equal(t.dataInicio, '2026-08-25')
    assert.equal(t.dataFinal, '2026-09-14')
    assert.equal(t.linhas[0].fatoresPorPrazo[120], 0.0280625)
    assert.equal(t.linhas[20].fatoresPorPrazo[12], 0.107275)
    assert.equal(t.bloqueio, null)
  })

  const intervalo = 'santander-intervalo-sjc-860021522.pdf'
  test('faixa em intervalo (SJC, 7 páginas paginadas por colunas)', { skip: semFixture(intervalo) }, async () => {
    const r = await parseFatoresSantander(readFileSync(fixture(intervalo)))
    const t = r.tabelas[0]
    assert.equal(r.convenioCodigo, '21522')
    assert.equal(t.codigoTabelaBanco, '860021522')
    assert.equal(t.taxaPercentual, 2.23)
    assert.equal(t.prazos.length, 80)
    assert.equal(t.prazos[0], 17)
    assert.equal(t.prazos[79], 96)
    assert.equal(t.linhas.length, 21)
    assert.ok(t.linhas.every((l) => Object.keys(l.fatoresPorPrazo).length === 80))
    assert.equal(t.linhas[0].fatoresPorPrazo[17], 0.0779624)
    assert.equal(t.linhas[13].fatoresPorPrazo[30], 0.0512615) // 16/09, salto mensal
    assert.equal(t.linhas[20].fatoresPorPrazo[96], 0.0281342)
    assert.ok(t.avisos.some((a) => a.includes('só traz fatores dos prazos 17 a 96')))
  })
})

describe('Daycoval — PDF real', () => {
  const nome = 'daycoval-sjc-731701.pdf'
  test('14 tabelas, uma por página, colunas vazias e só dias úteis', { skip: semFixture(nome) }, async () => {
    const r = await parseFatoresDaycoval(readFileSync(fixture(nome)))
    assert.equal(r.convenioNome, 'PREF SJ CAMPOS')
    assert.equal(r.tabelas.length, 14)
    const por = Object.fromEntries(r.tabelas.map((t) => [t.codigoTabelaBanco, t]))
    assert.deepEqual(por['731701'].prazos, [48, 60, 72, 84, 96])
    assert.equal(por['731701'].nomeTabela, 'PREFSJC1DIG')
    assert.equal(por['731701'].linhas.length, 23)
    assert.equal(por['731701'].linhas[0].fatoresPorPrazo[48], 0.03817)
    assert.deepEqual(por['731703'].prazos, [60, 72, 84, 96])
    assert.equal(por['731703'].linhas[0].fatoresPorPrazo[60], 0.0329)
    assert.deepEqual(por['731706'].prazos, [96])
    assert.equal(por['830001'].nomeTabela, 'RFNPREFSJC1FIDELDIG')
    assert.equal(por['830001'].linhas[22].fatoresPorPrazo[96], 0.02175)
    assert.ok(r.tabelas.every((t) => t.bloqueio === null && t.taxaPercentual === null))
    assert.ok(r.tabelas.every((t) => t.dataInicio === '2026-09-09' && t.dataFinal === '2026-10-09'))
    assert.ok(por['731701'].avisos.some((a) => a.includes('dias úteis')))
  })
})
