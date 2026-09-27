/** W3 (lote 2): números digitados e resultado de participantes. Roda com: npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { falhasDeParticipantes, separarNumeros, terminouNumero } from '../numeros.ts'

test('separa por vírgula, ponto e vírgula, quebra de linha e espaço após 10+ dígitos; formatação com espaço fica junta', () => {
  assert.deepEqual(separarNumeros('61 99999-1234, +55 61 98888-7777;\n(61) 3199-1641 5561999991234').validos, ['61999991234', '5561988887777', '6131991641', '5561999991234'])
  assert.deepEqual(separarNumeros('5561999991234, +55 61 98888-7777;5561999991234').validos, ['5561999991234', '5561988887777'])
  assert.deepEqual(separarNumeros('123, abc').invalidos, ['123', 'abc'])
})

test('terminouNumero: separador no fim vira badge', () => {
  assert.equal(terminouNumero('5561999991234'), false)
  assert.equal(terminouNumero('5561999991234,'), true)
  assert.equal(terminouNumero('5561999991234 '), true)
  assert.equal(terminouNumero('61 '), false)
})

test('falhas: 200 some; demais viram motivo em português', () => {
  const f = falhasDeParticipantes([{ jid: '5561999991234@s.whatsapp.net', status: '200' }, { jid: '5561988887777@s.whatsapp.net', status: '403' }, { jid: '999@lid', status: '409' }, { jid: '5561900000000@s.whatsapp.net', status: '500' }])
  assert.equal(f.length, 3)
  assert.match(f[0], /\+5561988887777.*convite/)
  assert.match(f[1], /já está no grupo/)
  assert.match(f[2], /código 500/)
})
