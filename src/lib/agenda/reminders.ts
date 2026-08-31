/**
 * Lembretes da Agenda via fila process_jobs.
 *
 * Dois kinds: agenda_meeting_reminder (30 min antes da reunião) e
 * agenda_task_due (às 09h do dia do prazo da tarefa). A dedupe_key
 * inclui o horário/data — quando o item é remarcado, um job novo é
 * enfileirado e o antigo se auto-invalida ao rodar (o horário gravado
 * no payload não bate mais com o item).
 */

import { createAdminClient } from '@/lib/supabase/server'
import { enqueueJob } from '@/lib/scp-engine/queue'
import type { EngineJob } from '@/lib/scp-engine/decisions'
import { createWorkspaceNotifications } from '@/lib/notifications'
import { entregarLembreteSelf } from '@/lib/interno-chat/data'

const MEETING_REMINDER_MINUTES = 30

export async function enqueueMeetingReminder(itemId: string, startAtIso: string): Promise<void> {
  const runAfter = new Date(new Date(startAtIso).getTime() - MEETING_REMINDER_MINUTES * 60 * 1000)
  if (runAfter.getTime() <= Date.now()) return
  await enqueueJob({
    kind: 'agenda_meeting_reminder',
    payload: { item_id: itemId, start_at: startAtIso },
    dedupeKey: `agenda_rem:${itemId}:${startAtIso}`,
    runAfterIso: runAfter.toISOString(),
    maxAttempts: 3,
  })
}

export async function enqueueTaskDueReminder(itemId: string, dueDate: string): Promise<void> {
  // 09:00 em America/Sao_Paulo (UTC-3) = 12:00Z.
  const runAfter = `${dueDate}T12:00:00Z`
  if (new Date(runAfter).getTime() <= Date.now()) return
  await enqueueJob({
    kind: 'agenda_task_due',
    payload: { item_id: itemId, due_date: dueDate },
    dedupeKey: `agenda_due:${itemId}:${dueDate}`,
    runAfterIso: runAfter,
    maxAttempts: 3,
  })
}

async function loadItemWithInvolved(itemId: string) {
  const admin = await createAdminClient()
  const { data: item } = await admin
    .from('agenda_items')
    .select('id, item_type, title, status, due_date, start_at, deleted_at')
    .eq('id', itemId)
    .maybeSingle()
  if (!item || item.deleted_at) return null
  const { data: participants } = await admin
    .from('agenda_item_participants')
    .select('user_id')
    .eq('item_id', itemId)
    .eq('role', 'envolvido')
  return { admin, item, involvedIds: (participants || []).map((row: { user_id: string }) => String(row.user_id)) }
}

async function handleMeetingReminder(job: EngineJob): Promise<void> {
  const itemId = String(job.payload?.item_id || '')
  const startAt = String(job.payload?.start_at || '')
  if (!itemId) return

  const loaded = await loadItemWithInvolved(itemId)
  if (!loaded) return
  const { admin, item, involvedIds } = loaded

  // Remarcada: este lembrete é do horário antigo — o novo horário tem
  // job próprio (dedupe inclui o horário). Só descarta.
  if (String(item.start_at || '') !== startAt) return
  if (!involvedIds.length) return

  const time = new Date(startAt).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
  await createWorkspaceNotifications(
    admin,
    involvedIds.map((userId) => ({
      user_id: userId,
      type: 'agenda_lembrete_reuniao',
      title: `Em ${MEETING_REMINDER_MINUTES} min (${time}): ${item.title}`,
      href: `/agenda?view=compromissos&item=${itemId}`,
      entity_type: 'agenda_item',
      entity_id: itemId,
    })),
  )

  // BRS Messenger (31/08/2026): o mesmo lembrete cai no canal "Você" de cada
  // envolvido do compromisso. Caminho escolhido do contrato: ESTENDER este
  // handler do process_jobs (não criar cron paralelo) — o job já roda no
  // horário certo, se auto-invalida em remarcação e tem dedupe; a entrega no
  // self é idempotente por (conversa, corpo), então retry não duplica.
  await entregarLembretesNoSelf(involvedIds, `${item.title} — hoje às ${time}`)
}

async function entregarLembretesNoSelf(userIds: string[], corpo: string): Promise<void> {
  for (const userId of userIds) {
    try {
      await entregarLembreteSelf(userId, corpo)
    } catch (error) {
      // Best-effort: o sino já notificou; falha no Messenger não derruba o job.
      console.error('Falha ao entregar lembrete no canal "Você":', (error as Error)?.message)
    }
  }
}

async function handleTaskDue(job: EngineJob): Promise<void> {
  const itemId = String(job.payload?.item_id || '')
  const dueDate = String(job.payload?.due_date || '')
  if (!itemId) return

  const loaded = await loadItemWithInvolved(itemId)
  if (!loaded) return
  const { admin, item, involvedIds } = loaded

  if (String(item.due_date || '') !== dueDate) return
  if (item.status === 'feito' || !involvedIds.length) return

  await createWorkspaceNotifications(
    admin,
    involvedIds.map((userId) => ({
      user_id: userId,
      type: 'agenda_prazo_tarefa',
      title: `Tarefa vence hoje: ${item.title}`,
      href: `/agenda?item=${itemId}`,
      entity_type: 'agenda_item',
      entity_id: itemId,
    })),
  )

  await entregarLembretesNoSelf(involvedIds, `tarefa "${item.title}" vence hoje`)
}

export function registerAgendaHandlers(deps: {
  registerHandler: (kind: string, fn: (job: EngineJob) => Promise<void>) => void
}): void {
  deps.registerHandler('agenda_meeting_reminder', handleMeetingReminder)
  deps.registerHandler('agenda_task_due', handleTaskDue)
}
