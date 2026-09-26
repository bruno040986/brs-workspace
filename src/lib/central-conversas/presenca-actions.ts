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

async function conversaDaConta(instanciaId: string, jid: string): Promise<boolean> {
  if (!jid.endsWith('@s.whatsapp.net')) return false
  const conta = await contaBrs()
  if (!conta) return false
  const admin = await createAdminClient()
  const { data } = await admin
    .from('chat_conversas')
    .select('id, chat_instancias!inner(conta_id)')
    .eq('instancia_id', instanciaId)
    .eq('jid', jid)
    .eq('chat_instancias.conta_id', conta.id)
    .limit(1)
    .maybeSingle()
  return Boolean(data)
}

export async function enviarPresencaConversa(instanciaId: string, jid: string, estado: 'composing' | 'recording' | 'paused'): Promise<{ ok: boolean }> {
  try {
    await requirePermission('conversas', 'can_view')
    if (!(await conversaDaConta(instanciaId, jid))) return { ok: false }
    await engine.presenca(instanciaId, { jid, estado })
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

/** Pede ao WhatsApp para nos avisar da presença deste contato (ao abrir a conversa). */
export async function assinarPresencaConversa(instanciaId: string, jid: string): Promise<{ ok: boolean }> {
  try {
    await requirePermission('conversas', 'can_view')
    if (!(await conversaDaConta(instanciaId, jid))) return { ok: false }
    await engine.presenca(instanciaId, { jid, assinar: true })
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
