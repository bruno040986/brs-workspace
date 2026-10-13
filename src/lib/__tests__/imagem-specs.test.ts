import { describe, it } from 'node:test'
import assert from 'node:assert'
import { IMAGEM_SPECS, textoSpec, fraseCopiavel, type ImagemSlot } from '../convenios-publico/imagem-specs.ts'
import { IMAGEM_TIPOS } from '../convenios-publico/snapshot.ts'

describe('imagem-specs', () => {
  it('todo tipo de IMAGEM_TIPOS tem spec de galeria', () => {
    for (const t of IMAGEM_TIPOS) assert.ok(IMAGEM_SPECS[`galeria_${t}` as ImagemSlot], t)
  })
  it('textoSpec e fraseCopiavel trazem largura × altura', () => {
    for (const [slot, s] of Object.entries(IMAGEM_SPECS)) {
      assert.ok(textoSpec(slot as ImagemSlot).includes(`${s.largura} × ${s.altura} px`), slot)
      assert.ok(fraseCopiavel(slot as ImagemSlot).includes(`${s.largura} × ${s.altura} px`), slot)
    }
  })
  it('destaque é 1080 × 1440 (3:4)', () => {
    assert.equal(textoSpec('destaque'), 'Tamanho ideal: 1080 × 1440 px (3:4) · PNG, JPG ou WebP · até 2 MB')
  })
})
