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
import { requireCurrentUser, requirePermission } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/permissions'
import { CHAT_ATTACHMENT_BUCKET, CHAT_SIGNED_URL_TTL } from '@/lib/chat/attachments'
import type { HelpdeskAnexo, HelpdeskTicket } from './tipos'
import { validarHelpdeskTicket, type HelpdeskTicketEntrada } from './validacao'

type AnexoLinha = { id: string; path: string; nome: string; tamanho: number; tipo: string }

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
      .select('*, helpdesk_anexos(id, path, nome, tamanho, tipo)')
      .order('urgente', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(300)
    if (error) throw error

    const autores = [...new Set((data || []).map((t) => String(t.aberto_por)))]
    const { data: usuarios } = autores.length
      ? await admin.from('users').select('id, name').in('id', autores)
      : { data: [] as Array<{ id: string; name: string | null }> }
    const nomePorId = new Map((usuarios || []).map((u) => [String(u.id), String(u.name || '')]))

    // Bucket privado: assina todos os anexos numa chamada só (a tela não vê o path).
    const paths = (data || []).flatMap((t) => ((t.helpdesk_anexos || []) as AnexoLinha[]).map((a) => a.path))
    const { data: assinadas } = paths.length
      ? await admin.storage.from(CHAT_ATTACHMENT_BUCKET).createSignedUrls(paths, CHAT_SIGNED_URL_TTL)
      : { data: [] }
    const urlPorPath = new Map((assinadas || []).map((a) => [String(a.path), a.signedUrl || '']))

    void user
    return {
      success: true,
      podeAprovar: hasPermission(permissions, 'helpdesk-aprovar', 'can_edit'),
      data: (data || []).map(({ helpdesk_anexos, ...t }) => ({
        ...(t as Omit<HelpdeskTicket, 'aberto_por_nome' | 'anexos'>),
        aberto_por_nome: nomePorId.get(String(t.aberto_por)) || '—',
        anexos: ((helpdesk_anexos || []) as AnexoLinha[]).map(
          (a): HelpdeskAnexo => ({ id: a.id, nome: a.nome, tipo: a.tipo, tamanho: Number(a.tamanho) || 0, url: urlPorPath.get(a.path) || '' }),
        ),
      })) as HelpdeskTicket[],
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao listar tickets.' }
  }
}

export async function abrirHelpdeskTicket(
  input: HelpdeskTicketEntrada,
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const { user } = await requirePermission('helpdesk-abrir', 'can_include')
    const v = validarHelpdeskTicket(input, user.id)
    if (!v.ok) throw new Error(v.error)

    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('helpdesk_tickets')
      .insert({ ...v.dados.ticket, aberto_por: user.id })
      .select('id')
      .single()
    if (error) throw error
    const id = String(data.id)

    if (v.dados.anexos.length) {
      const { error: erroAnexos } = await admin
        .from('helpdesk_anexos')
        .insert(v.dados.anexos.map((a) => ({ ...a, ticket_id: id, enviado_por: user.id })))
      if (erroAnexos) {
        // sem os anexos o ticket fica incompleto: desfaz (cascade) e o usuário reenvia
        const { error: erroNotif } = await admin
          .from('workspace_notifications')
          .delete()
          .eq('entity_type', 'helpdesk_ticket')
          .eq('entity_id', id)
          .eq('type', 'helpdesk_aberto')
        const { error: erroDel } = await admin.from('helpdesk_tickets').delete().eq('id', id)
        if (erroNotif || erroDel) console.error('[helpdesk] rollback do ticket falhou', { id, erroNotif, erroDel })
        throw new Error('Não foi possível salvar as imagens. Tente abrir o ticket de novo.')
      }
    }
    revalidatePath('/helpdesk')
    return { success: true, id }
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
