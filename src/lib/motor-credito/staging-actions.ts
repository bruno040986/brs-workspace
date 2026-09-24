'use server'

/**
 * Revisão humana da staging da API Kaizom (`motor_credito_consultas`) —
 * tela /alvoconsig/motor-credito. Permissão `alvoconsig-motor-credito`:
 * view = ver; can_include = aprovar/rejeitar/definir convênio. O envio ao
 * WeSales é a rota POST /api/motor-credito/enviar (D7).
 */
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { normalizarChave } from './parser'

const RESOURCE = 'alvoconsig-motor-credito'
const TELA = '/alvoconsig/motor-credito'
const STATUS_REVISAVEIS = ['pendente', 'aprovada', 'rejeitada', 'erro_envio'] as const

export type StatusStaging = 'pendente' | 'aprovada' | 'rejeitada' | 'falha' | 'enviando' | 'enviada' | 'erro_envio'

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
          porStatus: { pendente: 0, aprovada: 0, rejeitada: 0, falha: 0, enviando: 0, enviada: 0, erro_envio: 0 },
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
      .select('id, mysql_id, tarefa_id, cpf, nome, matricula, convenio_externo, convenio_id, orgao, lotacao, vinculo, mes_referencia, margem_novo_bruta, margem_novo_disp, margem_rmc_bruta, margem_rmc_disp, margem_rcc_bruta, margem_rcc_disp, sucesso, observacao, consultado_em, status, revisado_em, erro_envio, wesales_contact_id')
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
