import test from 'node:test'
import assert from 'node:assert/strict'
import { isCronAuthorized, safeEqual } from '../safe-compare.ts'

test('safeEqual: igual confere, diferente e vazio não', () => {
  assert.equal(safeEqual('abc', 'abc'), true)
  assert.equal(safeEqual('abc', 'abd'), false)
  assert.equal(safeEqual('abc', 'abcd'), false)
  assert.equal(safeEqual('', ''), false) // segredo vazio nunca confere
  assert.equal(safeEqual(null, 'x'), false)
  assert.equal(safeEqual('x', undefined), false)
})

test('cron: fail-closed sem segredo e exige o prefixo Bearer', () => {
  assert.equal(isCronAuthorized('Bearer s3', ''), false)
  assert.equal(isCronAuthorized('Bearer s3', undefined), false)
  assert.equal(isCronAuthorized(null, 's3'), false)
  assert.equal(isCronAuthorized('s3', 's3'), false)
  assert.equal(isCronAuthorized('Bearer s3', 's3'), true)
  assert.equal(isCronAuthorized('bearer s3', 's3'), false)
})
