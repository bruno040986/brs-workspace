/**
 * Consulta de margem do Amigoz — Fatia 2 (Higienização Amigoz). SÓ servidor.
 *
 * Formato REAL de `POST /api/consulta-margem` (fixado na descoberta, 14-15/09):
 * devolve um ARRAY com 1 linha por produto×tipo de margem (idProduto "15"|"7",
 * tipoMargem 3|2|1), cada linha trazendo nome/nascimento/ocupação/matrícula/
 * estável + um array `emprestimos[]` (idProduto "13", tipoMargem 5). A MESMA
 * entrada de empréstimo vem REPETIDA dentro do `emprestimos[]` de TODAS as
 * linhas de cartão — sem deduplicar por matrícula+verba, a margem do
 * empréstimo seria somada em dobro/triplo.
 *
 * Mapeamento pras margens que o WeSales JÁ TEM (decisão do Bruno, 15/09 —
 * margem é dado do cliente, não da IF):
 *   idProduto 15                → Cartão RMC Margem (soma se vier dividido)
 *   idProduto 7, tipoMargem 1   → 30% da margem do Cartão RCC (compra)
 *   idProduto 7, tipoMargem 2   → 70% da margem do Cartão RCC (saque)
 *   idProduto 13 (emprestimos[]) → Novo Margem (deduplicado)
 *
 * Erro da averbadora ou CPF sem margem: a doc não documenta o shape, então
 * qualquer resposta que NÃO seja array vira "sem margem" com o texto do erro
 * preservado (nunca derruba o item do lote).
 */
import { chamarAmigozAutenticado, type ConfigAmigoz } from './client'
import { listarVariantesPorConvenio, type VarianteConvenio } from './convenios'

export type MargemNormalizadaAmigoz = {
  nomeIf: string | null
  nascimentoIf: string | null // como a IF devolveu (dd/mm/aaaa) — não convertido aqui
  ocupacaoIf: string | null
  matriculaIf: string | null
  estavel: boolean | null
  margemConsignado: number // Cartão RMC (100%)
  margemBeneficioCompra: number // 30%
  margemBeneficioSaque: number // 70%
  margemBeneficio: number // Cartão RCC = compra + saque (100%)
  margemEmprestimo: number // Novo Margem
  temOportunidade: boolean
}

export type ResultadoConsultaMargem =
  | { ok: true; margem: MargemNormalizadaAmigoz; bruto: unknown }
  | { ok: false; mensagem: string; bruto: unknown }

type LinhaMargemBruta = {
  nome?: unknown
  nascimento?: unknown
  ocupacao?: unknown
  numeroMatricula?: unknown
  verba?: unknown
  idProduto?: unknown
  tipoMargem?: unknown
  estavel_bool?: unknown
  margem_atual?: unknown
  emprestimos?: unknown
}

function ehArray(v: unknown): v is unknown[] {
  return Array.isArray(v)
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** margem_atual vem como string com PONTO decimal ("467.50", "70.12") — nunca vírgula BR. */
function numeroAmigoz(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = Number.parseFloat(String(v ?? '').replace(',', '.').trim())
  return Number.isFinite(n) ? n : 0
}

function textoOuNull(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s ? s : null
}

/**
 * Normaliza a resposta do Amigoz. Devolve `ok:false` quando a resposta não é
 * o array esperado (erro da averbadora, `{detail: "..."}`, HTTP não-2xx já
 * filtrado por quem chama) — o texto de erro fica em `mensagem`.
 */
export function normalizarMargemAmigoz(bruto: unknown): ResultadoConsultaMargem {
  if (!ehArray(bruto)) {
    let mensagem = 'Sem margem retornada pela IF.'
    if (ehObjeto(bruto)) {
      const d = bruto.detail ?? bruto.message ?? bruto.erro ?? bruto.error
      if (typeof d === 'string' && d.trim()) mensagem = d.trim()
    } else if (typeof bruto === 'string' && bruto.trim()) {
      mensagem = bruto.trim()
    }
    return { ok: false, mensagem, bruto }
  }

  const linhas = bruto as LinhaMargemBruta[]
  if (linhas.length === 0) {
    return {
      ok: true,
      bruto,
      margem: {
        nomeIf: null,
        nascimentoIf: null,
        ocupacaoIf: null,
        matriculaIf: null,
        estavel: null,
        margemConsignado: 0,
        margemBeneficioCompra: 0,
        margemBeneficioSaque: 0,
        margemBeneficio: 0,
        margemEmprestimo: 0,
        temOportunidade: false,
      },
    }
  }

  let nomeIf: string | null = null
  let nascimentoIf: string | null = null
  let ocupacaoIf: string | null = null
  let matriculaIf: string | null = null
  let estavel: boolean | null = null
  let margemConsignado = 0
  let margemBeneficioCompra = 0
  let margemBeneficioSaque = 0

  // Empréstimo vem repetido no `emprestimos[]` de CADA linha de cartão —
  // dedup por matrícula+verba (identidade da linha de crédito na folha).
  const emprestimosVistos = new Map<string, number>()

  for (const linha of linhas) {
    if (!ehObjeto(linha)) continue
    if (!nomeIf) nomeIf = textoOuNull(linha.nome)
    if (!nascimentoIf) nascimentoIf = textoOuNull(linha.nascimento)
    if (!ocupacaoIf) ocupacaoIf = textoOuNull(linha.ocupacao)
    if (!matriculaIf) matriculaIf = textoOuNull(linha.numeroMatricula)
    if (estavel === null && typeof linha.estavel_bool === 'boolean') estavel = linha.estavel_bool

    const idProduto = String(linha.idProduto ?? '').trim()
    const tipoMargem = Number(linha.tipoMargem)
    const valor = numeroAmigoz(linha.margem_atual)

    if (idProduto === '15') {
      margemConsignado += valor
    } else if (idProduto === '7' && tipoMargem === 1) {
      margemBeneficioCompra += valor
    } else if (idProduto === '7' && tipoMargem === 2) {
      margemBeneficioSaque += valor
    }

    const emprestimos = ehArray(linha.emprestimos) ? (linha.emprestimos as LinhaMargemBruta[]) : []
    for (const emp of emprestimos) {
      if (!ehObjeto(emp)) continue
      const chave = `${textoOuNull(emp.numeroMatricula) ?? ''}|${textoOuNull(emp.verba) ?? ''}|${String(emp.idProduto ?? '')}`
      if (emprestimosVistos.has(chave)) continue
      emprestimosVistos.set(chave, numeroAmigoz(emp.margem_atual))
    }
  }

  const margemEmprestimo = [...emprestimosVistos.values()].reduce((a, b) => a + b, 0)
  const margemBeneficio = margemBeneficioCompra + margemBeneficioSaque
  const temOportunidade = margemConsignado > 0 || margemBeneficio > 0 || margemEmprestimo > 0

  return {
    ok: true,
    bruto,
    margem: {
      nomeIf,
      nascimentoIf,
      ocupacaoIf,
      matriculaIf,
      estavel,
      margemConsignado,
      margemBeneficioCompra,
      margemBeneficioSaque,
      margemBeneficio,
      margemEmprestimo,
      temOportunidade,
    },
  }
}

export type ParametrosConsultaMargem = {
  cpf: string
  convenioExternoId: string
  averbadora: number
  numeroMatricula?: string | null
  senhaServidor?: string | null
}

/**
 * Chama `POST /api/consulta-margem` e já devolve normalizado. Erros de rede/
 * HTTP (não-2xx que não seja um corpo reconhecível) viram `ok:false` também
 * — a chamada em si já fica registrada em `if_credito_chamadas` pelo adaptador.
 */
export async function consultarMargemAmigoz(
  cfg: ConfigAmigoz,
  params: ParametrosConsultaMargem,
  criadoPor?: string | null
): Promise<ResultadoConsultaMargem> {
  const body: Record<string, unknown> = {
    cpf: params.cpf,
    averbadora: params.averbadora,
    convenio: Number.isFinite(Number(params.convenioExternoId)) ? Number(params.convenioExternoId) : params.convenioExternoId,
  }
  if (params.numeroMatricula) body.numero_matricula = params.numeroMatricula
  if (params.senhaServidor) body.senha_servidor = params.senhaServidor

  const r = await chamarAmigozAutenticado(cfg, 'consulta-margem', 'POST', '/api/consulta-margem', body, criadoPor)
  if (!r.ok) {
    return normalizarMargemAmigoz(r.corpo) // corpo do erro já tem detail/message na maioria dos casos
  }
  return normalizarMargemAmigoz(r.corpo)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type ResultadoComVariante = ResultadoConsultaMargem & { varianteUsada: VarianteConvenio | null }

/**
 * Consulta um convênio BRS tentando TODAS as suas variantes na IF em
 * sequência (ordenadas por `ordem`) até achar oportunidade — decisão do
 * Bruno (15/09): o operador não sabe de antemão qual variante (ex.: "INSS"
 * vs "INSS - Aposentadoria por Invalidez") vale pra cada CPF. Variantes sem
 * averbadora configurada são puladas. Se nenhuma achar margem, devolve o
 * resultado da ÚLTIMA tentada (erro ou sem-margem) — nunca perde a
 * informação de qual variante respondeu.
 */
export async function consultarMargemComVariantes(
  cfg: ConfigAmigoz,
  convenioId: string,
  params: { cpf: string; numeroMatricula?: string | null; senhaServidor?: string | null },
  criadoPor?: string | null,
  retentativaMs = 0
): Promise<ResultadoComVariante> {
  const variantes = (await listarVariantesPorConvenio(convenioId)).filter((v) => v.averbadoraExterna !== null)
  if (variantes.length === 0) {
    return { ok: false, mensagem: 'Nenhuma variante deste convênio no Amigoz tem averbadora configurada.', bruto: null, varianteUsada: null }
  }

  let ultimoResultado: ResultadoConsultaMargem | null = null
  let ultimaVariante: VarianteConvenio | null = null

  for (const variante of variantes) {
    let r = await consultarMargemAmigoz(
      cfg,
      {
        cpf: params.cpf,
        convenioExternoId: variante.convenioExternoId,
        averbadora: variante.averbadoraExterna!,
        numeroMatricula: params.numeroMatricula,
        senhaServidor: params.senhaServidor,
      },
      criadoPor
    )
    if (!r.ok && retentativaMs > 0) {
      await sleep(retentativaMs)
      r = await consultarMargemAmigoz(
        cfg,
        {
          cpf: params.cpf,
          convenioExternoId: variante.convenioExternoId,
          averbadora: variante.averbadoraExterna!,
          numeroMatricula: params.numeroMatricula,
          senhaServidor: params.senhaServidor,
        },
        criadoPor
      )
    }
    ultimoResultado = r
    ultimaVariante = variante
    if (r.ok && r.margem.temOportunidade) return { ...r, varianteUsada: variante }
  }

  return { ...(ultimoResultado as ResultadoConsultaMargem), varianteUsada: ultimaVariante }
}
