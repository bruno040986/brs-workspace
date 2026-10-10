import { describe, it } from 'node:test'
import assert from 'node:assert'
import { SLUG_PUBLICO_RE, codigoDoNome, montarSnapshotPublico, urlHttps, type EntradaSnapshot } from '../convenios-publico/snapshot.ts'
const UUID = '3f2b8c1e-1111-4222-8333-444455556666'

function entrada(over: Partial<EntradaSnapshot> = {}, conteudo: Record<string, unknown> = {}): EntradaSnapshot {
  return {
    slug: 'governo-go',
    convenio: { nome: 'Governo de Goiás', esfera: 'estadual', uf: 'GO' },
    versao: 3,
    publicado_em: '2026-10-10T14:00:00.000Z',
    aprovado_por: 'Fulano',
    conteudo: {
      id: UUID,
      convenio_id: UUID,
      created_by: UUID,
      published_by: UUID,
      is_draft: true,
      pendente_revisao_humana: false,
      variaveis_permitidas: ['nome_parceiro'],
      secoes_ordem: ['hero'],
      titulo_destaque: 'Consignado GO',
      subtitulo: '',
      resumo_publico: '<b>Resumo</b> curto',
      hero_headline: 'Headline',
      hero_subheadline: null,
      imagem_destaque_url: 'https://cdn.exemplo.com/a.webp',
      imagem_destaque_alt: 'Servidor',
      vantagens: [
        { titulo: 'Desconto em folha', descricao: 'Parcelas no contracheque.', situacao: 'confirmado', fonte: 'https://go.gov.br/decreto', consultado_em: '2026-10-01', natureza: 'norma_oficial' },
      ],
      faqs: [{ pergunta: 'Quem pode?', resposta: 'Efetivos.', situacao: 'confirmado', fonte: 'regra do banco', natureza: 'regra_bancaria' }],
      secoes_visibilidade: { hero: true, resumo: true, vantagens: true, faq: true, cta: true, seo: true },
      meta_title: 'Consignado GO',
      meta_description: 'Descrição',
      keywords: ' consignado goias, , servidor go ',
      cta_texto_botao: 'Simular Agora',
      cta_tipo_destino: 'whatsapp',
      cta_link_destino: null,
      ...conteudo,
    },
    publicos: [{ nome: 'Efetivo' }, { nome: 'Temporário' }],
    formas: [{ nome: 'Cartão Benefício' }],
    instituicoes: [{ nome: 'StarBank', publicos: ['Temporário'], formas: [{ nome: 'Cartão Benefício', origem_margem: 'cartao_rcc' }] }],
    ...over,
  }
}

function snap(e: EntradaSnapshot) {
  const r = montarSnapshotPublico(e)
  assert.ok(r.ok, r.ok ? '' : r.erro)
  return r.snapshot
}

describe('montarSnapshotPublico', () => {
  it('só tem as chaves do contrato e nenhum campo interno/uuid', () => {
    const s = snap(entrada())
    assert.deepStrictEqual(Object.keys(s).sort(), [
      'aprovado_por', 'contrato', 'convenio', 'cta', 'faqs', 'formas_contratacao', 'hero', 'instituicoes', 'publicado_em',
      'publicos', 'resumo_publico', 'seo', 'slug', 'subtitulo', 'titulo_destaque', 'vantagens', 'versao',
    ])
    const json = JSON.stringify(s)
    assert.ok(!json.includes(UUID))
    for (const k of ['pendente_revisao_humana', 'variaveis_permitidas', 'secoes_ordem', 'published_by', 'origem_margem', 'is_draft']) {
      assert.ok(!json.includes(k), k)
    }
    assert.strictEqual(s.contrato, 'v1')
    assert.deepStrictEqual(s.instituicoes[0], {
      nome: 'StarBank',
      produtos: ['Cartão benefício'],
      publicos: ['Temporário'],
      formas: ['Cartão Benefício'],
      evidencia: { fonte: null, consultado_em: null, situacao: 'confirmado', natureza: null },
    })
    assert.deepStrictEqual(s.publicos[1], { codigo: 'temporario', nome: 'Temporário' })
  })

  it('item pendente ou sem situação fica fora', () => {
    const s = snap(entrada({}, {
      vantagens: [
        { titulo: 'A', descricao: 'a', situacao: 'pendente' },
        { titulo: 'B', descricao: 'b' },
        { titulo: 'C', descricao: 'c', situacao: 'confirmado' },
      ],
      faqs: [{ pergunta: 'P?', resposta: 'R' }],
    }))
    assert.deepStrictEqual(s.vantagens.map((v) => v.titulo), ['C'])
    assert.deepStrictEqual(s.faqs, [])
  })

  it('público vazio continua vazio (nunca vira "todos")', () => {
    const s = snap(entrada({ publicos: [], instituicoes: [{ nome: 'X', publicos: [], formas: [] }] }))
    assert.deepStrictEqual(s.publicos, [])
    assert.deepStrictEqual(s.instituicoes[0].publicos, [])
  })

  it('URL não-https vira null e item com fonte-URL anulada sai', () => {
    for (const u of [
      'http://a.com/x.png', 'javascript:alert(1)', 'data:image/png;base64,AA', '/rel.png',
      'https://user:senha@a.com/x', 'https://10.0.0.1/x', 'https://[::1]/x',
    ]) {
      assert.strictEqual(urlHttps(u), null, u)
      const s = snap(entrada({}, { imagem_destaque_url: u }))
      assert.strictEqual(s.hero.imagem_url, null)
    }
    for (const fonte of ['http://a.com/decreto', 'www.a.com/decreto', 'https://1.2.3.4/x']) {
      const s = snap(entrada({}, { vantagens: [{ titulo: 'T', descricao: 'd', situacao: 'confirmado', fonte }] }))
      assert.deepStrictEqual(s.vantagens, [], fonte)
    }
    const texto = snap(entrada({}, { vantagens: [{ titulo: 'T', descricao: 'd', situacao: 'confirmado', fonte: 'Resolução: 123/2026' }] }))
    assert.strictEqual(texto.vantagens[0].fonte, 'Resolução: 123/2026')
    const r = montarSnapshotPublico(entrada({}, { cta_tipo_destino: 'url_customizada', cta_link_destino: 'http://a.com' }))
    assert.strictEqual(r.ok, false)
  })

  it('fonte com esquema perigoso (javascript:, data:, etc.) descarta o item', () => {
    for (const fonte of ['javascript:alert(1)', ' DATA:text/html,x', 'vbscript:x', 'file:///etc/passwd', 'Blob:abc']) {
      const s = snap(entrada({}, { vantagens: [{ titulo: 'T', descricao: 'd', situacao: 'confirmado', fonte }] }))
      assert.deepStrictEqual(s.vantagens, [], fonte)
    }
  })

  it('fonte textual que não é URL nem esquema perigoso fica', () => {
    const s = snap(entrada({}, { vantagens: [{ titulo: 'T', descricao: 'd', situacao: 'confirmado', fonte: 'Resolução: 123/2026' }] }))
    assert.strictEqual(s.vantagens[0].fonte, 'Resolução: 123/2026')
  })

  it('recusa texto com {{variavel}}', () => {
    const r = montarSnapshotPublico(entrada({}, { hero_headline: 'Fale com {{nome_parceiro}}' }))
    assert.strictEqual(r.ok, false)
    assert.match(r.ok ? '' : r.erro, /\{\{nome_parceiro\}\}/)
  })

  it('keywords: texto vira array por vírgula, sem vazios', () => {
    assert.deepStrictEqual(snap(entrada()).seo.keywords, ['consignado goias', 'servidor go'])
  })

  it("textos '' viram null e tags HTML são removidas", () => {
    const s = snap(entrada())
    assert.strictEqual(s.subtitulo, null)
    assert.strictEqual(s.hero.subheadline, null)
    assert.strictEqual(s.resumo_publico, 'Resumo curto')
  })

  it('seção oculta sai vazia', () => {
    const s = snap(entrada({}, { secoes_visibilidade: { hero: false, resumo: true, vantagens: false, faq: false, cta: false, seo: false } }))
    assert.deepStrictEqual(s.hero, { headline: null, subheadline: null, imagem_url: null, imagem_alt: null })
    assert.deepStrictEqual(s.vantagens, [])
    assert.deepStrictEqual(s.faqs, [])
    assert.strictEqual(s.cta, null)
    assert.deepStrictEqual(s.seo, { meta_title: null, meta_description: null, keywords: [] })
  })

  it('passa de 256 KB → falha', () => {
    const publicos = Array.from({ length: 60 }, (_, i) => `Público ${i} ${'x'.repeat(180)}`)
    const insts = Array.from({ length: 30 }, (_, i) => ({ nome: `Banco ${i}`, publicos, formas: [] }))
    const r = montarSnapshotPublico(entrada({ instituicoes: insts }))
    assert.strictEqual(r.ok, false)
    assert.match(r.ok ? '' : r.erro, /256 KB/)
    assert.strictEqual(montarSnapshotPublico(entrada({ instituicoes: [...insts, ...insts] })).ok, false)
  })
})

describe('slug público', () => {
  it('regex do contrato', () => {
    for (const ok of ['governo-go', 'clt', 'a', 'taboao-da-serra-sp', 'a'.repeat(63)]) assert.ok(SLUG_PUBLICO_RE.test(ok), ok)
    for (const ruim of ['', '-go', 'go-', 'Governo', 'gov_go', 'a'.repeat(64), 'gov go', 'são-paulo']) assert.ok(!SLUG_PUBLICO_RE.test(ruim), ruim)
  })

  it('codigo derivado do nome', () => {
    assert.strictEqual(codigoDoNome('Forças de segurança'), 'forcas-de-seguranca')
  })
})
