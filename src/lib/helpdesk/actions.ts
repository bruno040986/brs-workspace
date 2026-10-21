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
import type { HelpdeskAnexo, HelpdeskComentario, HelpdeskHistorico, HelpdeskTicket } from './tipos'
import {
  podeReabrir,
  validarComentario,
  validarHelpdeskTicket,
  validarMotivoReabertura,
  type HelpdeskTicketEntrada,
} from './validacao'

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
    // Atômico: só grava se AINDA está em plano_proposto (outro aprovador ou a rotina podem ter mudado).
    const { data, error } = await admin
      .from('helpdesk_tickets')
      .update(
        input.decisao === 'aprovar'
          ? { status: 'aprovado', aprovado_por: user.id, aprovado_em: agora }
          : { status: 'rejeitado', aprovado_por: user.id, aprovado_em: agora, concluido_em: agora },
      )
      .eq('id', input.ticketId)
      .eq('status', 'plano_proposto')
      .select('id')
    if (error) throw error
    if (data?.length !== 1) throw new Error('O ticket mudou de status enquanto você decidia. Atualize a tela e confira.')
    revalidatePath('/helpdesk')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao registrar a decisão.' }
  }
}

const REJEITAVEIS = ['aberto', 'plano_proposto', 'aprovado', 'em_execucao']

/** Rejeitar um ticket em qualquer estado anterior a concluído (aprovador). */
export async function rejeitarHelpdeskTicket(ticketId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermission('helpdesk-aprovar', 'can_edit')
    const admin = await createAdminClient()
    const { data: ticket } = await admin.from('helpdesk_tickets').select('id, status').eq('id', ticketId).maybeSingle()
    if (!ticket) throw new Error('Ticket não encontrado.')
    if (!REJEITAVEIS.includes(String(ticket.status))) throw new Error('Ticket já encerrado.')
    const agora = new Date().toISOString()
    const { data, error } = await admin
      .from('helpdesk_tickets')
      .update({ status: 'rejeitado', aprovado_por: user.id, aprovado_em: agora, concluido_em: agora })
      .eq('id', ticketId)
      .in('status', REJEITAVEIS) // atômico: não rejeita o que foi concluído/rejeitado no meio
      .select('id')
    if (error) throw error
    if (data?.length !== 1) throw new Error('O ticket mudou de status (talvez já encerrado). Atualize a tela e confira.')
    revalidatePath('/helpdesk')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao rejeitar.' }
  }
}

/**
 * Comentários + histórico de status de um ticket (linha do tempo do detalhe).
 * Visibilidade: quem tem helpdesk-abrir vê todos os tickets (decisão do Bruno).
 */
export async function listarHelpdeskAtividade(ticketId: string): Promise<{
  success: boolean
  comentarios?: HelpdeskComentario[]
  historico?: HelpdeskHistorico[]
  error?: string
}> {
  try {
    await requirePermission('helpdesk-abrir')
    const admin = await createAdminClient()
    const [c, h] = await Promise.all([
      admin.from('helpdesk_comentarios').select('id, autor_tipo, autor_id, texto, created_at').eq('ticket_id', ticketId).order('created_at'),
      admin
        .from('helpdesk_historico')
        .select('id, de, para, por, plano_anterior, solucao_anterior, created_at')
        .eq('ticket_id', ticketId)
        .order('created_at'),
    ])
    if (c.error) throw c.error
    if (h.error) throw h.error

    const ids = [...new Set([...(c.data || []).map((x) => x.autor_id), ...(h.data || []).map((x) => x.por)].filter(Boolean).map(String))]
    const { data: usuarios } = ids.length
      ? await admin.from('users').select('id, name').in('id', ids)
      : { data: [] as Array<{ id: string; name: string | null }> }
    const nome = new Map((usuarios || []).map((u) => [String(u.id), String(u.name || '')]))

    return {
      success: true,
      comentarios: (c.data || []).map((x) => ({
        ...(x as Omit<HelpdeskComentario, 'autor_nome'>),
        autor_nome: x.autor_tipo === 'claude' ? 'Claude' : nome.get(String(x.autor_id)) || '—',
      })),
      historico: (h.data || []).map((x) => ({
        ...(x as Omit<HelpdeskHistorico, 'por_nome'>),
        por_nome: x.por ? nome.get(String(x.por)) || '—' : '',
      })),
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao carregar a atividade.' }
  }
}

/** Comentário de usuário (o do Claude entra direto no banco pela rotina). Trigger notifica. */
export async function comentarHelpdeskTicket(ticketId: string, texto: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermission('helpdesk-abrir')
    const v = validarComentario(texto)
    if (!v.ok) throw new Error(v.error)
    const admin = await createAdminClient()
    const { data: ticket } = await admin.from('helpdesk_tickets').select('id').eq('id', ticketId).maybeSingle()
    if (!ticket) throw new Error('Ticket não encontrado.')
    const { error } = await admin
      .from('helpdesk_comentarios')
      .insert({ ticket_id: ticketId, autor_tipo: 'usuario', autor_id: user.id, texto: v.texto })
    if (error) throw error
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao comentar.' }
  }
}

/**
 * Reabrir ticket concluído/rejeitado (solicitante ou aprovador). A RPC faz
 * tudo numa transação: motivo vira comentário, status volta a 'aberto' e
 * plano/solução anteriores ficam no histórico.
 */
export async function reabrirHelpdeskTicket(ticketId: string, motivo: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { user, permissions } = await requirePermission('helpdesk-abrir')
    const v = validarMotivoReabertura(motivo)
    if (!v.ok) throw new Error(v.error)
    const admin = await createAdminClient()
    const { data: ticket } = await admin.from('helpdesk_tickets').select('id, status, aberto_por').eq('id', ticketId).maybeSingle()
    if (!ticket) throw new Error('Ticket não encontrado.')
    const aprovador = hasPermission(permissions, 'helpdesk-aprovar', 'can_edit')
    if (!podeReabrir({ status: String(ticket.status), aberto_por: String(ticket.aberto_por) }, user.id, aprovador)) {
      throw new Error('Só o solicitante ou um aprovador reabre, e só ticket concluído ou rejeitado.')
    }
    const { error } = await admin.rpc('helpdesk_reabrir', { p_ticket_id: ticketId, p_motivo: v.texto, p_por: user.id })
    if (error) throw error
    revalidatePath('/helpdesk')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao reabrir.' }
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
