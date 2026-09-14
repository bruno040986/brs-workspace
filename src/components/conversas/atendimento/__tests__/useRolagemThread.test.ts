/**
 * Testa só a parte PURA de `useRolagemThread` (fotoDe/novosNoFim) — o hook
 * em si depende de `useLayoutEffect`/refs/DOM (React + jsdom) e não é
 * testável pelo runner deste projeto (`node --test --experimental-strip-types`,
 * sem `jsdom` nas dependências). O CRM AlvoConsig (`brs-alvoconsig`) tem o
 * teste completo do hook renderizado de verdade via `react-dom/client` +
 * `jsdom` — aqui cobrimos só a lógica que decide "quantas mensagens são
 * novas" e "qual é a foto atual do thread", que é puramente algorítmica e
 * onde mora o histórico de bugs revisado lá (Astra rodadas 2 e 3, 09-10/09).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fotoDe, novosNoFim } from '../useRolagemThread.ts'

type Item = { id: string }
const chave = (it: Item) => it.id

test('fotoDe: thread vazio', () => {
  const foto = fotoDe<Item>([], chave)
  assert.equal(foto.primeiro, undefined)
  assert.equal(foto.ultimo, undefined)
  assert.equal(foto.tamanho, 0)
  assert.equal(foto.chaves.size, 0)
})

test('fotoDe: primeiro/último/tamanho/chaves de um thread com itens', () => {
  const thread: Item[] = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }]
  const foto = fotoDe(thread, chave)
  assert.equal(foto.primeiro, 'm1')
  assert.equal(foto.ultimo, 'm3')
  assert.equal(foto.tamanho, 3)
  assert.deepEqual([...foto.chaves], ['m1', 'm2', 'm3'])
})

test('novosNoFim: nenhuma mensagem nova (mesmo conjunto)', () => {
  const thread: Item[] = [{ id: 'm1' }, { id: 'm2' }]
  const anteriores = new Set(['m1', 'm2'])
  assert.equal(novosNoFim(thread, chave, anteriores), 0)
})

test('novosNoFim: 1 mensagem nova no fim', () => {
  const thread: Item[] = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }]
  const anteriores = new Set(['m1', 'm2'])
  assert.equal(novosNoFim(thread, chave, anteriores), 1)
})

test('novosNoFim: várias mensagens novas no fim, todas contadas', () => {
  const thread: Item[] = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }, { id: 'm4' }]
  const anteriores = new Set(['m1', 'm2'])
  assert.equal(novosNoFim(thread, chave, anteriores), 2)
})

test('novosNoFim: imune a PREPEND — item novo só no início não conta nada (pára no 1º item já conhecido)', () => {
  const thread: Item[] = [{ id: 'h1' }, { id: 'm1' }, { id: 'm2' }]
  const anteriores = new Set(['m1', 'm2'])
  assert.equal(novosNoFim(thread, chave, anteriores), 0)
})

test('novosNoFim: último item anterior REMOVIDO e substituído (aviso otimista → mensagem real) conta só o novo, não o thread inteiro', () => {
  // Mesmo cenário do achado registrado no hook (Fable 10/09/2026 no CRM):
  // contar por findIndex do último item anterior explode quando ele some.
  const thread: Item[] = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] // m3 substitui o otimista que não existe mais
  const anteriores = new Set(['m1', 'm2', 'otimista-1'])
  assert.equal(novosNoFim(thread, chave, anteriores), 1)
})

test('novosNoFim: ack em mensagem existente (chave do último item não muda) não conta como nova', () => {
  const thread: Item[] = [{ id: 'm1' }, { id: 'm2' }]
  const anteriores = new Set(['m1', 'm2'])
  assert.equal(novosNoFim(thread, chave, anteriores), 0)
})

test('novosNoFim: prepend E mensagem nova no MESMO commit — conta só o item novo no fim, ignora o inserido no início', () => {
  const thread: Item[] = [{ id: 'h1' }, { id: 'm1' }, { id: 'm2' }, { id: 'm3' }]
  const anteriores = new Set(['m1', 'm2'])
  assert.equal(novosNoFim(thread, chave, anteriores), 1)
})
