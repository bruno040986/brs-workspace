/** D5 (lote 2): helpers da central de ajuda. Roda com: npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { corpoArtigo, corpoCategoria, corpoPortal, linkArtigo, slugify } from '../ajuda.ts'

test('slugify: sem acento, minúsculo, hifens; nunca vazio', () => {
  assert.equal(slugify('  Como Emitir a 2ª Via? '), 'como-emitir-a-2a-via')
  assert.equal(slugify('!!!'), 'item')
})

test('portal e categoria: nomes obrigatórios, pt_BR por padrão', () => {
  const p = corpoPortal({ nome: 'Ajuda BRS' })
  assert.ok(p.ok)
  if (p.ok) assert.deepEqual(p.corpo, { name: 'Ajuda BRS', slug: 'ajuda-brs', page_title: 'Ajuda BRS', header_text: 'Ajuda BRS', config: { allowed_locales: ['pt_BR'], default_locale: 'pt_BR' } })
  assert.equal(corpoPortal({ nome: ' ' }).ok, false)
  const c = corpoCategoria({ nome: 'Convênios', descricao: ' regras ' })
  assert.ok(c.ok)
  if (c.ok) assert.deepEqual(c.corpo, { name: 'Convênios', slug: 'convenios', description: 'regras', locale: 'pt_BR' })
  assert.equal(corpoCategoria({ nome: '' }).ok, false)
})

test('artigo: autor obrigatório no corpo, status, slug só na criação, validações', () => {
  const a = corpoArtigo({ titulo: 'Como funciona', conteudo: 'texto', categoriaId: 3, publicado: true }, 7, true)
  assert.ok(a.ok)
  if (a.ok) {
    assert.equal(a.corpo.author_id, 7)
    assert.equal(a.corpo.status, 1)
    assert.equal(a.corpo.category_id, 3)
    assert.match(String(a.corpo.slug), /^como-funciona-[a-z0-9]+$/)
  }
  const e = corpoArtigo({ titulo: 'x', conteudo: 'y', categoriaId: null, publicado: false }, 7, false)
  assert.ok(e.ok)
  if (e.ok) assert.deepEqual([e.corpo.status, 'slug' in e.corpo, 'category_id' in e.corpo], [0, false, false])
  assert.equal(corpoArtigo({ titulo: '', conteudo: 'y', categoriaId: null, publicado: false }, 1, true).ok, false)
  assert.equal(corpoArtigo({ titulo: 'x', conteudo: ' ', categoriaId: null, publicado: false }, 1, true).ok, false)
})

test('link público: domínio do Chatwoot ou do portal', () => {
  assert.equal(linkArtigo({ base: 'https://chat.brspromotora.com.br/', portalSlug: 'ajuda', slugArtigo: 'como-funciona' }), 'https://chat.brspromotora.com.br/hc/ajuda/pt_BR/articles/como-funciona')
  assert.equal(linkArtigo({ base: 'https://x', customDomain: 'ajuda.brspromotora.com.br', portalSlug: 'ajuda', slugArtigo: 'a' }), 'https://ajuda.brspromotora.com.br/hc/ajuda/pt_BR/articles/a')
})
