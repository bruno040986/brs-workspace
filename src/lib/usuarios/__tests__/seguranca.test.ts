import test from 'node:test'
import assert from 'node:assert/strict'
import { perfilPermitido, podeAdministrarPrivilegios, resolverRole, validarSenhaTemporaria } from '../seguranca.ts'

test('senha provisória: ausente, curta, repetida e padrão brs+dígitos falham', () => {
  for (const ruim of [undefined, null, '', 'abc', 'aaaaaaaaaaaa', 'brs987654', 'BRS12345678']) {
    assert.throws(() => validarSenhaTemporaria(ruim), Error, String(ruim))
  }
  assert.equal(validarSenhaTemporaria('Xk9#mQ2vLp'), 'Xk9#mQ2vLp')
  assert.throws(() => validarSenhaTemporaria('x'.repeat(73) + 'ab12'))
})

test('role: sem privilégio nunca vem do cliente', () => {
  assert.equal(resolverRole({ pedido: 'admin', atual: null, privilegiado: false }), 'consulta')
  assert.equal(resolverRole({ pedido: 'admin', atual: 'rh', privilegiado: false }), 'rh')
  assert.equal(resolverRole({ pedido: 'admin', atual: 'valor-estranho', privilegiado: false }), 'consulta')
})

test('role: com privilégio aceita só valores conhecidos', () => {
  assert.equal(resolverRole({ pedido: ' Admin ', privilegiado: true }), 'admin')
  assert.throws(() => resolverRole({ pedido: 'root', privilegiado: true }))
  assert.throws(() => resolverRole({ pedido: undefined, privilegiado: true }))
})

test('perfil: sem privilégio só se não mudar', () => {
  assert.equal(perfilPermitido({ pedido: 'p1', atual: null, privilegiado: false }), false)
  assert.equal(perfilPermitido({ pedido: 'p2', atual: 'p1', privilegiado: false }), false)
  assert.equal(perfilPermitido({ pedido: 'p1', atual: 'p1', privilegiado: false }), true)
  assert.equal(perfilPermitido({ pedido: undefined, atual: null, privilegiado: false }), true)
  assert.equal(perfilPermitido({ pedido: 'p9', atual: 'p1', privilegiado: true }), true)
})

test('privilégio exige editar perfis ou root, não apenas cadastro', () => {
  const so = (r: string) => (res: string) => res === r
  assert.equal(podeAdministrarPrivilegios(so('sistema-usuarios-cadastro')), false)
  assert.equal(podeAdministrarPrivilegios(so('sistema-usuarios-perfis')), true)
  assert.equal(podeAdministrarPrivilegios(so('sistema-usuarios-root')), true)
})
