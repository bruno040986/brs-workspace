/** Fixture ANONIMIZADA (CPF de teste válido, nome fictício) — nunca colar linha real aqui (handoff §6). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarConsulta, normalizarChave, consultadoEmParaIso } from '../parser.ts'

const linha = {
  id: '1486999',
  tarefa_id: 2158,
  convenio: 'Governo SP ',
  cpf_consultado: '52998224725',
  matricula: '12300001',
  nome: null,
  valor_margem: '8157.88',
  valor_disponivel: '7862.71',
  observacao: 'Consulta realizada com sucesso.',
  consultado_em: '2026-09-10 17:26:53',
  dados_extras: {
    cpf: '529.982.247-25',
    nome: 'FULANO DE TAL',
    cargo: '05770',
    orgao: 'SEFAZ',
    lotacao: '20 - SECRETARIA DA FAZENDA E PLANEJAMENTO',
    vinculo: '7 - Efetivo',
    admissao: '18/07/2002',
    prox_folha: '13/01/2026',
    mes_referencia: '12/2025',
    exportador: { margem_bruta_cartao_de_credito: 999 },
    margem_bruta: {
      'CARTAO DE CREDITO': { valor_str: '1165,41', valor_float: 1165.41 },
      'CARTÃO DE BENEFÍCIO': { valor_str: '3496,20', valor_float: 3496.2 },
      'CONSIGNACOES FACULTATIVAS': { valor_str: '8157,88', valor_float: 8157.88 },
    },
    margem_disponivel: {
      'CARTAO DE CREDITO': { valor_str: '1165,41', valor_float: 1165.41 },
      'CARTÃO DE BENEFÍCIO': { valor_str: '3496,20', valor_float: 3496.2 },
      'CONSIGNACOES FACULTATIVAS': { valor_str: '7862,71', valor_float: 7862.71 },
    },
  },
  sucesso: 1,
  created_at: null,
  updated_at: null,
}

test('normaliza a linha real da Kaizom (3 produtos, nome do dados_extras, datas BR)', () => {
  const n = normalizarConsulta(linha as unknown as Record<string, unknown>)
  assert.equal(n.mysqlId, 1486999)
  assert.equal(n.tarefaId, 2158)
  assert.equal(n.convenioExterno, 'Governo SP')
  assert.equal(n.cpf, '52998224725')
  assert.equal(n.nome, 'FULANO DE TAL')
  assert.equal(n.matricula, '12300001')
  assert.deepEqual(n.margens, {
    novo: { bruta: 8157.88, disp: 7862.71 },
    rmc: { bruta: 1165.41, disp: 1165.41 },
    rcc: { bruta: 3496.2, disp: 3496.2 },
  })
  assert.equal(n.admissao, '2002-07-18')
  assert.equal(n.proxFolha, '2026-01-13')
  assert.equal(n.mesReferencia, '12/2025')
  assert.equal(n.sucesso, true)
  assert.equal(n.consultadoEm, '2026-09-10T20:26:53.000Z')
})

test('falha (sucesso=0), dados_extras em string e CPF inválido', () => {
  const n = normalizarConsulta({ id: 5, tarefa_id: null, cpf_consultado: '11111111111', sucesso: 0, observacao: 'Matrícula não encontrada', dados_extras: '{"nome":"X"}' })
  assert.equal(n.sucesso, false)
  assert.equal(n.cpf, null)
  assert.equal(n.nome, 'X')
  assert.equal(n.tarefaId, null)
  assert.deepEqual(n.margens.novo, { bruta: null, disp: null })
})

test('chave normalizada casa grafias diferentes do convênio', () => {
  assert.equal(normalizarChave(' governo  sp'), 'GOVERNO SP')
  assert.equal(normalizarChave('Prefeitura de São Paulo'), 'PREFEITURA DE SAO PAULO')
  assert.equal(consultadoEmParaIso('lixo'), null)
})
