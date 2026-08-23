/**
 * Importador de Tabelas de Comissão (CSV/XLSX, modelo padronizado).
 *
 * Duas fases, ambas por upload (o arquivo é a fonte da verdade; nada fica em
 * memória entre os passos):
 * - fase=analisar: dry-run — resolve referências (com aliases memorizados +
 *   resoluções apontadas na tela), classifica cada linha (nova / atualização
 *   com diff / sem mudança / pendência / inválida). NADA é gravado.
 * - fase=aplicar: exige ZERO pendências/inválidas (decisão Bruno: tudo
 *   resolvido por segurança); atualizações aplicam só as linhas APROVADAS na
 *   tela; grava aliases novos e o log de auditoria.
 *
 * Exige sistema-config-credito (can_include).
 */

import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { hasPermissionForUser } from '@/lib/auth/server'
import {
  MODELO_TABELAS_HEADERS,
  chaveResolucao,
  normalizarTexto,
  parseSeguro,
  parseTaxaPlanilha,
  type CampoReferencia,
  type DiffCampo,
  type LinhaAnalisada,
  type Resolucoes,
} from '@/lib/comissionamento-import'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_LINHAS = 20_000

type Catalogo = {
  financeiras: Array<{ id: string; nome: string; codigoBanco: string }>
  promotoras: Array<{ id: string; nome: string; razao: string }>
  convenios: Array<{ id: string; nome: string; codigo: string }>
  formas: Array<{ id: string; nome: string; codigoArw: string }>
  formalizacoes: Array<{ id: string; nome: string; codigoArw: string }>
  aliases: Map<string, string>
}

function lerPlanilha(buffer: Buffer): { headers: string[]; rows: unknown[][] } {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return { headers: [], rows: [] }
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' })
  const headers = (rows[0] || []).map((cell) => normalizarTexto(cell).replace(/ /g, '_'))
  return { headers, rows: rows.slice(1) }
}

async function carregarCatalogo(admin: Awaited<ReturnType<typeof createAdminClient>>): Promise<Catalogo> {
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
  }
}

function resolverReferencia(
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

type TabelaExistente = {
  id: string
  codigo_tabela_banco: string | null
  nome: string
  institution_id: string
  promotora_id: string | null
  forma_contrato_id: string
  convenio_id: string | null
  tipo_formalizacao_id: string | null
  com_seguro: boolean | null
  taxa_juros_tipo: string | null
  taxa_juros: number | null
  taxa_juros_min: number | null
  taxa_juros_max: number | null
  observacao: string | null
  id_arw: string | null
}

function encontrarExistente(dados: LinhaAnalisada['dados'], existentes: TabelaExistente[]): TabelaExistente | null {
  // 1º: id do ARW (único por registro), quando presente dos dois lados.
  if (dados.id_arw) {
    const porArw = existentes.find((item) => item.id_arw && normalizarTexto(item.id_arw) === normalizarTexto(dados.id_arw))
    if (porArw) return porArw
  }
  // 2º: identidade IMUTÁVEL da tabela (decisão Bruno 24/08/2026):
  // financeira + convênio + forma de contrato + código no banco.
  // Nome e taxa de juros são atributos atualizáveis — NUNCA entram no
  // cruzamento (no Santander todas as tabelas têm o mesmo nome).
  if (dados.institution_id && dados.codigo_tabela_banco) {
    const porChave = existentes.find(
      (item) =>
        item.institution_id === dados.institution_id &&
        normalizarTexto(item.codigo_tabela_banco) === normalizarTexto(dados.codigo_tabela_banco) &&
        item.forma_contrato_id === dados.forma_contrato_id &&
        String(item.convenio_id || '') === String(dados.convenio_id || '') &&
        String(item.promotora_id || '') === String(dados.promotora_id || ''),
    )
    if (porChave) return porChave
  }
  // Sem id_arw e sem código no banco: não arrisca match — trata como nova.
  return null
}

function montarDiff(dados: LinhaAnalisada['dados'], atual: TabelaExistente, nomes: Map<string, string>): DiffCampo[] {
  const fmtRef = (id: string | null) => (id ? nomes.get(id) || id : '-')
  const fmtSeguro = (valor: boolean | null) => (valor === true ? 'Com seguro' : valor === false ? 'Sem seguro' : '-')
  const fmtTaxa = (valor: number | null) => (valor === null ? '-' : String(valor).replace('.', ','))
  const fmtJuros = (tipo: string | null, fixa: number | null, min: number | null, max: number | null) => {
    if (tipo === 'fixa') return `Fixa ${fmtTaxa(fixa)}%`
    if (tipo === 'faixa') return `Faixa ${fmtTaxa(min)}% a ${fmtTaxa(max)}%`
    return '-'
  }

  const comparacoes: Array<{ campo: string; label: string; atual: string; novo: string }> = [
    { campo: 'codigo_tabela_banco', label: 'Código no banco', atual: String(atual.codigo_tabela_banco || '-'), novo: String(dados.codigo_tabela_banco || '-') },
    { campo: 'nome', label: 'Nome', atual: atual.nome, novo: dados.nome },
    { campo: 'institution_id', label: 'Financeira', atual: fmtRef(atual.institution_id), novo: fmtRef(dados.institution_id) },
    { campo: 'promotora_id', label: 'Promotora', atual: atual.promotora_id ? fmtRef(atual.promotora_id) : 'Direto', novo: dados.promotora_id ? fmtRef(dados.promotora_id) : 'Direto' },
    { campo: 'forma_contrato_id', label: 'Forma de contrato', atual: fmtRef(atual.forma_contrato_id), novo: fmtRef(dados.forma_contrato_id) },
    { campo: 'convenio_id', label: 'Convênio', atual: fmtRef(atual.convenio_id), novo: fmtRef(dados.convenio_id) },
    { campo: 'tipo_formalizacao_id', label: 'Formalização', atual: fmtRef(atual.tipo_formalizacao_id), novo: fmtRef(dados.tipo_formalizacao_id) },
    { campo: 'com_seguro', label: 'Seguro', atual: fmtSeguro(atual.com_seguro), novo: fmtSeguro(dados.com_seguro) },
    {
      campo: 'taxa_juros',
      label: 'Taxa de juros',
      atual: fmtJuros(atual.taxa_juros_tipo, atual.taxa_juros === null ? null : Number(atual.taxa_juros), atual.taxa_juros_min === null ? null : Number(atual.taxa_juros_min), atual.taxa_juros_max === null ? null : Number(atual.taxa_juros_max)),
      novo: fmtJuros(dados.taxa_juros_tipo, dados.taxa_juros, dados.taxa_juros_min, dados.taxa_juros_max),
    },
    { campo: 'observacao', label: 'Observação', atual: String(atual.observacao || '-'), novo: dados.observacao || '-' },
    { campo: 'id_arw', label: 'ID no ARW', atual: String(atual.id_arw || '-'), novo: String(dados.id_arw || '-') },
  ]

  return comparacoes.filter((item) => item.atual !== item.novo)
}

async function analisar(buffer: Buffer, resolucoes: Resolucoes, admin: Awaited<ReturnType<typeof createAdminClient>>) {
  const planilha = lerPlanilha(buffer)
  if (!planilha.headers.length) throw new Error('Arquivo vazio ou sem cabeçalho.')
  if (planilha.rows.length > MAX_LINHAS) throw new Error(`Máximo de ${MAX_LINHAS.toLocaleString('pt-BR')} linhas por arquivo.`)

  // Valida o cabeçalho do modelo (ordem livre; casa por nome).
  const indice = new Map<string, number>()
  planilha.headers.forEach((header, i) => indice.set(header, i))
  const faltando = MODELO_TABELAS_HEADERS.filter((header) => !indice.has(header))
  if (faltando.length > 2) {
    throw new Error(`Cabeçalho não bate com o modelo. Colunas faltando: ${faltando.join(', ')}. Baixe o modelo na tela.`)
  }

  const celula = (row: unknown[], nome: string) => {
    const i = indice.get(nome)
    return i === undefined ? '' : row[i] ?? ''
  }

  const catalogo = await carregarCatalogo(admin)
  const { data: existentesData } = await admin
    .from('tabelas_comissao')
    .select('id, codigo_tabela_banco, nome, institution_id, promotora_id, forma_contrato_id, convenio_id, tipo_formalizacao_id, com_seguro, taxa_juros_tipo, taxa_juros, taxa_juros_min, taxa_juros_max, observacao, id_arw')
    .is('deleted_at', null)
  const existentes = (existentesData || []) as TabelaExistente[]

  // Nomes para o diff.
  const nomes = new Map<string, string>()
  const [fis, convs, promos] = await Promise.all([
    admin.from('financial_institutions').select('id, name'),
    admin.from('convenios').select('id, nome'),
    admin.from('promotoras').select('id, razao_social, nome_fantasia'),
  ])
  for (const row of fis.data || []) nomes.set(String(row.id), String(row.name))
  for (const row of convs.data || []) nomes.set(String(row.id), String(row.nome))
  for (const row of promos.data || []) nomes.set(String(row.id), String(row.nome_fantasia || row.razao_social || row.id))
  const [formasAll, formalizacoesAll] = await Promise.all([
    admin.from('formas_contrato').select('id, nome'),
    admin.from('tipos_formalizacao').select('id, nome'),
  ])
  for (const row of formasAll.data || []) nomes.set(String(row.id), String(row.nome))
  for (const row of formalizacoesAll.data || []) nomes.set(String(row.id), String(row.nome))

  const linhas: LinhaAnalisada[] = []
  for (let i = 0; i < planilha.rows.length; i++) {
    const row = planilha.rows[i]
    if (!Array.isArray(row) || row.every((cell) => String(cell ?? '').trim() === '')) continue
    const n = i + 2 // linha da planilha (1 = cabeçalho)

    const nome = String(celula(row, 'nome') ?? '').trim()
    const financeiraTexto = String(celula(row, 'financeira') ?? '').trim()
    const promotoraTexto = String(celula(row, 'promotora') ?? '').trim()
    const formaTexto = String(celula(row, 'forma_contrato') ?? '').trim()
    const convenioTexto = String(celula(row, 'convenio') ?? '').trim()
    const formalizacaoTexto = String(celula(row, 'tipo_formalizacao') ?? '').trim()

    const jurosTipoTexto = normalizarTexto(celula(row, 'taxa_juros_tipo'))
    const jurosTipo = jurosTipoTexto === 'fixa' ? 'fixa' : jurosTipoTexto === 'faixa' ? 'faixa' : null

    const dados: LinhaAnalisada['dados'] = {
      codigo_tabela_banco: String(celula(row, 'codigo_tabela_banco') ?? '').trim() || null,
      nome,
      financeira_texto: financeiraTexto,
      promotora_texto: promotoraTexto,
      forma_texto: formaTexto,
      convenio_texto: convenioTexto,
      formalizacao_texto: formalizacaoTexto,
      institution_id: resolverReferencia('financeira', financeiraTexto, catalogo, resolucoes),
      promotora_id: promotoraTexto ? resolverReferencia('promotora', promotoraTexto, catalogo, resolucoes) : null,
      forma_contrato_id: resolverReferencia('forma_contrato', formaTexto, catalogo, resolucoes),
      convenio_id: convenioTexto ? resolverReferencia('convenio', convenioTexto, catalogo, resolucoes) : null,
      tipo_formalizacao_id: formalizacaoTexto ? resolverReferencia('tipo_formalizacao', formalizacaoTexto, catalogo, resolucoes) : null,
      com_seguro: parseSeguro(celula(row, 'seguro')),
      taxa_juros_tipo: jurosTipo,
      taxa_juros: jurosTipo === 'fixa' ? parseTaxaPlanilha(celula(row, 'taxa_juros')) : null,
      taxa_juros_min: jurosTipo === 'faixa' ? parseTaxaPlanilha(celula(row, 'taxa_juros_min')) : null,
      taxa_juros_max: jurosTipo === 'faixa' ? parseTaxaPlanilha(celula(row, 'taxa_juros_max')) : null,
      observacao: String(celula(row, 'observacao') ?? '').trim(),
      id_arw: String(celula(row, 'id_arw') ?? '').trim() || null,
    }

    // Validações estruturais.
    if (!nome || !financeiraTexto || !formaTexto) {
      linhas.push({ n, status: 'invalida', erro: 'Nome, financeira e forma de contrato são obrigatórios.', dados, pendencias: [], matchId: null, diff: [] })
      continue
    }

    // Pendências de referência (campo preenchido que não resolveu).
    const pendencias: LinhaAnalisada['pendencias'] = []
    if (!dados.institution_id) pendencias.push({ campo: 'financeira', texto: financeiraTexto, textoNormalizado: normalizarTexto(financeiraTexto) })
    if (promotoraTexto && !dados.promotora_id) pendencias.push({ campo: 'promotora', texto: promotoraTexto, textoNormalizado: normalizarTexto(promotoraTexto) })
    if (!dados.forma_contrato_id) pendencias.push({ campo: 'forma_contrato', texto: formaTexto, textoNormalizado: normalizarTexto(formaTexto) })
    if (convenioTexto && !dados.convenio_id) pendencias.push({ campo: 'convenio', texto: convenioTexto, textoNormalizado: normalizarTexto(convenioTexto) })
    if (formalizacaoTexto && !dados.tipo_formalizacao_id) pendencias.push({ campo: 'tipo_formalizacao', texto: formalizacaoTexto, textoNormalizado: normalizarTexto(formalizacaoTexto) })

    if (pendencias.length > 0) {
      linhas.push({ n, status: 'pendencia', dados, pendencias, matchId: null, diff: [] })
      continue
    }

    const existente = encontrarExistente(dados, existentes)
    if (!existente) {
      linhas.push({ n, status: 'nova', dados, pendencias: [], matchId: null, diff: [] })
      continue
    }

    const diff = montarDiff(dados, existente, nomes)
    linhas.push({
      n,
      status: diff.length === 0 ? 'sem_mudanca' : 'atualizacao',
      dados,
      pendencias: [],
      matchId: existente.id,
      diff,
    })
  }

  const resumo = {
    total: linhas.length,
    novas: linhas.filter((linha) => linha.status === 'nova').length,
    atualizacoes: linhas.filter((linha) => linha.status === 'atualizacao').length,
    semMudanca: linhas.filter((linha) => linha.status === 'sem_mudanca').length,
    pendencias: linhas.filter((linha) => linha.status === 'pendencia').length,
    invalidas: linhas.filter((linha) => linha.status === 'invalida').length,
  }

  return { linhas, resumo }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

    const allowed = await hasPermissionForUser(user.id, 'sistema-config-credito', 'can_include')
    if (!allowed) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })

    const formData = await request.formData()
    const file = formData.get('file')
    const fase = String(formData.get('fase') || 'analisar')
    if (!(file instanceof File)) return NextResponse.json({ error: 'Envie um arquivo CSV ou XLSX.' }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'Arquivo acima de 10MB.' }, { status: 400 })

    let resolucoes: Resolucoes = {}
    try {
      resolucoes = JSON.parse(String(formData.get('resolucoes') || '{}'))
    } catch {
      return NextResponse.json({ error: 'Resoluções inválidas.' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const admin = await createAdminClient()
    const analise = await analisar(buffer, resolucoes, admin)

    if (fase === 'analisar') {
      return NextResponse.json(analise)
    }

    // fase=aplicar — decisão Bruno: tudo resolvido por segurança.
    if (analise.resumo.pendencias > 0 || analise.resumo.invalidas > 0) {
      return NextResponse.json(
        { error: `Ainda há ${analise.resumo.pendencias} pendência(s) e ${analise.resumo.invalidas} linha(s) inválida(s). Resolva tudo antes de aplicar.` },
        { status: 400 },
      )
    }

    let aprovadas: number[] = []
    try {
      aprovadas = JSON.parse(String(formData.get('aprovadas') || '[]'))
    } catch {
      return NextResponse.json({ error: 'Lista de aprovações inválida.' }, { status: 400 })
    }
    const aprovadasSet = new Set(aprovadas.map(Number))

    const agora = new Date().toISOString()
    let criadas = 0
    let atualizadas = 0
    const resultado: Array<{ n: number; acao: string; id?: string }> = []

    for (const linha of analise.linhas) {
      const base = {
        codigo_tabela_banco: linha.dados.codigo_tabela_banco,
        nome: linha.dados.nome,
        institution_id: linha.dados.institution_id!,
        promotora_id: linha.dados.promotora_id,
        forma_contrato_id: linha.dados.forma_contrato_id!,
        convenio_id: linha.dados.convenio_id,
        tipo_formalizacao_id: linha.dados.tipo_formalizacao_id,
        com_seguro: linha.dados.com_seguro,
        taxa_juros_tipo: linha.dados.taxa_juros_tipo,
        taxa_juros: linha.dados.taxa_juros,
        taxa_juros_min: linha.dados.taxa_juros_min,
        taxa_juros_max: linha.dados.taxa_juros_max,
        observacao: linha.dados.observacao,
        id_arw: linha.dados.id_arw,
        updated_at: agora,
      }

      if (linha.status === 'nova') {
        const { data, error } = await admin.from('tabelas_comissao').insert(base).select('id').single()
        if (error) throw error
        criadas += 1
        resultado.push({ n: linha.n, acao: 'criada', id: data?.id })
      } else if (linha.status === 'atualizacao' && linha.matchId && aprovadasSet.has(linha.n)) {
        const { error } = await admin.from('tabelas_comissao').update(base).eq('id', linha.matchId)
        if (error) throw error
        atualizadas += 1
        resultado.push({ n: linha.n, acao: 'atualizada', id: linha.matchId })
      } else if (linha.status === 'atualizacao') {
        resultado.push({ n: linha.n, acao: 'atualizacao_rejeitada', id: linha.matchId || undefined })
      } else {
        resultado.push({ n: linha.n, acao: 'sem_mudanca', id: linha.matchId || undefined })
      }
    }

    // Memoriza os de-paras apontados na tela.
    const aliasRows = Object.entries(resolucoes)
      .map(([chave, alvoId]) => {
        const [tipo, ...resto] = chave.split('::')
        return { tipo, texto_normalizado: resto.join('::'), alvo_id: alvoId, created_by: user.id }
      })
      .filter((row) => row.tipo && row.texto_normalizado && row.alvo_id)
    if (aliasRows.length) {
      await admin.from('comissionamento_import_aliases').upsert(aliasRows, { onConflict: 'tipo,texto_normalizado' })
    }

    await admin.from('comissionamento_imports').insert({
      tipo: 'tabelas',
      arquivo_nome: String(file.name || 'planilha').slice(0, 200),
      total_linhas: analise.resumo.total,
      criadas,
      atualizadas,
      sem_mudanca: analise.resumo.semMudanca,
      resultado,
      criado_por: user.id,
    })

    return NextResponse.json({ criadas, atualizadas, semMudanca: analise.resumo.semMudanca })
  } catch (error: any) {
    console.error('Erro no import de tabelas de comissão:', error)
    return NextResponse.json({ error: String(error?.message || 'Erro inesperado na importação.') }, { status: 500 })
  }
}
