'use server'

/**
 * Revisão humana da staging da API Kaizom (`motor_credito_consultas`) —
 * tela /alvoconsig/motor-credito. Permissão `alvoconsig-motor-credito`:
 * view = ver; can_include = aprovar/rejeitar/definir convênio. O envio ao
 * WeSales é a rota POST /api/motor-credito/enviar (D7).
 */
import { revalidatePath } from 'next/cache'
import { hasPermissionForUser, requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { comConcorrenciaLimitada, CONCORRENCIA_WESALES } from '@/lib/alvoconsig/margem-wesales'
import { findContactByCpf } from '@/lib/wesales/client'
import { getNvtiConfig } from '@/lib/nvti/config'
import { costForCount, currentMonthRange } from '@/lib/nvti/pricing'
import { kickNvtiWorker } from '@/lib/nvti/worker'
import { normalizarChave } from './parser'

const RESOURCE = 'alvoconsig-motor-credito'
const TELA = '/alvoconsig/motor-credito'
const STATUS_REVISAVEIS = ['pendente', 'aprovada', 'rejeitada', 'sem_cadastro', 'erro_envio'] as const
/** Permissão de quem pode gastar consulta NVTI (mesma da tela Higienização NVTI). */
const RESOURCE_NVTI = 'operacional-nvti'

export type StatusStaging = 'pendente' | 'aprovada' | 'rejeitada' | 'falha' | 'sem_cadastro' | 'enviando' | 'enviada' | 'erro_envio'

export type LoteKaizom = {
  tarefaId: number | null
  convenioExterno: string | null
  convenioId: string | null
  convenioNome: string | null
  consultadoEm: string | null
  total: number
  porStatus: Record<StatusStaging, number>
}

export type LinhaStaging = {
  id: string
  mysql_id: number
  tarefa_id: number | null
  cpf: string | null
  nome: string | null
  matricula: string | null
  convenio_externo: string | null
  convenio_id: string | null
  orgao: string | null
  lotacao: string | null
  vinculo: string | null
  mes_referencia: string | null
  margem_novo_bruta: number | null
  margem_novo_disp: number | null
  margem_rmc_bruta: number | null
  margem_rmc_disp: number | null
  margem_rcc_bruta: number | null
  margem_rcc_disp: number | null
  sucesso: boolean
  observacao: string | null
  consultado_em: string | null
  status: StatusStaging
  revisado_em: string | null
  erro_envio: string | null
  wesales_contact_id: string | null
  wesales_verificado_em: string | null
}

export type ConvenioOpcao = { id: string; nome: string; nome_reduzido: string; codigo_motor_credito: string | null }

type Resp<T = undefined> = { success: boolean; data?: T; error?: string }

function erro<T>(err: unknown): Resp<T> {
  return { success: false, error: err instanceof Error ? err.message : String(err) }
}

/** Convênios ativos pro seletor da revisão — permissão própria (quem revisa margem não precisa ver Gestão de Leads inteira). */
export async function listarConveniosParaRevisao(): Promise<Resp<ConvenioOpcao[]>> {
  try {
    await requirePermission(RESOURCE)
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('convenios')
      .select('id, nome, nome_reduzido, codigo_motor_credito')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('nome', { ascending: true })
    if (error) throw error
    return { success: true, data: (data || []) as ConvenioOpcao[] }
  } catch (err) {
    return erro(err)
  }
}

/** Lotes (tarefa_id) com contadores por status — agregação em memória. ponytail: staging é pequena; virar RPC se passar de dezenas de milhares de linhas. */
export async function listarLotesKaizom(): Promise<Resp<LoteKaizom[]>> {
  try {
    await requirePermission(RESOURCE)
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('motor_credito_consultas')
      .select('tarefa_id, status, convenio_externo, convenio_id, consultado_em, convenios(nome_reduzido, nome)')
      .order('mysql_id', { ascending: false })
      .limit(20000)
    if (error) throw error
    type LinhaAgregada = { tarefa_id: number | null; status: StatusStaging; convenio_externo: string | null; convenio_id: string | null; consultado_em: string | null; convenios: { nome_reduzido: string | null; nome: string | null } | null }
    const lotes = new Map<string, LoteKaizom>()
    for (const r of (data || []) as unknown as LinhaAgregada[]) {
      const chave = String(r.tarefa_id ?? 'sem-tarefa')
      let lote = lotes.get(chave)
      if (!lote) {
        lote = {
          tarefaId: r.tarefa_id ?? null,
          convenioExterno: r.convenio_externo ?? null,
          convenioId: r.convenio_id ?? null,
          convenioNome: r.convenios?.nome_reduzido || r.convenios?.nome || null,
          consultadoEm: r.consultado_em ?? null,
          total: 0,
          porStatus: { pendente: 0, aprovada: 0, rejeitada: 0, falha: 0, sem_cadastro: 0, enviando: 0, enviada: 0, erro_envio: 0 },
        }
        lotes.set(chave, lote)
      }
      lote.total += 1
      lote.porStatus[r.status as StatusStaging] = (lote.porStatus[r.status as StatusStaging] || 0) + 1
      if (!lote.convenioId && r.convenio_id) {
        lote.convenioId = r.convenio_id
        lote.convenioNome = r.convenios?.nome_reduzido || r.convenios?.nome || null
      }
    }
    return { success: true, data: [...lotes.values()] }
  } catch (err) {
    return erro(err)
  }
}

export async function listarLinhasKaizom(tarefaId: number | null, status?: StatusStaging): Promise<Resp<LinhaStaging[]>> {
  try {
    await requirePermission(RESOURCE)
    const admin = await createAdminClient()
    let q = admin
      .from('motor_credito_consultas')
      .select('id, mysql_id, tarefa_id, cpf, nome, matricula, convenio_externo, convenio_id, orgao, lotacao, vinculo, mes_referencia, margem_novo_bruta, margem_novo_disp, margem_rmc_bruta, margem_rmc_disp, margem_rcc_bruta, margem_rcc_disp, sucesso, observacao, consultado_em, status, revisado_em, erro_envio, wesales_contact_id, wesales_verificado_em')
      .order('mysql_id', { ascending: true })
      .limit(5000)
    q = tarefaId === null ? q.is('tarefa_id', null) : q.eq('tarefa_id', tarefaId)
    if (status) q = q.eq('status', status)
    const { data, error } = await q
    if (error) throw error
    return { success: true, data: (data || []) as LinhaStaging[] }
  } catch (err) {
    return erro(err)
  }
}

/**
 * Aprovar/rejeitar linhas. Só mexe em pendente/aprovada/rejeitada/erro_envio —
 * falha (D4), enviando e enviada não mudam por aqui. Aprovar exige convênio
 * casado em TODAS as linhas selecionadas.
 */
export async function revisarLinhasKaizom(ids: string[], decisao: 'aprovada' | 'rejeitada'): Promise<Resp<{ alteradas: number }>> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_include')
    const lista = [...new Set(ids.filter(Boolean))].slice(0, 5000)
    if (!lista.length) throw new Error('Selecione ao menos uma linha.')
    const admin = await createAdminClient()
    if (decisao === 'aprovada') {
      const { count } = await admin.from('motor_credito_consultas').select('id', { count: 'exact', head: true }).in('id', lista).is('convenio_id', null)
      if (count) throw new Error(`${count} linha(s) sem convênio — defina o convênio do lote antes de aprovar.`)
    }
    const { data, error } = await admin
      .from('motor_credito_consultas')
      .update({ status: decisao, revisado_por: user.id, revisado_em: new Date().toISOString(), erro_envio: null })
      .in('id', lista)
      .in('status', [...STATUS_REVISAVEIS])
      .select('id')
    if (error) throw error
    revalidatePath(TELA)
    return { success: true, data: { alteradas: data?.length ?? 0 } }
  } catch (err) {
    return erro(err)
  }
}

/**
 * Convênio por lote (D1 caminho c): aplica a todas as linhas ainda não
 * enviadas do `tarefa_id`. Com `lembrar`, grava o de-para em
 * `convenios.codigo_motor_credito` (normalizado) pra o leitor casar sozinho
 * nos próximos lotes desse convênio.
 */
export async function definirConvenioLoteKaizom(tarefaId: number, convenioId: string, lembrar: boolean): Promise<Resp<{ alteradas: number }>> {
  try {
    await requirePermission(RESOURCE, 'can_include')
    const admin = await createAdminClient()
    const { data: conv, error: convErr } = await admin.from('convenios').select('id, codigo_motor_credito').eq('id', convenioId).is('deleted_at', null).maybeSingle()
    if (convErr) throw convErr
    if (!conv) throw new Error('Convênio não encontrado.')

    const { data, error } = await admin
      .from('motor_credito_consultas')
      .update({ convenio_id: convenioId })
      .eq('tarefa_id', tarefaId)
      .in('status', [...STATUS_REVISAVEIS, 'falha'])
      .select('convenio_externo')
    if (error) throw error

    if (lembrar) {
      const externo = (data || []).map((r: { convenio_externo: string | null }) => normalizarChave(r.convenio_externo)).find(Boolean)
      if (!externo) throw new Error('Convênio do lote definido, mas a Kaizom não mandou o nome do convênio nestas linhas — não há o que lembrar.')
      const { error: upErr } = await admin.from('convenios').update({ codigo_motor_credito: externo }).eq('id', convenioId)
      if (upErr) {
        if (String(upErr.code) === '23505') throw new Error(`Convênio do lote definido, mas "${externo}" já está vinculado a outro convênio — ajuste em Convênios.`)
        throw upErr
      }
    }
    revalidatePath(TELA)
    return { success: true, data: { alteradas: data?.length ?? 0 } }
  } catch (err) {
    return erro(err)
  }
}

/**
 * "Verificar cadastros no WeSales" (só no clique): pra cada linha ainda não
 * enviada do lote, busca o CPF no WeSales e grava `wesales_contact_id` +
 * carimbo. Não cria nada, não gasta NVTI. `sem_cadastro` que agora tem
 * contato volta pra `pendente` (precisa ser aprovada de novo).
 */
export async function verificarCadastrosKaizom(tarefaId: number | null): Promise<Resp<{ verificadas: number; cadastradas: number; semCadastro: number }>> {
  try {
    await requirePermission(RESOURCE, 'can_include')
    const admin = await createAdminClient()
    let q = admin
      .from('motor_credito_consultas')
      .select('id, cpf, status')
      .in('status', ['pendente', 'aprovada', 'sem_cadastro', 'erro_envio'])
      .not('cpf', 'is', null)
      .limit(5000)
    q = tarefaId === null ? q.is('tarefa_id', null) : q.eq('tarefa_id', tarefaId)
    const { data, error } = await q
    if (error) throw error
    const linhas = (data || []) as Array<{ id: string; cpf: string; status: StatusStaging }>
    const agora = new Date().toISOString()
    let cadastradas = 0
    await comConcorrenciaLimitada(
      linhas.map((l) => async () => {
        const contato = await findContactByCpf(l.cpf)
        if (contato) cadastradas += 1
        const patch: Record<string, unknown> = { wesales_contact_id: contato?.id || null, wesales_verificado_em: agora }
        if (contato && l.status === 'sem_cadastro') Object.assign(patch, { status: 'pendente', erro_envio: null })
        await admin.from('motor_credito_consultas').update(patch).eq('id', l.id)
      }),
      CONCORRENCIA_WESALES,
    )
    revalidatePath(TELA)
    return { success: true, data: { verificadas: linhas.length, cadastradas, semCadastro: linhas.length - cadastradas } }
  } catch (err) {
    return erro(err)
  }
}

export type EstimativaNvti = { candidatos: number; custoEstimado: number; podeSubmeter: boolean; nvtiAtiva: boolean }

/** Quantos CPFs verificados e sem cadastro há no lote, quanto custaria na NVTI (cascata do mês) e se o usuário pode submeter. */
export async function estimarNvtiKaizom(tarefaId: number | null): Promise<Resp<EstimativaNvti>> {
  try {
    const { user } = await requirePermission(RESOURCE)
    const admin = await createAdminClient()
    let q = admin
      .from('motor_credito_consultas')
      .select('id', { count: 'exact', head: true })
      .not('wesales_verificado_em', 'is', null)
      .is('wesales_contact_id', null)
      .not('cpf', 'is', null)
      .in('status', ['pendente', 'aprovada', 'sem_cadastro', 'erro_envio'])
    q = tarefaId === null ? q.is('tarefa_id', null) : q.eq('tarefa_id', tarefaId)
    const { count, error } = await q
    if (error) throw error
    const candidatos = count ?? 0
    const [config, podeSubmeter] = await Promise.all([getNvtiConfig(), hasPermissionForUser(user.id, RESOURCE_NVTI, 'can_include')])
    const { start, end } = currentMonthRange()
    const { count: cobradasMes } = await admin.from('nvti_queries').select('id', { count: 'exact', head: true }).eq('billed', true).gte('created_at', start).lt('created_at', end)
    const base = cobradasMes ?? 0
    const custoEstimado = costForCount(config.price_tiers, base + candidatos) - costForCount(config.price_tiers, base)
    return { success: true, data: { candidatos, custoEstimado, podeSubmeter, nvtiAtiva: Boolean(config.has_credentials && config.is_active) } }
  } catch (err) {
    return erro(err)
  }
}

/**
 * Submete os CPFs verificados e sem cadastro do lote a um lote NVTI
 * (`nvti_batches` + worker, mesmo caminho da Higienização Amigoz). Exige a
 * permissão da NVTI — é gasto. Depois que o lote rodar, o operador clica
 * "Verificar cadastros" de novo e as linhas passam a ter contato.
 */
export async function submeterNvtiKaizom(tarefaId: number | null): Promise<Resp<{ enviados: number }>> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_include')
    if (!(await hasPermissionForUser(user.id, RESOURCE_NVTI, 'can_include'))) throw new Error('Sem permissão pra consultar a NVTI (Higienização NVTI › incluir).')
    const admin = await createAdminClient()
    let q = admin
      .from('motor_credito_consultas')
      .select('cpf, convenio_id')
      .not('wesales_verificado_em', 'is', null)
      .is('wesales_contact_id', null)
      .not('cpf', 'is', null)
      .in('status', ['pendente', 'aprovada', 'sem_cadastro', 'erro_envio'])
      .limit(5000)
    q = tarefaId === null ? q.is('tarefa_id', null) : q.eq('tarefa_id', tarefaId)
    const { data, error } = await q
    if (error) throw error
    const cpfs = [...new Set((data || []).map((r: { cpf: string }) => r.cpf))]
    if (!cpfs.length) throw new Error('Nenhum CPF verificado e sem cadastro neste lote — clique em "Verificar cadastros" antes.')
    const convenioId = (data || []).find((r: { convenio_id: string | null }) => r.convenio_id)?.convenio_id || null

    const { data: batch, error: batchError } = await admin
      .from('nvti_batches')
      .insert({ file_name: `API Kaizom — tarefa ${tarefaId ?? '?'}`, convenio_id: convenioId, created_by: user.id, total: cpfs.length })
      .select('id')
      .single()
    if (batchError || !batch) throw new Error(batchError?.message || 'Falha ao criar o lote NVTI.')
    for (let i = 0; i < cpfs.length; i += 500) {
      const { error: itemError } = await admin.from('nvti_batch_items').insert(cpfs.slice(i, i + 500).map((cpf) => ({ batch_id: batch.id, cpf })))
      if (itemError) throw new Error(`Falha ao gravar itens do lote NVTI: ${itemError.message}`)
    }
    await kickNvtiWorker()
    revalidatePath(TELA)
    return { success: true, data: { enviados: cpfs.length } }
  } catch (err) {
    return erro(err)
  }
}
