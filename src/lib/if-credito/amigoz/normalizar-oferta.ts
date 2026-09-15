/**
 * `normalizarOfertaAmigoz` isolada num arquivo sem NENHUM import com alias
 * (`@/...`) — só assim dá pra rodar em `node --test` puro (sem bundler/
 * resolver de path alias). Ver o comentário completo (mapeamento PROVISÓRIO,
 * por quê) em ./ofertas.ts, que reexporta esta função pro resto do código.
 */
import type { OfertaNormalizada, ProdutoOferta } from '../ofertas'

type Json = Record<string, unknown>

function ehObjeto(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function numeroOuNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v).replace(',', '.').trim())
  return Number.isFinite(n) ? n : null
}

function textoOuNull(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s ? s : null
}

/** dd/mm/aaaa → aaaa-mm-dd (formato que a IF pode devolver num "1º vencimento"). */
function normalizarDataAmigoz(v: unknown): string | null {
  const texto = String(v ?? '').trim()
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
}

/** Primeiro campo existente entre grafias candidatas — a doc do Amigoz tem schemas vazios. */
function pegar(obj: Json, chaves: string[]): unknown {
  for (const chave of chaves) {
    if (obj[chave] !== undefined && obj[chave] !== null) return obj[chave]
  }
  return undefined
}

/**
 * Normaliza a resposta de `simulacao-cartao`. MAPEAMENTO PROVISÓRIO — ver
 * ./ofertas.ts. Devolve `null` quando nenhum campo mínimo (saque, limite ou
 * parcela) é reconhecido — nunca inventa valores.
 */
export function normalizarOfertaAmigoz(produto: ProdutoOferta, bruto: unknown, inst: { id: string; name: string }): OfertaNormalizada | null {
  if (!ehObjeto(bruto)) return null

  // Alguns endpoints do Amigoz embrulham a resposta (visto no criar-cliente: {cliente:{...}, cartao:{...}}).
  const fontes: Json[] = [bruto]
  for (const chave of ['simulacao', 'resultado', 'oferta', 'cartao', 'data']) {
    const aninhado = bruto[chave]
    if (ehObjeto(aninhado)) fontes.push(aninhado)
  }

  let limitePreAprovado: number | null = null
  let valorSaque: number | null = null
  let numParcelas: number | null = null
  let valorParcela: number | null = null
  let taxaMes: number | null = null
  let cetMes: number | null = null
  let primeiroVencimento: string | null = null
  let tabelaCodigo: string | null = null

  for (const f of fontes) {
    if (limitePreAprovado === null) limitePreAprovado = numeroOuNull(pegar(f, ['limite_pre_aprovado', 'limitePreAprovado', 'limite_aprovado', 'limite']))
    if (valorSaque === null) valorSaque = numeroOuNull(pegar(f, ['valor_saque', 'valorSaque', 'saque', 'valor_troco', 'troco']))
    if (numParcelas === null) {
      const n = numeroOuNull(pegar(f, ['numero_parcelas', 'numParcelas', 'num_parcelas', 'quantidade_parcelas', 'qtd_parcelas', 'prazo']))
      numParcelas = n === null ? null : Math.round(n)
    }
    if (valorParcela === null) valorParcela = numeroOuNull(pegar(f, ['valor_parcela', 'valorParcela', 'parcela']))
    if (taxaMes === null) taxaMes = numeroOuNull(pegar(f, ['taxa_mes', 'taxaMes', 'taxa_am', 'taxa_a_m', 'taxa']))
    if (cetMes === null) cetMes = numeroOuNull(pegar(f, ['cet_mes', 'cetMes', 'cet_am', 'cet_a_m', 'cet']))
    if (primeiroVencimento === null) primeiroVencimento = normalizarDataAmigoz(pegar(f, ['primeiro_vencimento', 'primeiroVencimento', 'data_primeiro_vencimento', 'vencimento']))
    if (tabelaCodigo === null) tabelaCodigo = textoOuNull(pegar(f, ['id_produto', 'idProduto', 'codigo_produto', 'codigoProduto', 'id_tabela', 'tabela']))
  }

  // Nenhum campo mínimo bateu — o mapeamento provisório não reconheceu esta resposta.
  if (valorSaque === null && limitePreAprovado === null && valorParcela === null) return null

  return {
    produto,
    instituicaoId: inst.id,
    instituicaoNome: inst.name,
    limitePreAprovado,
    valorSaque,
    numParcelas,
    valorParcela,
    taxaMes,
    cetMes,
    primeiroVencimento,
    tabelaCodigo: tabelaCodigo ?? (produto === 'cartao_rcc' ? '7' : produto === 'cartao_rmc' ? '15' : null),
    bruto,
  }
}
