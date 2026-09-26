/**
 * Atributos personalizados do Chatwoot (D3, lote 2) — catálogo e helpers PUROS.
 * O Workspace continua dono do que já é dele (vínculo com parceiro/instituição/promotora):
 * o atributo é ESPELHO (Workspace → Chatwoot) para filtro e automação. Convênio e
 * Motivo de Contato não existiam no Workspace: nascem aqui, gravados direto no Chatwoot
 * (lista de convênios vem do cadastro `convenios`; a de motivos é editável na tela Atributos).
 * API: /custom_attribute_definitions (tipo e modelo são INTEIROS); valores em
 * contact/conversation `custom_attributes`.
 */

export type ModeloAtributo = 'contato' | 'conversa'

export const TIPO_TEXTO = 0
export const TIPO_LISTA = 6

export type DefinicaoAtributo = {
  chave: string
  nome: string
  modelo: ModeloAtributo
  tipo: typeof TIPO_TEXTO | typeof TIPO_LISTA
  descricao: string
}

export const DEFINICOES: readonly DefinicaoAtributo[] = [
  { chave: 'parceiro_codigo', nome: 'Parceiro/Código', modelo: 'contato', tipo: TIPO_TEXTO, descricao: 'Parceiro vinculado ao contato (espelho do Workspace).' },
  { chave: 'instituicao_financeira', nome: 'Instituição Financeira', modelo: 'contato', tipo: TIPO_TEXTO, descricao: 'Instituição financeira vinculada ao contato (espelho do Workspace).' },
  { chave: 'promotora', nome: 'Promotora', modelo: 'contato', tipo: TIPO_TEXTO, descricao: 'Promotora vinculada ao contato (espelho do Workspace).' },
  { chave: 'convenio', nome: 'Convênio', modelo: 'contato', tipo: TIPO_LISTA, descricao: 'Convênio do contato (lista do cadastro de convênios).' },
  { chave: 'motivo_contato', nome: 'Motivo de Contato', modelo: 'conversa', tipo: TIPO_LISTA, descricao: 'Motivo pelo qual o cliente entrou em contato.' },
] as const

/** Ponto de partida da lista de motivos; a equipe edita na tela Atributos. */
export const MOTIVOS_PADRAO = ['Dúvida', 'Proposta', 'Cadastro', 'Reclamação', 'Suporte técnico', 'Outros']

export const modeloParaApi = (m: ModeloAtributo) => (m === 'conversa' ? 0 : 1)

export type TipoEntidade = 'parceiro' | 'instituicao' | 'promotora'
export const CHAVE_POR_ENTIDADE: Record<TipoEntidade, string> = { parceiro: 'parceiro_codigo', instituicao: 'instituicao_financeira', promotora: 'promotora' }

/** Corpo do POST/PATCH de definição. Lista exige ao menos 1 valor. */
export function corpoDefinicao(def: DefinicaoAtributo, valores: string[]): { ok: true; corpo: Record<string, unknown> } | { ok: false; error: string } {
  const corpo: Record<string, unknown> = {
    attribute_display_name: def.nome,
    attribute_display_type: def.tipo,
    attribute_description: def.descricao,
    attribute_key: def.chave,
    attribute_model: modeloParaApi(def.modelo),
  }
  if (def.tipo === TIPO_LISTA) {
    const lista = normalizarLista(valores)
    if (!lista.length) return { ok: false, error: `A lista "${def.nome}" precisa de ao menos 1 valor.` }
    corpo.attribute_values = lista
  }
  return { ok: true, corpo }
}

/** Trim, remove vazios e duplicados (sem diferenciar maiúsculas), mantém a ordem. */
export function normalizarLista(valores: string[]): string[] {
  const vistos = new Set<string>()
  const saida: string[] = []
  for (const v of valores) {
    const t = String(v || '').trim()
    if (!t || vistos.has(t.toLowerCase())) continue
    vistos.add(t.toLowerCase())
    saida.push(t)
  }
  return saida
}

/** Mescla `novos` sobre `atual` sem apagar o resto (o Chatwoot substitui o hash inteiro se não mesclarmos aqui). */
export function mesclarAtributos(atual: Record<string, unknown> | null | undefined, novos: Record<string, unknown>): Record<string, unknown> {
  return { ...(atual || {}), ...novos }
}

/** Atributos de vínculo do contato: preenche a chave do tipo e limpa as outras (um contato tem UMA entidade). */
export function atributosDoVinculo(tipo: TipoEntidade | null, nome: string): Record<string, string> {
  const r: Record<string, string> = { parceiro_codigo: '', instituicao_financeira: '', promotora: '' }
  if (tipo) r[CHAVE_POR_ENTIDADE[tipo]] = nome
  return r
}
