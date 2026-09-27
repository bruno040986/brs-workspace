'use server'

/**
 * WhatsApp Oficial (YCloud) dentro da Central de Atendimento (S1). A UI nunca
 * decide direito de envio nem janela: a janela vem de `lerJanelaConversa`
 * (servidor) e o engine valida janela/template/saldo/opt-out (§5.1).
 */

import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { lerJanelaConversa, listarTemplates, type JanelaConversa, type TemplateYcloud } from '@/lib/ycloud/leitura'
import { contaBrs } from './actions'
import { engine, EngineEnvioIncertoError, mensagemErroEngine } from './engine'
import { ehOperationId, normalizarTelefoneDestino, type ResultadoEnvio } from './envio-intencao'

export type TemplateEnvio = { nome: string; idioma: string; variaveis?: Record<string, string> }

/** Conversa (id do Chatwoot) → linha do espelho, só se for de instância ycloud da conta BRS. */
async function conversaYcloud(conversationId: number) {
  const conta = await contaBrs()
  if (!conta || !Number.isInteger(conversationId)) return null
  const admin = await createAdminClient()
  const { data } = await admin
    .from('chat_conversas')
    .select('id, instancia_id, jid, chat_instancias!inner(conta_id, provedor, deleted_at)')
    .eq('chatwoot_conversation_id', conversationId)
    .eq('chat_instancias.conta_id', conta.id)
    .eq('chat_instancias.provedor', 'ycloud')
    .is('chat_instancias.deleted_at', null)
    .limit(1)
    .maybeSingle()
  return data ? { admin, id: String(data.id), instanciaId: String(data.instancia_id), jid: String(data.jid) } : null
}

export async function getJanelaConversaYcloud(conversationId: number): Promise<{ success: boolean; data?: JanelaConversa; error?: string }> {
  try {
    await requirePermission('conversas', 'can_view')
    const c = await conversaYcloud(conversationId)
    if (!c) return { success: false, error: 'Conversa não encontrada em uma conexão de WhatsApp Oficial.' }
    return { success: true, data: await lerJanelaConversa(c.admin, c.id) }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Falha ao ler a janela da conversa.' }
  }
}

/**
 * Envia template pelo engine. Molde de `iniciarConversaPorTelefone`: operationId
 * vem da UI (1× por intenção), resultado como valor, incerto nunca repete sozinho.
 */
export async function enviarTemplateYcloud(input: {
  conversationId?: number
  instanciaId?: string
  telefone?: string
  template: TemplateEnvio
  operationId: string
}): Promise<ResultadoEnvio> {
  await requirePermission('conversas', 'can_view')
  const rejeitado = (mensagem: string): ResultadoEnvio => ({ resultado: 'rejeitado', mensagem })
  try {
    if (!ehOperationId(input.operationId)) return rejeitado('Chave de envio (operationId) ausente ou inválida.')
    const t = input.template
    if (!t?.nome?.trim() || !t?.idioma?.trim()) return rejeitado('Escolha um template.')
    const variaveis: Record<string, string> = {}
    for (const [k, v] of Object.entries(t.variaveis || {})) variaveis[String(k)] = String(v ?? '')
    const template = { nome: t.nome, idioma: t.idioma, ...(Object.keys(variaveis).length ? { variaveis } : {}) }

    let instanciaId: string
    let destino = ''
    if (input.conversationId != null) {
      const c = await conversaYcloud(input.conversationId)
      if (!c) return rejeitado('Conversa não encontrada em uma conexão de WhatsApp Oficial.')
      instanciaId = c.instanciaId
      destino = normalizarTelefoneDestino(c.jid.startsWith('bsuid:') ? c.jid : c.jid.replace(/@.*$/, ''))
    } else {
      const conta = await contaBrs()
      if (!conta) return rejeitado('Chatwoot não provisionado.')
      const admin = await createAdminClient()
      const { data: inst } = await admin.from('chat_instancias').select('id').eq('id', String(input.instanciaId || '')).eq('conta_id', conta.id).eq('provedor', 'ycloud').is('deleted_at', null).maybeSingle()
      if (!inst) return rejeitado('Conexão de WhatsApp Oficial não encontrada.')
      instanciaId = String(inst.id)
      destino = normalizarTelefoneDestino(String(input.telefone || ''))
    }
    const res = await engine.enviar(instanciaId, destino, '', { operationId: input.operationId, template })
    return { resultado: 'confirmado', conversationId: res.conversationId ?? null }
  } catch (err) {
    if (err instanceof EngineEnvioIncertoError) return { resultado: 'incerto', mensagem: err.message }
    // Antes do POST ou rejeição comprovada (EngineErro): nada saiu.
    return rejeitado(mensagemErroEngine(err))
  }
}

/**
 * Templates APROVADOS da WABA da instância, para o atendente (`conversas`).
 * Conexão e WABA vêm da linha da instância — nunca do cliente.
 */
export async function getTemplatesAprovadosConversa(instanciaId: string): Promise<{ success: boolean; data?: TemplateYcloud[]; error?: string }> {
  try {
    await requirePermission('conversas', 'can_view')
    const conta = await contaBrs()
    const admin = await createAdminClient()
    const { data: inst } = conta
      ? await admin.from('chat_instancias').select('ycloud_conexao_id, ycloud_waba_id').eq('id', String(instanciaId || '')).eq('conta_id', conta.id).eq('provedor', 'ycloud').is('deleted_at', null).maybeSingle()
      : { data: null }
    if (!inst?.ycloud_conexao_id || !inst.ycloud_waba_id) return { success: false, error: 'Instância não encontrada.' }
    return { success: true, data: await listarTemplates(admin, String(inst.ycloud_conexao_id), String(inst.ycloud_waba_id), true) }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Falha ao listar templates.' }
  }
}
