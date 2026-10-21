/** Contorno do host de anexos do Chatwoot. Roda com: npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChatwootConta, normalizarAnexosDaMensagem, normalizarUrlAnexoChatwoot } from '../chatwoot.ts'

const BASE = 'https://chatwoot-production-1b6d.up.railway.app'
const PATH = '/rails/active_storage/blobs/redirect/abc/foto.jpg?x=1'

test('host de marca vira a base', () => {
  assert.equal(normalizarUrlAnexoChatwoot(`https://chat.brspromotora.com.br${PATH}`, BASE), `${BASE}${PATH}`)
  assert.equal(normalizarUrlAnexoChatwoot(`http://chat.brspromotora.com.br:8080${PATH}`, `${BASE}/`), `${BASE}${PATH}`)
})
test('host correto, outro caminho, relativa e invalida ficam intactos', () => {
  assert.equal(normalizarUrlAnexoChatwoot(`${BASE}${PATH}`, BASE), `${BASE}${PATH}`)
  assert.equal(normalizarUrlAnexoChatwoot('https://outro.com/arquivo.jpg', BASE), 'https://outro.com/arquivo.jpg')
  assert.equal(normalizarUrlAnexoChatwoot(PATH, BASE), PATH)
  assert.equal(normalizarUrlAnexoChatwoot('lixo://', BASE), 'lixo://')
  assert.equal(normalizarUrlAnexoChatwoot(undefined, BASE), undefined)
})
test('base ausente, invalida ou interna nao reescreve', () => {
  const u = `https://chat.brspromotora.com.br${PATH}`
  for (const b of [undefined, null, '', 'nao-url', 'http://chatwoot.railway.internal:3000', 'ftp://x.com']) assert.equal(normalizarUrlAnexoChatwoot(u, b), u)
})
test('normalizarAnexosDaMensagem trata data_url e thumb_url', () => {
  const m = { id: 1, attachments: [{ id: 2, data_url: `https://chat.brspromotora.com.br${PATH}`, thumb_url: `https://chat.brspromotora.com.br${PATH}` }] }
  const r = normalizarAnexosDaMensagem(m, BASE)
  assert.equal(r.attachments[0].data_url, `${BASE}${PATH}`)
  assert.equal(r.attachments[0].thumb_url, `${BASE}${PATH}`)
})
test('ChatwootConta.mensagens normaliza anexos (env CHATWOOT_URL)', async () => {
  const antes = { url: process.env.CHATWOOT_URL, asset: process.env.CHATWOOT_ASSET_BASE_URL, fetch: globalThis.fetch }
  process.env.CHATWOOT_URL = BASE
  delete process.env.CHATWOOT_ASSET_BASE_URL
  const msg = { id: 1, attachments: [{ id: 2, file_type: 'image', data_url: `https://chat.brspromotora.com.br${PATH}` }] }
  globalThis.fetch = (async () => new Response(JSON.stringify({ payload: [msg], meta: {} }))) as typeof fetch
  try {
    const r = await new ChatwootConta(1, 't').mensagens(9)
    assert.equal(r.payload[0].attachments![0].data_url, `${BASE}${PATH}`)
  } finally {
    globalThis.fetch = antes.fetch
    if (antes.url === undefined) delete process.env.CHATWOOT_URL; else process.env.CHATWOOT_URL = antes.url
    if (antes.asset !== undefined) process.env.CHATWOOT_ASSET_BASE_URL = antes.asset
  }
})
