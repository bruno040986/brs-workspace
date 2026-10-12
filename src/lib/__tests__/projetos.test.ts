import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  MAX_CHAT,
  avisoEscritaAlterada,
  concluidaEmPara,
  contasDeAgentes,
  corCota,
  ehChat,
  erroTransicaoProjeto,
  extrairRefsCommit,
  normalizarPrazo,
  parseCodigoProjeto,
  patchEscritaTecnica,
  resolverContaCota,
  temEscritaTecnica,
  tempoDesde,
  textoChat,
  validarCotas,
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

describe('cotas das IAs', () => {
  it('normaliza nome, percentual, reinício e observação', () => {
    assert.deepEqual(validarCotas([{ nome: '  5 horas ', percentualUsado: 42.456 }]), [
      { nome: '5 horas', percentualUsado: 42.46, reiniciaEm: null, observacao: null },
    ])
    const [c] = validarCotas([{ nome: 'Semanal', percentualUsado: '37,5%', reiniciaEm: '2026-10-10T18:00:00-03:00', observacao: '  ok ' }])
    assert.equal(c.percentualUsado, 37.5)
    assert.equal(c.reiniciaEm, '2026-10-10T21:00:00.000Z')
    assert.equal(c.observacao, 'ok')
    assert.equal(validarCotas([{ nome: 'x', percentualUsado: 0 }])[0].percentualUsado, 0)
    assert.equal(validarCotas([{ nome: 'x', percentualUsado: 100 }])[0].percentualUsado, 100)
  })
  it('rejeita lista vazia, nome vazio/longo/repetido, percentual fora de 0–100 e data inválida', () => {
    assert.throws(() => validarCotas([]), /ao menos uma/)
    assert.throws(() => validarCotas('x'), /ao menos uma/)
    assert.throws(() => validarCotas(Array.from({ length: 21 }, (_, i) => ({ nome: `c${i}`, percentualUsado: 1 }))), /20/)
    assert.throws(() => validarCotas([{ nome: '   ', percentualUsado: 1 }]), /nome/)
    assert.throws(() => validarCotas([{ nome: 'a'.repeat(61), percentualUsado: 1 }]), /60/)
    assert.throws(() => validarCotas([{ nome: 'Semanal', percentualUsado: 1 }, { nome: 'SEMANAL ', percentualUsado: 2 }]), /repetida/)
    for (const p of [-1, 100.01, '', null, 'abc', undefined]) assert.throws(() => validarCotas([{ nome: 'x', percentualUsado: p }]), /0 a 100/)
    assert.throws(() => validarCotas([{ nome: 'x', percentualUsado: 1, reiniciaEm: 'amanhã' }]), /ISO/)
    assert.throws(() => validarCotas([{ nome: 'x', percentualUsado: 1, observacao: 'a'.repeat(201) }]), /200/)
  })
  const ags = [
    { id: '1', slug: 'claude-code', nome: 'Claude Code', ativo: true, cotaConta: 'claude', cotaContaRotulo: 'Claude.ai / Claude Code' },
    { id: '2', slug: 'claude', nome: 'Claude', ativo: true, cotaConta: 'claude', cotaContaRotulo: 'Claude.ai / Claude Code' },
    { id: '3', slug: 'jarvis', nome: 'Jarvis (ChatGPT)', ativo: true, cotaConta: null, cotaContaRotulo: null },
    { id: '4', slug: 'codex', nome: 'Codex', ativo: true, cotaConta: 'codex', cotaContaRotulo: 'Codex (OpenAI)' },
    { id: '5', slug: 'gemini-antigravity', nome: 'Gemini (Antigravity)', ativo: true, cotaConta: 'antigravity', cotaContaRotulo: 'Gemini (Antigravity)' },
    { id: '6', slug: 'gemini-notebooklm', nome: 'Gemini (NotebookLM)', ativo: true, cotaConta: null, cotaContaRotulo: null },
  ]
  it('agrupa IAs por conta: Claude e Claude Code numa linha, sem Jarvis/NotebookLM, ordem pelo rótulo', () => {
    assert.deepEqual(contasDeAgentes(ags), [
      { conta: 'claude', rotulo: 'Claude.ai / Claude Code', agentes: ['Claude', 'Claude Code'] },
      { conta: 'codex', rotulo: 'Codex (OpenAI)', agentes: ['Codex'] },
      { conta: 'antigravity', rotulo: 'Gemini (Antigravity)', agentes: ['Gemini (Antigravity)'] },
    ])
    assert.deepEqual(contasDeAgentes([{ ...ags[3], ativo: false, cotaContaRotulo: null }]), [{ conta: 'codex', rotulo: 'codex', agentes: [] }])
  })
  it('resolve a conta: conta > agenteSlug > IA chamadora; erro claro sem conta', () => {
    assert.equal(resolverContaCota(ags, { agenteId: '1' }), 'claude')
    assert.equal(resolverContaCota(ags, { agenteId: '2' }), 'claude')
    assert.equal(resolverContaCota(ags, { agenteId: '3', agenteSlug: 'codex' }), 'codex')
    assert.equal(resolverContaCota(ags, { agenteId: '3', conta: ' Antigravity ', agenteSlug: 'codex' }), 'antigravity')
    assert.throws(() => resolverContaCota(ags, { agenteId: '3' }), /Jarvis \(ChatGPT\) não tem conta.*antigravity, claude, codex/)
    assert.throws(() => resolverContaCota(ags, { agenteId: '1', agenteSlug: 'gemini-notebooklm' }), /NotebookLM\) não tem conta/)
    assert.throws(() => resolverContaCota(ags, { agenteId: '1', agenteSlug: 'xpto' }), /não encontrada/)
    assert.throws(() => resolverContaCota(ags, { conta: 'chatgpt' }), /não existe/)
  })
  it('cor: < 50 verde, 50–70 amarelo, > 70 vermelho', () => {
    assert.deepEqual([0, 49.99, 50, 70, 70.01, 100].map(corCota), ['success', 'success', 'warning', 'warning', 'danger', 'danger'])
  })
  it('tempoDesde', () => {
    const agora = Date.parse('2026-10-10T12:00:00Z')
    assert.equal(tempoDesde('2026-10-10T11:59:30Z', agora), 'agora')
    assert.equal(tempoDesde('2026-10-10T11:55:00Z', agora), 'há 5 min')
    assert.equal(tempoDesde('2026-10-10T09:00:00Z', agora), 'há 3 h')
    assert.equal(tempoDesde('2026-10-09T12:00:00Z', agora), 'há 1 dia')
    assert.equal(tempoDesde('2026-10-07T12:00:00Z', agora), 'há 3 dias')
    assert.equal(tempoDesde('lixo', agora), '—')
  })
})
