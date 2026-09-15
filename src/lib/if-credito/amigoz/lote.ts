/**
 * Lotes de higienização de margem no Amigoz (Fatia 2). SÓ servidor.
 *
 * Mesmo desenho do worker de lotes NVTI (src/lib/nvti/worker.ts): lock por
 * lote com renovação, "kick" ao criar/retomar + Vercel Cron como rede de
 * segurança, estado persistido item a item (timeout no meio não perde nada).
 *
 * Diferença chave: a API do Amigoz é 1 consulta por vez, sem paralelismo —
 * o worker processa os itens em SÉRIE, com uma pausa configurável entre
 * chamadas (o Bruno pediu isso pra não sobrecarregar a API deles).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/server'
import { cifrarTexto, decifrarTexto } from '@/lib/central-conversas/cofre'
import { normalizeCpf, validateCpf } from '@/lib/import/columnMap'
import { carregarConfigAmigoz, obterInstituicaoAmigoz } from './client'
import { consultarMargemComVariantes } from './margem'

export type OrigemLote = 'unitaria' | 'csv' | 'wesales'
export type StatusLote = 'pendente' | 'rodando' | 'pausado' | 'concluido' | 'erro' | 'cancelado'

export type ItemEntrada = {
  cpf: string
  nome?: string | null
  telefone?: string | null
  matricula?: string | null
  senhaServidor?: string | null
  wesalesContactId?: string | null
}

export type LoteResumo = {
  id: string
  origem: OrigemLote
  status: StatusLote
  convenioId: string | null
  /** @deprecated informativo — desde que um convênio pode ter várias variantes, a resolução real é feita por item (ver `convenioExternoUsado` em ItemResumo). */
  convenioExternoId: string | null
  averbadoraExterna: number | null
  totalItens: number
  itensProcessados: number
  itensComMargem: number
  itensErro: number
  pausaMs: number
  arquivoNome: string | null
  lastError: string | null
  createdAt: string
  concluidoEm: string | null
}

function mapLote(row: Record<string, unknown>): LoteResumo {
  return {
    id: String(row.id),
    origem: row.origem as OrigemLote,
    status: row.status as StatusLote,
    convenioId: row.convenio_id ? String(row.convenio_id) : null,
    convenioExternoId: row.convenio_externo_id ? String(row.convenio_externo_id) : null,
    averbadoraExterna: row.averbadora_externa === null ? null : Number(row.averbadora_externa),
    totalItens: Number(row.total_itens) || 0,
    itensProcessados: Number(row.itens_processados) || 0,
    itensComMargem: Number(row.itens_com_margem) || 0,
    itensErro: Number(row.itens_erro) || 0,
    pausaMs: Number(row.pausa_ms) || 1500,
    arquivoNome: row.arquivo_nome ? String(row.arquivo_nome) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: String(row.created_at),
    concluidoEm: row.concluido_em ? String(row.concluido_em) : null,
  }
}

/**
 * Cria o lote (sem itens ainda), preso a um convênio BRS. A resolução de
 * QUAL variante do Amigoz usar é feita pelo worker, item a item (o convênio
 * pode ter várias — ver `consultarMargemComVariantes`). `convenioExternoId`/
 * `averbadoraExterna` são só informativos (1ª variante, pra exibição).
 */
export async function criarLote(input: {
  origem: OrigemLote
  convenioId: string
  convenioExternoId?: string | null
  averbadoraExterna?: number | null
  pausaMs?: number
  arquivoNome?: string | null
  filtroWesales?: Record<string, unknown> | null
  criadoPor: string
}): Promise<string> {
  const inst = await obterInstituicaoAmigoz()
  if (!inst) throw new Error('Amigoz não está cadastrada em Instituições Financeiras.')
  const admin = await createAdminClient()
  const { data, error } = await admin
    .from('if_higienizacao_lotes')
    .insert({
      instituicao_financeira_id: inst.id,
      convenio_id: input.convenioId,
      convenio_externo_id: input.convenioExternoId ?? null,
      averbadora_externa: input.averbadoraExterna ?? null,
      origem: input.origem,
      pausa_ms: Math.min(Math.max(input.pausaMs ?? 1500, 500), 60_000),
      arquivo_nome: input.arquivoNome ?? null,
      filtro_wesales: input.filtroWesales ?? null,
      criado_por: input.criadoPor,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(error?.message || 'Falha ao criar o lote.')
  return String(data.id)
}

/** Adiciona itens ao lote (chunks de 500), dedupe por CPF, valida DV. Devolve o total inserido e descartado. */
export async function adicionarItens(
  loteId: string,
  itens: ItemEntrada[]
): Promise<{ inseridos: number; invalidos: number; duplicados: number }> {
  const admin = await createAdminClient()
  const vistos = new Set<string>()
  let invalidos = 0
  let duplicados = 0

  const linhas: Array<Record<string, unknown>> = []
  let ordem = 0
  for (const item of itens) {
    const cpf = normalizeCpf(String(item.cpf || ''))
    if (!validateCpf(cpf)) {
      invalidos += 1
      continue
    }
    if (vistos.has(cpf)) {
      duplicados += 1
      continue
    }
    vistos.add(cpf)
    ordem += 1
    linhas.push({
      lote_id: loteId,
      ordem,
      cpf,
      nome: item.nome?.trim() || null,
      telefone: item.telefone?.trim() || null,
      matricula: item.matricula?.trim() || null,
      senha_servidor_enc: item.senhaServidor?.trim() ? cifrarTexto(item.senhaServidor.trim()) : null,
      wesales_contact_id: item.wesalesContactId || null,
    })
  }

  const TAMANHO_CHUNK = 500
  for (let i = 0; i < linhas.length; i += TAMANHO_CHUNK) {
    const chunk = linhas.slice(i, i + TAMANHO_CHUNK)
    const { error } = await admin.from('if_higienizacao_itens').insert(chunk)
    if (error) throw new Error(`Falha ao gravar itens do lote: ${error.message}`)
  }

  if (linhas.length > 0) {
    await admin.from('if_higienizacao_lotes').update({ total_itens: linhas.length }).eq('id', loteId)
  }

  return { inseridos: linhas.length, invalidos, duplicados }
}

/** Marca o lote pronto pra rodar e aciona o worker (o cron é a rede de segurança). */
export async function iniciarLote(loteId: string): Promise<void> {
  const admin = await createAdminClient()
  await admin
    .from('if_higienizacao_lotes')
    .update({ status: 'pendente', iniciado_em: new Date().toISOString() })
    .eq('id', loteId)
    .in('status', ['pendente', 'erro'])
  await kickHigienizacaoWorker()
}

export async function pausarLote(loteId: string): Promise<void> {
  const admin = await createAdminClient()
  await admin.from('if_higienizacao_lotes').update({ status: 'pausado' }).eq('id', loteId).in('status', ['pendente', 'rodando'])
}

export async function retomarLote(loteId: string): Promise<void> {
  const admin = await createAdminClient()
  await admin.from('if_higienizacao_lotes').update({ status: 'pendente' }).eq('id', loteId).eq('status', 'pausado')
  await kickHigienizacaoWorker()
}

export async function cancelarLote(loteId: string): Promise<void> {
  const admin = await createAdminClient()
  await admin.from('if_higienizacao_lotes').update({ status: 'cancelado' }).eq('id', loteId).in('status', ['pendente', 'rodando', 'pausado'])
}

export async function obterLote(loteId: string): Promise<LoteResumo | null> {
  const admin = await createAdminClient()
  const { data } = await admin.from('if_higienizacao_lotes').select('*').eq('id', loteId).maybeSingle()
  return data ? mapLote(data) : null
}

export async function listarLotes(limite = 30): Promise<LoteResumo[]> {
  const inst = await obterInstituicaoAmigoz()
  if (!inst) return []
  const admin = await createAdminClient()
  const { data } = await admin
    .from('if_higienizacao_lotes')
    .select('*')
    .eq('instituicao_financeira_id', inst.id)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limite, 1), 100))
  return (data || []).map(mapLote)
}

export type ItemResumo = {
  id: string
  ordem: number
  cpf: string
  nome: string | null
  status: string
  erro: string | null
  nomeIf: string | null
  matriculaIf: string | null
  margemConsignado: number | null
  margemBeneficioCompra: number | null
  margemBeneficioSaque: number | null
  margemBeneficio: number | null
  margemEmprestimo: number | null
  temOportunidade: boolean | null
  wesalesContactId: string | null
  nvtiEnviadoEm: string | null
  wesalesAtualizadoEm: string | null
  consultadoEm: string | null
  convenioExternoUsado: string | null
}

function mapItem(row: Record<string, unknown>): ItemResumo {
  return {
    id: String(row.id),
    ordem: Number(row.ordem),
    cpf: String(row.cpf),
    nome: row.nome ? String(row.nome) : null,
    status: String(row.status),
    erro: row.erro ? String(row.erro) : null,
    nomeIf: row.nome_if ? String(row.nome_if) : null,
    matriculaIf: row.matricula_if ? String(row.matricula_if) : null,
    convenioExternoUsado: row.convenio_externo_usado ? String(row.convenio_externo_usado) : null,
    margemConsignado: row.margem_consignado === null ? null : Number(row.margem_consignado),
    margemBeneficioCompra: row.margem_beneficio_compra === null ? null : Number(row.margem_beneficio_compra),
    margemBeneficioSaque: row.margem_beneficio_saque === null ? null : Number(row.margem_beneficio_saque),
    margemBeneficio: row.margem_beneficio === null ? null : Number(row.margem_beneficio),
    margemEmprestimo: row.margem_emprestimo === null ? null : Number(row.margem_emprestimo),
    temOportunidade: row.tem_oportunidade === null ? null : Boolean(row.tem_oportunidade),
    wesalesContactId: row.wesales_contact_id ? String(row.wesales_contact_id) : null,
    nvtiEnviadoEm: row.nvti_enviado_em ? String(row.nvti_enviado_em) : null,
    wesalesAtualizadoEm: row.wesales_atualizado_em ? String(row.wesales_atualizado_em) : null,
    consultadoEm: row.consultado_em ? String(row.consultado_em) : null,
  }
}

export async function listarItensLote(loteId: string, limite = 500): Promise<ItemResumo[]> {
  const admin = await createAdminClient()
  const { data } = await admin
    .from('if_higienizacao_itens')
    .select('*')
    .eq('lote_id', loteId)
    .order('ordem', { ascending: true })
    .limit(Math.min(Math.max(limite, 1), 5000))
  return (data || []).map(mapItem)
}

// ---------------------------------------------------------------------------
// Worker — 1 consulta por vez, respeitando a pausa configurada no lote.
// ---------------------------------------------------------------------------

const LOCK_SECONDS = 180
const RENEW_EVERY_ITEMS = 5
const RETENTATIVA_MS = 10_000

export type ResumoWorker = {
  lotesTocados: number
  itensProcessados: number
  workRemains: boolean
  stoppedReason?: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function workerIdentity(): string {
  return `if-hig-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
}

async function claimNextLote(admin: SupabaseClient, workerId: string): Promise<Record<string, unknown> | null> {
  const nowIso = new Date().toISOString()
  const until = new Date(Date.now() + LOCK_SECONDS * 1000).toISOString()

  const { data: candidatos } = await admin
    .from('if_higienizacao_lotes')
    .select('*')
    .in('status', ['pendente', 'rodando'])
    .or(`worker_lock_until.is.null,worker_lock_until.lt.${nowIso}`)
    .order('created_at', { ascending: true })
    .limit(5)

  for (const candidato of candidatos || []) {
    const { data: preso } = await admin
      .from('if_higienizacao_lotes')
      .update({ worker_lock_until: until, worker_lock_by: workerId, status: 'rodando' })
      .eq('id', candidato.id)
      .or(`worker_lock_until.is.null,worker_lock_until.lt.${nowIso}`)
      .select('*')
      .maybeSingle()
    if (preso) return preso
  }
  return null
}

async function renovarLock(admin: SupabaseClient, loteId: string, workerId: string): Promise<boolean> {
  const { data } = await admin
    .from('if_higienizacao_lotes')
    .update({ worker_lock_until: new Date(Date.now() + LOCK_SECONDS * 1000).toISOString() })
    .eq('id', loteId)
    .eq('worker_lock_by', workerId)
    .select('id')
    .maybeSingle()
  return Boolean(data)
}

async function liberarLote(admin: SupabaseClient, loteId: string, workerId: string, patch: Record<string, unknown>): Promise<void> {
  await admin
    .from('if_higienizacao_lotes')
    .update({ ...patch, worker_lock_until: null, worker_lock_by: null })
    .eq('id', loteId)
    .eq('worker_lock_by', workerId)
}

/** Status atual do lote direto do banco — pra notar pausa/cancelamento pedidos no meio do processamento. */
async function statusAtual(admin: SupabaseClient, loteId: string): Promise<StatusLote | null> {
  const { data } = await admin.from('if_higienizacao_lotes').select('status').eq('id', loteId).maybeSingle()
  return (data?.status as StatusLote) ?? null
}

export async function runHigienizacaoAmigozWorker(options: { budgetMs?: number; workerId?: string } = {}): Promise<ResumoWorker> {
  const budgetMs = Math.max(10_000, options.budgetMs ?? 265_000)
  const deadline = Date.now() + budgetMs
  const workerId = options.workerId || workerIdentity()
  const admin = await createAdminClient()

  const resumo: ResumoWorker = { lotesTocados: 0, itensProcessados: 0, workRemains: false }

  while (Date.now() < deadline - 15_000) {
    const lote = await claimNextLote(admin, workerId)
    if (!lote) break
    resumo.lotesTocados += 1

    const loteId = String(lote.id)
    const convenioId = lote.convenio_id ? String(lote.convenio_id) : null
    const pausaMs = Number(lote.pausa_ms) || 1500
    let itensProcessados = Number(lote.itens_processados) || 0
    let itensComMargem = Number(lote.itens_com_margem) || 0
    let itensErro = Number(lote.itens_erro) || 0
    let sinceRenew = 0
    let primeiroItem = true
    let interrompidoPor: StatusLote | null = null

    if (!convenioId) {
      await admin
        .from('if_higienizacao_itens')
        .update({ status: 'erro', erro: 'Lote sem convênio.' })
        .eq('lote_id', loteId)
        .eq('status', 'pendente')
      await liberarLote(admin, loteId, workerId, { status: 'erro', last_error: 'Lote sem convênio.' })
      continue
    }

    loteLoop: while (true) {
      if (Date.now() > deadline - 15_000) {
        await liberarLote(admin, loteId, workerId, { itens_processados: itensProcessados, itens_com_margem: itensComMargem, itens_erro: itensErro })
        resumo.workRemains = true
        resumo.stoppedReason = 'budget'
        return resumo
      }

      const status = await statusAtual(admin, loteId)
      if (status === 'pausado' || status === 'cancelado') {
        interrompidoPor = status
        break loteLoop
      }

      const { data: itens } = await admin
        .from('if_higienizacao_itens')
        .select('id, cpf, matricula, senha_servidor_enc')
        .eq('lote_id', loteId)
        .eq('status', 'pendente')
        .order('ordem', { ascending: true })
        .limit(1)

      const item = itens?.[0]
      if (!item) break

      if (!primeiroItem) await sleep(pausaMs)
      primeiroItem = false

      sinceRenew += 1
      if (sinceRenew >= RENEW_EVERY_ITEMS) {
        sinceRenew = 0
        const dono = await renovarLock(admin, loteId, workerId)
        if (!dono) {
          resumo.stoppedReason = 'lock_lost'
          resumo.workRemains = true
          return resumo
        }
      }

      await admin.from('if_higienizacao_itens').update({ status: 'processando' }).eq('id', item.id)

      // Cfg fresca a cada item: token pode ter sido renovado por outra
      // chamada dentro do próprio loop (ver client.ts) — evita usar um
      // access token expirado que o objeto em memória não saberia atualizar.
      let cfg
      try {
        cfg = await carregarConfigAmigoz()
      } catch (err) {
        await liberarLote(admin, loteId, workerId, {
          status: 'erro',
          last_error: err instanceof Error ? err.message : 'Configuração do Amigoz indisponível.',
          itens_processados: itensProcessados,
          itens_com_margem: itensComMargem,
          itens_erro: itensErro,
        })
        resumo.stoppedReason = 'config'
        return resumo
      }

      const senhaServidor = item.senha_servidor_enc ? decifrarTexto(item.senha_servidor_enc) : null

      const resultado = await consultarMargemComVariantes(
        cfg,
        convenioId,
        { cpf: item.cpf, numeroMatricula: item.matricula || undefined, senhaServidor: senhaServidor || undefined },
        undefined,
        RETENTATIVA_MS
      )

      if (resultado.ok) {
        const m = resultado.margem
        await admin
          .from('if_higienizacao_itens')
          .update({
            status: m.temOportunidade ? 'ok' : 'sem_margem',
            erro: null,
            nome_if: m.nomeIf,
            nascimento_if: m.nascimentoIf,
            ocupacao_if: m.ocupacaoIf,
            matricula_if: m.matriculaIf,
            estavel: m.estavel,
            margem_consignado: m.margemConsignado,
            margem_beneficio_compra: m.margemBeneficioCompra,
            margem_beneficio_saque: m.margemBeneficioSaque,
            margem_beneficio: m.margemBeneficio,
            margem_emprestimo: m.margemEmprestimo,
            tem_oportunidade: m.temOportunidade,
            resposta_bruta: resultado.bruto as never,
            convenio_externo_usado: resultado.varianteUsada?.convenioExternoId ?? null,
            averbadora_usada: resultado.varianteUsada?.averbadoraExterna ?? null,
            consultado_em: new Date().toISOString(),
          })
          .eq('id', item.id)
        if (m.temOportunidade) itensComMargem += 1
      } else {
        await admin
          .from('if_higienizacao_itens')
          .update({
            status: 'erro',
            erro: resultado.mensagem.slice(0, 500),
            tentativas: 2,
            resposta_bruta: (resultado.bruto ?? null) as never,
            convenio_externo_usado: resultado.varianteUsada?.convenioExternoId ?? null,
            averbadora_usada: resultado.varianteUsada?.averbadoraExterna ?? null,
            consultado_em: new Date().toISOString(),
          })
          .eq('id', item.id)
        itensErro += 1
      }

      itensProcessados += 1
      resumo.itensProcessados += 1
      await admin
        .from('if_higienizacao_lotes')
        .update({ itens_processados: itensProcessados, itens_com_margem: itensComMargem, itens_erro: itensErro })
        .eq('id', loteId)
    }

    if (interrompidoPor) {
      await liberarLote(admin, loteId, workerId, { itens_processados: itensProcessados, itens_com_margem: itensComMargem, itens_erro: itensErro })
    } else {
      await liberarLote(admin, loteId, workerId, {
        status: 'concluido',
        concluido_em: new Date().toISOString(),
        itens_processados: itensProcessados,
        itens_com_margem: itensComMargem,
        itens_erro: itensErro,
      })
    }
  }

  if (!resumo.workRemains) {
    const { count } = await admin.from('if_higienizacao_lotes').select('id', { count: 'exact', head: true }).in('status', ['pendente', 'rodando'])
    resumo.workRemains = (count ?? 0) > 0
  }

  return resumo
}

/** Aciona o worker imediatamente (o cron é a rede de segurança). */
export async function kickHigienizacaoWorker(): Promise<void> {
  try {
    const secret = String(process.env.CRON_SECRET || '')
    if (!secret) return
    const { getAppBaseUrl } = await import('@/lib/zapi/webhooks')
    const url = `${getAppBaseUrl()}/api/cron/if-higienizacao?kick=1`
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(2500),
      cache: 'no-store',
    }).catch(() => undefined)
  } catch {
    // silencioso: o cron é a rede de segurança
  }
}
