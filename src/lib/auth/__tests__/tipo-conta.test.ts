import test from 'node:test'
import assert from 'node:assert/strict'
import { mesclarAppMetadata, lerContaAuth } from '../tipo-conta.ts'

test('mesclarAppMetadata mantém as outras chaves e grava o tipo', () => {
  assert.deepEqual(mesclarAppMetadata(null, { temp_password_reset_required: true }, 'interno', 'a@brspromotora.com.br'),
    { temp_password_reset_required: true, tipo: 'interno' })
  assert.deepEqual(mesclarAppMetadata({ provider: 'email', providers: ['email'] }, {}, 'parceiro'),
    { provider: 'email', providers: ['email'], tipo: 'parceiro' })
  assert.deepEqual(mesclarAppMetadata({ tipo: 'interno', temp_password_reset_required: true }, { temp_password_reset_required: false }),
    { tipo: 'interno', temp_password_reset_required: false })
  assert.deepEqual(mesclarAppMetadata('lixo', {}, 'parceiro'), { tipo: 'parceiro' })
})

test('mesclarAppMetadata nunca troca tipo válido existente', () => {
  assert.equal(mesclarAppMetadata({ tipo: 'atendente', external: 'alvoconsig' }, {}, 'parceiro').tipo, 'atendente')
  assert.equal(mesclarAppMetadata({ tipo: 'parceiro' }, { tipo: 'interno' }, 'interno').tipo, 'parceiro')
  assert.equal(mesclarAppMetadata({ tipo: '' }, {}, 'interno', 'a@brspromotora.com.br').tipo, 'interno') // marca inválida é corrigida
})

test('mesclarAppMetadata não dá interno para external ou e-mail de parceiro', () => {
  const ext = mesclarAppMetadata({ external: 'alvoconsig' }, { temp_password_reset_required: true }, 'interno', 'x@exemplo.com')
  assert.deepEqual(ext, { external: 'alvoconsig', temp_password_reset_required: true })
  assert.equal('tipo' in mesclarAppMetadata({}, {}, 'interno', ' ARW1@Parceiro.BrsPromotora.com.br '), false)
  assert.equal(mesclarAppMetadata({}, {}, 'parceiro', 'arw1@parceiro.brspromotora.com.br').tipo, 'parceiro')
})

test('lerContaAuth devolve app_metadata/e-mail e falha fechado', async () => {
  const fake = (r: unknown) => ({ auth: { admin: { getUserById: async () => r } } }) as never
  assert.deepEqual(await lerContaAuth(fake({ data: { user: { app_metadata: { external: 'x' }, email: 'e@x' } }, error: null }), 'u'),
    { app_metadata: { external: 'x' }, email: 'e@x' })
  await assert.rejects(lerContaAuth(fake({ data: { user: null }, error: new Error('boom') }), 'u'), /boom/)
  await assert.rejects(lerContaAuth(fake({ data: { user: null }, error: null }), 'u'))
})
