/** Cascata Instituição → Convênio → Tabela do lançamento manual de coeficientes (funções puras). */

export type TabelaCascata = {
  id: string
  convenio_id: string | null
  financial_institutions: { id: string; name: string } | null
  convenios: { id: string; nome: string } | null
}

export type OpcaoCascata = { id: string; label: string }
export type SelecaoCascata = { instituicaoId: string; convenioId: string; tabelaId: string }

const chave = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const comparar = (a: string, b: string) => chave(a).localeCompare(chave(b), 'pt-BR') || a.localeCompare(b, 'pt-BR')

/** Rótulo legível: espaços normalizados; se vier todo em maiúsculas/minúsculas, capitaliza. */
export function rotuloCascata(texto: string | null | undefined): string {
  const t = (texto ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return 'sem nome'
  if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t
  return t.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, sp, ch) => sp + ch.toUpperCase())
}

function unicas(pares: Array<[string, string]>): OpcaoCascata[] {
  const mapa = new Map<string, OpcaoCascata>()
  for (const [id, nome] of pares) if (!mapa.has(id)) mapa.set(id, { id, label: rotuloCascata(nome) })
  return [...mapa.values()].sort((a, b) => comparar(a.label, b.label))
}

/** Instituições que têm ao menos uma tabela. */
export function opcoesInstituicao(tabelas: TabelaCascata[]): OpcaoCascata[] {
  return unicas(tabelas.flatMap((t) => (t.financial_institutions ? [[t.financial_institutions.id, t.financial_institutions.name] as [string, string]] : [])))
}

/** Convênios da instituição que têm tabela (vazio sem instituição). */
export function opcoesConvenio(tabelas: TabelaCascata[], instituicaoId: string): OpcaoCascata[] {
  if (!instituicaoId) return []
  return unicas(
    tabelas.flatMap((t) =>
      t.financial_institutions?.id === instituicaoId && t.convenio_id && t.convenios ? [[t.convenio_id, t.convenios.nome] as [string, string]] : [],
    ),
  )
}

/** Tabelas do convênio E da instituição (vazio se faltar qualquer um). Rótulo vem de `rotulo`. */
export function opcoesTabela<T extends TabelaCascata>(
  tabelas: T[],
  sel: Pick<SelecaoCascata, 'instituicaoId' | 'convenioId'>,
  rotulo: (t: T) => string,
): OpcaoCascata[] {
  if (!sel.instituicaoId || !sel.convenioId) return []
  return unicas(
    tabelas
      .filter((t) => t.financial_institutions?.id === sel.instituicaoId && t.convenio_id === sel.convenioId)
      .map((t) => [t.id, rotulo(t)] as [string, string]),
  )
}

/** Troca um campo, limpa os dependentes e pré-seleciona quando só há UMA opção. */
export function aplicarSelecao<T extends TabelaCascata>(
  tabelas: T[],
  atual: SelecaoCascata,
  campo: keyof SelecaoCascata,
  valor: string,
  rotulo: (t: T) => string,
): SelecaoCascata {
  const sel = { ...atual, [campo]: valor }
  if (campo === 'instituicaoId') { sel.convenioId = ''; sel.tabelaId = '' }
  if (campo === 'convenioId') sel.tabelaId = ''
  if (campo === 'instituicaoId' && sel.instituicaoId) {
    const c = opcoesConvenio(tabelas, sel.instituicaoId)
    if (c.length === 1) sel.convenioId = c[0].id
  }
  if (campo !== 'tabelaId' && sel.convenioId && !sel.tabelaId) {
    const t = opcoesTabela(tabelas, sel, rotulo)
    if (t.length === 1) sel.tabelaId = t[0].id
  }
  return sel
}

/** Validação do servidor: a tabela existe e, se instituição/convênio vieram, pertencem a ela. */
export function vinculoTabelaValido(
  tabela: { institution_id: string | null; convenio_id: string | null } | null | undefined,
  informado: { instituicaoId?: string; convenioId?: string },
): boolean {
  if (!tabela) return false
  if (informado.instituicaoId && tabela.institution_id !== informado.instituicaoId) return false
  if (informado.convenioId && tabela.convenio_id !== informado.convenioId) return false
  return true
}
