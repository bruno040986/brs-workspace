import { describe, it } from 'node:test'
import assert from 'node:assert'
import { SLUG_PUBLICO_RE, codigoDoNome, extrasInstituicaoPublica, horarioPublico, logoDataUrl, logoPublico, montarSnapshotPublico, urlHttps, type EntradaSnapshot } from '../convenios-publico/snapshot.ts'
const UUID = '3f2b8c1e-1111-4222-8333-444455556666'

function entrada(over: Partial<EntradaSnapshot> = {}, conteudo: Record<string, unknown> = {}): EntradaSnapshot {
  return {
    slug: 'governo-go',
    convenio: { nome: 'Governo de Goiás', esfera: 'estadual', uf: 'GO' },
    versao: 3,
    publicado_em: '2026-10-10T14:00:00.000Z',
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
    instituicoes: [{ nome: 'StarBank', publicos: ['Temporário'], ofertas: [{ forma: 'Cartão Benefício', publicos_restritos: null }] }],
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
      'contrato', 'convenio', 'cta', 'faqs', 'formas_contratacao', 'hero', 'instituicoes', 'publicado_em',
      'publicos', 'resumo_publico', 'seo', 'slug', 'subtitulo', 'titulo_destaque', 'vantagens', 'versao',
    ])
    const json = JSON.stringify(s)
    assert.ok(!json.includes(UUID))
    for (const k of ['pendente_revisao_humana', 'variaveis_permitidas', 'secoes_ordem', 'published_by', 'origem_margem', 'is_draft', 'aprovado_por', 'publicos_restritos']) {
      assert.ok(!json.includes(k), k)
    }
    assert.strictEqual(s.contrato, 'v1')
    assert.deepStrictEqual(s.instituicoes[0], {
      nome: 'StarBank',
      logo_url: null,
      publicos_base: ['Temporário'],
      ofertas: [{ forma: 'Cartão Benefício', codigo_forma: 'cartao-beneficio', publicos: ['Temporário'] }],
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
    const s = snap(entrada({ publicos: [], instituicoes: [{ nome: 'X', publicos: [], ofertas: [{ forma: 'Novo', publicos_restritos: null }] }] }))
    assert.deepStrictEqual(s.publicos, [])
    assert.deepStrictEqual(s.instituicoes, [])
  })

  describe('instituicoes[].ofertas', () => {
    const go = entrada({
      publicos: [{ nome: 'Comissionado' }, { nome: 'Efetivo' }, { nome: 'Temporário' }],
      instituicoes: [
        {
          nome: 'Banco X',
          publicos: ['Comissionado', 'Efetivo', 'Temporário'],
          ofertas: [
            { forma: 'Cartão consignado', publicos_restritos: ['Efetivo', 'Temporário'] },
            { forma: 'Empréstimo consignado', publicos_restritos: ['Efetivo'] },
            { forma: 'Portabilidade', publicos_restritos: null },
          ],
        },
        { nome: 'Banco Sem Oferta', publicos: ['Efetivo'], ofertas: [] },
        { nome: 'Banco Restrito a Inativo', publicos: ['Efetivo'], ofertas: [{ forma: 'Novo', publicos_restritos: [] }] },
        { nome: 'Banco Vínculo Vazio', publicos: null, ofertas: [{ forma: 'Novo', publicos_restritos: null }] },
      ],
    })

    it('restrição mantém só os públicos restritos; dois produtos do mesmo banco preservam a diferença', () => {
      const [x] = snap(go).instituicoes
      assert.deepStrictEqual(x.publicos_base, ['Comissionado', 'Efetivo', 'Temporário'])
      assert.deepStrictEqual(x.ofertas.slice(0, 2), [
        { forma: 'Cartão consignado', codigo_forma: 'cartao-consignado', publicos: ['Efetivo', 'Temporário'] },
        { forma: 'Empréstimo consignado', codigo_forma: 'emprestimo-consignado', publicos: ['Efetivo'] },
      ])
    })

    it('oferta sem restrição herda publicos_base', () => {
      assert.deepStrictEqual(snap(go).instituicoes[0].ofertas[2].publicos, ['Comissionado', 'Efetivo', 'Temporário'])
    })

    it('instituição sem oferta (ou só com oferta sem público) é omitida', () => {
      const nomes = snap(go).instituicoes.map((i) => i.nome)
      assert.ok(!nomes.includes('Banco Sem Oferta'))
      assert.ok(!nomes.includes('Banco Restrito a Inativo'))
    })

    it('vínculo sem público no cadastro herda os públicos do convênio', () => {
      const v = snap(go).instituicoes.find((i) => i.nome === 'Banco Vínculo Vazio')
      assert.deepStrictEqual(v?.publicos_base, ['Comissionado', 'Efetivo', 'Temporário'])
      assert.deepStrictEqual(v?.ofertas[0].publicos, ['Comissionado', 'Efetivo', 'Temporário'])
    })

    it('restrito fora da base não entra', () => {
      const s = snap(entrada({ instituicoes: [{ nome: 'Y', publicos: ['Efetivo'], ofertas: [{ forma: 'Novo', publicos_restritos: ['Efetivo', 'Temporário'] }] }] }))
      assert.deepStrictEqual(s.instituicoes[0].ofertas[0].publicos, ['Efetivo'])
    })

    it('aprovado_por não está no payload', () => {
      assert.ok(!('aprovado_por' in snap(go)))
    })
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
    for (const fonte of ['javascript:alert(1)', ' DATA:text/html,x', 'vbscript:x', 'file:///etc/passwd', 'Blob:abc', 'about:blank']) {
      const s = snap(entrada({}, { vantagens: [{ titulo: 'T', descricao: 'd', situacao: 'confirmado', fonte }] }))
      assert.deepStrictEqual(s.vantagens, [], fonte)
    }
  })

  it('esquema perigoso com controle/espaço/invisível dentro do esquema também descarta', () => {
    for (const fonte of ['java\tscript:alert(1)', '\u0000javascript:x', ' JAVA\nSCRIPT:x', 'ja\u200bvascript:x', 'jav\u00a0ascript:x']) {
      const s = snap(entrada({}, { vantagens: [{ titulo: 'T', descricao: 'd', situacao: 'confirmado', fonte }] }))
      assert.deepStrictEqual(s.vantagens, [], JSON.stringify(fonte))
    }
  })

  it('URL com controle dentro (ht\\ttps://) é inválida e o item sai', () => {
    const s = snap(entrada({}, { vantagens: [{ titulo: 'T', descricao: 'd', situacao: 'confirmado', fonte: 'ht\ttps://exemplo.com' }] }))
    assert.deepStrictEqual(s.vantagens, [])
    assert.strictEqual(urlHttps('ht\ttps://exemplo.com'), null)
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
    const insts = Array.from({ length: 30 }, (_, i) => ({ nome: `Banco ${i}`, publicos, ofertas: [{ forma: 'Novo', publicos_restritos: null }] }))
    const r = montarSnapshotPublico(entrada({ instituicoes: insts }))
    assert.strictEqual(r.ok, false)
    assert.match(r.ok ? '' : r.erro, /256 KB/)
    assert.strictEqual(montarSnapshotPublico(entrada({ instituicoes: [...insts, ...insts] })).ok, false)
  })
})

const IF = '0a1b2c3d-1111-4222-8333-444455556666'
const PNG = 'data:image/png;base64,iVBORw0KGgo='
const ROTA = `https://workspace.brspromotora.com.br/api/convenios/publico/v1/instituicoes/${IF}/logo`

describe('logo das instituições', () => {
  const inst = (logo_url: string | null | undefined) =>
    snap(entrada({ instituicoes: [{ id: IF, nome: 'StarBank', logo_url, publicos: null, ofertas: [{ forma: 'Novo', publicos_restritos: null }] }] })).instituicoes[0].logo_url

  it('logoPublico: data URL válida → rota absoluta; https → ela mesma; resto → null', () => {
    assert.strictEqual(logoPublico(IF, PNG), ROTA)
    assert.strictEqual(logoPublico(IF, PNG, 'https://preview.vercel.app/'), `https://preview.vercel.app/api/convenios/publico/v1/instituicoes/${IF}/logo`)
    assert.strictEqual(logoPublico(IF, 'https://cdn.exemplo.com/l.png'), 'https://cdn.exemplo.com/l.png')
    for (const ruim of [null, '', 'http://cdn.exemplo.com/l.png', 'javascript:alert(1)', 'data:text/html;base64,PGI+', 'data:image/gif;base64,R0lGOA==', 'data:image/png;base64,@@@']) {
      assert.strictEqual(logoPublico(IF, ruim), null, String(ruim))
    }
    assert.strictEqual(logoPublico('nao-e-uuid', PNG), null)
  })

  it('logoDataUrl: tipo, base64 e limite de 300 KB', () => {
    assert.deepStrictEqual(logoDataUrl('data:image/jpg;base64,/9j/'), { mime: 'image/jpeg', base64: '/9j/' })
    assert.strictEqual(logoDataUrl('data:image/svg+xml;base64,PHN2Zz4=')?.mime, 'image/svg+xml')
    assert.ok(logoDataUrl(`data:image/png;base64,${'A'.repeat(400 * 1024)}`))
    assert.strictEqual(logoDataUrl(`data:image/png;base64,${'A'.repeat(400 * 1024 + 4)}`), null)
  })

  it('snapshot: logo válido vira rota, inválido vira null, ausente vira null', () => {
    assert.strictEqual(inst(PNG), ROTA)
    assert.strictEqual(inst('data:image/png;base64,nao base64'), null)
    assert.strictEqual(inst(undefined), null)
    assert.strictEqual(inst(''), null)
  })
})

describe('extras da lista de instituições', () => {
  it('logo larga: ?v=wide para data URL, https direto, resto null', () => {
    assert.strictEqual(logoPublico(IF, PNG, undefined, true), `${ROTA}?v=wide`)
    assert.strictEqual(logoPublico(IF, 'https://x.com/l.png', undefined, true), 'https://x.com/l.png')
    assert.strictEqual(logoPublico(IF, '', undefined, true), null)
  })

  it('extras nunca carregam campos sensíveis', () => {
    const r = extrasInstituicaoPublica('https://x.com.br', { card_enabled: true, telefone: '0800 1', email: 'a@b.com', whatsapp: '5511999999999', atendimento: [] })
    assert.deepStrictEqual(Object.keys(r).sort(), ['site'])
  })

  const linha = (dia: string, enabled = true, ini = '08:00', fim = '20:00') => ({ enabled, dia_da_semana: dia, hora_inicial: ini, hora_final: fim })
  const semana = ['Segunda-Feira', 'Terça-Feira', 'Quarta-Feira', 'Quinta-Feira', 'Sexta-Feira']

  it('horario agrupa dias seguidos com a mesma faixa', () => {
    assert.strictEqual(horarioPublico([...semana.map((d) => linha(d)), linha('Sábado', true, '09:00', '14:00'), linha('', false, '', '')]),
      'Segunda-Feira a Sexta-Feira, 08:00–20:00; Sábado, 09:00–14:00')
    const todos = [...semana, 'Sábado', 'Domingo'].map((d) => linha(d, true, '00:00', '23:59'))
    assert.strictEqual(horarioPublico(todos), 'Todos os dias, 00:00–23:59')
  })

  it('horario: linha ativa sem dia ou hora, dia repetido, ou nada ativo → null', () => {
    assert.strictEqual(horarioPublico([linha('Segunda-Feira'), linha('')]), null)
    assert.strictEqual(horarioPublico([linha('Segunda-Feira', true, '8h', '20:00')]), null)
    assert.strictEqual(horarioPublico([linha('Segunda-Feira'), linha('Segunda-Feira')]), null)
    assert.strictEqual(horarioPublico([linha('', false)]), null)
    assert.strictEqual(horarioPublico(null), null)
  })

  it('site: https ou www. viram https; resto some', () => {
    assert.deepStrictEqual(extrasInstituicaoPublica('www.bib.com.br', null), { site: 'https://www.bib.com.br/' })
    assert.deepStrictEqual(extrasInstituicaoPublica('https://x.com.br/a', null), { site: 'https://x.com.br/a' })
    for (const ruim of ['', 'http://x.com.br', 'javascript:alert(1)', 'bib.com.br', null]) assert.deepStrictEqual(extrasInstituicaoPublica(ruim, null), {}, String(ruim))
  })

  it('sac e horario só com card_enabled', () => {
    const sac = { card_enabled: true, telefone: '0800 762-7777', atendimento: semana.map((d) => linha(d)) }
    assert.deepStrictEqual(extrasInstituicaoPublica('', sac), { sac: '08007627777', horario: 'Segunda-Feira a Sexta-Feira, 08:00–20:00' })
    assert.deepStrictEqual(extrasInstituicaoPublica('', { ...sac, card_enabled: false }), {})
    assert.deepStrictEqual(extrasInstituicaoPublica('', { ...sac, telefone: '' }), { horario: 'Segunda-Feira a Sexta-Feira, 08:00–20:00' })
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

import { dispararRebuildNuAzul } from '../convenios-publico/deploy-hook.ts'

describe('dispararRebuildNuAzul', () => {
  it('env vazia: não chama', async () => {
    delete process.env.NUAZUL_DEPLOY_HOOK_URL
    let n = 0
    await dispararRebuildNuAzul('publicar', 'x', async () => { n++ })
    assert.equal(n, 0)
  })
  it('env definida: chama com a URL; falha não lança', async () => {
    process.env.NUAZUL_DEPLOY_HOOK_URL = 'https://hook.test/abc'
    const urls: string[] = []
    await dispararRebuildNuAzul('retirar', 'x', async (u) => { urls.push(u); throw new Error('boom https://hook.test/abc') })
    assert.deepEqual(urls, ['https://hook.test/abc'])
    delete process.env.NUAZUL_DEPLOY_HOOK_URL
  })
})
