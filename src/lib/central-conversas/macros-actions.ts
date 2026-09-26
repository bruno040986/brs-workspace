'use server'

/**
 * Macros do Chatwoot (D1, lote 2). Administração (criar/editar/excluir) exige
 * `central-conversas`; listar para uso e EXECUTAR na conversa exige `conversas`
 * (quem atende). Execução assíncrona no Chatwoot: aqui só enfileira.
 * Retorna `{ok:false,error}` em vez de lançar (o Next apaga a mensagem de Error em produção).
 */

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { clienteChatwootBrs } from './actions'
import { montarCorpoMacro, type MacroEntrada } from './macros'

export type MacroChatwoot = {
  id: number
  name: string
  visibility?: string
  actions: Array<{ action_name: string; action_params?: unknown[] }>
}

type Falha = { ok: false; error: string }
const msg = (e: unknown): Falha => ({ ok: false, error: e instanceof Error ? e.message : 'Falha ao falar com o Chatwoot.' })

async function cliente() {
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  return cli
}

async function listar(): Promise<MacroChatwoot[]> {
  const r = await (await cliente()).req<MacroChatwoot[] | { payload: MacroChatwoot[] }>('/macros')
  return Array.isArray(r) ? r : r.payload || []
}

export async function listarMacros(): Promise<{ ok: true; macros: MacroChatwoot[] } | Falha> {
  try {
    await requirePermission('central-conversas', 'can_view')
    return { ok: true, macros: await listar() }
  } catch (e) {
    return msg(e)
  }
}

/** Lista para o botão "Macro" da conversa (só nome/id, sem exigir a permissão de administração). */
export async function listarMacrosParaConversa(): Promise<{ ok: true; macros: Array<{ id: number; name: string }> } | Falha> {
  try {
    await requirePermission('conversas', 'can_view')
    return { ok: true, macros: (await listar()).map((m) => ({ id: m.id, name: m.name })) }
  } catch (e) {
    return msg(e)
  }
}

export async function salvarMacro(id: number | null, entrada: MacroEntrada): Promise<{ ok: true } | Falha> {
  try {
    await requirePermission('central-conversas', 'can_edit')
    const m = montarCorpoMacro(entrada)
    if (!m.ok) return m
    await (await cliente()).req(id ? `/macros/${id}` : '/macros', { method: id ? 'PATCH' : 'POST', body: m.corpo })
    revalidatePath('/central-conversas/macros')
    return { ok: true }
  } catch (e) {
    return msg(e)
  }
}

export async function excluirMacro(id: number): Promise<{ ok: true } | Falha> {
  try {
    await requirePermission('central-conversas', 'can_edit')
    await (await cliente()).req(`/macros/${id}`, { method: 'DELETE' })
    revalidatePath('/central-conversas/macros')
    return { ok: true }
  } catch (e) {
    return msg(e)
  }
}

/** Enfileira a macro na conversa. O Chatwoot executa em segundo plano (Sidekiq): o efeito aparece em instantes. */
export async function executarMacro(macroId: number, conversationId: number): Promise<{ ok: true } | Falha> {
  try {
    await requirePermission('conversas', 'can_view')
    if (!Number.isInteger(macroId) || !Number.isInteger(conversationId)) throw new Error('Macro ou conversa inválida.')
    await (await cliente()).req(`/macros/${macroId}/execute`, { method: 'POST', body: { conversation_ids: [conversationId] } })
    return { ok: true }
  } catch (e) {
    return msg(e)
  }
}
