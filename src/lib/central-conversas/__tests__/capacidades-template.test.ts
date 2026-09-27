import test from 'node:test'
import assert from 'node:assert/strict'
import { CAPACIDADES, capacidadesDe } from '../capacidades.ts'
import { renderizarPrevia, variaveisFaltando, variaveisParaEnvio, posicoesVariaveis } from '../template-ycloud.ts'

test('baileys/zapi: comportamento anterior (só grupos separa; sem templates/janela/custo)', () => {
  assert.equal(CAPACIDADES.baileys.grupos, true)
  assert.equal(CAPACIDADES.zapi.grupos, false)
  for (const p of ['baileys', 'zapi'] as const) {
    const c = CAPACIDADES[p]
    assert.ok(c.novaConversa && c.reacoes && c.respostaCitada && c.mencoes)
    assert.ok(!c.templates && !c.janela24h && !c.custoPorMensagem)
  }
})

test('ycloud conforme ADR-7', () => {
  const c = CAPACIDADES.ycloud
  assert.deepEqual(
    { r: c.reacoes, m: c.mencoes, g: c.grupos, n: c.novaConversa, t: c.templates, j: c.janela24h, $: c.custoPorMensagem, q: c.respostaCitada, l: c.marcaLido, d: c.digitando },
    { r: false, m: false, g: false, n: true, t: true, j: true, $: true, q: true, l: true, d: true },
  )
  assert.equal(capacidadesDe('ycloud'), c)
  assert.equal(capacidadesDe(undefined), CAPACIDADES.baileys)
})

const comps = [
  { type: 'HEADER', format: 'TEXT', text: 'Oi {{1}}' },
  { type: 'BODY', text: 'Olá {{1}}, seu código é {{2}}.' },
  { type: 'FOOTER', text: 'BRS' },
  { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Ok' }] },
]

test('prévia: preenche o que existe e mantém {{n}} do que falta', () => {
  const p = renderizarPrevia(comps, { '1': 'Ana' })
  assert.equal(p.corpo, 'Olá Ana, seu código é {{2}}.')
  assert.equal(p.header, 'Oi Ana')
  assert.equal(p.rodape, 'BRS')
  assert.deepEqual(p.botoes, ['Ok'])
})

test('variáveis faltando/envio', () => {
  assert.deepEqual(posicoesVariaveis(2), ['1', '2'])
  assert.deepEqual(variaveisFaltando(2, { '1': 'a', '2': '  ' }), ['2'])
  assert.deepEqual(variaveisFaltando(0, {}), [])
  assert.deepEqual(variaveisParaEnvio(2, { '1': ' a ', '2': 'b', '3': 'x' }), { '1': 'a', '2': 'b' })
  assert.equal(renderizarPrevia([], {}).corpo, '')
})

test('motivoNaoSuportado: só BODY passa; header var, URL dinâmica e mídia bloqueiam', async () => {
  const { motivoNaoSuportado } = await import('../template-ycloud.ts')
  const body = { type: 'BODY', text: 'Oi {{1}}' }
  assert.equal(motivoNaoSuportado([body, { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'x', url: 'https://a.com' }] }]), null)
  assert.match(motivoNaoSuportado([{ type: 'HEADER', format: 'TEXT', text: 'Olá {{1}}' }, body]) || '', /cabeçalho/)
  assert.match(motivoNaoSuportado([body, { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'x', url: 'https://a.com/{{1}}' }] }]) || '', /botão/)
  assert.match(motivoNaoSuportado([{ type: 'HEADER', format: 'IMAGE' }, body]) || '', /IMAGE/)
})
