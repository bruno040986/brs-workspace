'use server'

/**
 * Agendamento de ação por conversa (Fase B §3 da spec) — mensagem ou lembrete
 * interno numa data/hora futura, executado por um worker (não depende do
 * navegador aberto). Lease/claim próprios (`chat_acoes_agendadas_claim`/
 * `_finish`, migration 20260907022722) — desenho igual ao disparo do CRM,
 * TABELA própria (regras do Messenger ≠ CRM, spec §0).
 */
import { revalidatePath } from 'next/cache'
import { requireCurrentUser, requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { contaBrs } from './actions'

export type AcaoAgendada = {
  id: string
  chatwootConversationId: number
  acao: 'mensagem' | 'lembrete_interno'
  texto: string | null
  agendadoPara: string
  status: 'pendente' | 'executado' | 'cancelado' | 'falhou'
  ultimoErro: string | null
  criadoPor: string
}

export async function listarAgendamentos(conversationId: number): Promise<AcaoAgendada[]> {
  await requirePermission('conversas', 'can_view')
  const conta = await contaBrs()
  if (!conta) return []
  const admin = await createAdminClient()
  const { data } = await admin
    .from('chat_acoes_agendadas')
    .select('id, chatwoot_conversation_id, acao, texto, agendado_para, status, ultimo_erro, criado_por')
    .eq('conta_id', conta.id)
    .eq('chatwoot_conversation_id', conversationId)
    .order('agendado_para')
  return (data || []).map((a: any) => ({
    id: String(a.id),
    chatwootConversationId: Number(a.chatwoot_conversation_id),
    acao: a.acao,
    texto: a.texto,
    agendadoPara: a.agendado_para,
    status: a.status,
    ultimoErro: a.ultimo_erro,
    criadoPor: String(a.criado_por),
  }))
}

export async function agendarAcao(input: { conversationId: number; acao: 'mensagem' | 'lembrete_interno'; texto: string; agendadoPara: string }): Promise<{ ok: true }> {
  await requirePermission('conversas', 'can_view')
  const user = await requireCurrentUser()
  const conta = await contaBrs()
  if (!conta) throw new Error('Chatwoot não provisionado.')
  const texto = String(input.texto || '').trim()
  if (!texto) throw new Error('Escreva o texto do agendamento.')
  const quando = new Date(input.agendadoPara)
  if (Number.isNaN(quando.getTime())) throw new Error('Data/hora inválida.')
  if (quando.getTime() <= Date.now()) throw new Error('Agende para um horário no futuro.')

  const admin = await createAdminClient()
  const { error } = await admin.from('chat_acoes_agendadas').insert({
    conta_id: conta.id,
    chatwoot_conversation_id: input.conversationId,
    criado_por: user.id,
    acao: input.acao,
    texto,
    agendado_para: quando.toISOString(),
  })
  if (error) throw error
  revalidatePath('/conversas')
  return { ok: true }
}

export async function cancelarAgendamento(id: string): Promise<{ ok: true }> {
  await requirePermission('conversas', 'can_view')
  const admin = await createAdminClient()
  const { error } = await admin.from('chat_acoes_agendadas').update({ status: 'cancelado' }).eq('id', id).eq('status', 'pendente')
  if (error) throw error
  revalidatePath('/conversas')
  return { ok: true }
}

export async function reagendar(id: string, novaData: string): Promise<{ ok: true }> {
  await requirePermission('conversas', 'can_view')
  const quando = new Date(novaData)
  if (Number.isNaN(quando.getTime()) || quando.getTime() <= Date.now()) throw new Error('Data/hora inválida.')
  const admin = await createAdminClient()
  const { error } = await admin.from('chat_acoes_agendadas').update({ agendado_para: quando.toISOString() }).eq('id', id).eq('status', 'pendente')
  if (error) throw error
  revalidatePath('/conversas')
  return { ok: true }
}
