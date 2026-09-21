/**
 * Importador de comissionamento — tabela SEM código no banco.
 * O banco nem sempre informa código (`codigo_tabela_banco` nulo). Regra do Bruno
 * (21/09/2026) para o passo 2 (Prazos): a tabela é um cadastro único e cada linha
 * da planilha repete a tabela e traz um prazo. COM código vale financeira +
 * promotora + forma + convênio + código; SEM código todos os demais campos da
 * tabela precisam bater (menos observação) — se algum não bate, não é a mesma.
 * Roda com: npm test  (node --test --experimental-strip-types)
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  camposDiferentes,
  candidatasDaLinha,
  chaveTabelaCompleta,
  discriminadorTabela,
  explicarTabelaNaoEncontrada,
  indexarTabelas,
  lerCamposTabela,
  type CamposTabela,
  type TabelaCadastrada,
} from '../comissionamento-import.ts'

const nomes = new Map([
  ['inst-1', 'Banco Um'],
  ['inst-2', 'Banco Dois'],
  ['prom-1', 'Promotora X'],
  ['forma-1', 'Cartão'],
  ['conv-1', 'Prefeitura A'],
  ['conv-2', 'Prefeitura B'],
  ['fmt-1', 'Digital'],
])

function tabela(o: Partial<CamposTabela> = {}): CamposTabela {
  return {
    codigo_tabela_banco: null,
    nome: 'Novo 1 Oferta S/ Seguro',
    institution_id: 'inst-1',
    promotora_id: null,
    forma_contrato_id: 'forma-1',
    convenio_id: 'conv-1',
    tipo_formalizacao_id: 'fmt-1',
    com_seguro: false,
    taxa_juros_tipo: 'fixa',
    taxa_juros: 2.38,
    taxa_juros_min: null,
    taxa_juros_max: null,
    ...o,
  }
}

function cadastrada(id: string, o: Partial<CamposTabela> = {}, idArw: string | null = null): TabelaCadastrada {
  return { ...tabela(o), id, id_arw: idArw }
}

// O passo 1 (Tabelas) continua usando o discriminador: não mudou.
describe('discriminadorTabela', () => {
  test('usa o código quando existe e ignora o nome', () => {
    assert.equal(discriminadorTabela(' 827004875 ', 'qualquer nome'), 'cod:827004875')
  })
  test('sem código usa o nome normalizado (acento/caixa/espaços)', () => {
    assert.equal(discriminadorTabela(null, '  Refin  Oferta Ç '), 'nome:refin oferta c')
    assert.equal(discriminadorTabela('', 'Refin Oferta'), discriminadorTabela(null, 'REFIN   oferta'))
  })
  test('código e nome nunca colidem entre si', () => {
    assert.notEqual(discriminadorTabela('abc', 'x'), discriminadorTabela(null, 'abc'))
  })
})

describe('chaveTabelaCompleta', () => {
  const base = chaveTabelaCompleta(tabela())

  test('ignora caixa, acento e espaços repetidos', () => {
    assert.equal(chaveTabelaCompleta(tabela({ nome: '  NOVO 1   oferta s/ seguro ' })), base)
    assert.equal(chaveTabelaCompleta(tabela({ nome: 'Saque Comp. Benefício' })), chaveTabelaCompleta(tabela({ nome: 'saque comp. beneficio' })))
  })

  test('qualquer campo diferente muda a chave', () => {
    const variacoes: Array<[string, Partial<CamposTabela>]> = [
      ['código', { codigo_tabela_banco: '827004875' }],
      ['nome', { nome: 'Novo 2 Oferta S/ Seguro' }],
      ['financeira', { institution_id: 'inst-2' }],
      ['promotora', { promotora_id: 'prom-1' }],
      ['forma', { forma_contrato_id: 'forma-2' }],
      ['convênio', { convenio_id: 'conv-2' }],
      ['formalização', { tipo_formalizacao_id: null }],
      ['seguro', { com_seguro: true }],
      ['juros (valor)', { taxa_juros: 2.5 }],
      ['juros (tipo)', { taxa_juros_tipo: 'faixa', taxa_juros: null, taxa_juros_min: 2, taxa_juros_max: 3 }],
    ]
    for (const [campo, mudanca] of variacoes) {
      assert.notEqual(chaveTabelaCompleta(tabela(mudanca)), base, `${campo} deveria diferenciar`)
    }
  })

  test('seguro em branco (null) não é o mesmo que "sem seguro"', () => {
    assert.notEqual(chaveTabelaCompleta(tabela({ com_seguro: null })), chaveTabelaCompleta(tabela({ com_seguro: false })))
  })

  test('taxa é comparada na escala do banco (4 casas)', () => {
    assert.equal(chaveTabelaCompleta(tabela({ taxa_juros: 2.380001 })), base)
  })

  test('valor de juros que não pertence ao tipo escolhido não conta', () => {
    assert.equal(chaveTabelaCompleta(tabela({ taxa_juros_tipo: null, taxa_juros: 9 })), chaveTabelaCompleta(tabela({ taxa_juros_tipo: null, taxa_juros: null })))
    assert.equal(chaveTabelaCompleta(tabela({ taxa_juros_min: 1, taxa_juros_max: 7 })), base)
  })
})

describe('candidatasDaLinha — linha COM código (regra de sempre)', () => {
  const t = cadastrada('t-cod', { codigo_tabela_banco: '81034875' })

  test('acha por financeira + promotora + forma + convênio + código', () => {
    assert.deepEqual(candidatasDaLinha(indexarTabelas([t]), tabela({ codigo_tabela_banco: '81034875' }), null), [t])
  })

  test('nome, juros, seguro e formalização diferentes não impedem (atualização pendente no passo 1 não trava os prazos)', () => {
    const linha = tabela({ codigo_tabela_banco: '81034875', nome: 'Nome novo', taxa_juros: 2.6, com_seguro: true, tipo_formalizacao_id: null })
    assert.deepEqual(candidatasDaLinha(indexarTabelas([t]), linha, null), [t])
  })

  test('mesmo código em outra financeira, promotora, forma ou convênio é outra tabela', () => {
    const indice = indexarTabelas([t])
    for (const mudanca of [{ institution_id: 'inst-2' }, { promotora_id: 'prom-1' }, { forma_contrato_id: 'forma-2' }, { convenio_id: 'conv-2' }]) {
      assert.deepEqual(candidatasDaLinha(indice, tabela({ codigo_tabela_banco: '81034875', ...mudanca }), null), [])
    }
  })

  test('não casa com tabela sem código', () => {
    assert.deepEqual(candidatasDaLinha(indexarTabelas([cadastrada('t-sem')]), tabela({ codigo_tabela_banco: '81034875' }), null), [])
  })
})

describe('candidatasDaLinha — linha SEM código: valida os demais campos', () => {
  test('acha a tabela quando todos os campos batem', () => {
    const t = cadastrada('t-1')
    assert.deepEqual(candidatasDaLinha(indexarTabelas([t, cadastrada('t-2', { nome: 'Novo 2 Oferta S/ Seguro' })]), tabela(), null), [t])
  })

  test('cenário do Bruno: vários prazos da mesma tabela — todas as linhas caem na MESMA tabela', () => {
    const t = cadastrada('t-1')
    const indice = indexarTabelas([t, cadastrada('t-2', { nome: 'Novo 2 Oferta S/ Seguro' })])
    // Cada linha da planilha repete a tabela; só o prazo (24-36, 37-48...) muda.
    const resolvidos: Record<string, string> = { 'financeira:Banco Um': 'inst-1', 'forma_contrato:Cartão': 'forma-1', 'convenio:Prefeitura A': 'conv-1', 'tipo_formalizacao:Digital': 'fmt-1' }
    const resolver = (campo: string, texto: string) => resolvidos[`${campo}:${texto}`] ?? null
    for (const [inicial, final] of [[24, 36], [37, 48], [49, 60], [61, 72]]) {
      const linha: Record<string, unknown> = {
        nome: 'Novo 1 Oferta S/ Seguro', financeira: 'Banco Um', forma_contrato: 'Cartão', convenio: 'Prefeitura A', tipo_formalizacao: 'Digital',
        seguro: 'sem', taxa_juros_tipo: 'fixa', taxa_juros: '2,38', prazo_inicial: inicial, prazo_final: final,
      }
      assert.deepEqual(candidatasDaLinha(indice, lerCamposTabela((nome) => linha[nome] ?? '', resolver), null), [t], `prazo ${inicial}-${final}`)
    }
  })

  test('se algum campo não bate, NÃO é a mesma tabela', () => {
    const indice = indexarTabelas([cadastrada('t-1')])
    const variacoes: Array<[string, Partial<CamposTabela>]> = [
      ['nome', { nome: 'Novo 1 Oferta C/ Seguro' }],
      ['financeira', { institution_id: 'inst-2' }],
      ['promotora', { promotora_id: 'prom-1' }],
      ['forma', { forma_contrato_id: 'forma-2' }],
      ['convênio', { convenio_id: 'conv-2' }],
      ['formalização', { tipo_formalizacao_id: null }],
      ['seguro', { com_seguro: true }],
      ['juros', { taxa_juros: 2.5 }],
    ]
    for (const [campo, mudanca] of variacoes) {
      assert.deepEqual(candidatasDaLinha(indice, tabela(mudanca), null), [], `${campo} diferente não pode casar`)
    }
  })

  test('mesmo nome em várias tabelas: fica a que bate em tudo', () => {
    const alvo = cadastrada('alvo')
    const indice = indexarTabelas([cadastrada('outra-financeira', { institution_id: 'inst-2' }), cadastrada('outro-juros', { taxa_juros: 2.5 }), alvo])
    assert.deepEqual(candidatasDaLinha(indice, tabela(), null), [alvo])
  })

  test('a observação não entra na comparação', () => {
    // CamposTabela não tem observação: a leitura da planilha a descarta.
    const linha = lerCamposTabela((nome) => ({ nome: 'Novo 1 Oferta S/ Seguro', observacao: 'texto qualquer' } as Record<string, unknown>)[nome] ?? '', () => null)
    assert.equal('observacao' in linha, false)
  })

  test('não casa com tabela que TEM código', () => {
    assert.deepEqual(candidatasDaLinha(indexarTabelas([cadastrada('t-cod', { codigo_tabela_banco: '123' })]), tabela(), null), [])
  })

  test('cópias idênticas no cadastro voltam todas, na ordem indexada', () => {
    const a = cadastrada('copia-a')
    const b = cadastrada('copia-b')
    assert.deepEqual(candidatasDaLinha(indexarTabelas([a, b]), tabela(), null), [a, b])
  })

  test('id_arw manda quando bate; se não existir, vale a regra dos campos', () => {
    const arw = cadastrada('t-arw', { nome: 'Nome antigo' }, 'ARW-99')
    const t = cadastrada('t-1')
    const indice = indexarTabelas([t, arw])
    assert.deepEqual(candidatasDaLinha(indice, tabela(), ' arw-99 '), [arw])
    assert.deepEqual(candidatasDaLinha(indice, tabela(), 'nao-existe'), [t])
  })
})

describe('explicarTabelaNaoEncontrada', () => {
  test('com código: mensagem de sempre', () => {
    const msg = explicarTabelaNaoEncontrada(indexarTabelas([]), tabela({ codigo_tabela_banco: '123' }), nomes)
    assert.match(msg, /financeira \+ promotora \+ forma \+ convênio \+ código no banco/)
  })

  test('sem código e sem nome', () => {
    assert.match(explicarTabelaNaoEncontrada(indexarTabelas([cadastrada('t-1')]), tabela({ nome: '' }), nomes), /sem código no banco e sem nome da tabela/)
  })

  test('nenhuma tabela com o nome', () => {
    const msg = explicarTabelaNaoEncontrada(indexarTabelas([cadastrada('t-1')]), tabela({ nome: 'Inexistente' }), nomes)
    assert.match(msg, /Não há Tabela de Comissão com o nome "Inexistente"/)
  })

  test('aponta só os campos que diferem na tabela de mesmo nome mais parecida', () => {
    const indice = indexarTabelas([cadastrada('longe', { institution_id: 'inst-2', convenio_id: 'conv-2' }), cadastrada('perto', { taxa_juros: 2.5 })])
    const msg = explicarTabelaNaoEncontrada(indice, tabela(), nomes)
    assert.match(msg, /Taxa de juros \(planilha: Fixa 2,38% × cadastro: Fixa 2,5%\)/)
    assert.doesNotMatch(msg, /Financeira|Convênio/)
  })

  test('mostra o código quando a única diferença é a tabela do cadastro ter código', () => {
    const msg = explicarTabelaNaoEncontrada(indexarTabelas([cadastrada('t-cod', { codigo_tabela_banco: '123' })]), tabela(), nomes)
    assert.match(msg, /Código no banco \(planilha: - × cadastro: 123\)/)
  })
})

describe('lerCamposTabela', () => {
  const resolvidos: Record<string, string> = { 'financeira:Banco Um': 'inst-1', 'forma_contrato:Cartão': 'forma-1', 'convenio:Prefeitura A': 'conv-1', 'tipo_formalizacao:Digital': 'fmt-1' }
  const resolver = (campo: string, texto: string) => resolvidos[`${campo}:${texto}`] ?? null
  const linhaPlanilha: Record<string, unknown> = {
    codigo_tabela_banco: '', nome: 'Novo 1 Oferta S/ Seguro', financeira: 'Banco Um', promotora: '', forma_contrato: 'Cartão',
    convenio: 'Prefeitura A', tipo_formalizacao: 'Digital', seguro: 'sem', taxa_juros_tipo: 'fixa', taxa_juros: '2,38',
  }
  const ler = (linha: Record<string, unknown>) => lerCamposTabela((nome) => linha[nome] ?? '', resolver)

  test('a planilha lida tem a mesma chave do cadastro equivalente', () => {
    assert.equal(chaveTabelaCompleta(ler(linhaPlanilha)), chaveTabelaCompleta(tabela()))
  })

  test('juros por faixa lê mínimo e máximo e ignora a taxa fixa', () => {
    const lido = ler({ ...linhaPlanilha, taxa_juros_tipo: 'faixa', taxa_juros: '9', taxa_juros_min: '1,5', taxa_juros_max: '2' })
    assert.equal(lido.taxa_juros, null)
    assert.equal(lido.taxa_juros_min, 1.5)
    assert.equal(lido.taxa_juros_max, 2)
  })

  test('referência não reconhecida fica null e guarda o texto original (para a pendência)', () => {
    const lido = ler({ ...linhaPlanilha, financeira: 'Banco Desconhecido' })
    assert.equal(lido.institution_id, null)
    assert.equal(lido.financeira_texto, 'Banco Desconhecido')
  })
})

describe('camposDiferentes', () => {
  test('mostra nomes legíveis das referências e "Direto" para promotora vazia', () => {
    assert.deepEqual(camposDiferentes(tabela({ promotora_id: 'prom-1' }), tabela({ promotora_id: null }), nomes), [{ label: 'Promotora', a: 'Promotora X', b: 'Direto' }])
  })
})
