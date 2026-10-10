import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  MAX_CHAT,
  avisoEscritaAlterada,
  concluidaEmPara,
  ehChat,
  erroTransicaoProjeto,
  extrairRefsCommit,
  normalizarPrazo,
  parseCodigoProjeto,
  patchEscritaTecnica,
  temEscritaTecnica,
  textoChat,
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
    assert.match(erroTransicaoProjeto('brainstorm', 'brainstorm', { temRedator: true, temEscrita: true }) || '', /já está/)
    assert.match(erroTransicaoProjeto('rascunho', 'escrita_tecnica', { temRedator: false, temEscrita: true }) || '', /redatora/)
    assert.equal(erroTransicaoProjeto('rascunho', 'escrita_tecnica', { temRedator: true, temEscrita: true }), null)
    assert.equal(erroTransicaoProjeto('execucao', 'planejamento', { temRedator: false, temEscrita: true }), null)
    assert.equal(erroTransicaoProjeto('rascunho', 'toString' as never, { temRedator: true, temEscrita: true }), 'Status inválido.')
  })
  it('projeto: planejamento exige escrita técnica (vindo de qualquer status)', () => {
    for (const de of ['rascunho', 'escrita_tecnica', 'brainstorm', 'execucao', 'arquivado'] as const) {
      assert.match(erroTransicaoProjeto(de, 'planejamento', { temRedator: true, temEscrita: false }) || '', /escrita técnica/)
      assert.equal(erroTransicaoProjeto(de, 'planejamento', { temRedator: true, temEscrita: true }), null)
    }
    assert.equal(temEscritaTecnica('  \n '), false)
    assert.equal(temEscritaTecnica(null), false)
    assert.equal(temEscritaTecnica('# Doc'), true)
  })
  it('escrita técnica: cada registro sobe a versão', () => {
    assert.deepEqual(patchEscritaTecnica('v1', 0), { escrita_tecnica: 'v1', escrita_versao: 1 })
    assert.equal(patchEscritaTecnica('v4', 3).escrita_versao, 4)
  })
  it('aviso de escrita alterada só quando a versão atual passa da aprovada', () => {
    assert.equal(avisoEscritaAlterada({ escritaVersao: 2, versaoEscritaAprovada: null }), null)
    assert.equal(avisoEscritaAlterada({ escritaVersao: 2, versaoEscritaAprovada: 2 }), null)
    assert.match(avisoEscritaAlterada({ escritaVersao: 3, versaoEscritaAprovada: 2 }) || '', /v2 → v3/)
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

describe('chat do projeto', () => {
  it('separa chat (meta.chat === true) do fórum', () => {
    const msgs = [{ meta: { chat: true } }, { meta: null }, { meta: { entidade: 'projeto' } }, { meta: { chat: 'true' } }]
    assert.deepEqual(msgs.map(ehChat), [true, false, false, false])
  })
  it('texto: obrigatório, apara e respeita 4.000 caracteres', () => {
    assert.equal(MAX_CHAT, 4000)
    assert.equal(textoChat('  oi  '), 'oi')
    assert.equal(textoChat('a'.repeat(4000)).length, 4000)
    assert.throws(() => textoChat('a'.repeat(4001)), /4000/)
    assert.throws(() => textoChat('   '))
    assert.throws(() => textoChat(null))
  })
})
