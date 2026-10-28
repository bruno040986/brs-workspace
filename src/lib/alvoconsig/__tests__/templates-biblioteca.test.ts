import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  analisarVariaveis, chaveNovaVersao, gerarChave, previaCorpo, proximaChave, validarMidia, validarTemplate,
} from '../templates-biblioteca.ts'

test('gerarChave: kebab sem acento, vazio vira template', () => {
  assert.equal(gerarChave('  Olá, Maria! Boas-vindas  '), 'ola-maria-boas-vindas')
  assert.equal(gerarChave('!!!'), 'template')
})
test('proximaChave: livre usa a base, ocupada sobe o -vN', () => {
  assert.equal(proximaChave('x', []), 'x')
  assert.equal(proximaChave('x', ['x', 'x-v2']), 'x-v3')
})
test('chaveNovaVersao: tira o sufixo e acha o próximo livre (arquivadas contam)', () => {
  assert.equal(chaveNovaVersao('x', ['x']), 'x-v2')
  assert.equal(chaveNovaVersao('x-v2', ['x', 'x-v2']), 'x-v3')
  assert.equal(chaveNovaVersao('x-v2', ['x', 'x-v2', 'x-v3']), 'x-v4')
})
test('variáveis: conhecidas e desconhecidas, prévia troca só as conhecidas', () => {
  const r = analisarVariaveis('Oi {{primeiro_nome}} {{ cidade }} {{foo}}')
  assert.deepEqual(r.usadas, ['primeiro_nome', 'cidade'])
  assert.deepEqual(r.desconhecidas, ['foo'])
  assert.equal(previaCorpo('Oi {{primeiro_nome}} {{foo}}'), 'Oi Maria {{foo}}')
})
test('validarTemplate: limites e variável desconhecida bloqueia', () => {
  assert.equal(validarTemplate({ nome: '', corpo: 'a' }).ok, false)
  assert.equal(validarTemplate({ nome: 'a'.repeat(81), corpo: 'a' }).ok, false)
  assert.equal(validarTemplate({ nome: 'a', categoria: 'c'.repeat(61), corpo: 'a' }).ok, false)
  assert.equal(validarTemplate({ nome: 'a', corpo: 'a'.repeat(4001) }).ok, false)
  assert.equal(validarTemplate({ nome: 'a', corpo: 'oi {{x}}' }).ok, false)
  const ok = validarTemplate({ nome: ' a ', categoria: ' ', corpo: 'oi {{nome}}' })
  assert.ok(ok.ok && ok.dados.categoria === null && ok.variaveis[0] === 'nome')
})
test('validarMidia: png ok, texto recusado, imagem grande recusada', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])
  assert.equal(validarMidia(png, 100).ok, true)
  assert.equal(validarMidia(png, 6 * 1024 * 1024).ok, false)
  assert.equal(validarMidia(new Uint8Array(12), 100).ok, false)
})
