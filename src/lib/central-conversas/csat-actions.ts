'use server'

/**
 * Pesquisa de satisfação (D4, lote 2). Config e relatório exigem `central-conversas`
 * (escrita: can_edit). Retorna `{ok:false,error}` em vez de lançar.
 */

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { clienteChatwootBrs } from './actions'
import { CSAT_BOTAO_PADRAO, CSAT_MENSAGEM_PADRAO, montarConfigCsat, resumirCsat, type CsatEntrada, type RespostaCsat, type ResumoCsat } from './csat'

type Falha = { ok: false; error: string }
const msg = (e: unknown): Falha => ({ ok: false, error: e instanceof Error ? e.message : 'Falha ao falar com o Chatwoot.' })

async function cliente() {
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  return cli
}

type InboxChatwoot = { id: number; name: string; channel_type?: string; csat_survey_enabled?: boolean; csat_config?: { display_type?: string; message?: string; button_text?: string } | null }
export type CsatCaixa = { id: number; nome: string; ativa: boolean; tipo: string; mensagem: string; botao: string }

export async function listarCsat(): Promise<{ ok: true; caixas: CsatCaixa[] } | Falha> {
  try {
    await requirePermission('central-conversas', 'can_view')
    const r = await (await cliente()).req<{ payload: InboxChatwoot[] } | InboxChatwoot[]>('/inboxes')
    const lista = Array.isArray(r) ? r : r.payload || []
    return {
      ok: true,
      caixas: lista.map((i) => ({
        id: i.id,
        nome: i.name,
        ativa: Boolean(i.csat_survey_enabled),
        tipo: i.csat_config?.display_type === 'star' ? 'star' : 'emoji',
        mensagem: i.csat_config?.message || CSAT_MENSAGEM_PADRAO,
        botao: i.csat_config?.button_text || CSAT_BOTAO_PADRAO,
      })),
    }
  } catch (e) {
    return msg(e)
  }
}

export async function salvarCsat(inboxId: number, entrada: CsatEntrada): Promise<{ ok: true } | Falha> {
  try {
    await requirePermission('central-conversas', 'can_edit')
    if (!Number.isInteger(inboxId)) throw new Error('Caixa de entrada inválida.')
    const m = montarConfigCsat(entrada)
    if (!m.ok) return m
    await (await cliente()).req(`/inboxes/${inboxId}`, { method: 'PATCH', body: m.corpo })
    revalidatePath('/central-conversas/pesquisa-satisfacao')
    return { ok: true }
  } catch (e) {
    return msg(e)
  }
}

/** Respostas dos últimos `dias` (até 5 páginas) + resumo. `since`/`until` em segundos Unix, como nos relatórios do Chatwoot. */
export async function respostasCsat(dias: number, inboxId?: number): Promise<{ ok: true; respostas: RespostaCsat[]; resumo: ResumoCsat } | Falha> {
  try {
    await requirePermission('central-conversas', 'can_view')
    const cli = await cliente()
    const ate = Math.floor(Date.now() / 1000)
    const desde = ate - Math.min(Math.max(Math.floor(dias) || 30, 1), 365) * 86400
    const respostas: RespostaCsat[] = []
    for (let pagina = 1; pagina <= 5; pagina++) {
      const q = new URLSearchParams({ since: String(desde), until: String(ate), page: String(pagina) })
      if (inboxId) q.set('inbox_id', String(inboxId))
      const r = await cli.req<RespostaCsat[] | { payload: RespostaCsat[] }>(`/csat_survey_responses?${q.toString()}`)
      const lote = Array.isArray(r) ? r : r.payload || []
      respostas.push(...lote)
      if (lote.length < 25) break
    }
    return { ok: true, respostas, resumo: resumirCsat(respostas) }
  } catch (e) {
    return msg(e)
  }
}
