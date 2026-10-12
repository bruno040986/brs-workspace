import { describe, it } from 'node:test'
import assert from 'node:assert'
import { itemListaPublica, ordenarListaPublica, type ConvenioListaPublica } from '../convenios-publico/lista.ts'
import { decidirTokenPreview, montarEntradaSnapshot, montarPreview, tokenPreviewValido, type DadosSnapshot } from '../convenios-publico/montar-entrada.ts'

const linha = (over: Record<string, unknown> = {}) => ({
  slug_publico: 'governo-go',
  nome: 'Governo de Goiás',
  nome_reduzido: 'GOV GO',
  esfera: 'estadual',
  uf: 'GO',
  logotipo_url: null,
  brasao_url: null,
  imagens_predio: [],
  publicado_em: '2026-10-10T14:00:00+00:00',
  id: 'interno',
  is_active: true,
  ...over,
})

describe('lista pública de convênios', () => {
  it('só os campos do contrato, publicado_em em ISO UTC', () => {
    const i = itemListaPublica(linha())!
    assert.deepStrictEqual(Object.keys(i).sort(), ['brasao_url', 'esfera', 'imagem_card_url', 'logotipo_url', 'nome', 'nome_reduzido', 'publicado_em', 'slug', 'uf'])
    assert.equal(i.publicado_em, '2026-10-10T14:00:00.000Z')
    assert.equal(i.imagem_card_url, null)
  })

  it('imagem_card_url: logotipo → brasão → primeiro prédio https; só https', () => {
    const predio = [{ url: 'http://x.com/p.webp' }, { url: 'https://cdn.x.com/p2.webp' }]
    assert.equal(itemListaPublica(linha({ imagens_predio: predio }))!.imagem_card_url, 'https://cdn.x.com/p2.webp')
    assert.equal(itemListaPublica(linha({ imagens_predio: predio, brasao_url: 'https://cdn.x.com/b.png' }))!.imagem_card_url, 'https://cdn.x.com/b.png')
    const i = itemListaPublica(linha({ imagens_predio: predio, brasao_url: 'https://cdn.x.com/b.png', logotipo_url: 'https://cdn.x.com/l.png' }))!
    assert.equal(i.imagem_card_url, 'https://cdn.x.com/l.png')
    const ruim = itemListaPublica(linha({ logotipo_url: 'javascript:alert(1)', brasao_url: 'http://x.com/b.png' }))!
    assert.equal(ruim.logotipo_url, null)
    assert.equal(ruim.brasao_url, null)
    assert.equal(ruim.imagem_card_url, null)
  })

  it('linha inválida sai (slug, esfera, data)', () => {
    assert.equal(itemListaPublica(linha({ slug_publico: 'Ruim!' })), null)
    assert.equal(itemListaPublica(linha({ esfera: 'galactica' })), null)
    assert.equal(itemListaPublica(linha({ publicado_em: null })), null)
  })

  it('ordem por esfera e depois nome', () => {
    const l = [
      itemListaPublica(linha({ slug_publico: 'b', nome: 'Trindade', esfera: 'municipal' })),
      itemListaPublica(linha({ slug_publico: 'c', nome: 'Governo PI', esfera: 'estadual' })),
      itemListaPublica(linha({ slug_publico: 'a', nome: 'Águas Lindas', esfera: 'municipal' })),
    ] as ConvenioListaPublica[]
    assert.deepStrictEqual(ordenarListaPublica(l).map((c) => c.slug), ['a', 'b', 'c'])
  })
})

const TOKEN = 'A'.repeat(43)
describe('token de preview', () => {
  const agora = Date.parse('2026-10-11T12:00:00Z')
  it('válido dentro da validade', () => {
    assert.equal(tokenPreviewValido(TOKEN, TOKEN, '2026-10-11T13:00:00Z', agora), true)
  })
  it('expirado é recusado', () => {
    assert.equal(tokenPreviewValido(TOKEN, TOKEN, '2026-10-11T11:59:59Z', agora), false)
    assert.equal(tokenPreviewValido(TOKEN, TOKEN, null, agora), false)
  })
  it('diferente, vazio ou fora do formato é recusado', () => {
    assert.equal(tokenPreviewValido('B'.repeat(43), TOKEN, '2026-10-11T13:00:00Z', agora), false)
    assert.equal(tokenPreviewValido('', null, '2026-10-11T13:00:00Z', agora), false)
    assert.equal(tokenPreviewValido(TOKEN + 'x', TOKEN + 'x', '2026-10-11T13:00:00Z', agora), false)
  })
  it('caso real de Goiás (2026-10-12): token gerado pela action vale; depois de girado, o antigo cai', () => {
    const gerado = 'xSNxHJ8RPrkyJKZ1wg2QW0sHpgJn8o80AkwhzIRl0PA'
    const agoraGo = Date.parse('2026-10-12T20:05:00Z')
    // formato que o PostgREST devolve para timestamptz e o do psql
    assert.equal(tokenPreviewValido(gerado, gerado, '2026-10-12T22:02:59.837+00:00', agoraGo), true)
    assert.equal(tokenPreviewValido(gerado, gerado, '2026-10-12 22:02:59.837+00', agoraGo), true)
    // nova chamada de gerarLinkPreview (Ver preview / Recarregar) troca o token: o link anterior responde 401
    assert.equal(tokenPreviewValido(gerado, 'a5OeqJ2xqnc5VAawTVX8eGo1sTpj7LnCn20kJai-OA8', '2026-10-12T22:05:15.093+00:00', agoraGo), false)
  })
})

describe('preview do rascunho', () => {
  const dados: DadosSnapshot = {
    publicos: [{ publicos_atendidos: { id: 'p1', nome: 'Servidor efetivo', is_active: true } }],
    formas: [{ formas_contrato: { nome: 'Consignado', is_active: true } }],
    instituicoes: [],
    imagens: [],
    faqsBase: [],
  }
  const convenio = { nome: 'Governo de Goiás', esfera: 'estadual', uf: 'GO' }
  const rascunho = {
    versao: 4,
    is_draft: true,
    pendente_revisao_humana: true,
    revisado_por: null,
    titulo_destaque: 'Consignado GO',
    cta_tipo_destino: 'whatsapp',
    cta_texto_botao: 'Fale conosco',
    preview_token: TOKEN,
  }

  it('não exige revisão e marca preview: true', () => {
    const r = montarPreview(dados, convenio, 'governo-go', rascunho, new Date('2026-10-11T12:00:00Z'))
    assert.ok(r.ok)
    if (!r.ok) return
    assert.equal(r.snapshot.preview, true)
    assert.equal(r.snapshot.versao, 4)
    assert.equal(r.snapshot.publicado_em, '2026-10-11T12:00:00.000Z')
    assert.equal(JSON.stringify(r.snapshot).includes(TOKEN), false)
  })

  it('mesma montagem da publicação (exceto a marca preview)', () => {
    const r = montarPreview(dados, convenio, 'governo-go', rascunho, new Date('2026-10-11T12:00:00Z'))
    const e = montarEntradaSnapshot(dados, convenio, 'governo-go', rascunho, '2026-10-11T12:00:00.000Z')
    assert.deepStrictEqual(e.publicos.map((p) => p.nome), ['Servidor efetivo'])
    assert.ok(r.ok)
    if (r.ok) assert.deepStrictEqual(r.snapshot.formas_contratacao, [{ codigo: 'consignado', nome: 'Consignado' }])
  })

  it('publicos_destaque do rascunho sai com o nome do público ativo; inativo do convênio é descartado', () => {
    const comInativo: DadosSnapshot = {
      ...dados,
      publicos: [...dados.publicos, { publicos_atendidos: { id: 'p2', nome: 'Temporário', is_active: false } }],
    }
    const publicos_destaque = [
      { publico_id: 'p2', titulo: 'Temporários', texto: '', imagem_url: null },
      { publico_id: 'p1', titulo: 'Efetivos', texto: 'Desconto em folha.', imagem_url: 'http://inseguro.exemplo.com/a.png' },
    ]
    const r = montarPreview(comInativo, convenio, 'governo-go', { ...rascunho, publicos_destaque })
    assert.ok(r.ok)
    if (r.ok) assert.deepStrictEqual(r.snapshot.publicos_destaque, [{ publico: 'Servidor efetivo', titulo: 'Efetivos', texto: 'Desconto em folha.', imagem_url: null }])
  })

  it('erro de validação do conteúdo volta como erro (não lança)', () => {
    const r = montarPreview(dados, convenio, 'governo-go', { ...rascunho, titulo_destaque: 'Olá {{nome_parceiro}}' })
    assert.equal(r.ok, false)
  })
})

describe('decidirTokenPreview', () => {
  const agora = Date.parse('2026-10-12T12:00:00Z')
  const em = (min: number) => new Date(agora + min * 60_000).toISOString()
  it('reutiliza com mais de 30 min restantes', () => assert.strictEqual(decidirTokenPreview('t', em(31), agora), 'reutilizar'))
  it('gera novo com 30 min ou menos, expirado ou sem token', () => {
    assert.strictEqual(decidirTokenPreview('t', em(30), agora), 'novo')
    assert.strictEqual(decidirTokenPreview('t', em(-5), agora), 'novo')
    assert.strictEqual(decidirTokenPreview(null, em(90), agora), 'novo')
    assert.strictEqual(decidirTokenPreview('t', null, agora), 'novo')
    assert.strictEqual(decidirTokenPreview('t', 'lixo', agora), 'novo')
  })
})
