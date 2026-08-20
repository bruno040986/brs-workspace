/**
 * Worker do Disparo de WhatsApp.
 *
 * Roda pela rota /api/cron/wa-campaigns (cron a cada minuto + "kick" imediato
 * ao iniciar/retomar). Em cada execução:
 *  1. promove campanhas agendadas cujo horário chegou;
 *  2. recupera destinatários presos em "sending" (função morreu no meio);
 *  3. para cada instância Z-API com campanha em execução, roda um loop
 *     serializado (lock otimista na instância) que envia 1 mensagem por vez,
 *     respeitando delay aleatório, janela/dias/lotes, pausa/cancelamento e
 *     opt-out; persiste o estado após CADA envio (seguro contra timeout).
 *
 * O pacing é persistido em zapi_instances.next_send_at — duas campanhas na
 * mesma instância nunca interleiam mais rápido que o delay configurado.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ZapiClient, isZapiOnline, sendAndLog, type ZapiInstanceRow } from '@/lib/zapi'
import { composeAntibanText, composeButtonMessage, renderTemplate } from '@/lib/zapi/format'
import { evaluateGate, pickTemplateIndex, randomBetween } from './schedule'
import {
  ANTIBAN_BUTTON_NO_ID,
  ANTIBAN_BUTTON_YES_ID,
  type CampaignRecipientRecord,
  type CampaignRecord,
  type CampaignSlotRecord,
  type CampaignTemplateBlock,
} from './types'

export const MEDIA_BUCKET = 'wa-campaign-media'
const MEDIA_SIGNED_TTL = 3 * 3600
const LOCK_SECONDS = 90
const STUCK_SENDING_MINUTES = 3
const MAX_CONSECUTIVE_FAILURES = 5

function admin(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type WorkerSummary = {
  workerId: string
  promoted: number
  recovered: number
  instances: Array<{ instanceId: string; sent: number; failed: number; skipped: number; stoppedReason: string }>
  workRemains: boolean
  elapsedMs: number
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export async function runWaWorker(options: { budgetMs?: number; workerId?: string } = {}): Promise<WorkerSummary> {
  const startedAt = Date.now()
  const budgetMs = options.budgetMs ?? 265_000
  const deadline = startedAt + budgetMs
  const workerId = options.workerId || `wa-${Math.random().toString(36).slice(2, 8)}`
  const supabase = admin()

  const promoted = await promoteScheduled(supabase)
  const recovered = await recoverStuckSending(supabase)

  const nowIso = new Date().toISOString()
  const { data: due } = await supabase
    .from('wa_campaigns')
    .select('instance_id')
    .eq('status', 'running')
    .or(`next_run_at.is.null,next_run_at.lte.${nowIso}`)
  const instanceIds = Array.from(new Set((due || []).map((r: any) => String(r.instance_id))))

  const instances = await Promise.all(instanceIds.map((id) => runInstanceLoop(supabase, id, workerId, deadline)))

  // Kick em cadeia SÓ quando este worker era o dono do lock e saiu por budget
  // com trabalho pendente. Se o lock está com outro worker ('locked'), quem
  // deve continuar é ele — re-kickar aqui criava uma rajada de invocações
  // inúteis a cada minuto. O cron de 1 min segue como rede de segurança.
  const workRemains = instances.some((i) => i.stoppedReason === 'budget')

  return {
    workerId,
    promoted,
    recovered,
    instances,
    workRemains,
    elapsedMs: Date.now() - startedAt,
  }
}

async function promoteScheduled(supabase: SupabaseClient): Promise<number> {
  const nowIso = new Date().toISOString()
  const { data } = await supabase
    .from('wa_campaigns')
    .update({ status: 'running', started_at: nowIso })
    .eq('status', 'scheduled')
    .lte('next_run_at', nowIso)
    .select('id')
  return data?.length || 0
}

async function recoverStuckSending(supabase: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_SENDING_MINUTES * 60_000).toISOString()
  const { data } = await supabase
    .from('wa_campaign_recipients')
    .update({ status: 'failed', error: 'Envio interrompido pelo worker (timeout). Use "Reenviar" se a mensagem não chegou.' })
    .eq('status', 'sending')
    .lt('claimed_at', cutoff)
    .select('id')
  return data?.length || 0
}

// ---------------------------------------------------------------------------
// Loop por instância
// ---------------------------------------------------------------------------

async function tryLockInstance(supabase: SupabaseClient, instanceId: string, workerId: string): Promise<ZapiInstanceRow | null> {
  const nowIso = new Date().toISOString()
  const until = new Date(Date.now() + LOCK_SECONDS * 1000).toISOString()
  const { data } = await supabase
    .from('zapi_instances')
    .update({ worker_lock_until: until, worker_lock_by: workerId })
    .eq('id', instanceId)
    .or(`worker_lock_until.is.null,worker_lock_until.lt.${nowIso}`)
    .select('*')
    .maybeSingle()
  return (data as ZapiInstanceRow) || null
}

/** Renova o lock e confirma que ainda somos o dono. */
async function heartbeat(supabase: SupabaseClient, instanceId: string, workerId: string, nextSendAtIso: string | null): Promise<boolean> {
  const { data } = await supabase
    .from('zapi_instances')
    .update({
      worker_lock_until: new Date(Date.now() + LOCK_SECONDS * 1000).toISOString(),
      worker_lock_by: workerId,
      ...(nextSendAtIso ? { next_send_at: nextSendAtIso } : {}),
    })
    .eq('id', instanceId)
    .eq('worker_lock_by', workerId)
    .select('id')
  return (data?.length || 0) > 0
}

/**
 * Dorme `ms` segurando o lock: renova a cada ≤25s (o lock dura 90s — sem isso,
 * um delay de 3–5min deixava o lock expirar e o cron seguinte entrava JUNTO,
 * causando mensagens no mesmo segundo e contadores de lote corrompidos).
 * Retorna false se estourou o budget ou perdemos o lock.
 */
async function sleepHoldingLock(supabase: SupabaseClient, instanceId: string, workerId: string, ms: number, deadline: number): Promise<'ok' | 'budget' | 'lock_lost'> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (Date.now() >= deadline - 5000) return 'budget'
    await sleep(Math.min(25_000, end - Date.now(), Math.max(0, deadline - 5000 - Date.now())))
    const owned = await heartbeat(supabase, instanceId, workerId, null)
    if (!owned) return 'lock_lost'
  }
  return 'ok'
}

async function unlockInstance(supabase: SupabaseClient, instanceId: string, workerId: string) {
  await supabase
    .from('zapi_instances')
    .update({ worker_lock_until: null, worker_lock_by: null })
    .eq('id', instanceId)
    .eq('worker_lock_by', workerId)
}

async function pauseCampaignsOfInstance(supabase: SupabaseClient, instanceId: string, reason: string) {
  await supabase
    .from('wa_campaigns')
    .update({ status: 'paused', last_error: reason })
    .eq('instance_id', instanceId)
    .eq('status', 'running')
}

async function finalizeCampaign(supabase: SupabaseClient, campaignId: string, status: 'completed' | 'failed' | 'paused', error?: string) {
  await supabase
    .from('wa_campaigns')
    .update({
      status,
      last_error: error || null,
      finished_at: status === 'completed' || status === 'failed' ? new Date().toISOString() : null,
      next_run_at: null,
    })
    .eq('id', campaignId)
    .eq('status', 'running')
}

async function runInstanceLoop(
  supabase: SupabaseClient,
  instanceId: string,
  workerId: string,
  deadline: number,
): Promise<WorkerSummary['instances'][number]> {
  const summary = { instanceId, sent: 0, failed: 0, skipped: 0, stoppedReason: '' }
  const inst = await tryLockInstance(supabase, instanceId, workerId)
  if (!inst) {
    summary.stoppedReason = 'locked'
    return summary
  }
  if (!inst.is_active || !inst.instance_id || !inst.token) {
    await pauseCampaignsOfInstance(supabase, instanceId, 'Instância Z-API inativa ou sem credenciais')
    await unlockInstance(supabase, instanceId, workerId)
    summary.stoppedReason = 'instance_inactive'
    return summary
  }

  const client = ZapiClient.fromInstance(inst)
  const templateCache = new Map<string, CampaignTemplateBlock[]>()
  const slotCache = new Map<string, CampaignSlotRecord[]>()
  let nextSendAt = inst.next_send_at ? new Date(inst.next_send_at).getTime() : 0

  try {
    // Saúde da instância (1 chamada por execução).
    try {
      const status = await client.getStatus()
      await supabase.from('zapi_instances').update({ last_status: status, last_checked_at: new Date().toISOString() }).eq('id', instanceId)
      if (!isZapiOnline(status)) {
        await pauseCampaignsOfInstance(supabase, instanceId, `Instância desconectada (${status.error || 'sem detalhe'}). Reconecte e retome a campanha.`)
        summary.stoppedReason = 'instance_offline'
        return summary
      }
    } catch (err: any) {
      await pauseCampaignsOfInstance(supabase, instanceId, `Falha ao consultar status da instância: ${err?.message || err}`)
      summary.stoppedReason = 'status_error'
      return summary
    }

    while (Date.now() < deadline - 5000) {
      // 1. Pacing por instância — dorme SEM soltar o lock (renova a cada ≤25s).
      const wait = nextSendAt - Date.now()
      if (wait > 0) {
        if (Date.now() + wait > deadline - 5000) {
          summary.stoppedReason = 'budget'
          return summary
        }
        const slept = await sleepHoldingLock(supabase, instanceId, workerId, wait, deadline)
        if (slept !== 'ok') {
          summary.stoppedReason = slept
          return summary
        }
      }

      // 1b. Cinto e suspensório: confirma a posse do lock antes de reivindicar
      // um destinatário (se outro worker assumiu, saímos sem enviar).
      if (!(await heartbeat(supabase, instanceId, workerId, null))) {
        summary.stoppedReason = 'lock_lost'
        return summary
      }

      // 2. Campanhas elegíveis nesta instância (round-robin pela última enviada)
      const nowIso = new Date().toISOString()
      const { data: campaigns } = await supabase
        .from('wa_campaigns')
        .select('*')
        .eq('instance_id', instanceId)
        .eq('status', 'running')
        .or(`next_run_at.is.null,next_run_at.lte.${nowIso}`)
        .order('last_sent_at', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: true })
      if (!campaigns || campaigns.length === 0) {
        summary.stoppedReason = 'no_work'
        return summary
      }

      let picked: { c: CampaignRecord; r: CampaignRecipientRecord } | null = null
      for (const c of campaigns as CampaignRecord[]) {
        const slots = c.schedule_mode === 'batches' ? await loadSlots(supabase, c.id, slotCache) : []
        const hasPending = (c.pending_count || 0) > 0
        const gate = evaluateGate(c, slots, new Date(), hasPending)
        if (gate.kind === 'wait') {
          await supabase.from('wa_campaigns').update({ next_run_at: gate.at.toISOString() }).eq('id', c.id).eq('status', 'running')
          continue
        }
        if (gate.kind === 'complete') {
          if ((c.sending_count || 0) === 0) await finalizeCampaign(supabase, c.id, 'completed')
          continue
        }
        if (gate.kind === 'fail') {
          await finalizeCampaign(supabase, c.id, 'failed', gate.error)
          continue
        }
        const { data: claimed } = await supabase.rpc('wa_claim_next_recipient', { p_campaign_id: c.id })
        const r = Array.isArray(claimed) ? (claimed[0] as CampaignRecipientRecord | undefined) : (claimed as any)
        if (!r) {
          if ((c.sending_count || 0) === 0) await finalizeCampaign(supabase, c.id, 'completed')
          continue
        }
        picked = { c, r }
        break
      }
      if (!picked) {
        // Nada enviável agora (todas em espera/concluídas ou só "sending" em
        // andamento): sai — o próximo tick do cron reavalia.
        summary.stoppedReason = summary.stoppedReason || 'nothing_pickable'
        return summary
      }

      const { c, r } = picked

      // 3a. Lote do próprio destinatário: garante a cota mesmo que o contador
      // do lote esteja errado — se o horário do lote dele ainda não chegou,
      // devolve pra fila e agenda a campanha pro horário do lote.
      if (r.slot_id) {
        const { data: slot } = await supabase.from('wa_campaign_slots').select('run_at').eq('id', r.slot_id).maybeSingle()
        const runAt = slot?.run_at ? new Date(slot.run_at) : null
        if (runAt && runAt.getTime() > Date.now()) {
          await supabase
            .from('wa_campaign_recipients')
            .update({ status: 'pending', claimed_at: null, attempts: Math.max(0, (r.attempts || 1) - 1) })
            .eq('id', r.id)
          await supabase.from('wa_campaigns').update({ next_run_at: runAt.toISOString() }).eq('id', c.id).eq('status', 'running')
          continue
        }
      }

      // 3b. Re-checa controle (pausou/cancelou durante o sleep?)
      const { data: fresh } = await supabase.from('wa_campaigns').select('status').eq('id', c.id).maybeSingle()
      if (!fresh || fresh.status !== 'running') {
        await supabase
          .from('wa_campaign_recipients')
          .update({ status: fresh?.status === 'cancelled' ? 'cancelled' : 'pending', claimed_at: null, attempts: Math.max(0, (r.attempts || 1) - 1) })
          .eq('id', r.id)
        continue
      }

      // 4. Opt-out
      const { data: opt } = await supabase.from('wa_optouts').select('id').eq('phone', r.phone).maybeSingle()
      if (opt) {
        await supabase.from('wa_campaign_recipients').update({ status: 'optout', error: 'Número em opt-out' }).eq('id', r.id)
        await bumpSlot(supabase, r.slot_id)
        summary.skipped += 1
        continue
      }

      // 5. Template + envio
      const templates = await loadTemplates(supabase, c.id, templateCache)
      if (templates.length === 0) {
        await supabase.from('wa_campaign_recipients').update({ status: 'pending', claimed_at: null }).eq('id', r.id)
        await finalizeCampaign(supabase, c.id, 'failed', 'Campanha sem blocos de mensagem')
        continue
      }
      const idx = pickTemplateIndex(c.rotation_mode, c.rotate_templates, r.position, templates.length)
      const block = templates[idx]
      const outcome = await sendRecipient(supabase, inst, client, c, r, block)

      // 6. Persiste após o envio
      await supabase
        .from('wa_campaign_recipients')
        .update({
          status: outcome.ok ? 'sent' : 'failed',
          template_index: idx,
          message_id: outcome.messageId || null,
          zaap_id: outcome.zaapId || null,
          error: outcome.ok ? null : outcome.error,
          sent_at: new Date().toISOString(),
        })
        .eq('id', r.id)
      await bumpSlot(supabase, r.slot_id)

      const outcomeError = outcome.ok ? null : outcome.error
      const consecutive = outcome.ok ? 0 : (c.consecutive_failures || 0) + 1
      const campaignPatch: Record<string, unknown> = {
        last_sent_at: new Date().toISOString(),
        consecutive_failures: consecutive,
        last_error: outcomeError,
      }
      if (consecutive >= MAX_CONSECUTIVE_FAILURES) {
        campaignPatch.status = 'paused'
        campaignPatch.last_error = `Pausada automaticamente após ${consecutive} falhas seguidas: ${outcomeError}`
      }
      await supabase.from('wa_campaigns').update(campaignPatch).eq('id', c.id).eq('status', 'running')
      // Atualiza contador local para o próximo loop enxergar
      c.consecutive_failures = consecutive
      if (outcome.ok) summary.sent += 1
      else summary.failed += 1

      // 7. Delay aleatório (também após falha — mantém o ritmo humano)
      const delayMs = randomBetween(c.delay_min_seconds, c.delay_max_seconds) * 1000
      nextSendAt = Date.now() + delayMs
      await heartbeat(supabase, instanceId, workerId, new Date(nextSendAt).toISOString())
    }
    summary.stoppedReason = summary.stoppedReason || 'budget'
    return summary
  } finally {
    await unlockInstance(supabase, instanceId, workerId)
  }
}

async function loadTemplates(supabase: SupabaseClient, campaignId: string, cache: Map<string, CampaignTemplateBlock[]>) {
  const cached = cache.get(campaignId)
  if (cached) return cached
  const { data } = await supabase.from('wa_campaign_templates').select('*').eq('campaign_id', campaignId).order('position')
  const list = (data || []) as CampaignTemplateBlock[]
  cache.set(campaignId, list)
  return list
}

async function loadSlots(supabase: SupabaseClient, campaignId: string, cache: Map<string, CampaignSlotRecord[]>) {
  // Lotes mudam (sent_count) a cada envio: recarrega sempre, cache só evita
  // consultas repetidas dentro da mesma iteração.
  const { data } = await supabase.from('wa_campaign_slots').select('*').eq('campaign_id', campaignId).order('position')
  const list = (data || []) as CampaignSlotRecord[]
  cache.set(campaignId, list)
  return list
}

async function bumpSlot(supabase: SupabaseClient, slotId: string | null) {
  if (!slotId) return
  const { error } = await supabase.rpc('wa_bump_slot', { p_slot_id: slotId })
  if (error) {
    // Migration 20260820090000 ainda não aplicada: fallback não-atômico.
    const { data } = await supabase.from('wa_campaign_slots').select('sent_count').eq('id', slotId).maybeSingle()
    await supabase.from('wa_campaign_slots').update({ sent_count: (data?.sent_count || 0) + 1 }).eq('id', slotId)
  }
}

// ---------------------------------------------------------------------------
// Envio de um destinatário (mensagem principal → contato → botão anti-ban)
// ---------------------------------------------------------------------------

type SendOutcome = { ok: true; messageId: string; zaapId: string } | { ok: false; error: string; messageId?: string; zaapId?: string }

function extensionOf(fileName: string, mime: string): string {
  const fromName = String(fileName || '').split('.').pop() || ''
  if (fromName && fromName.length <= 5 && /^[a-z0-9]+$/i.test(fromName)) return fromName.toLowerCase()
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'application/zip': 'zip',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/webm': 'webm',
    'image/png': 'png',
    'image/jpeg': 'jpg',
  }
  return map[mime] || 'bin'
}

async function signedMediaUrl(supabase: SupabaseClient, bucket: string, path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket || MEDIA_BUCKET).createSignedUrl(path, MEDIA_SIGNED_TTL)
  if (error || !data?.signedUrl) throw new Error(`Falha ao assinar URL da mídia: ${error?.message || 'sem URL'}`)
  return data.signedUrl
}

export async function sendRecipient(
  supabase: SupabaseClient,
  inst: ZapiInstanceRow,
  client: ZapiClient,
  c: CampaignRecord,
  r: CampaignRecipientRecord,
  block: CampaignTemplateBlock,
): Promise<SendOutcome> {
  const vars = { ...(r.variables || {}), nome: (r.variables as any)?.nome ?? r.name ?? '', telefone: (r.variables as any)?.telefone ?? r.phone }
  const body = renderTemplate(block.body || '', vars)
  const refs = { campaignId: c.id, recipientId: r.id, createdBy: c.created_by || null }

  // Mensagem principal
  let main
  try {
    if (block.media) {
      const url = await signedMediaUrl(supabase, block.media.bucket, block.media.path)
      if (block.media.type === 'image') {
        main = await sendAndLog({ instance: inst, client, phone: r.phone, source: 'campaign', refs, block: { type: 'image', url, caption: body || undefined } })
      } else if (block.media.type === 'document') {
        main = await sendAndLog({
          instance: inst, client, phone: r.phone, source: 'campaign', refs,
          block: { type: 'document', url, extension: extensionOf(block.media.file_name, block.media.mime), fileName: block.media.file_name, caption: body || undefined },
        })
      } else {
        // Áudio não aceita legenda: texto vai antes, áudio depois.
        if (body.trim()) {
          const textRes = await sendAndLog({ instance: inst, client, phone: r.phone, source: 'campaign', refs, block: { type: 'text', body } })
          if (!textRes.ok) return { ok: false, error: textRes.error }
          main = textRes
          const audioRes = await sendAndLog({ instance: inst, client, phone: r.phone, source: 'campaign', refs, block: { type: 'audio', url, delayMessage: 2 } })
          if (!audioRes.ok) return { ok: false, error: `Texto enviado, áudio falhou: ${audioRes.error}`, messageId: textRes.result.messageId, zaapId: textRes.result.zaapId }
        } else {
          main = await sendAndLog({ instance: inst, client, phone: r.phone, source: 'campaign', refs, block: { type: 'audio', url } })
        }
      }
    } else {
      if (!body.trim()) return { ok: false, error: 'Bloco sem texto e sem mídia' }
      main = await sendAndLog({ instance: inst, client, phone: r.phone, source: 'campaign', refs, block: { type: 'text', body } })
    }
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err) }
  }
  if (!main.ok) return { ok: false, error: main.error }

  const outcome: SendOutcome = { ok: true, messageId: main.result.messageId || main.result.id || '', zaapId: main.result.zaapId || '' }

  // Cartão de contato (opcional; falha não derruba o destinatário)
  if (block.contact?.name && block.contact?.phone) {
    await sendAndLog({
      instance: inst, client, phone: r.phone, source: 'campaign_contact', refs,
      block: { type: 'contact', contactName: block.contact.name, contactPhone: block.contact.phone, description: block.contact.description, delayMessage: 2 },
    })
  }

  // Anti-ban (opcional). Modo texto (padrão) sempre entrega; modo botões
  // depende da conta — se a Z-API recusar, cai automaticamente pro texto.
  if (c.antiban && c.antiban.message) {
    const textBlock = {
      type: 'text' as const,
      body: composeAntibanText({ title: c.antiban.title, message: c.antiban.message, footer: c.antiban.footer }),
      delayMessage: 2,
    }
    if (c.antiban.send_as === 'buttons') {
      const btnRes = await sendAndLog({
        instance: inst, client, phone: r.phone, source: 'campaign_button', refs,
        block: {
          type: 'button_list',
          message: composeButtonMessage({ title: c.antiban.title, message: c.antiban.message, footer: c.antiban.footer }),
          buttons: [
            { id: ANTIBAN_BUTTON_YES_ID, label: c.antiban.positive_label || 'Sim' },
            { id: ANTIBAN_BUTTON_NO_ID, label: c.antiban.negative_label || 'Não' },
          ],
          delayMessage: 2,
        },
      })
      if (!btnRes.ok) {
        await sendAndLog({ instance: inst, client, phone: r.phone, source: 'campaign_button', refs, block: textBlock })
      }
    } else {
      await sendAndLog({ instance: inst, client, phone: r.phone, source: 'campaign_button', refs, block: textBlock })
    }
  }

  return outcome
}

// ---------------------------------------------------------------------------
// Kick: dispara o worker imediatamente (fire-and-forget)
// ---------------------------------------------------------------------------

export async function kickWorker(): Promise<void> {
  try {
    const secret = String(process.env.CRON_SECRET || '')
    if (!secret) return
    const { getAppBaseUrl } = await import('@/lib/zapi/webhooks')
    const url = `${getAppBaseUrl()}/api/cron/wa-campaigns?kick=1`
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(2500),
      cache: 'no-store',
    }).catch(() => undefined)
  } catch {
    // silencioso: o cron de 1 min é a rede de segurança
  }
}
