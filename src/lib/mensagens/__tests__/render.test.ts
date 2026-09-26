import { describe, it } from 'node:test'
import assert from 'node:assert'
import { limparWhatsApp, problemasHtmlTemplate, renderizarHtml, renderizarTexto, variaveisUsadas } from '../render.ts'

describe('render de templates (fatia 5)', () => {
  it('substitui variáveis; desconhecida vira vazio', () => {
    assert.strictEqual(renderizarTexto('Olá, {{nome}}! {{x}}.', { nome: 'Bruno' }), 'Olá, Bruno! .')
  })
  it('HTML escapa o valor (nome vindo do parceiro não vira tag)', () => {
    assert.strictEqual(renderizarHtml('<p>{{nome}}</p>', { nome: '<a href="x">oi</a>' }), '<p>&lt;a href=&quot;x&quot;&gt;oi&lt;/a&gt;</p>')
  })
  it('bloco condicional some sem valor e fica com valor', () => {
    const t = 'Parabéns!{{#codigo}} Seu código é {{codigo}}.{{/codigo}} Fim.'
    assert.strictEqual(renderizarTexto(t, { codigo: '' }), 'Parabéns! Fim.')
    assert.strictEqual(renderizarTexto(t, { codigo: 'DF3-4' }), 'Parabéns! Seu código é DF3-4. Fim.')
  })
  it('lista vira • por linha no texto e <ul> no HTML', () => {
    assert.strictEqual(renderizarTexto('Ajustes:\n{{itens}}', { itens: ['CNPJ: corrija', 'RG: reenvie'] }), 'Ajustes:\n• CNPJ: corrija\n• RG: reenvie')
    assert.strictEqual(renderizarHtml('{{itens}}', { itens: ['a<b'] }), '<ul><li>a&lt;b</li></ul>')
    assert.strictEqual(renderizarHtml('{{itens}}', { itens: [] }), '')
  })
  it('variaveisUsadas lista nomes (inclui as de bloco)', () => {
    assert.deepStrictEqual(variaveisUsadas('{{a}} {{#b}}{{c}}{{/b}}').sort(), ['a', 'b', 'c'])
  })
  it('limparWhatsApp tira HTML e mantém marcação do WhatsApp', () => {
    assert.strictEqual(limparWhatsApp('<p>*Oi*</p><p>_x_ <b>y</b></p>'), '*Oi*\n_x_ y')
  })
})

describe('problemasHtmlTemplate', () => {
  it('aceita HTML de e-mail comum', () => {
    assert.deepStrictEqual(problemasHtmlTemplate('<p>Olá <strong>{{nome}}</strong> <a href="{{link}}">x</a><img src="https://x/y.png"></p>'), [])
  })
  it('barra script, eventos, javascript:, data: e iframe', () => {
    assert.ok(problemasHtmlTemplate('<p>a</p><script>alert(1)</script>').length > 0)
    assert.ok(problemasHtmlTemplate('<img src=x onerror=alert(1)>').length > 0)
    assert.ok(problemasHtmlTemplate('<a href="javascript:alert(1)">x</a>').length > 0)
    assert.ok(problemasHtmlTemplate('<a href=" DATA:text/html,x">x</a>').length > 0)
    assert.ok(problemasHtmlTemplate('<iframe src="https://x"></iframe>').length > 0)
    assert.ok(problemasHtmlTemplate('<div style="width:expression(alert(1))">').length > 0)
  })
})
