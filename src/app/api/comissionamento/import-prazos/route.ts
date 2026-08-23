/**
 * Importador — PASSO 2: Prazos Comissão (a MESMA planilha do passo 1).
 *
 * Cada linha localiza a Tabela de Comissão pela identidade natural
 * (financeira + promotora + forma + convênio + código no banco — as mesmas
 * colunas que a cadastraram no passo 1) e usa as colunas específicas de
 * prazo. Aqui a repetição da tabela é o esperado: cada linha é um prazo.
 * Tabela não encontrada = linha inválida ("rode o passo 1 primeiro").
 *
 * Match p/ atualização: tabela + prazo_inicial/final + faixa de valores.
 * Aplicar grava o número de lote em lote_importacao (coluna do grid).
 * Exige sistema-config-credito (can_include).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { hasPermissionForUser } from '@/lib/auth/server'
import {
  normalizarTexto,
  parseDataPlanilha,
  parseFormaPagamentoPlanilha,
  parseSimNao,
  parseIntPlanilha,
  parseTaxaPlanilha,
  type CampoReferencia,
  type DiffCampo,
  type PendenciaLinha,
  type Resolucoes,
} from '@/lib/comissionamento-import'
import { formaPagamentoLabel, formaPagamentoUsaFaixa } from '@/lib/comissionamento'
import {
  carregarCatalogo,
  lerPlanilha,
  resolverReferencia,
  salvarAliases,
  type Catalogo,
} from '@/lib/comissionamento-import-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_LINHAS = 20_000

const COLUNAS_PRAZO_OBRIGATORIAS = ['prazo_inicial', 'prazo_final', 'comissao'] as const

type TabelaRef = {
  id: string
  codigo: number
  nome: string
  codigo_tabela_banco: string | null
  institution_id: string
  promotora_id: string | null
  forma_contrato_id: string
  convenio_id: string | null
}

type PrazoExistente = {
  id: string
  tabela_comissao_id: string
  forma_pagamento: string
  valor_inicial: number | null
  valor_final: number | null
  prazo_inicial: number
  prazo_final: number
  data_base: string | null
  data_bloqueio: string | null
  manter_enquadramento: boolean
  comissao: number | null
  emissao: number | null
  seguro: number | null
  forma_pagamento_seguro: string | null
  id_arw: string | null
}

type DadosPrazo = {
  tabela_comissao_id: string | null
  forma_pagamento: string | null
  valor_inicial: number | null
  valor_final: number | null
  prazo_inicial: number | null
  prazo_final: number | null
  data_base: string | null
  data_bloqueio: string | null
  manter_enquadramento: boolean
  comissao: number | null
  emissao: number | null
  seguro: number | null
  forma_pagamento_seguro: string | null
}

type LinhaPrazo = {
  n: number
  status: 'nova' | 'atualizacao' | 'sem_mudanca' | 'pendencia' | 'invalida' | 'repetida'
  erro?: string
  descricao: string
  pendencias: PendenciaLinha[]
  matchId: string | null
  diff: DiffCampo[]
  dados: DadosPrazo
}

function numeroIgual(a: number | null, b: number | null) {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return Math.abs(Number(a) - Number(b)) < 0.005
}

function chaveIdentidadePrazo(dados: DadosPrazo) {
  return [dados.tabela_comissao_id, dados.prazo_inicial, dados.prazo_final, dados.valor_inicial ?? '', dados.valor_final ?? ''].join('|')
}

function fmtNum(valor: number | null) {
  return valor === null ? '-' : String(valor).replace('.', ',')
}

function fmtData(valor: string | null) {
  if (!valor) return '-'
  const [y, m, d] = valor.split('-')
  return `${d}/${m}/${y}`
}

function montarDiffPrazo(dados: DadosPrazo, atual: PrazoExistente): DiffCampo[] {
  const comparacoes: DiffCampo[] = [
    { campo: 'forma_pagamento', label: 'Forma de pagamento', atual: formaPagamentoLabel(atual.forma_pagamento), novo: formaPagamentoLabel(dados.forma_pagamento) },
    { campo: 'data_base', label: 'Data base', atual: fmtData(atual.data_base), novo: fmtData(dados.data_base) },
    { campo: 'data_bloqueio', label: 'Data bloqueio', atual: fmtData(atual.data_bloqueio), novo: fmtData(dados.data_bloqueio) },
    { campo: 'manter_enquadramento', label: 'Manter enquadramento', atual: atual.manter_enquadramento ? 'Sim' : 'Não', novo: dados.manter_enquadramento ? 'Sim' : 'Não' },
    { campo: 'comissao', label: 'Comissão', atual: fmtNum(atual.comissao === null ? null : Number(atual.comissao)), novo: fmtNum(dados.comissao) },
    { campo: 'emissao', label: 'Emissão', atual: fmtNum(atual.emissao === null ? null : Number(atual.emissao)), novo: fmtNum(dados.emissao) },
    { campo: 'seguro', label: 'Seguro', atual: fmtNum(atual.seguro === null ? null : Number(atual.seguro)), novo: fmtNum(dados.seguro) },
    { campo: 'forma_pagamento_seguro', label: 'Forma pagto. seguro', atual: atual.forma_pagamento_seguro || '-', novo: dados.forma_pagamento_seguro || '-' },
  ]
  return comparacoes.filter((item) => item.atual !== item.novo)
}

async function analisar(buffer: Buffer, resolucoes: Resolucoes, admin: Awaited<ReturnType<typeof createAdminClient>>) {
  const planilha = lerPlanilha(buffer)
  if (!planilha.headers.length) throw new Error('Arquivo vazio ou sem cabeçalho.')
  if (planilha.rows.length > MAX_LINHAS) throw new Error(`Máximo de ${MAX_LINHAS.toLocaleString('pt-BR')} linhas por arquivo.`)

  const indice = new Map<string, number>()
  planilha.headers.forEach((header, i) => indice.set(header, i))
  const faltando = COLUNAS_PRAZO_OBRIGATORIAS.filter((header) => !indice.has(header))
  if (faltando.length > 0) {
    throw new Error(`Colunas de prazo faltando no arquivo: ${faltando.join(', ')}. Use o mesmo modelo do passo 1 (layout completo).`)
  }

  const celula = (row: unknown[], nome: string) => {
    const i = indice.get(nome)
    return i === undefined ? '' : row[i] ?? ''
  }

  const catalogo: Catalogo = await carregarCatalogo(admin)
  const [{ data: tabelasData }, { data: prazosData }] = await Promise.all([
    admin
      .from('tabelas_comissao')
      .select('id, codigo, nome, codigo_tabela_banco, institution_id, promotora_id, forma_contrato_id, convenio_id')
      .is('deleted_at', null),
    admin
      .from('prazos_comissao')
      .select('id, tabela_comissao_id, forma_pagamento, valor_inicial, valor_final, prazo_inicial, prazo_final, data_base, data_bloqueio, manter_enquadramento, comissao, emissao, seguro, forma_pagamento_seguro, id_arw'),
  ])
  const tabelas = (tabelasData || []) as TabelaRef[]
  const prazosExistentes = (prazosData || []) as PrazoExistente[]

  function localizarTabela(institutionId: string | null, promotoraId: string | null, formaId: string | null, convenioId: string | null, codigoBanco: string | null): TabelaRef | null {
    if (!institutionId || !codigoBanco) return null
    return (
      tabelas.find(
        (item) =>
          item.institution_id === institutionId &&
          normalizarTexto(item.codigo_tabela_banco) === normalizarTexto(codigoBanco) &&
          item.forma_contrato_id === formaId &&
          String(item.convenio_id || '') === String(convenioId || '') &&
          String(item.promotora_id || '') === String(promotoraId || ''),
      ) || null
    )
  }

  const linhas: LinhaPrazo[] = []
  const identidadesVistas = new Set<string>()

  for (let i = 0; i < planilha.rows.length; i++) {
    const row = planilha.rows[i]
    if (!Array.isArray(row) || row.every((cell) => String(cell ?? '').trim() === '')) continue
    const n = i + 2

    const financeiraTexto = String(celula(row, 'financeira') ?? '').trim()
    const promotoraTexto = String(celula(row, 'promotora') ?? '').trim()
    const formaTexto = String(celula(row, 'forma_contrato') ?? '').trim()
    const convenioTexto = String(celula(row, 'convenio') ?? '').trim()
    const codigoBanco = String(celula(row, 'codigo_tabela_banco') ?? '').trim() || null

    const institutionId = resolverReferencia('financeira', financeiraTexto, catalogo, resolucoes)
    const promotoraId = promotoraTexto ? resolverReferencia('promotora', promotoraTexto, catalogo, resolucoes) : null
    const formaId = resolverReferencia('forma_contrato', formaTexto, catalogo, resolucoes)
    const convenioId = convenioTexto ? resolverReferencia('convenio', convenioTexto, catalogo, resolucoes) : null

    const formaPagamento = parseFormaPagamentoPlanilha(celula(row, 'forma_pagamento'))
    const usaFaixa = formaPagamentoUsaFaixa(formaPagamento)

    const dados: DadosPrazo = {
      tabela_comissao_id: null,
      forma_pagamento: formaPagamento,
      valor_inicial: usaFaixa ? parseTaxaPlanilha(celula(row, 'valor_inicial')) : null,
      valor_final: usaFaixa ? parseTaxaPlanilha(celula(row, 'valor_final')) : null,
      prazo_inicial: parseIntPlanilha(celula(row, 'prazo_inicial')),
      prazo_final: parseIntPlanilha(celula(row, 'prazo_final')),
      data_base: parseDataPlanilha(celula(row, 'data_base')),
      data_bloqueio: parseDataPlanilha(celula(row, 'data_bloqueio')),
      manter_enquadramento: parseSimNao(celula(row, 'manter_enquadramento'), true),
      comissao: parseTaxaPlanilha(celula(row, 'comissao')),
      emissao: parseTaxaPlanilha(celula(row, 'emissao')),
      seguro: parseTaxaPlanilha(celula(row, 'seguro_valor')),
      forma_pagamento_seguro: (() => {
        const texto = normalizarTexto(celula(row, 'forma_pagamento_seguro'))
        if (texto.includes('percentual')) return 'percentual'
        if (texto.includes('fixo')) return 'fixo'
        return null
      })(),
    }

    const descricaoBase = `${financeiraTexto || '?'} · cód. ${codigoBanco || '?'} · ${convenioTexto || 'sem convênio'}${promotoraTexto ? ` · via ${promotoraTexto}` : ''}`
    const descricao = `${descricaoBase} — prazo ${dados.prazo_inicial ?? '?'} a ${dados.prazo_final ?? '?'} — comissão ${fmtNum(dados.comissao)}`

    // Pendências de referência.
    const pendencias: PendenciaLinha[] = []
    if (financeiraTexto && !institutionId) pendencias.push({ campo: 'financeira' as CampoReferencia, texto: financeiraTexto, textoNormalizado: normalizarTexto(financeiraTexto) })
    if (promotoraTexto && !promotoraId) pendencias.push({ campo: 'promotora' as CampoReferencia, texto: promotoraTexto, textoNormalizado: normalizarTexto(promotoraTexto) })
    if (formaTexto && !formaId) pendencias.push({ campo: 'forma_contrato' as CampoReferencia, texto: formaTexto, textoNormalizado: normalizarTexto(formaTexto) })
    if (convenioTexto && !convenioId) pendencias.push({ campo: 'convenio' as CampoReferencia, texto: convenioTexto, textoNormalizado: normalizarTexto(convenioTexto) })
    if (pendencias.length > 0) {
      linhas.push({ n, status: 'pendencia', descricao, pendencias, matchId: null, diff: [], dados })
      continue
    }

    // Validações estruturais.
    if (!formaPagamento) {
      linhas.push({ n, status: 'invalida', erro: 'Forma de pagamento inválida (use percentual, fixo, faixa_percentual, faixa_fixo ou 1-4).', descricao, pendencias: [], matchId: null, diff: [], dados })
      continue
    }
    if (dados.prazo_inicial === null || dados.prazo_final === null || dados.prazo_final < dados.prazo_inicial) {
      linhas.push({ n, status: 'invalida', erro: 'Prazos inválidos (prazo_final deve ser ≥ prazo_inicial).', descricao, pendencias: [], matchId: null, diff: [], dados })
      continue
    }
    if (usaFaixa && (dados.valor_inicial === null || dados.valor_final === null)) {
      linhas.push({ n, status: 'invalida', erro: 'Forma por faixa exige valor_inicial e valor_final.', descricao, pendencias: [], matchId: null, diff: [], dados })
      continue
    }

    const tabela = localizarTabela(institutionId, promotoraId, formaId, convenioId, codigoBanco)
    if (!tabela) {
      linhas.push({ n, status: 'invalida', erro: 'Tabela de Comissão não encontrada com essa combinação (financeira + promotora + forma + convênio + código no banco). Rode primeiro o passo 1 — Tabelas.', descricao, pendencias: [], matchId: null, diff: [], dados })
      continue
    }
    dados.tabela_comissao_id = tabela.id

    // Dedupe dentro do arquivo (mesmo prazo da mesma tabela duas vezes).
    const identidade = chaveIdentidadePrazo(dados)
    if (identidadesVistas.has(identidade)) {
      linhas.push({ n, status: 'repetida', descricao, pendencias: [], matchId: null, diff: [], dados })
      continue
    }
    identidadesVistas.add(identidade)

    // Match: tabela + intervalo de prazos + faixa de valores.
    const existente = prazosExistentes.find(
      (item) =>
        item.tabela_comissao_id === tabela.id &&
        Number(item.prazo_inicial) === dados.prazo_inicial &&
        Number(item.prazo_final) === dados.prazo_final &&
        numeroIgual(item.valor_inicial === null ? null : Number(item.valor_inicial), dados.valor_inicial) &&
        numeroIgual(item.valor_final === null ? null : Number(item.valor_final), dados.valor_final),
    )

    if (!existente) {
      linhas.push({ n, status: 'nova', descricao, pendencias: [], matchId: null, diff: [], dados })
      continue
    }

    const diff = montarDiffPrazo(dados, existente)
    linhas.push({ n, status: diff.length === 0 ? 'sem_mudanca' : 'atualizacao', descricao, pendencias: [], matchId: existente.id, diff, dados })
  }

  const resumo = {
    total: linhas.length,
    novas: linhas.filter((linha) => linha.status === 'nova').length,
    atualizacoes: linhas.filter((linha) => linha.status === 'atualizacao').length,
    semMudanca: linhas.filter((linha) => linha.status === 'sem_mudanca').length,
    pendencias: linhas.filter((linha) => linha.status === 'pendencia').length,
    invalidas: linhas.filter((linha) => linha.status === 'invalida').length,
    repetidas: linhas.filter((linha) => linha.status === 'repetida').length,
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

    // Cria o log ANTES para obter o número de lote curto.
    const { data: logRow, error: logError } = await admin
      .from('comissionamento_imports')
      .insert({
        tipo: 'prazos',
        arquivo_nome: String(file.name || 'planilha').slice(0, 200),
        total_linhas: analise.resumo.total,
        criado_por: user.id,
      })
      .select('id, codigo')
      .single()
    if (logError || !logRow) throw logError || new Error('Falha ao registrar a importação.')
    const lote = String(logRow.codigo)

    const agora = new Date().toISOString()
    let criadas = 0
    let atualizadas = 0
    const resultado: Array<{ n: number; acao: string; id?: string }> = []

    for (const linha of analise.linhas) {
      if (linha.status === 'repetida') {
        resultado.push({ n: linha.n, acao: 'repetida' })
        continue
      }

      const base = {
        tabela_comissao_id: linha.dados.tabela_comissao_id!,
        forma_pagamento: linha.dados.forma_pagamento!,
        valor_inicial: linha.dados.valor_inicial,
        valor_final: linha.dados.valor_final,
        prazo_inicial: linha.dados.prazo_inicial!,
        prazo_final: linha.dados.prazo_final!,
        data_base: linha.dados.data_base,
        data_bloqueio: linha.dados.data_bloqueio,
        manter_enquadramento: linha.dados.manter_enquadramento,
        comissao: linha.dados.comissao,
        emissao: linha.dados.emissao,
        seguro: linha.dados.seguro,
        forma_pagamento_seguro: linha.dados.forma_pagamento_seguro,
        lote_importacao: lote,
        updated_at: agora,
      }

      if (linha.status === 'nova') {
        const { data, error } = await admin.from('prazos_comissao').insert(base).select('id').single()
        if (error) throw error
        criadas += 1
        resultado.push({ n: linha.n, acao: 'criada', id: data?.id })
      } else if (linha.status === 'atualizacao' && linha.matchId && aprovadasSet.has(linha.n)) {
        const { error } = await admin.from('prazos_comissao').update(base).eq('id', linha.matchId)
        if (error) throw error
        atualizadas += 1
        resultado.push({ n: linha.n, acao: 'atualizada', id: linha.matchId })
      } else if (linha.status === 'atualizacao') {
        resultado.push({ n: linha.n, acao: 'atualizacao_rejeitada', id: linha.matchId || undefined })
      } else {
        resultado.push({ n: linha.n, acao: 'sem_mudanca', id: linha.matchId || undefined })
      }
    }

    await salvarAliases(admin, resolucoes, user.id)

    await admin
      .from('comissionamento_imports')
      .update({
        criadas,
        atualizadas,
        sem_mudanca: analise.resumo.semMudanca + analise.resumo.repetidas,
        resultado,
      })
      .eq('id', logRow.id)

    return NextResponse.json({ criadas, atualizadas, semMudanca: analise.resumo.semMudanca, repetidas: analise.resumo.repetidas, lote })
  } catch (error: any) {
    console.error('Erro no import de prazos comissão:', error)
    return NextResponse.json({ error: String(error?.message || 'Erro inesperado na importação.') }, { status: 500 })
  }
}
