import { test } from 'node:test'
import assert from 'node:assert/strict'
import { camposTrafego, slugTag, sourceTrafego, tagsTrafego, CAMPOS_TRAFEGO } from '../trafego-wesales.ts'

const T = { utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'valparaiso_promo', utm_content: 'margem_20', fbclid: 'AbC123', landing_url: 'https://x.com/p?a=1' }

test('slugTag: acento, espaço, maiúscula, vazio, tamanho', () => {
  assert.equal(slugTag('Promoção Ótima Já'), 'promocao-otima-ja')
  assert.equal(slugTag('  A  B '), 'a-b')
  assert.equal(slugTag('a!b@c#'), 'abc')
  assert.equal(slugTag(''), '')
  assert.equal(slugTag(null), '')
  assert.equal(slugTag('x'.repeat(60)).length, 40)
})

test('tagsTrafego e sourceTrafego com UTM', () => {
  assert.deepEqual(tagsTrafego(T), ['utm-campanha-valparaiso_promo', 'utm-conteudo-margem_20', 'utm-origem-meta'])
  assert.equal(sourceTrafego(T), 'Promoção NuAzul Valparaíso | meta/valparaiso_promo/margem_20')
  assert.ok(sourceTrafego({ utm_source: 'a'.repeat(200) }).length <= 120)
})

test('sem tracking: tudo como antes', async () => {
  for (const t of [null, undefined, {}]) {
    assert.deepEqual(tagsTrafego(t), [])
    assert.equal(sourceTrafego(t), 'Promoção NuAzul Valparaíso')
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
    { id: 'trafego__utm_campaign', fieldValue: 'valparaiso_promo' },
  ])
  assert.deepEqual(r.ausentes, ['trafego__utm_medium', 'trafego__utm_content', 'trafego__click_id_meta', 'trafego__pagina_de_entrada'])
})

test('camposTrafego: valor vazio não consulta nem grava; trunca em 255', async () => {
  const r = await camposTrafego({ utm_source: '', utm_medium: 'y'.repeat(400) }, async (k) => ({ id: k }), (d, v) => ({ id: d.id, fieldValue: v }))
  assert.equal(r.entradas.length, 1)
  assert.equal(String(r.entradas[0].fieldValue).length, 255)
})
