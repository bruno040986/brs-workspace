'use server'

/**
 * Presença (B1, lote 2): "digitando…/gravando…" que o contato vê e o que ele
 * faz que vemos. Mesma permissão `conversas` das demais actions. Best-effort:
 * nunca lança nem mostra erro pro atendente (é só um indicador).
 * A instância/jid vêm do cliente (evita um round-trip ao Chatwoot a cada
 * pulso de digitação), mas SÓ valem se baterem com uma conversa da conta BRS.
 */

import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { contaBrs } from './actions'
import { engine } from './engine'

/**
 * Duas consultas simples (a anterior usava embed PostgREST `chat_instancias!inner` e, ao falhar,
 * devolvia `false` em silêncio — o "digitando" nunca chegou ao engine no teste de 26/09).
 * `motivo` diz por que barrou; vai para o log do servidor.
 */
async function conversaDaConta(instanciaId: string, jid: string): Promise<{ ok: true } | { ok: false; motivo: string }> {
  if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@lid')) return { ok: false, motivo: `jid sem suporte (${jid})` }
  const conta = await contaBrs()
  if (!conta) return { ok: false, motivo: 'conta BRS não provisionada' }
  const admin = await createAdminClient()
  const { data: inst, error: erroInst } = await admin.from('chat_instancias').select('id').eq('id', instanciaId).eq('conta_id', conta.id).is('deleted_at', null).maybeSingle()
  if (erroInst) return { ok: false, motivo: `consulta da instância falhou: ${erroInst.message}` }
  if (!inst) return { ok: false, motivo: 'instância não pertence à conta BRS' }
  const { data: conversa, error: erroConv } = await admin.from('chat_conversas').select('id').eq('instancia_id', instanciaId).eq('jid', jid).limit(1).maybeSingle()
  if (erroConv) return { ok: false, motivo: `consulta da conversa falhou: ${erroConv.message}` }
  if (!conversa) return { ok: false, motivo: 'conversa não encontrada para esta instância/jid' }
  return { ok: true }
}

export async function enviarPresencaConversa(instanciaId: string, jid: string, estado: 'composing' | 'recording' | 'paused'): Promise<{ ok: boolean }> {
  try {
    await requirePermission('conversas', 'can_view')
    const gate = await conversaDaConta(instanciaId, jid)
    if (!gate.ok) {
      console.warn('[presença] envio barrado:', gate.motivo)
      return { ok: false }
    }
    await engine.presenca(instanciaId, { jid, estado })
    return { ok: true }
  } catch (err) {
    console.warn('[presença] envio falhou:', err instanceof Error ? err.message : err)
    return { ok: false }
  }
}

/** Pede ao WhatsApp para nos avisar da presença deste contato (ao abrir a conversa). */
export async function assinarPresencaConversa(instanciaId: string, jid: string): Promise<{ ok: boolean }> {
  try {
    await requirePermission('conversas', 'can_view')
    const gate = await conversaDaConta(instanciaId, jid)
    if (!gate.ok) {
      console.warn('[presença] assinatura barrada:', gate.motivo)
      return { ok: false }
    }
    await engine.presenca(instanciaId, { jid, assinar: true })
    return { ok: true }
  } catch (err) {
    console.warn('[presença] assinatura falhou:', err instanceof Error ? err.message : err)
    return { ok: false }
  }
}
