'use server'

/**
 * Ações do subsistema "Disparo de WhatsApp" (Comercial).
 * Permissão: comercial-disparo-whatsapp.
 */

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { requirePermission } from '@/lib/auth/server'
import { listInstances, toPublicInstance, type ZapiInstancePublic } from '@/lib/zapi'
import { normalizeBrPhone } from '@/lib/zapi/phone'
import { kickWorker, MEDIA_BUCKET } from '@/lib/disparo-whatsapp/worker'
import {
  AGENT_PHONE_FIELDS,
  DELAY_MAX_LIMIT,
  DELAY_MIN_LIMIT,
  readPath,
  validateSlots,
  type AntibanConfig,
  type CampaignRecipientRecord,
  type CampaignRecord,
  type CampaignSlotInput,
  type CampaignSlotRecord,
  type CampaignSourceType,
  type CampaignTemplateBlock,
  type RecipientDraft,
  type RecipientStatus,
  type RotationMode,
  type ScheduleMode,
} from '@/lib/disparo-whatsapp'

const RESOURCE = 'comercial-disparo-whatsapp'
const BASE_PATH = '/disparo-whatsapp'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

function revalidate(id?: string) {
  revalidatePath(BASE_PATH)
  if (id) revalidatePath(`${BASE_PATH}/${id}`)
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export async function listCampaigns(): Promise<
  { success: true; items: CampaignRecord[]; instances: ZapiInstancePublic[] } | { success: false; error: string; items: []; instances: [] }
> {
  try {
    await requirePermission(RESOURCE, 'can_view')
    const [{ data, error }, instances] = await Promise.all([
      supabaseAdmin.from('wa_campaigns').select('*').order('created_at', { ascending: false }).limit(200),
      listInstances(),
    ])
    if (error) throw error
    return { success: true, items: (data || []) as CampaignRecord[], instances: instances.map(toPublicInstance) }
  } catch (error: any) {
    console.error('Erro ao listar campanhas:', error)
    return { success: false, error: error.message, items: [], instances: [] }
  }
}

export async function listInstancesForCampaign() {
  try {
    await requirePermission(RESOURCE, 'can_view')
    const rows = await listInstances({ activeOnly: true })
    return { success: true, items: rows.map(toPublicInstance) }
  } catch (error: any) {
    return { success: false, error: error.message, items: [] as ZapiInstancePublic[] }
  }
}

export type CampaignDetail = {
  campaign: CampaignRecord
  templates: CampaignTemplateBlock[]
  slots: CampaignSlotRecord[]
  instance: ZapiInstancePublic | null
}

export async function getCampaign(id: string): Promise<{ success: true; detail: CampaignDetail } | { success: false; error: string }> {
  try {
    await requirePermission(RESOURCE, 'can_view')
    const [{ data: campaign, error }, { data: templates }, { data: slots }] = await Promise.all([
      supabaseAdmin.from('wa_campaigns').select('*').eq('id', id).maybeSingle(),
      supabaseAdmin.from('wa_campaign_templates').select('*').eq('campaign_id', id).order('position'),
      supabaseAdmin.from('wa_campaign_slots').select('*').eq('campaign_id', id).order('position'),
    ])
    if (error) throw error
    if (!campaign) throw new Error('Campanha não encontrada.')
    const instances = await listInstances()
    const inst = instances.find((i) => i.id === campaign.instance_id) || null
    // URLs de preview das mídias
    const withPreview: CampaignTemplateBlock[] = []
    for (const t of (templates || []) as CampaignTemplateBlock[]) {
      if (t.media?.path) {
        const { data } = await supabaseAdmin.storage.from(t.media.bucket || MEDIA_BUCKET).createSignedUrl(t.media.path, 3600)
        withPreview.push({ ...t, media: { ...t.media, preview_url: data?.signedUrl || undefined } })
      } else withPreview.push(t)
    }
    return {
      success: true,
      detail: {
        campaign: campaign as CampaignRecord,
        templates: withPreview,
        slots: (slots || []) as CampaignSlotRecord[],
        instance: inst ? toPublicInstance(inst) : null,
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function listCampaignRecipients(
  id: string,
  options: { page?: number; pageSize?: number; status?: RecipientStatus | 'all'; q?: string } = {},
) {
  try {
    await requirePermission(RESOURCE, 'can_view')
    const page = Math.max(1, Number(options.page || 1))
    const pageSize = Math.min(200, Math.max(10, Number(options.pageSize || 100)))
    const from = (page - 1) * pageSize
    let query = supabaseAdmin
      .from('wa_campaign_recipients')
      .select('*', { count: 'exact' })
      .eq('campaign_id', id)
      .order('position')
      .range(from, from + pageSize - 1)
    if (options.status && options.status !== 'all') query = query.eq('status', options.status)
    const q = String(options.q || '').trim()
    if (q) {
      const digits = q.replace(/\D/g, '')
      query = digits.length >= 4 ? query.or(`phone.ilike.%${digits}%,name.ilike.%${q}%`) : query.ilike('name', `%${q}%`)
    }
    const { data, error, count } = await query
    if (error) throw error
    return { success: true, items: (data || []) as CampaignRecipientRecord[], total: count || 0, page, pageSize }
  } catch (error: any) {
    return { success: false, error: error.message, items: [] as CampaignRecipientRecord[], total: 0, page: 1, pageSize: 100 }
  }
}

// ---------------------------------------------------------------------------
// Base: Agentes Corban
// ---------------------------------------------------------------------------

export type AgentForCampaign = {
  id: string
  name: string
  fantasy_name: string
  cpf_cnpj: string
  arw_code: string
  email: string
  status: string
  person_type: string
  tipo_agente: string
  filial: string
  nivel_acesso: string
  /** key do campo → telefones encontrados (já normalizados). */
  phones: Record<string, string[]>
}

export async function listAgentsForCampaign(): Promise<{ success: true; items: AgentForCampaign[] } | { success: false; error: string; items: [] }> {
  try {
    await requirePermission(RESOURCE, 'can_view')
    const { data, error } = await supabaseAdmin
      .from('agentes_parceiros')
      .select('id, name, fantasy_name, cpf_cnpj, arw_code, email_comissao, status, person_type, tipo_agente, filial, nivel_acesso, phone_whatsapp, phone_whatsapp_financeiro, phone_commercial, phone_residential, phone_support, corban_data')
      .order('name')
    if (error) throw error
    const items: AgentForCampaign[] = (data || []).map((row: any) => {
      const phones: Record<string, string[]> = {}
      for (const f of AGENT_PHONE_FIELDS) {
        const raw = f.source === 'column' ? [row[f.path]] : readPath(row.corban_data || {}, f.path)
        const normalized = Array.from(new Set(raw.map((v: any) => normalizeBrPhone(v)).filter(Boolean))) as string[]
        if (normalized.length) phones[f.key] = normalized
      }
      return {
        id: row.id,
        name: row.name || '',
        fantasy_name: row.fantasy_name || '',
        cpf_cnpj: row.cpf_cnpj || '',
        arw_code: row.arw_code || '',
        email: row.email_comissao || '',
        status: row.status || '',
        person_type: row.person_type || '',
        tipo_agente: row.tipo_agente || '',
        filial: row.filial || '',
        nivel_acesso: row.nivel_acesso || '',
        phones,
      }
    })
    return { success: true, items }
  } catch (error: any) {
    console.error('Erro ao listar agentes para campanha:', error)
    return { success: false, error: error.message, items: [] }
  }
}

/** Modelos de WhatsApp do SCP (para importar o texto num bloco). */
export async function listWhatsappTemplatesForCampaign() {
  try {
    await requirePermission(RESOURCE, 'can_view')
    const { data, error } = await supabaseAdmin.from('whatsapp_templates').select('id, name, body, is_active').order('name')
    if (error) throw error
    return { success: true, items: (data || []).filter((t: any) => t.is_active !== false) as Array<{ id: string; name: string; body: string }> }
  } catch (error: any) {
    return { success: false, error: error.message, items: [] as Array<{ id: string; name: string; body: string }> }
  }
}

// ---------------------------------------------------------------------------
// Criação / edição
// ---------------------------------------------------------------------------

export type CampaignDraftPayload = {
  id?: string
  name: string
  instance_id: string
  source_type: CampaignSourceType
  variables: string[]
  /** Ao editar rascunho: apaga os destinatários gravados (o wizard reenvia). */
  replace_recipients?: boolean
  templates: Array<{ body: string; media: CampaignTemplateBlock['media']; contact: CampaignTemplateBlock['contact'] }>
  settings: {
    delay_min_seconds: number
    delay_max_seconds: number
    rotate_templates: boolean
    rotation_mode: RotationMode
    antiban: AntibanConfig | null
  }
  schedule: {
    schedule_mode: ScheduleMode
    start_at: string | null
    allowed_weekdays: number[]
    window_start: string | null
    window_end: string | null
    timezone: string
    slots: CampaignSlotInput[]
  }
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function sanitizeAntiban(input: AntibanConfig | null | undefined): AntibanConfig | null {
  if (!input || !String(input.message || '').trim()) return null
  return {
    title: String(input.title || '').trim().slice(0, 80),
    footer: String(input.footer || '').trim().slice(0, 120),
    message: String(input.message || '').trim().slice(0, 1000),
    positive_label: String(input.positive_label || 'Sim').trim().slice(0, 40) || 'Sim',
    negative_label: String(input.negative_label || 'Não').trim().slice(0, 40) || 'Não',
    send_as: input.send_as === 'buttons' ? 'buttons' : 'text',
  }
}

/**
 * Cria (ou substitui, se `id` de rascunho) a campanha com blocos, lotes e
 * configurações. Destinatários vão em seguida via addCampaignRecipients.
 */
export async function saveCampaignDraft(payload: CampaignDraftPayload) {
  try {
    const { user } = await requirePermission(RESOURCE, payload.id ? 'can_edit' : 'can_include')
    const name = String(payload.name || '').trim()
    if (!name) throw new Error('Informe o nome da campanha.')
    if (!payload.instance_id) throw new Error('Selecione a instância Z-API.')
    const templates = (payload.templates || []).filter((t) => String(t.body || '').trim() || t.media)
    if (templates.length === 0) throw new Error('Adicione pelo menos um bloco de mensagem (texto ou mídia).')

    const delayMin = clampInt(payload.settings?.delay_min_seconds, DELAY_MIN_LIMIT, DELAY_MAX_LIMIT, 30)
    const delayMax = clampInt(payload.settings?.delay_max_seconds, delayMin, DELAY_MAX_LIMIT, Math.max(delayMin, 60))
    const weekdays = Array.from(new Set((payload.schedule?.allowed_weekdays || [0, 1, 2, 3, 4, 5, 6]).map(Number).filter((n) => n >= 0 && n <= 6)))
    if (weekdays.length === 0) throw new Error('Selecione pelo menos um dia da semana.')
    const windowStart = payload.schedule?.window_start || null
    const windowEnd = payload.schedule?.window_end || null
    if ((windowStart && !windowEnd) || (!windowStart && windowEnd)) throw new Error('Informe início e fim da janela de horário.')
    if (windowStart && windowEnd && windowStart >= windowEnd) throw new Error('O fim da janela precisa ser depois do início.')

    const row = {
      name,
      instance_id: payload.instance_id,
      source_type: payload.source_type,
      variables: Array.from(new Set((payload.variables || []).map((v) => String(v).trim()).filter(Boolean))),
      delay_min_seconds: delayMin,
      delay_max_seconds: delayMax,
      rotate_templates: payload.settings?.rotate_templates !== false,
      rotation_mode: payload.settings?.rotation_mode === 'random' ? 'random' : 'sequential',
      antiban: sanitizeAntiban(payload.settings?.antiban),
      schedule_mode: payload.schedule?.schedule_mode === 'batches' ? 'batches' : 'direct',
      start_at: payload.schedule?.start_at || null,
      allowed_weekdays: weekdays,
      window_start: windowStart,
      window_end: windowEnd,
      timezone: payload.schedule?.timezone || 'America/Sao_Paulo',
      status: 'draft',
    }

    let campaignId = payload.id || ''
    if (payload.id) {
      const { data: existing } = await supabaseAdmin.from('wa_campaigns').select('status').eq('id', payload.id).maybeSingle()
      if (!existing) throw new Error('Campanha não encontrada.')
      if (existing.status !== 'draft') throw new Error('Só rascunhos podem ser editados.')
      const { error } = await supabaseAdmin.from('wa_campaigns').update(row).eq('id', payload.id)
      if (error) throw error
      // Substitui blocos e lotes (o wizard reenvia); destinatários só se pedido.
      await supabaseAdmin.from('wa_campaign_templates').delete().eq('campaign_id', payload.id)
      await supabaseAdmin.from('wa_campaign_slots').delete().eq('campaign_id', payload.id)
      if (payload.replace_recipients) {
        await supabaseAdmin.from('wa_campaign_recipients').delete().eq('campaign_id', payload.id)
        await supabaseAdmin.rpc('wa_campaign_recount', { p_campaign_id: payload.id })
      } else {
        await supabaseAdmin.from('wa_campaign_recipients').update({ slot_id: null }).eq('campaign_id', payload.id)
      }
    } else {
      const { data, error } = await supabaseAdmin.from('wa_campaigns').insert({ ...row, created_by: user.id }).select('id').single()
      if (error) throw error
      campaignId = data.id
    }

    const { error: tErr } = await supabaseAdmin.from('wa_campaign_templates').insert(
      templates.map((t, i) => ({ campaign_id: campaignId, position: i, body: String(t.body || ''), media: t.media || null, contact: t.contact?.name && t.contact?.phone ? t.contact : null })),
    )
    if (tErr) throw tErr

    if (row.schedule_mode === 'batches' && payload.schedule.slots?.length) {
      const { error: sErr } = await supabaseAdmin.from('wa_campaign_slots').insert(
        payload.schedule.slots.map((s, i) => ({ campaign_id: campaignId, position: i, run_at: s.run_at, quantity: Math.max(1, Math.round(Number(s.quantity) || 0)) })),
      )
      if (sErr) throw sErr
    }

    revalidate(campaignId)
    return { success: true, id: campaignId }
  } catch (error: any) {
    console.error('Erro ao salvar campanha:', error)
    return { success: false, error: error.message }
  }
}

/** Insere um lote de destinatários (chunk ≤ 1000). Duplicados por telefone são ignorados. */
export async function addCampaignRecipients(campaignId: string, recipients: RecipientDraft[], startPosition: number) {
  try {
    await requirePermission(RESOURCE, 'can_include')
    const list = (recipients || []).slice(0, 1000)
    if (!list.length) return { success: true, inserted: 0 }
    const rows = list.map((r, i) => ({
      campaign_id: campaignId,
      position: startPosition + i,
      phone: normalizeBrPhone(r.phone) || r.phone,
      phone_raw: r.phone_raw || null,
      name: r.name || null,
      variables: r.variables || {},
      source_ref: r.source_ref || null,
      status: 'pending',
    }))
    const { error, data } = await supabaseAdmin
      .from('wa_campaign_recipients')
      .upsert(rows, { onConflict: 'campaign_id,phone', ignoreDuplicates: true })
      .select('id')
    if (error) throw error
    return { success: true, inserted: data?.length || 0 }
  } catch (error: any) {
    console.error('Erro ao inserir destinatários:', error)
    return { success: false, error: error.message, inserted: 0 }
  }
}

/**
 * Finaliza o rascunho: valida, atribui lotes, e (se startNow) coloca em
 * execução/agendada e chama o worker.
 */
export async function finalizeCampaign(campaignId: string, options: { startNow: boolean }) {
  try {
    await requirePermission(RESOURCE, 'can_include')
    const { data: c, error } = await supabaseAdmin.from('wa_campaigns').select('*').eq('id', campaignId).maybeSingle()
    if (error) throw error
    if (!c) throw new Error('Campanha não encontrada.')
    if (c.status !== 'draft') throw new Error('Campanha já finalizada.')

    await supabaseAdmin.rpc('wa_campaign_recount', { p_campaign_id: campaignId })
    const { count: total } = await supabaseAdmin.from('wa_campaign_recipients').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId)
    if (!total) throw new Error('A campanha não tem destinatários válidos.')

    const { count: blocks } = await supabaseAdmin.from('wa_campaign_templates').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId)
    if (!blocks) throw new Error('A campanha não tem blocos de mensagem.')

    let firstRunAt: Date | null = null
    if (c.schedule_mode === 'batches') {
      const { data: slots } = await supabaseAdmin.from('wa_campaign_slots').select('*').eq('campaign_id', campaignId).order('position')
      const check = validateSlots((slots || []) as CampaignSlotInput[], total)
      if (!check.ok) throw new Error(check.error)
      // Atribui slot_id por posição cumulativa
      const { data: recips } = await supabaseAdmin.from('wa_campaign_recipients').select('id, position').eq('campaign_id', campaignId).order('position')
      let cursor = 0
      for (const s of (slots || []) as CampaignSlotRecord[]) {
        const ids = (recips || []).slice(cursor, cursor + s.quantity).map((r: any) => r.id)
        cursor += s.quantity
        if (ids.length) await supabaseAdmin.from('wa_campaign_recipients').update({ slot_id: s.id }).in('id', ids)
      }
      firstRunAt = slots?.[0]?.run_at ? new Date(slots[0].run_at) : null
    } else if (c.start_at) {
      firstRunAt = new Date(c.start_at)
    }

    if (!options.startNow) {
      revalidate(campaignId)
      return { success: true, status: 'draft' as const }
    }

    const now = new Date()
    const scheduled = !!firstRunAt && firstRunAt.getTime() > now.getTime() + 30_000
    const { error: uErr } = await supabaseAdmin
      .from('wa_campaigns')
      .update({
        status: scheduled ? 'scheduled' : 'running',
        next_run_at: scheduled ? firstRunAt!.toISOString() : now.toISOString(),
        started_at: scheduled ? null : now.toISOString(),
        last_error: null,
        consecutive_failures: 0,
      })
      .eq('id', campaignId)
      .eq('status', 'draft')
    if (uErr) throw uErr
    if (!scheduled) after(() => kickWorker())
    revalidate(campaignId)
    return { success: true, status: scheduled ? ('scheduled' as const) : ('running' as const) }
  } catch (error: any) {
    console.error('Erro ao finalizar campanha:', error)
    return { success: false, error: error.message }
  }
}

// ---------------------------------------------------------------------------
// Controle
// ---------------------------------------------------------------------------

export async function startCampaign(id: string) {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const { data: c } = await supabaseAdmin.from('wa_campaigns').select('status').eq('id', id).maybeSingle()
    if (!c) throw new Error('Campanha não encontrada.')
    if (c.status === 'draft') return finalizeCampaign(id, { startNow: true })
    if (!['scheduled', 'paused'].includes(c.status)) throw new Error(`Campanha em "${c.status}" não pode ser iniciada.`)
    const { error } = await supabaseAdmin
      .from('wa_campaigns')
      .update({ status: 'running', next_run_at: new Date().toISOString(), started_at: new Date().toISOString(), last_error: null, consecutive_failures: 0 })
      .eq('id', id)
      .in('status', ['scheduled', 'paused'])
    if (error) throw error
    after(() => kickWorker())
    revalidate(id)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function pauseCampaign(id: string) {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const { error } = await supabaseAdmin.from('wa_campaigns').update({ status: 'paused' }).eq('id', id).in('status', ['running', 'scheduled'])
    if (error) throw error
    revalidate(id)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function resumeCampaign(id: string) {
  return startCampaign(id)
}

export async function cancelCampaign(id: string) {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const { error } = await supabaseAdmin
      .from('wa_campaigns')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), next_run_at: null })
      .eq('id', id)
      .in('status', ['draft', 'scheduled', 'running', 'paused'])
    if (error) throw error
    await supabaseAdmin.from('wa_campaign_recipients').update({ status: 'cancelled' }).eq('campaign_id', id).in('status', ['pending', 'sending'])
    revalidate(id)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function deleteCampaign(id: string) {
  try {
    await requirePermission(RESOURCE, 'can_delete')
    const { data: c } = await supabaseAdmin.from('wa_campaigns').select('status').eq('id', id).maybeSingle()
    if (!c) throw new Error('Campanha não encontrada.')
    if (['running', 'scheduled'].includes(c.status)) throw new Error('Pause ou cancele a campanha antes de excluir.')
    const { data: media } = await supabaseAdmin.from('wa_campaign_templates').select('media').eq('campaign_id', id)
    const paths = (media || []).map((m: any) => m?.media?.path).filter(Boolean)
    if (paths.length) await supabaseAdmin.storage.from(MEDIA_BUCKET).remove(paths)
    const { error } = await supabaseAdmin.from('wa_campaigns').delete().eq('id', id)
    if (error) throw error
    revalidate()
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

/** Reenvia destinatários com falha (todos ou os ids informados). */
export async function retryFailedRecipients(id: string, recipientIds?: string[]) {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    let query = supabaseAdmin.from('wa_campaign_recipients').update({ status: 'pending', error: null, claimed_at: null }).eq('campaign_id', id).eq('status', 'failed')
    if (recipientIds?.length) query = query.in('id', recipientIds)
    const { data, error } = await query.select('id')
    if (error) throw error
    const reset = data?.length || 0
    if (reset > 0) {
      const { data: c } = await supabaseAdmin.from('wa_campaigns').select('status').eq('id', id).maybeSingle()
      if (c && ['completed', 'paused', 'failed'].includes(c.status)) {
        await supabaseAdmin
          .from('wa_campaigns')
          .update({ status: 'running', next_run_at: new Date().toISOString(), finished_at: null, last_error: null, consecutive_failures: 0 })
          .eq('id', id)
        after(() => kickWorker())
      }
    }
    revalidate(id)
    return { success: true, reset }
  } catch (error: any) {
    return { success: false, error: error.message, reset: 0 }
  }
}

export async function refreshCampaignCounters(id: string) {
  try {
    await requirePermission(RESOURCE, 'can_view')
    await supabaseAdmin.rpc('wa_campaign_recount', { p_campaign_id: id })
    revalidate(id)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

/** Dispara o worker manualmente (ex.: "Processar agora"). */
export async function pokeWorker() {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    after(() => kickWorker())
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

// ---------------------------------------------------------------------------
// Mídia
// ---------------------------------------------------------------------------

export async function getCampaignMediaPreviewUrl(path: string) {
  try {
    await requirePermission(RESOURCE, 'can_view')
    const { data, error } = await supabaseAdmin.storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600)
    if (error) throw error
    return { success: true, url: data.signedUrl }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

// ---------------------------------------------------------------------------
// Opt-outs
// ---------------------------------------------------------------------------

export type OptoutRecord = {
  id: string
  phone: string
  source: 'button' | 'text' | 'manual'
  reason: string | null
  campaign_id: string | null
  message_id: string | null
  created_at: string
}

export async function listOptouts(q?: string) {
  try {
    await requirePermission(RESOURCE, 'can_view')
    let query = supabaseAdmin.from('wa_optouts').select('*').order('created_at', { ascending: false }).limit(1000)
    const digits = String(q || '').replace(/\D/g, '')
    if (digits) query = query.ilike('phone', `%${digits}%`)
    const { data, error } = await query
    if (error) throw error
    return { success: true, items: (data || []) as OptoutRecord[] }
  } catch (error: any) {
    return { success: false, error: error.message, items: [] as OptoutRecord[] }
  }
}

export async function addOptouts(phones: string[], reason?: string) {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_include')
    const normalized = Array.from(new Set((phones || []).map((p) => normalizeBrPhone(p)).filter(Boolean))) as string[]
    if (!normalized.length) throw new Error('Nenhum telefone válido informado.')
    const { error } = await supabaseAdmin
      .from('wa_optouts')
      .upsert(normalized.map((phone) => ({ phone, source: 'manual', reason: reason || null, created_by: user.id })), { onConflict: 'phone', ignoreDuplicates: true })
    if (error) throw error
    // Marca pendentes das campanhas em execução/pausadas/agendadas
    await supabaseAdmin
      .from('wa_campaign_recipients')
      .update({ status: 'optout', error: 'Número em opt-out' })
      .in('phone', normalized)
      .eq('status', 'pending')
    revalidatePath(`${BASE_PATH}/optouts`)
    return { success: true, added: normalized.length }
  } catch (error: any) {
    return { success: false, error: error.message, added: 0 }
  }
}

export async function removeOptout(id: string) {
  try {
    await requirePermission(RESOURCE, 'can_delete')
    const { error } = await supabaseAdmin.from('wa_optouts').delete().eq('id', id)
    if (error) throw error
    revalidatePath(`${BASE_PATH}/optouts`)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
