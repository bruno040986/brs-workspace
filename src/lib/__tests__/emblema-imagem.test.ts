import { describe, it } from 'node:test'
import assert from 'node:assert'
import sharp from 'sharp'
import { aparar } from '../convenios-publico/emblema-imagem.ts'

const dims = async (b: Buffer) => {
  const m = await sharp(b).metadata()
  return { w: m.width!, h: m.height! }
}

const opaco = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 80, b: 200 } } }).png().toBuffer()

/** Retângulo opaco cw x ch centralizado em tela transparente 500x500. */
const emTela = (cw: number, ch: number) =>
  sharp({ create: { width: 500, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width: cw, height: ch, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }, left: Math.floor((500 - cw) / 2), top: Math.floor((500 - ch) / 2) }])
    .png()
    .toBuffer()

describe('aparar emblema', () => {
  it('logotipo 400x128 em 500x500 vira quadrado e mantém a proporção do conteúdo', async () => {
    const r = await aparar(await emTela(400, 128), 'quadrado')
    assert.equal(r.aparada, true)
    const { w, h } = await dims(r.buffer)
    assert.ok(Math.abs(w - h) <= 1, `${w}x${h}`)
    assert.equal((await sharp(r.buffer).metadata()).format, 'png')
    const c = await dims(await sharp(r.buffer).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 10 }).toBuffer())
    assert.ok(c.w / c.h > 2.9 && c.w / c.h < 3.3, `conteúdo ${c.w}x${c.h}`)
  })

  it('brasão 300x400 vira quadrado', async () => {
    const r = await aparar(await emTela(300, 400), 'quadrado')
    const { w, h } = await dims(r.buffer)
    assert.ok(Math.abs(w - h) <= 1, `${w}x${h}`)
    assert.ok(h >= 400)
  })

  it('bandeira 500x350 fica 10:7 sem mudar', async () => {
    const r = await aparar(await opaco(500, 350), 'bandeira')
    const { w, h } = await dims(r.buffer)
    assert.ok(Math.abs(w / h - 10 / 7) <= 0.02, `${w}x${h}`)
    assert.ok(Math.abs(w - 500) <= 10 && Math.abs(h - 350) <= 7)
  })

  it('bandeira 600x400 (3:2) vira 10:7 sem distorcer', async () => {
    const r = await aparar(await opaco(600, 400), 'bandeira')
    assert.equal(r.aparada, true)
    const { w, h } = await dims(r.buffer)
    assert.ok(Math.abs(w / h - 10 / 7) <= 0.02, `${w}x${h}`)
    assert.ok(w >= 600 && h >= 400)
  })

  it('imagem com pixels demais (6000x6000) volta intacta, sem decodificar', async () => {
    const grande = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: { r: 128, g: 128, b: 128 } } }).png().toBuffer()
    const r = await aparar(grande, 'quadrado')
    assert.equal(r.aparada, false)
    assert.equal(r.buffer, grande)
  })

  it('entrada inválida devolve o original', async () => {
    const lixo = Buffer.from('nao e imagem')
    const r = await aparar(lixo)
    assert.equal(r.aparada, false)
    assert.equal(r.buffer, lixo)
  })
})
