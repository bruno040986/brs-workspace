// "Preencher automaticamente" da aba Landing Page: template determinístico (sem IA)
// a partir dos dados básicos + Base de Conhecimento. Só preenche campo vazio.
// Módulo puro (sem alias/IO) para rodar no node:test.

import type { PublicoDestaque, VantagemItem } from '../site-builder/conteudo-publico'

export type DadosConvenioLanding = {
  nome: string
  /** convenios.esfera (municipal | estadual | federal | inss | outro). */
  esfera: string | null
  uf: string | null
  cidade: string | null
  /** Razão social do CNPJ do convênio (órgão gestor). */
  orgao: string | null
  teto_margem: number | null
  prazo_min: number | null
  prazo_max: number | null
  formas: { nome: string; margem: number | null }[]
  publicos: { id: string; nome: string }[]
  /** Decretos ativos da BC; só os com link são citados. */
  normas: { titulo: string; url: string | null }[]
}

export type CamposPreenchiveis = {
  titulo_destaque: string
  subtitulo: string
  resumo_publico: string
  vantagens: VantagemItem[]
  publicos_destaque: PublicoDestaque[]
  meta_title?: string | null
  meta_description?: string | null
}

const VANTAGENS_MIN = 4
const VANTAGENS_MAX = 6
const PUBLICOS_SUGERIDOS = 4

export function corta(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`
}

/** ['a','b','c'] → 'a, b e c'. */
export function lista(itens: string[]): string {
  return itens.length <= 1 ? (itens[0] ?? '') : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`
}

const pct = (n: number) => `${String(n).replace('.', ',')}%`

function local(d: DadosConvenioLanding): string | null {
  if (d.esfera === 'municipal' && d.cidade && d.uf) return `${d.cidade}/${d.uf}`
  return d.uf || null
}

function prazoTexto(d: DadosConvenioLanding): string | null {
  if (!d.prazo_max) return null
  return d.prazo_min ? `de ${d.prazo_min} a ${d.prazo_max} meses` : `de até ${d.prazo_max} meses`
}

/** Link citável: só https (o snapshot descarta item com fonte-URL que não seja https); "www.x" ganha https://. */
function linkHttps(url: string | null): string | null {
  const t = (url ?? '').trim()
  const u = /^www\./i.test(t) ? `https://${t}` : t
  return /^https:\/\/[^\s/]+\.[^\s]+$/i.test(u) ? u : null
}

const vantagem = (titulo: string, descricao: string, extra: Partial<VantagemItem> = {}): VantagemItem => ({
  titulo: corta(titulo, 120),
  descricao: corta(descricao, 600),
  fonte: null,
  consultado_em: null,
  situacao: 'confirmado',
  natureza: 'regra_bancaria',
  ...extra,
})

/** Vantagens neutras (sem banco). Norma só é citada quando tem link. */
export function gerarVantagens(d: DadosConvenioLanding): VantagemItem[] {
  const out: VantagemItem[] = [vantagem('Desconto em folha', 'As parcelas saem direto da folha de pagamento: não há boleto para lembrar.')]
  const prazo = prazoTexto(d)
  if (prazo) out.push(vantagem(`Até ${d.prazo_max} meses para pagar`, `Prazos ${prazo}, conforme a modalidade.`))
  if (d.formas.length) {
    const formas = lista(d.formas.map((f) => (f.margem != null ? `${f.nome} (margem de ${pct(f.margem)})` : f.nome)))
    const teto = d.teto_margem != null ? ` Comprometimento máximo da renda: ${pct(d.teto_margem)}.` : ''
    out.push(vantagem('Modalidades disponíveis', `${formas}.${teto}`))
  } else if (d.teto_margem != null) {
    out.push(vantagem('Margem definida pelo convênio', `Até ${pct(d.teto_margem)} da remuneração pode ser comprometida com consignações.`))
  }
  if (d.publicos.length) out.push(vantagem('Para quem é', `Atende ${lista(d.publicos.map((p) => p.nome))}.`))
  const norma = d.normas.map((n) => ({ titulo: n.titulo.trim(), url: linkHttps(n.url) })).find((n) => n.url && n.titulo)
  if (norma) out.push(vantagem('Regulamentado por norma oficial', `${norma.titulo}.`, { fonte: norma.url, natureza: 'norma_oficial' }))
  const reservas = [
    vantagem('Simulação antes de decidir', 'Você vê o valor da parcela e o prazo antes de contratar.'),
    vantagem('Atendimento pelo WhatsApp', 'Tire dúvidas e acompanhe sua proposta com atendimento humano.'),
    vantagem('Contratação orientada', 'Nossa equipe explica as regras do convênio e os documentos necessários.'),
  ]
  while (out.length < VANTAGENS_MIN) out.push(reservas.shift()!)
  return out.slice(0, VANTAGENS_MAX)
}

export function gerarTextos(d: DadosConvenioLanding) {
  const nome = d.nome.trim()
  const onde = local(d)
  const prazo = prazoTexto(d)
  const publicos = d.publicos.map((p) => p.nome)
  const paraQuem = publicos.length && publicos.length <= 3 ? ` para ${lista(publicos)}` : ''
  const resumo = [
    `O convênio ${nome}${onde ? ` (${onde})` : ''} permite contratar crédito consignado com as parcelas descontadas diretamente da folha de pagamento.`,
    publicos.length ? `Podem contratar: ${lista(publicos)}.` : '',
    d.teto_margem != null ? `Até ${pct(d.teto_margem)} da remuneração pode ser comprometida com consignações.` : '',
    d.formas.some((f) => f.margem != null)
      ? `Margem por modalidade: ${lista(d.formas.filter((f) => f.margem != null).map((f) => `${f.nome} ${pct(f.margem!)}`))}.`
      : '',
    prazo ? `Prazos ${prazo}.` : '',
    'Fale com a nossa equipe pelo WhatsApp para simular e tirar dúvidas.',
  ]
  return {
    titulo_destaque: corta(`Consignado ${nome}`, 200),
    subtitulo: corta(`Crédito com desconto em folha${paraQuem}${prazo ? `, em até ${d.prazo_max} meses` : ''}.`, 300),
    resumo_publico: corta(resumo.filter(Boolean).join(' '), 2000),
    meta_title: corta(`Consignado ${nome}${onde ? ` - ${onde}` : ''}`, 70),
    meta_description: corta(
      `Crédito consignado ${nome}: desconto em folha${prazo ? `, prazos ${prazo}` : ''}. Veja quem pode contratar e simule pelo WhatsApp.`,
      170,
    ),
  }
}

export function gerarPublicosDestaque(d: DadosConvenioLanding): PublicoDestaque[] {
  const prazo = d.prazo_max ? ` e prazo de até ${d.prazo_max} meses` : ''
  return d.publicos.slice(0, PUBLICOS_SUGERIDOS).map((p) => ({
    publico_id: p.id,
    titulo: corta(p.nome, 60),
    texto: corta(`Crédito consignado para ${p.nome} do convênio ${d.nome.trim()}, com desconto em folha${prazo}. Simule pelo WhatsApp.`, 300),
    imagem_url: null,
  }))
}

const vazio = (v: unknown) => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0)

const ROTULOS: Record<string, string> = {
  titulo_destaque: 'título',
  subtitulo: 'subtítulo',
  resumo_publico: 'texto de apresentação',
  vantagens: 'vantagens',
  publicos_destaque: 'públicos em destaque',
  meta_title: 'meta title',
  meta_description: 'meta description',
}

/** Preenche só os campos vazios de `atual`; devolve o novo valor e os rótulos do que foi preenchido. */
export function preencherLanding<T extends CamposPreenchiveis>(atual: T, d: DadosConvenioLanding): { valor: T; preenchidos: string[] } {
  const sugestao: Record<string, unknown> = {
    ...gerarTextos(d),
    vantagens: gerarVantagens(d),
    publicos_destaque: gerarPublicosDestaque(d),
  }
  const valor = { ...atual } as Record<string, unknown>
  const preenchidos: string[] = []
  for (const [campo, novo] of Object.entries(sugestao)) {
    if (vazio(valor[campo]) && !vazio(novo)) {
      valor[campo] = novo
      preenchidos.push(ROTULOS[campo])
    }
  }
  return { valor: valor as T, preenchidos }
}
