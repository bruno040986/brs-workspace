'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/permissions'
import { createWorkspaceNotifications } from '@/lib/notifications'
import { mirrorAgendaItemToGoogle, removeAgendaItemFromGoogle } from '@/lib/agenda/googleMirror'
import { getValidGoogleTokenAdmin, queryFreeBusy, type BusyBlock } from '@/lib/google/calendarApi'
import { enqueueMeetingReminder, enqueueTaskDueReminder } from '@/lib/agenda/reminders'
import {
  AGENDA_LINK_ENTITY_TYPES,
  AGENDA_TASK_STATUSES,
  GUEST_EMAIL_REGEX,
  nextOccurrenceDate,
  type AgendaGuest,
  type AgendaItem,
  type AgendaItemLink,
  type AgendaItemPayload,
  type AgendaParticipant,
  type AgendaRecurrence,
  type AgendaTaskStatus,
  type SuggestedGuest,
} from '@/lib/agenda/types'

const PERMISSION_RESOURCE = 'workspace-agenda'

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>

export type AgendaBootstrap = {
  currentUserId: string
  currentUserName: string
  canInclude: boolean
  users: Array<{ id: string; name: string; avatar_url: string | null }>
}

export async function getAgendaBootstrap(): Promise<AgendaBootstrap> {
  const { user, permissions } = await requirePermission(PERMISSION_RESOURCE, 'can_view')
  const admin = await createAdminClient()

  const { data: users } = await admin
    .from('users')
    .select('id, name, avatar_url')
    .eq('active', true)
    .order('name')

  const me = (users || []).find((u: any) => String(u.id) === user.id)

  return {
    currentUserId: user.id,
    currentUserName: String(me?.name || user.email || ''),
    canInclude: hasPermission(permissions, PERMISSION_RESOURCE, 'can_include'),
    users: (users || []).map((u: any) => ({
      id: String(u.id),
      name: String(u.name || ''),
      avatar_url: u.avatar_url ? String(u.avatar_url) : null,
    })),
  }
}

export type AgendaListParams = {
  kind: 'tarefas' | 'compromissos' | 'agenda'
  scope: 'minhas' | 'todas'
  // Para kind 'agenda' (grade dia/semana/mês):
  rangeStart?: string
  rangeEnd?: string
  // Filtra pela agenda de uma pessoa específica (criador ou envolvida);
  // 'todos' = agenda geral da equipe, sem filtro de pessoa.
  personId?: string
}

export async function listAgendaItems(params: AgendaListParams): Promise<AgendaItem[]> {
  const { user } = await requirePermission(PERMISSION_RESOURCE, 'can_view')
  const admin = await createAdminClient()

  let query = admin
    .from('agenda_items')
    .select('*')
    .is('deleted_at', null)

  if (params.kind === 'tarefas') {
    query = query.eq('item_type', 'tarefa').order('created_at', { ascending: false }).limit(500)
  } else if (params.kind === 'agenda') {
    const rangeStart = params.rangeStart || new Date().toISOString()
    const rangeEnd = params.rangeEnd || new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString()
    const dayStart = rangeStart.slice(0, 10)
    const dayEnd = rangeEnd.slice(0, 10)
    query = query
      .or(
        `and(start_at.gte.${rangeStart},start_at.lte.${rangeEnd}),and(item_type.eq.tarefa,due_date.gte.${dayStart},due_date.lte.${dayEnd})`,
      )
      .order('start_at', { ascending: true, nullsFirst: false })
      .limit(500)
  } else {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    query = query
      .neq('item_type', 'tarefa')
      .or(`start_at.gte.${cutoff},start_at.is.null`)
      .order('start_at', { ascending: true, nullsFirst: false })
      .limit(200)
  }

  const { data: rows, error } = await query
  if (error) throw error

  const items = (rows || []) as any[]
  if (!items.length) return []

  const itemIds = items.map((row) => String(row.id))

  const [{ data: participantRows }, { data: linkRows }, { data: guestRows }] = await Promise.all([
    admin
      .from('agenda_item_participants')
      .select('item_id, user_id, role, user:user_id ( name, avatar_url )')
      .in('item_id', itemIds),
    admin.from('agenda_item_links').select('item_id, entity_type, entity_id, label').in('item_id', itemIds),
    admin.from('agenda_item_guests').select('item_id, email, name, source').in('item_id', itemIds),
  ])

  const guestsByItem = new Map<string, AgendaGuest[]>()
  for (const row of guestRows || []) {
    const list = guestsByItem.get(String((row as any).item_id)) || []
    list.push({
      email: String((row as any).email),
      name: String((row as any).name || ''),
      source: ((row as any).source || 'manual') as AgendaGuest['source'],
    })
    guestsByItem.set(String((row as any).item_id), list)
  }

  const participantsByItem = new Map<string, AgendaParticipant[]>()
  for (const row of participantRows || []) {
    const list = participantsByItem.get(String((row as any).item_id)) || []
    list.push({
      user_id: String((row as any).user_id),
      name: String((row as any).user?.name || '—'),
      avatar_url: (row as any).user?.avatar_url || null,
      role: (row as any).role === 'autorizado' ? 'autorizado' : 'envolvido',
    })
    participantsByItem.set(String((row as any).item_id), list)
  }

  const linksByItem = new Map<string, AgendaItem['links']>()
  for (const row of linkRows || []) {
    const list = linksByItem.get(String((row as any).item_id)) || []
    list.push({
      entity_type: String((row as any).entity_type),
      entity_id: String((row as any).entity_id),
      label: String((row as any).label || ''),
    })
    linksByItem.set(String((row as any).item_id), list)
  }

  const creatorIds = Array.from(new Set(items.map((row) => String(row.created_by))))
  const { data: creators } = await admin.from('users').select('id, name').in('id', creatorIds)
  const creatorNames = new Map<string, string>((creators || []).map((row: any) => [String(row.id), String(row.name || '—')]))

  const result: AgendaItem[] = []
  for (const row of items) {
    const id = String(row.id)
    const participants = participantsByItem.get(id) || []
    const involvedIds = new Set(participants.map((p) => p.user_id))
    const isMine = String(row.created_by) === user.id || involvedIds.has(user.id)

    if (params.kind === 'agenda') {
      // 'todos' = visão geral da equipe (home): sem filtro de pessoa; a
      // privacidade continua valendo (item privado chega mascarado abaixo).
      if (params.personId !== 'todos') {
        const personId = params.personId || user.id
        const isOfPerson = String(row.created_by) === personId || involvedIds.has(personId)
        if (!isOfPerson) continue
      }
    } else if (params.scope === 'minhas' && !isMine) {
      continue
    }

    const isPrivate = String(row.visibility) === 'privada'
    const canSeeContent = !isPrivate || isMine

    result.push({
      id,
      item_type: row.item_type,
      title: canSeeContent ? String(row.title) : 'Item privado',
      description: canSeeContent ? String(row.description || '') : '',
      all_day: Boolean(row.all_day),
      due_date: row.due_date ? String(row.due_date) : null,
      start_at: row.start_at ? String(row.start_at) : null,
      end_at: row.end_at ? String(row.end_at) : null,
      priority: row.priority,
      status: row.status || null,
      visibility: row.visibility,
      meeting_link_mode: canSeeContent ? row.meeting_link_mode : 'nenhum',
      meeting_link: canSeeContent ? String(row.meeting_link || '') : '',
      recurrence: canSeeContent && row.recurrence ? (row.recurrence as AgendaRecurrence) : null,
      created_by: String(row.created_by),
      created_by_name: creatorNames.get(String(row.created_by)) || '—',
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      participants: canSeeContent ? participants : participants.filter((p) => p.role === 'envolvido'),
      links: canSeeContent ? linksByItem.get(id) || [] : [],
      guests: canSeeContent ? guestsByItem.get(id) || [] : [],
      masked: !canSeeContent,
    })
  }

  return result
}

function normalizePayload(payload: AgendaItemPayload) {
  const title = String(payload.title || '').trim()
  if (!title) throw new Error('Informe um título.')
  if (title.length > 200) throw new Error('Título excede 200 caracteres.')

  const itemType = payload.item_type
  const isTask = itemType === 'tarefa'

  if (!isTask && !payload.start_at) {
    throw new Error('Compromissos precisam de data e horário.')
  }

  let meetingLinkMode = payload.meeting_link_mode || 'nenhum'
  let meetingLink = String(payload.meeting_link || '').trim()
  if (meetingLinkMode === 'gerar_meet') {
    if (itemType !== 'reuniao_virtual') {
      throw new Error('Só reuniões virtuais geram link do Meet.')
    }
    // O link em si é preenchido pelo espelhamento no Google.
    meetingLink = ''
  } else if (meetingLinkMode === 'externo') {
    if (!/^https:\/\/\S+$/i.test(meetingLink)) {
      throw new Error('Informe um link válido começando com https://')
    }
  } else {
    meetingLink = ''
    meetingLinkMode = 'nenhum'
  }

  let recurrence: AgendaRecurrence | null = null
  if (isTask && payload.recurrence) {
    const freq = payload.recurrence.freq
    if (freq === 'daily') recurrence = { freq }
    else if (freq === 'weekly') {
      const weekdays = (payload.recurrence.weekdays || []).filter((d) => d >= 0 && d <= 6)
      if (!weekdays.length) throw new Error('Escolha os dias da semana da recorrência.')
      recurrence = { freq, weekdays }
    } else if (freq === 'monthly') {
      recurrence = { freq, day: Math.min(28, Math.max(1, Number(payload.recurrence.day || 1))) }
    }
    if (recurrence && !payload.due_date) {
      throw new Error('Tarefa recorrente precisa de uma data inicial.')
    }
  }

  return {
    item_type: itemType,
    title,
    description: String(payload.description || '').trim(),
    all_day: Boolean(payload.all_day),
    due_date: payload.due_date || null,
    start_at: payload.start_at || null,
    end_at: payload.end_at || null,
    priority: payload.priority || 'media',
    status: isTask ? payload.status || 'pendente' : null,
    visibility: payload.visibility === 'privada' ? 'privada' : 'publica',
    meeting_link_mode: meetingLinkMode,
    meeting_link: meetingLink,
    recurrence,
  }
}

async function replaceItemRelations(admin: AdminClient, itemId: string, payload: AgendaItemPayload) {
  const involved = Array.from(new Set((payload.participant_user_ids || []).map(String).filter(Boolean)))
  const authorized = Array.from(new Set((payload.authorized_user_ids || []).map(String).filter(Boolean)))
    .filter((id) => !involved.includes(id))

  await admin.from('agenda_item_participants').delete().eq('item_id', itemId)
  const participantRows = [
    ...involved.map((userId) => ({ item_id: itemId, user_id: userId, role: 'envolvido' })),
    ...(payload.visibility === 'privada'
      ? authorized.map((userId) => ({ item_id: itemId, user_id: userId, role: 'autorizado' }))
      : []),
  ]
  if (participantRows.length) {
    const { error } = await admin.from('agenda_item_participants').insert(participantRows)
    if (error) throw error
  }

  await admin.from('agenda_item_links').delete().eq('item_id', itemId)
  const validTypes = new Set(AGENDA_LINK_ENTITY_TYPES.map((t) => t.value))
  const linkRows = (payload.links || [])
    .filter((link) => validTypes.has(link.entity_type) && link.entity_id)
    .map((link) => ({
      item_id: itemId,
      entity_type: link.entity_type,
      entity_id: link.entity_id,
      label: String(link.label || '').slice(0, 200),
    }))
  if (linkRows.length) {
    const { error } = await admin.from('agenda_item_links').insert(linkRows)
    if (error) throw error
  }

  // Convidados externos: substitui os geridos pelo editor; os de
  // source 'google' pertencem ao sync inbound e não são tocados aqui.
  const seenEmails = new Set<string>()
  const guestRows = (payload.guests || [])
    .map((guest) => ({
      email: String(guest.email || '').trim().toLowerCase(),
      name: String(guest.name || '').slice(0, 120),
      source: guest.source === 'vinculo' ? 'vinculo' : 'manual',
    }))
    .filter((guest) => {
      if (!GUEST_EMAIL_REGEX.test(guest.email) || seenEmails.has(guest.email)) return false
      seenEmails.add(guest.email)
      return true
    })
    .slice(0, 50)
    .map((guest) => ({ ...guest, item_id: itemId }))

  await admin.from('agenda_item_guests').delete().eq('item_id', itemId).neq('source', 'google')
  if (guestRows.length) {
    const { error } = await admin
      .from('agenda_item_guests')
      .upsert(guestRows, { onConflict: 'item_id,email', ignoreDuplicates: true })
    if (error) throw error
  }

  return { involved, guestCount: guestRows.length }
}

export async function saveAgendaItem(
  payload: AgendaItemPayload,
): Promise<{ success: boolean; id?: string; error?: string; warning?: string }> {
  try {
    const { user } = await requirePermission(PERMISSION_RESOURCE, payload.id ? 'can_edit' : 'can_include')
    const admin = await createAdminClient()
    const normalized = normalizePayload(payload)

    let itemId = payload.id ? String(payload.id) : ''
    let previouslyInvolved = new Set<string>()

    if (itemId) {
      const { data: existing, error: findErr } = await admin
        .from('agenda_items')
        .select('id, created_by')
        .eq('id', itemId)
        .is('deleted_at', null)
        .maybeSingle()
      if (findErr) throw findErr
      if (!existing) throw new Error('Item não encontrado.')

      const { data: currentParticipants } = await admin
        .from('agenda_item_participants')
        .select('user_id, role')
        .eq('item_id', itemId)
        .eq('role', 'envolvido')
      previouslyInvolved = new Set((currentParticipants || []).map((row: any) => String(row.user_id)))

      const isCreator = String(existing.created_by) === user.id
      if (!isCreator && !previouslyInvolved.has(user.id)) {
        throw new Error('Apenas o criador ou os envolvidos podem editar este item.')
      }

      const { error: updErr } = await admin
        .from('agenda_items')
        .update({ ...normalized, updated_at: new Date().toISOString() })
        .eq('id', itemId)
      if (updErr) throw updErr
    } else {
      const { data: inserted, error: insErr } = await admin
        .from('agenda_items')
        .insert({ ...normalized, created_by: user.id })
        .select('id')
        .single()
      if (insErr) throw insErr
      itemId = String(inserted.id)
    }

    const { involved, guestCount } = await replaceItemRelations(admin, itemId, payload)

    // Notifica apenas quem acabou de ser adicionado (não re-notifica em
    // toda edição) — e nunca o próprio autor da ação.
    const newlyInvolved = involved.filter((id) => id !== user.id && !previouslyInvolved.has(id))
    if (newlyInvolved.length) {
      const { data: me } = await admin.from('users').select('name').eq('id', user.id).maybeSingle()
      const actorName = String(me?.name || 'Alguém')
      const kindLabel = normalized.item_type === 'tarefa' ? 'tarefa' : 'compromisso'
      await createWorkspaceNotifications(
        admin,
        newlyInvolved.map((userId) => ({
          user_id: userId,
          type: 'agenda_atribuicao',
          title: `${actorName} te adicionou na ${kindLabel === 'tarefa' ? 'tarefa' : 'agenda'}: ${normalized.title}`,
          href: `/agenda?item=${itemId}`,
          entity_type: 'agenda_item',
          entity_id: itemId,
          actor_user_id: user.id,
        })),
      )
    }

    // Lembretes via fila de jobs (idempotentes pela dedupe_key; ao
    // remarcar, o job antigo se auto-invalida ao rodar).
    if (normalized.item_type !== 'tarefa' && normalized.start_at) {
      await enqueueMeetingReminder(itemId, normalized.start_at)
    }
    if (normalized.item_type === 'tarefa' && normalized.due_date && normalized.status !== 'feito') {
      await enqueueTaskDueReminder(itemId, normalized.due_date)
    }

    // Espelha compromissos no Google Calendar do organizador; os
    // envolvidos entram como convidados e o Google propaga o evento.
    let warning: string | undefined
    if (normalized.item_type !== 'tarefa') {
      const mirror = await mirrorAgendaItemToGoogle(admin, itemId, user.id)
      if (!mirror.mirrored && mirror.reason === 'sem_conexao') {
        warning =
          'Salvo no Workspace, mas nenhum envolvido tem conta Google conectada — o compromisso não foi para o Google Agenda.'
        if (guestCount > 0) {
          warning += ' Os convidados externos NÃO receberão o convite até alguém conectar o Google e salvar de novo.'
        }
      } else if (!mirror.mirrored && mirror.reason === 'erro') {
        warning = 'Salvo no Workspace, mas o espelhamento no Google Agenda falhou. Tente salvar de novo.'
      }
      if (normalized.meeting_link_mode === 'gerar_meet' && mirror.mirrored && !mirror.meetLink) {
        warning = 'Compromisso criado, mas o Google não retornou o link do Meet. Edite e salve de novo.'
      }
    }

    return { success: true, id: itemId, warning }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function updateTaskStatus(
  itemId: string,
  status: AgendaTaskStatus,
): Promise<{ success: boolean; error?: string; recurred?: boolean }> {
  try {
    const { user } = await requirePermission(PERMISSION_RESOURCE, 'can_edit')
    const admin = await createAdminClient()

    const { data: item, error: findErr } = await admin
      .from('agenda_items')
      .select('id, item_type, created_by, due_date, recurrence')
      .eq('id', itemId)
      .is('deleted_at', null)
      .maybeSingle()
    if (findErr) throw findErr
    if (!item || item.item_type !== 'tarefa') throw new Error('Tarefa não encontrada.')

    const { data: participants } = await admin
      .from('agenda_item_participants')
      .select('user_id')
      .eq('item_id', itemId)
      .eq('role', 'envolvido')
    const involvedIds = new Set((participants || []).map((row: any) => String(row.user_id)))
    if (String(item.created_by) !== user.id && !involvedIds.has(user.id)) {
      throw new Error('Apenas o criador ou os envolvidos podem mover esta tarefa.')
    }

    // Tarefa recorrente marcada como Feito: registra "feito nesta
    // ocorrência" e reagenda para a próxima data, voltando a Pendente.
    const recurrence = (item.recurrence || null) as AgendaRecurrence | null
    if (status === 'feito' && recurrence) {
      const todayIso = new Date().toISOString().slice(0, 10)
      const occurrenceDate = String(item.due_date || todayIso)
      await admin
        .from('agenda_task_occurrences')
        .upsert(
          { item_id: itemId, occurrence_date: occurrenceDate, done_at: new Date().toISOString(), done_by: user.id },
          { onConflict: 'item_id,occurrence_date' },
        )
      const nextDue = nextOccurrenceDate(recurrence, occurrenceDate)
      const { error } = await admin
        .from('agenda_items')
        .update({ status: 'pendente', due_date: nextDue, updated_at: new Date().toISOString() })
        .eq('id', itemId)
      if (error) throw error
      await enqueueTaskDueReminder(itemId, nextDue)
      return { success: true, recurred: true }
    }

    const { error } = await admin
      .from('agenda_items')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', itemId)
    if (error) throw error

    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

// Carrega um único item (deep-link do sino), com o mesmo mascaramento
// de privacidade da listagem.
export async function getAgendaItemById(itemId: string): Promise<AgendaItem | null> {
  const { user } = await requirePermission(PERMISSION_RESOURCE, 'can_view')
  const admin = await createAdminClient()

  const { data: row } = await admin.from('agenda_items').select('*').eq('id', itemId).is('deleted_at', null).maybeSingle()
  if (!row) return null

  const [{ data: participantRows }, { data: linkRows }, { data: creator }, { data: guestRows }] = await Promise.all([
    admin
      .from('agenda_item_participants')
      .select('user_id, role, user:user_id ( name, avatar_url )')
      .eq('item_id', itemId),
    admin.from('agenda_item_links').select('entity_type, entity_id, label').eq('item_id', itemId),
    admin.from('users').select('name').eq('id', String(row.created_by)).maybeSingle(),
    admin.from('agenda_item_guests').select('email, name, source').eq('item_id', itemId),
  ])

  const participants: AgendaParticipant[] = (participantRows || []).map((p: any) => ({
    user_id: String(p.user_id),
    name: String(p.user?.name || '—'),
    avatar_url: p.user?.avatar_url || null,
    role: p.role === 'autorizado' ? 'autorizado' : 'envolvido',
  }))
  const isMine = String(row.created_by) === user.id || participants.some((p) => p.user_id === user.id)
  const canSeeContent = String(row.visibility) !== 'privada' || isMine

  return {
    id: String(row.id),
    item_type: row.item_type,
    title: canSeeContent ? String(row.title) : 'Item privado',
    description: canSeeContent ? String(row.description || '') : '',
    all_day: Boolean(row.all_day),
    due_date: row.due_date ? String(row.due_date) : null,
    start_at: row.start_at ? String(row.start_at) : null,
    end_at: row.end_at ? String(row.end_at) : null,
    priority: row.priority,
    status: row.status || null,
    visibility: row.visibility,
    meeting_link_mode: canSeeContent ? row.meeting_link_mode : 'nenhum',
    meeting_link: canSeeContent ? String(row.meeting_link || '') : '',
    recurrence: canSeeContent && row.recurrence ? (row.recurrence as AgendaRecurrence) : null,
    created_by: String(row.created_by),
    created_by_name: String(creator?.name || '—'),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    participants: canSeeContent ? participants : participants.filter((p) => p.role === 'envolvido'),
    links: canSeeContent
      ? (linkRows || []).map((l: any) => ({ entity_type: String(l.entity_type), entity_id: String(l.entity_id), label: String(l.label || '') }))
      : [],
    guests: canSeeContent
      ? (guestRows || []).map((g: any) => ({
          email: String(g.email),
          name: String(g.name || ''),
          source: (g.source || 'manual') as AgendaGuest['source'],
        }))
      : [],
    masked: !canSeeContent,
  }
}

export type AgendaReportRow = {
  user_id: string
  name: string
  pendente: number
  em_andamento: number
  aguardando: number
  feito: number
  atrasadas: number
  total_abertas: number
}

// Relatório de gestão: tarefas por pessoa (contada para cada
// envolvido; sem envolvidos, conta para o criador).
export async function getAgendaReport(): Promise<{ rows: AgendaReportRow[]; totals: Omit<AgendaReportRow, 'user_id' | 'name'> }> {
  await requirePermission(PERMISSION_RESOURCE, 'can_view')
  const admin = await createAdminClient()

  const { data: tasks } = await admin
    .from('agenda_items')
    .select('id, status, due_date, created_by')
    .eq('item_type', 'tarefa')
    .is('deleted_at', null)
    .limit(2000)

  const taskIds = (tasks || []).map((row: any) => String(row.id))
  const involvedByTask = new Map<string, string[]>()
  if (taskIds.length) {
    const { data: participantRows } = await admin
      .from('agenda_item_participants')
      .select('item_id, user_id')
      .eq('role', 'envolvido')
      .in('item_id', taskIds)
    for (const row of participantRows || []) {
      const list = involvedByTask.get(String((row as any).item_id)) || []
      list.push(String((row as any).user_id))
      involvedByTask.set(String((row as any).item_id), list)
    }
  }

  const todayIso = new Date().toISOString().slice(0, 10)
  const emptyRow = () => ({ pendente: 0, em_andamento: 0, aguardando: 0, feito: 0, atrasadas: 0, total_abertas: 0 })
  const byUser = new Map<string, ReturnType<typeof emptyRow>>()
  const totals = emptyRow()

  for (const task of tasks || []) {
    const status = String(task.status || 'pendente') as AgendaTaskStatus
    const isOpen = status !== 'feito'
    const isLate = isOpen && task.due_date && String(task.due_date) < todayIso
    const owners = involvedByTask.get(String(task.id))?.length
      ? involvedByTask.get(String(task.id))!
      : [String(task.created_by)]

    if (AGENDA_TASK_STATUSES.some((s) => s.value === status)) {
      totals[status] += 1
      if (isOpen) totals.total_abertas += 1
      if (isLate) totals.atrasadas += 1
    }

    for (const userId of owners) {
      const row = byUser.get(userId) || emptyRow()
      row[status] += 1
      if (isOpen) row.total_abertas += 1
      if (isLate) row.atrasadas += 1
      byUser.set(userId, row)
    }
  }

  const userIds = Array.from(byUser.keys())
  const { data: users } = userIds.length
    ? await admin.from('users').select('id, name').in('id', userIds)
    : { data: [] as any[] }
  const names = new Map<string, string>((users || []).map((row: any) => [String(row.id), String(row.name || '—')]))

  const rows: AgendaReportRow[] = userIds
    .map((userId) => ({ user_id: userId, name: names.get(userId) || '—', ...byUser.get(userId)! }))
    .sort((a, b) => b.total_abertas - a.total_abertas || a.name.localeCompare(b.name))

  return { rows, totals }
}

export async function deleteAgendaItem(itemId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermission(PERMISSION_RESOURCE, 'can_delete')
    const admin = await createAdminClient()

    const { data: item, error: findErr } = await admin
      .from('agenda_items')
      .select('id, created_by, google_event_id, google_owner_user_id')
      .eq('id', itemId)
      .is('deleted_at', null)
      .maybeSingle()
    if (findErr) throw findErr
    if (!item) throw new Error('Item não encontrado.')
    if (String(item.created_by) !== user.id) throw new Error('Apenas o criador pode excluir este item.')

    const { error } = await admin
      .from('agenda_items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', itemId)
    if (error) throw error

    await removeAgendaItemFromGoogle(admin, {
      google_event_id: item.google_event_id ? String(item.google_event_id) : null,
      google_owner_user_id: item.google_owner_user_id ? String(item.google_owner_user_id) : null,
    })

    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export type AvailabilityEntry = {
  user_id: string
  name: string
  status: 'livre' | 'ocupado' | 'sem_conexao'
  busy: BusyBlock[]
}

// Consulta a disponibilidade real (free/busy do Google) de cada
// envolvido no horário proposto, usando o token do próprio usuário.
export async function getAvailability(params: {
  userIds: string[]
  startAt: string
  endAt: string
}): Promise<{ success: boolean; entries: AvailabilityEntry[]; error?: string }> {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_view')
    const admin = await createAdminClient()

    const userIds = Array.from(new Set((params.userIds || []).map(String).filter(Boolean))).slice(0, 30)
    if (!userIds.length || !params.startAt || !params.endAt) {
      return { success: false, error: 'Informe envolvidos e horário.', entries: [] }
    }

    const { data: users } = await admin.from('users').select('id, name').in('id', userIds)
    const names = new Map<string, string>((users || []).map((row: any) => [String(row.id), String(row.name || '—')]))

    const entries = await Promise.all(
      userIds.map(async (userId): Promise<AvailabilityEntry> => {
        const name = names.get(userId) || '—'
        const token = await getValidGoogleTokenAdmin(admin, userId)
        if (!token) return { user_id: userId, name, status: 'sem_conexao', busy: [] }
        const busy = await queryFreeBusy(token, params.startAt, params.endAt)
        if (busy === null) return { user_id: userId, name, status: 'sem_conexao', busy: [] }
        return { user_id: userId, name, status: busy.length ? 'ocupado' : 'livre', busy }
      }),
    )

    return { success: true, entries }
  } catch (error: any) {
    return { success: false, error: error.message, entries: [] }
  }
}

type RawSuggestion = { email: unknown; name: string; role: string }

function contactListSuggestions(list: unknown, nameKey: string, role: string): RawSuggestion[] {
  if (!Array.isArray(list)) return []
  return list
    .filter((contact: any) => contact && contact.is_active !== false)
    .map((contact: any) => ({ email: contact.email, name: String(contact[nameKey] || ''), role }))
}

// Extrai e-mails "de pessoa" do cadastro de cada entidade vinculável.
// Curadoria combinada com o Bruno (20/08/2026): contatos ativos com
// nome + e-mails principais/por finalidade; fora e-mails utilitários
// (NFS-e, Receita, PIX).
async function extractEntitySuggestions(
  admin: AdminClient,
  link: AgendaItemLink,
): Promise<RawSuggestion[]> {
  if (link.entity_type === 'financial_institution') {
    const { data } = await admin
      .from('financial_institutions')
      .select('general_data, contacts_commercial, contacts_operational')
      .eq('id', link.entity_id)
      .maybeSingle()
    if (!data) return []
    return [
      ...contactListSuggestions(data.contacts_commercial, 'nome_completo', 'Comercial'),
      ...contactListSuggestions(data.contacts_operational, 'nome_responsavel', 'Operacional'),
      { email: (data.general_data as any)?.email_principal, name: '', role: 'E-mail principal' },
    ]
  }

  if (link.entity_type === 'promotora') {
    const { data } = await admin
      .from('promotoras')
      .select('address_data, contacts_commercial, contacts_operational')
      .eq('id', link.entity_id)
      .maybeSingle()
    if (!data) return []
    return [
      ...contactListSuggestions(data.contacts_commercial, 'nome_completo', 'Comercial'),
      ...contactListSuggestions(data.contacts_operational, 'nome_responsavel', 'Operacional'),
      { email: (data.address_data as any)?.email_principal, name: '', role: 'E-mail principal' },
    ]
  }

  if (link.entity_type === 'agente_parceiro') {
    const { data } = await admin
      .from('agentes_parceiros')
      .select(
        'email_comissao, email_informe, email_formalizacao, email_proposta, email_mesa_liberacao, email_juridico, corban_data',
      )
      .eq('id', link.entity_id)
      .maybeSingle()
    if (!data) return []
    const corban = (data.corban_data || {}) as any
    const byPurpose: RawSuggestion[] = [
      { email: data.email_comissao, name: '', role: 'Comissão' },
      { email: data.email_formalizacao, name: '', role: 'Formalização' },
      { email: data.email_proposta, name: '', role: 'Proposta' },
      { email: data.email_mesa_liberacao, name: '', role: 'Mesa de liberação' },
      { email: data.email_juridico, name: '', role: 'Jurídico' },
      { email: data.email_informe, name: '', role: 'Informe' },
      { email: corban?.contacts?.email_financeiro, name: '', role: 'Financeiro' },
    ]
    const people: RawSuggestion[] = [
      ...(Array.isArray(corban?.socios) ? corban.socios : []).map((p: any) => ({
        email: p?.email,
        name: String(p?.name || ''),
        role: 'Sócio',
      })),
      ...(Array.isArray(corban?.administracao) ? corban.administracao : []).map((p: any) => ({
        email: p?.email,
        name: String(p?.name || ''),
        role: String(p?.cargo || p?.tipo || 'Administração'),
      })),
    ]
    return [...people, ...byPurpose]
  }

  if (link.entity_type === 'commercial_entity') {
    const { data } = await admin
      .from('commercial_entities')
      .select('name, email_comissao, cadastral_data')
      .eq('id', link.entity_id)
      .maybeSingle()
    if (!data) return []
    const cadastral = (data.cadastral_data || {}) as any
    return [
      {
        email: cadastral?.email_professional || data.email_comissao,
        name: String(data.name || ''),
        role: 'Profissional',
      },
    ]
  }

  return []
}

// Sugestões de convidados a partir dos vínculos selecionados no item.
export async function getSuggestedGuests(
  links: AgendaItemLink[],
): Promise<{ success: boolean; suggestions: SuggestedGuest[]; error?: string }> {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_view')
    const admin = await createAdminClient()

    const validTypes = new Set(AGENDA_LINK_ENTITY_TYPES.map((t) => t.value))
    const safeLinks = (links || []).filter((link) => validTypes.has(link.entity_type) && link.entity_id).slice(0, 10)

    const suggestions: SuggestedGuest[] = []
    const seen = new Set<string>()
    for (const link of safeLinks) {
      const raw = await extractEntitySuggestions(admin, link)
      for (const suggestion of raw) {
        const email = String(suggestion.email || '').trim().toLowerCase()
        if (!email || seen.has(email) || !GUEST_EMAIL_REGEX.test(email)) continue
        seen.add(email)
        suggestions.push({ email, name: suggestion.name, role: suggestion.role, entity_label: link.label })
        if (suggestions.length >= 40) break
      }
    }

    return { success: true, suggestions }
  } catch (error: any) {
    return { success: false, error: error.message, suggestions: [] }
  }
}

export async function searchAgendaLinkTargets(entityType: string, query: string) {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_view')
    const meta = AGENDA_LINK_ENTITY_TYPES.find((t) => t.value === entityType)
    if (!meta) return { success: false, error: 'Tipo de vínculo inválido.', results: [] }

    const admin = await createAdminClient()
    const term = String(query || '').trim()

    let q = admin.from(meta.table).select(`id, ${meta.nameColumn}`).limit(15)
    if (term) q = q.ilike(meta.nameColumn, `%${term}%`)

    const { data, error } = await q
    if (error) throw error

    return {
      success: true,
      results: (data || []).map((row: any) => ({
        entity_type: entityType,
        entity_id: String(row.id),
        label: String(row[meta.nameColumn] || '—'),
      })),
    }
  } catch (error: any) {
    return { success: false, error: error.message, results: [] }
  }
}
