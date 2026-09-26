'use server'

/**
 * Regras de automação (D6, lote 2) — lista/cria/edita/ativa/exclui no Chatwoot da
 * conta BRS. Permissão `central-conversas` (a do menu; escrita exige can_edit).
 * Retorna `{ok:false,error}` em vez de lançar (o Next apaga a mensagem de Error em produção).
 */

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { clienteChatwootBrs } from './actions'
import { montarCorpoRegra, type RegraEntrada } from './automacoes'

export type RegraChatwoot = {
  id: number
  name: string
  description?: string
  event_name: string
  active: boolean
  conditions: Array<{ attribute_key: string; filter_operator: string; query_operator?: string | null; values?: unknown[] }>
  actions: Array<{ action_name: string; action_params?: unknown[] }>
}

type Falha = { ok: false; error: string }
const msg = (e: unknown): Falha => ({ ok: false, error: e instanceof Error ? e.message : 'Falha ao falar com o Chatwoot.' })

async function cliente() {
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  return cli
}

export async function listarRegras(): Promise<{ ok: true; regras: RegraChatwoot[] } | Falha> {
  try {
    await requirePermission('central-conversas', 'can_view')
    const r = await (await cliente()).req<RegraChatwoot[] | { payload: RegraChatwoot[] }>('/automation_rules')
    return { ok: true, regras: Array.isArray(r) ? r : r.payload || [] }
  } catch (e) {
    return msg(e)
  }
}

export async function salvarRegra(id: number | null, entrada: RegraEntrada): Promise<{ ok: true } | Falha> {
  try {
    await requirePermission('central-conversas', 'can_edit')
    const m = montarCorpoRegra(entrada)
    if (!m.ok) return m
    const cli = await cliente()
    await cli.req(id ? `/automation_rules/${id}` : '/automation_rules', { method: id ? 'PATCH' : 'POST', body: m.corpo })
    revalidatePath('/central-conversas/automacoes')
    return { ok: true }
  } catch (e) {
    return msg(e)
  }
}

export async function ativarRegra(id: number, ativa: boolean): Promise<{ ok: true } | Falha> {
  try {
    await requirePermission('central-conversas', 'can_edit')
    await (await cliente()).req(`/automation_rules/${id}`, { method: 'PATCH', body: { active: ativa } })
    revalidatePath('/central-conversas/automacoes')
    return { ok: true }
  } catch (e) {
    return msg(e)
  }
}

export async function excluirRegra(id: number): Promise<{ ok: true } | Falha> {
  try {
    await requirePermission('central-conversas', 'can_edit')
    await (await cliente()).req(`/automation_rules/${id}`, { method: 'DELETE' })
    revalidatePath('/central-conversas/automacoes')
    return { ok: true }
  } catch (e) {
    return msg(e)
  }
}
