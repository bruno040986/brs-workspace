import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  concluidaEmPara,
  erroTransicaoProjeto,
  extrairRefsCommit,
  normalizarPrazo,
  parseCodigoProjeto,
} from '../projetos/puro.ts'

describe('parseCodigoProjeto', () => {
  it('aceita PRJ-n, minúsculas, sem hífen e só o número', () => {
    assert.equal(parseCodigoProjeto('PRJ-3'), 3)
    assert.equal(parseCodigoProjeto(' prj-12 '), 12)
    assert.equal(parseCodigoProjeto('PRJ3'), 3)
    assert.equal(parseCodigoProjeto('3'), 3)
  })
  it('rejeita lixo e zero', () => {
    for (const v of ['', 'PRJ-', 'PRJ-0', 'T-3', 'PRJ-3/T-1', 'abc', null, undefined]) assert.equal(parseCodigoProjeto(v), null)
  })
})

describe('extrairRefsCommit', () => {
  it('projeto só', () => {
    assert.deepEqual(extrairRefsCommit('feat: tela nova (PRJ-3)'), { projetoNumero: 3, tarefaNumero: null })
  })
  it('projeto/tarefa', () => {
    assert.deepEqual(extrairRefsCommit('fix PRJ-3/T-2: ajuste'), { projetoNumero: 3, tarefaNumero: 2 })
  })
  it('T-n solto vale com um projeto citado', () => {
    assert.deepEqual(extrairRefsCommit('PRJ-4 T-7 conclui busca'), { projetoNumero: 4, tarefaNumero: 7 })
  })
  it('T-n solto não vale com vários projetos; fica o primeiro projeto', () => {
    assert.deepEqual(extrairRefsCommit('PRJ-4 e PRJ-5, T-7'), { projetoNumero: 4, tarefaNumero: null })
  })
  it('sem referência', () => {
    assert.deepEqual(extrairRefsCommit('chore: deps'), { projetoNumero: null, tarefaNumero: null })
    assert.deepEqual(extrairRefsCommit('T-2 sem projeto'), { projetoNumero: null, tarefaNumero: null })
  })
  it('não confunde palavras que contêm PRJ/T-', () => {
    assert.deepEqual(extrairRefsCommit('XPRJ-3 HOT-2'), { projetoNumero: null, tarefaNumero: null })
    assert.deepEqual(extrairRefsCommit('PRJ-3 SHORT-9'), { projetoNumero: 3, tarefaNumero: null })
  })
})

describe('transição de status', () => {
  it('projeto: bloqueia repetir status e escrita técnica sem redator', () => {
    assert.match(erroTransicaoProjeto('brainstorm', 'brainstorm', { temRedator: true }) || '', /já está/)
    assert.match(erroTransicaoProjeto('rascunho', 'escrita_tecnica', { temRedator: false }) || '', /redatora/)
    assert.equal(erroTransicaoProjeto('rascunho', 'escrita_tecnica', { temRedator: true }), null)
    assert.equal(erroTransicaoProjeto('execucao', 'planejamento', { temRedator: false }), null)
    assert.equal(erroTransicaoProjeto('rascunho', 'toString' as never, { temRedator: true }), 'Status inválido.')
  })
  it('tarefa: concluida_em entra ao concluir e sai ao reabrir', () => {
    const agora = '2026-10-09T12:00:00.000Z'
    assert.equal(concluidaEmPara('concluido', null, agora), agora)
    assert.equal(concluidaEmPara('concluido', '2026-01-01T00:00:00Z', agora), '2026-01-01T00:00:00Z')
    assert.equal(concluidaEmPara('em_andamento', '2026-01-01T00:00:00Z', agora), null)
  })
})

describe('normalizarPrazo', () => {
  it('aceita vazio e datas reais, rejeita o resto', () => {
    assert.equal(normalizarPrazo(''), null)
    assert.equal(normalizarPrazo(null), null)
    assert.equal(normalizarPrazo('2026-02-28'), '2026-02-28')
    assert.throws(() => normalizarPrazo('2026-02-30'))
    assert.throws(() => normalizarPrazo('28/02/2026'))
  })
})
