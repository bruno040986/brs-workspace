/**
 * Filtros das telas Tabelas de Comissão e Prazos Comissão (referência: ARW).
 * Roda com: npm test  (node --test --experimental-strip-types)
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  FILTROS_PRAZOS_PADRAO,
  FILTROS_TABELAS_PADRAO,
  filtrarOpcoesCombobox,
  filtrarTabelas,
  hojeSaoPaulo,
  montarConsultaPrazos,
  normalizarBuscaCombobox,
  type FiltrosTabelas,
  type OpFiltro,
  type TabelaFiltravel,
} from '../comissionamento-filtros.ts'

const ID = {
  inst1: '11111111-1111-4111-8111-111111111111',
  inst2: '22222222-2222-4222-8222-222222222222',
  conv1: '33333333-3333-4333-8333-333333333333',
  forma1: '44444444-4444-4444-8444-444444444444',
  forma2: '55555555-5555-4555-8555-555555555555',
  fmt1: '66666666-6666-4666-8666-666666666666',
  prom1: '77777777-7777-4777-8777-777777777777',
  tab1: '88888888-8888-4888-8888-888888888888',
}

function tabela(o: Partial<TabelaFiltravel> = {}): TabelaFiltravel {
  return {
    nome: 'Novo 1 Oferta S/ Seguro',
    codigo: 1000000001,
    codigo_tabela_banco: null,
    institution_id: ID.inst1,
    promotora_id: null,
    forma_contrato_id: ID.forma1,
    convenio_id: ID.conv1,
    tipo_formalizacao_id: ID.fmt1,
    com_seguro: false,
    is_active: true,
    created_at: '2026-09-01T10:00:00Z',
    financial_institutions: { name: 'Banco Um' },
    ...o,
  }
}

function filtros(o: Partial<FiltrosTabelas> = {}): FiltrosTabelas {
  return { ...FILTROS_TABELAS_PADRAO, ...o }
}

describe('filtrarTabelas', () => {
  const t1 = tabela({ nome: 'Novo 1 Oferta S/ Seguro', codigo: 1000000001, codigo_tabela_banco: '827004875' })
  const t2 = tabela({ nome: 'Saque Complementar Benefício', codigo: 1000000002, institution_id: ID.inst2, financial_institutions: { name: 'Banco Dois' }, com_seguro: true, promotora_id: ID.prom1, forma_contrato_id: ID.forma2, convenio_id: null, tipo_formalizacao_id: null, created_at: '2026-09-10T10:00:00Z' })
  const t3 = tabela({ nome: 'CC C/ Saque', codigo: 1000000003, com_seguro: null, is_active: false, created_at: '2026-09-05T10:00:00Z' })
  const todas = [t1, t2, t3]
  const nomes = (lista: TabelaFiltravel[]) => lista.map((t) => t.nome)

  test('padrão: só as não bloqueadas, por nome', () => {
    assert.deepEqual(nomes(filtrarTabelas(todas, filtros())), ['Novo 1 Oferta S/ Seguro', 'Saque Complementar Benefício'])
  })

  test('Bloqueado: sim mostra só as bloqueadas, todos mostra tudo', () => {
    assert.deepEqual(nomes(filtrarTabelas(todas, filtros({ bloqueado: 'sim' }))), ['CC C/ Saque'])
    assert.equal(filtrarTabelas(todas, filtros({ bloqueado: 'todos' })).length, 3)
  })

  test('Nome ignora caixa e acento', () => {
    assert.deepEqual(nomes(filtrarTabelas(todas, filtros({ nome: 'BENEFICIO' }))), ['Saque Complementar Benefício'])
  })

  test('Financeira, Convênio, Forma e Formalização filtram por id', () => {
    assert.deepEqual(nomes(filtrarTabelas(todas, filtros({ financeira: ID.inst2 }))), ['Saque Complementar Benefício'])
    assert.deepEqual(nomes(filtrarTabelas(todas, filtros({ convenio: ID.conv1 }))), ['Novo 1 Oferta S/ Seguro'])
    assert.deepEqual(nomes(filtrarTabelas(todas, filtros({ forma: ID.forma2 }))), ['Saque Complementar Benefício'])
    assert.deepEqual(nomes(filtrarTabelas(todas, filtros({ formalizacao: ID.fmt1 }))), ['Novo 1 Oferta S/ Seguro'])
  })

  test('Tipo de seguro: com, sem e não informado', () => {
    const todos = filtros({ bloqueado: 'todos' })
    assert.deepEqual(nomes(filtrarTabelas(todas, { ...todos, seguro: 'com' })), ['Saque Complementar Benefício'])
    assert.deepEqual(nomes(filtrarTabelas(todas, { ...todos, seguro: 'sem' })), ['Novo 1 Oferta S/ Seguro'])
    assert.deepEqual(nomes(filtrarTabelas(todas, { ...todos, seguro: 'nao_informado' })), ['CC C/ Saque'])
  })

  test('Promotora: direto = sem promotora; ou uma promotora específica', () => {
    assert.deepEqual(nomes(filtrarTabelas(todas, filtros({ promotora: 'direto' }))), ['Novo 1 Oferta S/ Seguro'])
    assert.deepEqual(nomes(filtrarTabelas(todas, filtros({ promotora: ID.prom1 }))), ['Saque Complementar Benefício'])
  })

  test('Código da tabela procura no código do banco e no nº do sistema', () => {
    assert.deepEqual(nomes(filtrarTabelas(todas, filtros({ codigo: '8270' }))), ['Novo 1 Oferta S/ Seguro'])
    assert.deepEqual(nomes(filtrarTabelas(todas, filtros({ codigo: '1000000002' }))), ['Saque Complementar Benefício'])
  })

  test('os filtros se combinam (E)', () => {
    assert.deepEqual(nomes(filtrarTabelas(todas, filtros({ nome: 'saque', seguro: 'com', financeira: ID.inst2 }))), ['Saque Complementar Benefício'])
    assert.deepEqual(filtrarTabelas(todas, filtros({ nome: 'saque', seguro: 'sem' })), [])
  })

  test('ordenações', () => {
    const todos = filtros({ bloqueado: 'todos' })
    // Financeira: "Banco Dois" antes de "Banco Um"; dentro da mesma financeira, por nome.
    assert.deepEqual(nomes(filtrarTabelas(todas, { ...todos, ordenar: 'financeira' })), ['Saque Complementar Benefício', 'CC C/ Saque', 'Novo 1 Oferta S/ Seguro'])
    assert.deepEqual(nomes(filtrarTabelas(todas, { ...todos, ordenar: 'codigo_sistema' })), ['Novo 1 Oferta S/ Seguro', 'Saque Complementar Benefício', 'CC C/ Saque'])
    assert.deepEqual(nomes(filtrarTabelas(todas, { ...todos, ordenar: 'recentes' })), ['Saque Complementar Benefício', 'CC C/ Saque', 'Novo 1 Oferta S/ Seguro'])
  })

  test('não altera a lista original', () => {
    const copia = [...todas]
    filtrarTabelas(todas, filtros({ ordenar: 'recentes', bloqueado: 'todos' }))
    assert.deepEqual(todas, copia)
  })
})

describe('montarConsultaPrazos', () => {
  const HOJE = '2026-09-21'
  const consulta = (f: Parameters<typeof montarConsultaPrazos>[0] = {}) => montarConsultaPrazos(f, HOJE)
  const semBloqueio = { prazoBloqueado: 'todos', tabelaBloqueada: 'todos' } as const
  const achar = (ops: OpFiltro[], coluna: string) => ops.filter((o) => 'coluna' in o && o.coluna === coluna)

  test('padrão: só prazos não bloqueados (ativos e sem data de bloqueio vencida), por nome da tabela', () => {
    const { filtros: ops, ordem } = consulta()
    assert.deepEqual(ops, [
      { op: 'eq', coluna: 'is_active', valor: true },
      { op: 'or', expressao: 'data_bloqueio.is.null,data_bloqueio.gt.2026-09-21' },
    ])
    assert.deepEqual(ordem[0], { coluna: 'tabelas_comissao(nome)', ascending: true })
  })

  test('sem bloqueio nem outros filtros: nenhuma operação', () => {
    assert.deepEqual(consulta({ ...semBloqueio }).filtros, [])
  })

  test('prazo bloqueado = sim: inativo ou data de bloqueio já atingida', () => {
    assert.deepEqual(consulta({ prazoBloqueado: 'sim', tabelaBloqueada: 'todos' }).filtros, [{ op: 'or', expressao: 'is_active.eq.false,data_bloqueio.lte.2026-09-21' }])
  })

  test('tabela bloqueada: não e sim', () => {
    assert.deepEqual(consulta({ ...semBloqueio, tabelaBloqueada: 'nao' }).filtros, [{ op: 'eq', coluna: 'tabelas_comissao.is_active', valor: true }])
    assert.deepEqual(consulta({ ...semBloqueio, tabelaBloqueada: 'sim' }).filtros, [{ op: 'eq', coluna: 'tabelas_comissao.is_active', valor: false }])
  })

  test('financeira, convênio, forma e tabela viram igualdade; o que não é uuid é ignorado', () => {
    const { filtros: ops } = consulta({ ...semBloqueio, financeira: ID.inst1, convenio: ID.conv1, forma: ID.forma1, tabela: ID.tab1 })
    assert.deepEqual(ops, [
      { op: 'eq', coluna: 'tabelas_comissao.institution_id', valor: ID.inst1 },
      { op: 'eq', coluna: 'tabelas_comissao.convenio_id', valor: ID.conv1 },
      { op: 'eq', coluna: 'tabelas_comissao.forma_contrato_id', valor: ID.forma1 },
      { op: 'eq', coluna: 'tabela_comissao_id', valor: ID.tab1 },
    ])
    assert.deepEqual(consulta({ ...semBloqueio, financeira: "x' or 1=1", tabela: 'abc' }).filtros, [])
  })

  test('promotora: direto = sem promotora; ou uma específica', () => {
    assert.deepEqual(consulta({ ...semBloqueio, promotora: 'direto' }).filtros, [{ op: 'is_null', coluna: 'tabelas_comissao.promotora_id' }])
    assert.deepEqual(consulta({ ...semBloqueio, promotora: ID.prom1 }).filtros, [{ op: 'eq', coluna: 'tabelas_comissao.promotora_id', valor: ID.prom1 }])
  })

  test('descrição procura no nome da tabela', () => {
    assert.deepEqual(consulta({ ...semBloqueio, descricao: '  CC C/ SAQUE ' }).filtros, [{ op: 'ilike', coluna: 'tabelas_comissao.nome', valor: '%CC C/ SAQUE%' }])
  })

  test('código da tabela: texto procura no banco; número procura também no nº do sistema', () => {
    assert.deepEqual(consulta({ ...semBloqueio, codigoTabela: 'AB12' }).filtros, [{ op: 'or', expressao: 'codigo_tabela_banco.ilike.*AB12*', tabela: 'tabelas_comissao' }])
    assert.deepEqual(consulta({ ...semBloqueio, codigoTabela: '1000000002' }).filtros, [{ op: 'or', expressao: 'codigo_tabela_banco.ilike.*1000000002*,codigo.eq.1000000002', tabela: 'tabelas_comissao' }])
  })

  test('código da tabela: caracteres da gramática do PostgREST são removidos (sem injeção)', () => {
    const [op] = consulta({ ...semBloqueio, codigoTabela: 'x),id.not.is.null,(y' }).filtros
    assert.equal(op.op, 'or')
    if (op.op === 'or') {
      assert.doesNotMatch(op.expressao.replace('codigo_tabela_banco.ilike.*', '').replace(/\*$/, ''), /[,()*]/)
      assert.equal(op.expressao.split(',').length, 1)
    }
    assert.deepEqual(consulta({ ...semBloqueio, codigoTabela: ',()*%' }).filtros, [])
  })

  test('tipo de seguro: com, sem e não informado', () => {
    assert.deepEqual(consulta({ ...semBloqueio, seguro: 'com' }).filtros, [{ op: 'eq', coluna: 'tabelas_comissao.com_seguro', valor: true }])
    assert.deepEqual(consulta({ ...semBloqueio, seguro: 'sem' }).filtros, [{ op: 'eq', coluna: 'tabelas_comissao.com_seguro', valor: false }])
    assert.deepEqual(consulta({ ...semBloqueio, seguro: 'nao_informado' }).filtros, [{ op: 'is_null', coluna: 'tabelas_comissao.com_seguro' }])
  })

  test('forma de pagamento (e do seguro) só aceita valores conhecidos', () => {
    assert.deepEqual(consulta({ ...semBloqueio, formaPagamento: 'faixa_fixo', formaPagamentoSeguro: 'fixo' }).filtros, [
      { op: 'eq', coluna: 'forma_pagamento', valor: 'faixa_fixo' },
      { op: 'eq', coluna: 'forma_pagamento_seguro', valor: 'fixo' },
    ])
    assert.deepEqual(consulta({ ...semBloqueio, formaPagamento: 'qualquer', formaPagamentoSeguro: 'faixa_fixo' }).filtros, [])
  })

  test('prazo de–até: prazos contidos no intervalo; zero e lixo são ignorados', () => {
    assert.deepEqual(consulta({ ...semBloqueio, prazoDe: '24', prazoAte: '48' }).filtros, [
      { op: 'gte', coluna: 'prazo_inicial', valor: 24 },
      { op: 'lte', coluna: 'prazo_final', valor: 48 },
    ])
    assert.deepEqual(consulta({ ...semBloqueio, prazoDe: '0', prazoAte: 'abc' }).filtros, [])
  })

  test('lote de importação: igualdade exata', () => {
    assert.deepEqual(consulta({ ...semBloqueio, lote: ' 12 ' }).filtros, [{ op: 'eq', coluna: 'lote_importacao', valor: '12' }])
  })

  test('data: campo de data usa a data pura; cadastro/atualização usam o dia inteiro em Brasília', () => {
    assert.deepEqual(consulta({ ...semBloqueio, dataCampo: 'data_bloqueio', dataDe: '2026-01-01', dataAte: '2026-01-31' }).filtros, [
      { op: 'gte', coluna: 'data_bloqueio', valor: '2026-01-01' },
      { op: 'lte', coluna: 'data_bloqueio', valor: '2026-01-31' },
    ])
    assert.deepEqual(consulta({ ...semBloqueio, dataCampo: 'created_at', dataDe: '2026-01-01', dataAte: '2026-01-31' }).filtros, [
      { op: 'gte', coluna: 'created_at', valor: '2026-01-01T00:00:00-03:00' },
      { op: 'lte', coluna: 'created_at', valor: '2026-01-31T23:59:59.999-03:00' },
    ])
  })

  test('data: campo inválido cai em data base e data inválida é ignorada', () => {
    assert.deepEqual(consulta({ ...semBloqueio, dataCampo: 'senha' as never, dataDe: '2026-02-01' }).filtros, [{ op: 'gte', coluna: 'data_base', valor: '2026-02-01' }])
    assert.deepEqual(consulta({ ...semBloqueio, dataDe: '01/02/2026', dataAte: 'x' }).filtros, [])
  })

  test('ordenações: por tabela (A–Z/Z–A), prazo, comissão, recentes, código; inválida cai no padrão', () => {
    assert.deepEqual(consulta({ ordenar: 'tabela_desc' }).ordem[0], { coluna: 'tabelas_comissao(nome)', ascending: false })
    assert.deepEqual(consulta({ ordenar: 'prazo_asc' }).ordem[0], { coluna: 'prazo_inicial', ascending: true })
    assert.deepEqual(consulta({ ordenar: 'comissao_desc' }).ordem[0], { coluna: 'comissao', ascending: false })
    assert.deepEqual(consulta({ ordenar: 'recentes' }).ordem, [{ coluna: 'created_at', ascending: false }])
    assert.deepEqual(consulta({ ordenar: 'codigo_asc' }).ordem, [{ coluna: 'codigo', ascending: true }])
    assert.deepEqual(consulta({ ordenar: 'drop table' as never }).ordem, consulta().ordem)
  })

  test('valores de bloqueio inválidos caem no padrão do ARW (prazo: não; tabela: todos)', () => {
    assert.deepEqual(consulta({ prazoBloqueado: 'talvez' as never, tabelaBloqueada: 'talvez' as never }), consulta())
  })

  test('sem a data de referência válida, o bloqueio por data é omitido (nunca gera expressão quebrada)', () => {
    assert.deepEqual(montarConsultaPrazos({ prazoBloqueado: 'nao', tabelaBloqueada: 'todos' }, 'lixo').filtros, [{ op: 'eq', coluna: 'is_active', valor: true }])
    assert.deepEqual(montarConsultaPrazos({ prazoBloqueado: 'sim', tabelaBloqueada: 'todos' }, 'lixo').filtros, [{ op: 'or', expressao: 'is_active.eq.false' }])
  })

  test('todos os campos do padrão existem na consulta sem erro', () => {
    assert.doesNotThrow(() => montarConsultaPrazos(FILTROS_PRAZOS_PADRAO, HOJE))
    assert.equal(achar(consulta().filtros, 'is_active').length, 1)
  })
})

describe('hojeSaoPaulo', () => {
  test('usa o dia de Brasília, não o UTC', () => {
    assert.equal(hojeSaoPaulo(new Date('2026-09-22T02:30:00Z')), '2026-09-21')
    assert.equal(hojeSaoPaulo(new Date('2026-09-22T03:00:00Z')), '2026-09-22')
  })
})

describe('filtrarOpcoesCombobox', () => {
  const opcoes = [
    { valor: 'a', label: 'BANCO SANTANDER (BRASIL) S.A.' },
    { valor: 'b', label: 'Banco Pan' },
    { valor: 'c', label: 'Prefeitura Municipal de Salto/SP' },
    { valor: 'd', label: 'Bem Digital' },
  ]

  test('abaixo do mínimo (padrão 3): devolve a lista inteira, sem filtrar', () => {
    assert.deepEqual(filtrarOpcoesCombobox(opcoes, ''), opcoes)
    assert.deepEqual(filtrarOpcoesCombobox(opcoes, 'b'), opcoes)
    assert.deepEqual(filtrarOpcoesCombobox(opcoes, 'ba'), opcoes)
  })

  test('a partir do mínimo: filtra pelo texto contido no label', () => {
    assert.deepEqual(filtrarOpcoesCombobox(opcoes, 'ban'), [opcoes[0], opcoes[1]])
    assert.deepEqual(filtrarOpcoesCombobox(opcoes, 'salto'), [opcoes[2]])
  })

  test('ignora caixa e acento', () => {
    assert.deepEqual(filtrarOpcoesCombobox(opcoes, 'PREFEITURA'), [opcoes[2]])
    assert.deepEqual(filtrarOpcoesCombobox(opcoes, 'sáo'), [])
  })

  test('espaços nas pontas não contam para o mínimo de caracteres', () => {
    assert.deepEqual(filtrarOpcoesCombobox(opcoes, '  ba  '), opcoes) // "ba" = 2 caracteres reais
    assert.deepEqual(filtrarOpcoesCombobox(opcoes, '  ban  '), [opcoes[0], opcoes[1]]) // "ban" = 3
  })

  test('sem nenhum resultado: lista vazia (não devolve tudo)', () => {
    assert.deepEqual(filtrarOpcoesCombobox(opcoes, 'xyz'), [])
  })

  test('minimoCaracteres é configurável', () => {
    assert.deepEqual(filtrarOpcoesCombobox(opcoes, 'ba', 2), [opcoes[0], opcoes[1]])
    assert.deepEqual(filtrarOpcoesCombobox(opcoes, 'ba', 5), opcoes)
  })

  test('não altera a lista original', () => {
    const copia = [...opcoes]
    filtrarOpcoesCombobox(opcoes, 'ban')
    assert.deepEqual(opcoes, copia)
  })
})

describe('normalizarBuscaCombobox', () => {
  test('mede o mesmo tamanho que o limiar do filtro usa (ignora acento, caixa e espaços das pontas)', () => {
    assert.equal(normalizarBuscaCombobox('  Ban  ').length, 3)
    assert.equal(normalizarBuscaCombobox('sáo').length, 3)
    assert.equal(normalizarBuscaCombobox('').length, 0)
  })
})
