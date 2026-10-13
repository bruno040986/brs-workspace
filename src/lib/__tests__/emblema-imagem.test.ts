import { describe, it } from 'node:test'
import assert from 'node:assert'
import sharp from 'sharp'
import { aparar } from '../convenios-publico/emblema-imagem.ts'

const dims = async (b: Buffer) => {
  const m = await sharp(b).metadata()
  return { w: m.width!, h: m.height! }
}

describe('aparar emblema', () => {
  it('apara a margem transparente (400x128 dentro de 500x500)', async () => {
    const png = await sharp({ create: { width: 500, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: { create: { width: 400, height: 128, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }, left: 50, top: 186 }])
      .png()
      .toBuffer()
    const r = await aparar(png)
    assert.equal(r.aparada, true)
    const { w, h } = await dims(r.buffer)
    assert.ok(w / h > 2.8 && w / h < 3.4, `proporção ${w}x${h}`)
    assert.ok(w < 500 && h < 200)
    assert.equal((await sharp(r.buffer).metadata()).format, 'png')
  })

  it('imagem opaca sem margem volta praticamente igual', async () => {
    const png = await sharp({ create: { width: 500, height: 350, channels: 3, background: { r: 10, g: 80, b: 200 } } }).png().toBuffer()
    const r = await aparar(png)
    const { w, h } = await dims(r.buffer)
    assert.ok(Math.abs(w - 500) <= 50 && Math.abs(h - 350) <= 35, `${w}x${h}`)
  })

  it('entrada inválida devolve o original', async () => {
    const lixo = Buffer.from('nao e imagem')
    const r = await aparar(lixo)
    assert.equal(r.aparada, false)
    assert.equal(r.buffer, lixo)
  })
})
