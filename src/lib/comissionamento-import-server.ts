/**
 * Helpers server-side compartilhados pelos importadores do Comissionamento
 * (Tabelas de Comissão e Prazos Comissão — planilha ÚNICA, dois passos).
 * Recebem o client admin por parâmetro; nunca importar no browser.
 */

import * as XLSX from 'xlsx'
import { chaveResolucao, normalizarTexto, type CampoReferencia, type Resolucoes } from '@/lib/comissionamento-import'

export type AdminClient = {
  from: (table: string) => any
}

export function lerPlanilha(buffer: Buffer): { headers: string[]; rows: unknown[][] } {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return { headers: [], rows: [] }
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' })
  const headers = (rows[0] || []).map((cell) => normalizarTexto(cell).replace(/ /g, '_'))
  return { headers, rows: rows.slice(1) }
}

export type Catalogo = {
  financeiras: Array<{ id: string; nome: string; codigoBanco: string }>
  promotoras: Array<{ id: string; nome: string; razao: string }>
  convenios: Array<{ id: string; nome: string; codigo: string }>
  formas: Array<{ id: string; nome: string; codigoArw: string }>
  formalizacoes: Array<{ id: string; nome: string; codigoArw: string }>
  aliases: Map<string, string>
  /** id -> nome de exibição (para diffs/descrições). */
  nomes: Map<string, string>
}

export async function carregarCatalogo(admin: AdminClient): Promise<Catalogo> {
  const [financeiras, promotoras, convenios, formas, formalizacoes, aliases] = await Promise.all([
    admin.from('financial_institutions').select('id, name, linked_bank_code').is('deleted_at', null),
    admin.from('promotoras').select('id, razao_social, nome_fantasia'),
    admin.from('convenios').select('id, nome, codigo').is('deleted_at', null),
    admin.from('formas_contrato').select('id, nome, codigo_arw'),
    admin.from('tipos_formalizacao').select('id, nome, codigo_arw'),
    admin.from('comissionamento_import_aliases').select('tipo, texto_normalizado, alvo_id'),
  ])

  const aliasesMap = new Map<string, string>()
  for (const alias of aliases.data || []) {
    aliasesMap.set(chaveResolucao(alias.tipo as CampoReferencia, String(alias.texto_normalizado)), String(alias.alvo_id))
  }

  const nomes = new Map<string, string>()
  for (const row of financeiras.data || []) nomes.set(String(row.id), String(row.name))
  for (const row of promotoras.data || []) nomes.set(String(row.id), String(row.nome_fantasia || row.razao_social || row.id))
  for (const row of convenios.data || []) nomes.set(String(row.id), String(row.nome))
  for (const row of formas.data || []) nomes.set(String(row.id), String(row.nome))
  for (const row of formalizacoes.data || []) nomes.set(String(row.id), String(row.nome))

  return {
    financeiras: (financeiras.data || []).map((row: any) => ({
      id: String(row.id),
      nome: normalizarTexto(row.name),
      codigoBanco: normalizarTexto(row.linked_bank_code),
    })),
    promotoras: (promotoras.data || []).map((row: any) => ({
      id: String(row.id),
      nome: normalizarTexto(row.nome_fantasia),
      razao: normalizarTexto(row.razao_social),
    })),
    convenios: (convenios.data || []).map((row: any) => ({
      id: String(row.id),
      nome: normalizarTexto(row.nome),
      codigo: normalizarTexto(row.codigo),
    })),
    formas: (formas.data || []).map((row: any) => ({
      id: String(row.id),
      nome: normalizarTexto(row.nome),
      codigoArw: normalizarTexto(row.codigo_arw),
    })),
    formalizacoes: (formalizacoes.data || []).map((row: any) => ({
      id: String(row.id),
      nome: normalizarTexto(row.nome),
      codigoArw: normalizarTexto(row.codigo_arw),
    })),
    aliases: aliasesMap,
    nomes,
  }
}

export function resolverReferencia(
  campo: CampoReferencia,
  texto: string,
  catalogo: Catalogo,
  resolucoes: Resolucoes,
): string | null {
  const normalizado = normalizarTexto(texto)
  if (!normalizado) return null

  const chave = chaveResolucao(campo, normalizado)
  if (resolucoes[chave]) return resolucoes[chave]
  if (catalogo.aliases.has(chave)) return catalogo.aliases.get(chave)!

  if (campo === 'financeira') {
    const hit = catalogo.financeiras.find((item) => item.nome === normalizado || (item.codigoBanco && item.codigoBanco === normalizado))
    return hit?.id || null
  }
  if (campo === 'promotora') {
    const hit = catalogo.promotoras.find((item) => item.nome === normalizado || item.razao === normalizado)
    return hit?.id || null
  }
  if (campo === 'convenio') {
    const hit = catalogo.convenios.find((item) => item.nome === normalizado || (item.codigo && item.codigo === normalizado))
    return hit?.id || null
  }
  if (campo === 'forma_contrato') {
    const hit = catalogo.formas.find((item) => item.nome === normalizado || (item.codigoArw && item.codigoArw === normalizado))
    return hit?.id || null
  }
  const hit = catalogo.formalizacoes.find((item) => item.nome === normalizado || (item.codigoArw && item.codigoArw === normalizado))
  return hit?.id || null
}

/** Grava os de-paras apontados na tela (memória para as próximas importações). */
export async function salvarAliases(admin: AdminClient, resolucoes: Resolucoes, userId: string) {
  const aliasRows = Object.entries(resolucoes)
    .map(([chave, alvoId]) => {
      const [tipo, ...resto] = chave.split('::')
      return { tipo, texto_normalizado: resto.join('::'), alvo_id: alvoId, created_by: userId }
    })
    .filter((row) => row.tipo && row.texto_normalizado && row.alvo_id)
  if (aliasRows.length) {
    await admin.from('comissionamento_import_aliases').upsert(aliasRows, { onConflict: 'tipo,texto_normalizado' })
  }
}
