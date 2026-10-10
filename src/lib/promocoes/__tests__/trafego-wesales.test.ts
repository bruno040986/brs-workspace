import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidirCampoTrafego, limparValorTrafego, camposTrafego, slugTag, sourceTrafego, tagsTrafego, CAMPOS_TRAFEGO } from '../trafego-wesales.ts'

const T = { utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'servidor_premiado', utm_content: 'margem_20', fbclid: 'AbC123', landing_url: 'https://nuazul.com.br/p?a=1' }

test('slugTag: acento, espaço, maiúscula, vazio, tamanho', () => {
  assert.equal(slugTag('Promoção Ótima Já'), 'promocao-otima-ja')
  assert.equal(slugTag('  A  B '), 'a-b')
  assert.equal(slugTag('a!b@c#'), 'abc')
  assert.equal(slugTag(''), '')
  assert.equal(slugTag(null), '')
  assert.equal(slugTag('x'.repeat(60)).length, 40)
})

test('tagsTrafego e sourceTrafego com UTM', () => {
  assert.deepEqual(tagsTrafego(T), ['utm-campanha-servidor_premiado', 'utm-conteudo-margem_20', 'utm-origem-meta'])
  assert.equal(sourceTrafego(T), 'Promoção NuAzul Servidor Premiado | meta/servidor_premiado/margem_20')
  assert.ok(sourceTrafego({ utm_source: 'a'.repeat(200) }).length <= 120)
})

test('sem tracking: tudo como antes', async () => {
  for (const t of [null, undefined, {}]) {
    assert.deepEqual(tagsTrafego(t), [])
    assert.equal(sourceTrafego(t), 'Promoção NuAzul Servidor Premiado')
    const r = await camposTrafego(t, async () => null, () => null)
    assert.deepEqual(r, { entradas: [], ausentes: [] })
  }
})

test('camposTrafego: existentes entram, ausentes são pulados e listados', async () => {
  const existem = new Set([CAMPOS_TRAFEGO.utm_source, CAMPOS_TRAFEGO.utm_campaign])
  const r = await camposTrafego(
    T,
    async (key) => (existem.has(key) ? { id: key } : null),
    (def, valor) => ({ id: def.id, fieldValue: valor }),
  )
  assert.deepEqual(r.entradas, [
    { id: 'trafego__utm_source', fieldValue: 'meta' },
    { id: 'trafego__utm_campaign', fieldValue: 'servidor_premiado' },
  ])
  assert.deepEqual(r.ausentes, ['trafego__utm_medium', 'trafego__utm_content', 'trafego__click_id_meta', 'trafego__pagina_de_entrada'])
})

test('camposTrafego: valor vazio não consulta nem grava; trunca em 120', async () => {
  const r = await camposTrafego({ utm_source: '', utm_medium: 'y'.repeat(400) }, async (k) => ({ id: k }), (d, v) => ({ id: d.id, fieldValue: v }))
  assert.equal(r.entradas.length, 1)
  assert.equal(String(r.entradas[0].fieldValue).length, 120)
})

test('decidirCampoTrafego: vazio grava, preenchido mantém', () => {
  assert.equal(decidirCampoTrafego('', 'x'), 'gravar')
  assert.equal(decidirCampoTrafego(null, 'x'), 'gravar')
  assert.equal(decidirCampoTrafego('meta', 'x'), 'manter')
})

test('camposTrafego com contato existente: só campos vazios', async () => {
  const r = await camposTrafego(
    T,
    async (k) => ({ id: k }),
    (d, v) => ({ id: d.id, fieldValue: v }),
    (d) => (d.id === 'trafego__utm_source' ? 'google' : ''),
  )
  assert.ok(!r.entradas.some((e) => e.id === 'trafego__utm_source'))
  assert.equal(r.entradas.length, 5)
})

test('limparValorTrafego: landing de host estranho descarta; quebra de linha limpa', () => {
  assert.equal(limparValorTrafego('landing_url', 'https://evil.com/https://nuazul.com.br/'), '')
  assert.equal(limparValorTrafego('landing_url', 'http://nuazul.com.br/x'), '')
  assert.equal(limparValorTrafego('landing_url', 'https://nuazul.com.br/p?a=1'), 'https://nuazul.com.br/p?a=1')
  assert.equal(limparValorTrafego('utm_campaign', 'meta\r\nX: y'), 'meta-x-y')
  assert.equal(limparValorTrafego('utm_source', 'https://a.com/x'), 'httpsacomx')
})

test('utm_term e gclid: limpeza, ausente pulado e set-if-empty', async () => {
  assert.equal(limparValorTrafego('utm_term', 'Margem 20\r\nX'), 'margem-20-x')
  assert.equal(limparValorTrafego('utm_term', 'a'.repeat(300)).length, 120)
  assert.equal(limparValorTrafego('gclid', 'Cj0K_AbC-1\n<x>'), 'Cj0K_AbC-1x')
  assert.equal(limparValorTrafego('gclid', 'A'.repeat(300)).length, 255)
  const t = { utm_term: 'Margem 20', gclid: 'AbC_1' }
  const ent = (d: { id: string }, v: string) => ({ id: d.id, fieldValue: v })
  const r = await camposTrafego(t, async (k) => ({ id: k }), ent)
  assert.deepEqual(r.entradas, [
    { id: 'trafego__utm_term', fieldValue: 'margem-20' },
    { id: 'trafego__click_id_google', fieldValue: 'AbC_1' },
  ])
  const aus = await camposTrafego(t, async () => null, ent)
  assert.deepEqual(aus.ausentes, ['trafego__utm_term', 'trafego__click_id_google'])
  const keep = await camposTrafego(t, async (k) => ({ id: k }), ent, (d) => (d.id === 'trafego__utm_term' ? 'x' : ''))
  assert.deepEqual(keep.entradas.map((e) => e.id), ['trafego__click_id_google'])
  assert.deepEqual(tagsTrafego(t), [])
})
