import { test } from 'node:test'
import assert from 'node:assert/strict'
import { campanhaAceitaCadastro, escolherIp, estadoCadastro, fimDoMinuto, mascararTextoEnvio, pixDoIndicado } from '../seguranca.ts'

test('máscara de envio: otp, link de números, aviso de pagamento, demais intactos', () => {
  assert.equal(mascararTextoEnvio('otp', 'Código 123456'), '[otp]')
  assert.equal(mascararTextoEnvio('link_numeros_servidor', 'Acesse https://x.com/n?a=1&t=abc123_-Z&b=2 ok'), 'Acesse https://x.com/n?a=1&t=[token]&b=2 ok')
  assert.equal(mascararTextoEnvio('link_numeros_indicador', 'https://x.com/n?t=abc'), 'https://x.com/n?t=[token]')
  assert.equal(mascararTextoEnvio('aviso_pagamento', 'Pago!\nChave Pix: 123.456.789-09\nObrigado'), 'Pago!\nChave Pix: [pix]\nObrigado')
  assert.equal(mascararTextoEnvio('comprovante_indicacao', 'Chave Pix: x t=1'), 'Chave Pix: x t=1')
})

const camp = { inicio_em: '2026-10-01T03:00:00.000Z', fim_em: '2026-11-01T02:59:00.000Z' }
test('campanhaAceitaCadastro: antes, dentro, fim_em + 59,999 s e depois', () => {
  assert.equal(estadoCadastro(camp, new Date('2026-10-01T02:59:59.999Z')), 'nao_iniciada')
  assert.equal(campanhaAceitaCadastro(camp, new Date('2026-10-01T03:00:00.000Z')), true)
  assert.equal(campanhaAceitaCadastro(camp, new Date('2026-11-01T02:59:59.999Z')), true)
  assert.equal(estadoCadastro(camp, new Date('2026-11-01T02:59:59.999Z')), 'aberta')
  assert.equal(estadoCadastro(camp, new Date('2026-11-01T03:00:00.000Z')), 'encerrada')
})

test('pixDoIndicado: cpf e telefone do indicado; outros tipos não', () => {
  const ind = { cpf: '52998224725', telefone: '61999990000' }
  assert.equal(pixDoIndicado({ tipo: 'cpf', chave: '52998224725' }, ind), true)
  assert.equal(pixDoIndicado({ tipo: 'cpf', chave: '11144477735' }, ind), false)
  assert.equal(pixDoIndicado({ tipo: 'telefone', chave: '61999990000' }, ind), true)
  assert.equal(pixDoIndicado({ tipo: 'telefone', chave: '5561999990000' }, ind), true)
  assert.equal(pixDoIndicado({ tipo: 'telefone', chave: '61988887777' }, ind), false)
  assert.equal(pixDoIndicado({ tipo: 'email', chave: 'a@b.com' }, ind), false)
  assert.equal(pixDoIndicado({ tipo: 'dados_bancarios', chave: null }, ind), false)
})

test('escolherIp: precedência, validação e truncamento', () => {
  const h = (o: Record<string, string>) => new Headers(o)
  assert.equal(escolherIp(h({ 'x-vercel-forwarded-for': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' })), '1.2.3.4')
  assert.equal(escolherIp(h({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8', 'x-real-ip': '7.7.7.7' })), '9.9.9.9')
  assert.equal(escolherIp(h({ 'x-real-ip': '2001:db8::1' })), '2001:db8::1')
  assert.equal(escolherIp(h({ 'x-forwarded-for': 'lixo<script>', 'x-real-ip': '7.7.7.7' })), '7.7.7.7')
  assert.equal(escolherIp(h({ 'x-forwarded-for': 'a'.repeat(60) })), 'desconhecido')
  assert.equal(escolherIp(h({})), 'desconhecido')
})

test('fimDoMinuto: 23:59 vira 23:59:59.999 e é idempotente', () => {
  const a = fimDoMinuto('2026-10-31T23:59:00.000Z')
  assert.equal(a, '2026-10-31T23:59:59.999Z')
  assert.equal(fimDoMinuto(a), a)
  assert.equal(fimDoMinuto('2026-10-31T23:59:30.500Z'), a)
  assert.equal(fimDoMinuto('lixo'), 'lixo')
})
