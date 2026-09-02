'use server'

/**
 * HelpDesk do grupo — server actions da tela /helpdesk.
 * Permissões: `helpdesk-abrir` (abrir e acompanhar tickets) e
 * `helpdesk-aprovar` (aprovar/rejeitar plano proposto). A investigação e a
 * execução dos tickets rodam POR FORA (sessão Claude agendada, service
 * role); as notificações do sino são trigger no banco — nada a fazer aqui.
 */

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireCurrentUser, requirePermission, getEffectivePermissionsForUser } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/permissions'
import { HELPDESK_SISTEMAS, type HelpdeskSistema, type HelpdeskTicket } from './tipos'

export async function listarHelpdeskTickets(): Promise<{
  success: boolean
  data?: HelpdeskTicket[]
  podeAprovar?: boolean
  error?: string
}> {
  try {
    const { user, permissions } = await requirePermission('helpdesk-abrir')
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('helpdesk_tickets')
      .select('*')
      .order('urgente', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(300)
    if (error) throw error

    const autores = [...new Set((data || []).map((t) => String(t.aberto_por)))]
    const { data: usuarios } = autores.length
      ? await admin.from('users').select('id, name').in('id', autores)
      : { data: [] as Array<{ id: string; name: string | null }> }
    const nomePorId = new Map((usuarios || []).map((u) => [String(u.id), String(u.name || '')]))

    void user
    return {
      success: true,
      podeAprovar: hasPermission(permissions, 'helpdesk-aprovar', 'can_edit'),
      data: (data || []).map((t) => ({
        ...(t as Omit<HelpdeskTicket, 'aberto_por_nome'>),
        aberto_por_nome: nomePorId.get(String(t.aberto_por)) || '—',
      })) as HelpdeskTicket[],
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao listar tickets.' }
  }
}

export async function abrirHelpdeskTicket(input: {
  titulo: string
  descricao: string
  url?: string
  menu_contexto?: string
  sistema: HelpdeskSistema
  urgente?: boolean
}): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const { user } = await requirePermission('helpdesk-abrir', 'can_include')
    const titulo = String(input.titulo || '').trim()
    if (!titulo) throw new Error('Dê um título ao ticket.')
    if (!HELPDESK_SISTEMAS.some((s) => s.id === input.sistema)) throw new Error('Escolha o sistema.')

    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('helpdesk_tickets')
      .insert({
        titulo: titulo.slice(0, 200),
        descricao: String(input.descricao || '').trim().slice(0, 8000),
        url: String(input.url || '').trim().slice(0, 500),
        menu_contexto: String(input.menu_contexto || '').trim().slice(0, 200),
        sistema: input.sistema,
        urgente: Boolean(input.urgente),
        aberto_por: user.id,
      })
      .select('id')
      .single()
    if (error) throw error
    revalidatePath('/helpdesk')
    return { success: true, id: String(data.id) }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao abrir ticket.' }
  }
}

/** Aprovar ou rejeitar um plano proposto (só quem tem helpdesk-aprovar). */
export async function decidirHelpdeskPlano(input: {
  ticketId: string
  decisao: 'aprovar' | 'rejeitar'
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermission('helpdesk-aprovar', 'can_edit')
    const admin = await createAdminClient()
    const { data: ticket } = await admin
      .from('helpdesk_tickets')
      .select('id, status')
      .eq('id', input.ticketId)
      .maybeSingle()
    if (!ticket) throw new Error('Ticket não encontrado.')
    if (ticket.status !== 'plano_proposto') throw new Error('Este ticket não está aguardando aprovação de plano.')

    const agora = new Date().toISOString()
    const { error } = await admin
      .from('helpdesk_tickets')
      .update(
        input.decisao === 'aprovar'
          ? { status: 'aprovado', aprovado_por: user.id, aprovado_em: agora }
          : { status: 'rejeitado', aprovado_por: user.id, aprovado_em: agora, concluido_em: agora },
      )
      .eq('id', input.ticketId)
    if (error) throw error
    revalidatePath('/helpdesk')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao registrar a decisão.' }
  }
}

/** Rejeitar um ticket em qualquer estado anterior a concluído (aprovador). */
export async function rejeitarHelpdeskTicket(ticketId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermission('helpdesk-aprovar', 'can_edit')
    const admin = await createAdminClient()
    const { data: ticket } = await admin.from('helpdesk_tickets').select('id, status').eq('id', ticketId).maybeSingle()
    if (!ticket) throw new Error('Ticket não encontrado.')
    if (ticket.status === 'concluido' || ticket.status === 'rejeitado') throw new Error('Ticket já encerrado.')
    const agora = new Date().toISOString()
    const { error } = await admin
      .from('helpdesk_tickets')
      .update({ status: 'rejeitado', aprovado_por: user.id, aprovado_em: agora, concluido_em: agora })
      .eq('id', ticketId)
    if (error) throw error
    revalidatePath('/helpdesk')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao rejeitar.' }
  }
}

// util para a tela saber quem é o usuário logado (destacar "meus tickets")
export async function getMeuIdHelpdesk(): Promise<string> {
  try {
    const user = await requireCurrentUser()
    return user.id
  } catch {
    return ''
  }
}
