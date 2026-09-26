'use server'

/**
 * Card "Nuvidio" em Provedores e APIs — permissão `sistema-config-nuvidio`.
 * Credenciais (API KEY/SECRET) cifradas no cofre; write-only na UI.
 */

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'
import { ERRO_IGNORADO, processarWebhookNuvidio } from './webhooks'
import {
  lerNuvidioConfigPublica,
  salvarNuvidioConfig,
  testarConexaoNuvidio,
  type NuvidioConfigPublica,
  type NuvidioDepartment,
} from './client'

export async function getNuvidioConfig(): Promise<{ success: boolean; data?: NuvidioConfigPublica; error?: string }> {
  try {
    await requirePermission('sistema-config-nuvidio')
    const data = await lerNuvidioConfigPublica()
    return { success: true, data }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function saveNuvidioConfig(input: {
  apiKey?: string
  apiSecret?: string
  departmentPadraoId: string
  departmentPadraoNome: string
  departmentOnboardingId: string
  departmentOnboardingNome: string
  webhookKey?: string
  isActive: boolean
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermission('sistema-config-nuvidio', 'can_edit')
    await salvarNuvidioConfig({ ...input, updatedBy: user.id })
    revalidatePath('/rh/parceiros/config/provedores/nuvidio')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function testNuvidioConnection(): Promise<{ ok: boolean; detalhe: string; departments?: NuvidioDepartment[] }> {
  try {
    await requirePermission('sistema-config-nuvidio')
    return await testarConexaoNuvidio()
  } catch (err: any) {
    return { ok: false, detalhe: err.message }
  }
}

// ---------------------------------------------------------------------------
// Inbox de webhooks (fatia 1) — últimos recebidos + reprocessar os sem convite
// ---------------------------------------------------------------------------

export type NuvidioWebhookRow = {
  id: string
  hook_type: string
  invite_id: string
  call_id: string
  convite_id: string | null
  recebido_em: string
  processado_em: string | null
  erro: string
  cliente: string
}

export async function listarWebhooksNuvidio(): Promise<{ success: boolean; data?: NuvidioWebhookRow[]; error?: string }> {
  try {
    await requirePermission('sistema-config-nuvidio')
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('nuvidio_webhooks_recebidos')
      .select('id, hook_type, invite_id, call_id, convite_id, recebido_em, processado_em, erro, cliente:payload->content->customer->>name')
      .order('recebido_em', { ascending: false })
      .limit(50)
    if (error) throw error
    return { success: true, data: (data || []).map((r: any) => ({ ...r, cliente: String(r.cliente || '') })) as NuvidioWebhookRow[] }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/** Reprocessa os webhooks que ainda não casaram com convite (últimos 200). */
export async function reprocessarWebhooksNuvidio(): Promise<{ success: boolean; total?: number; casaram?: number; error?: string }> {
  try {
    await requirePermission('sistema-config-nuvidio', 'can_edit')
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('nuvidio_webhooks_recebidos')
      .select('id')
      .is('convite_id', null)
      .neq('erro', ERRO_IGNORADO)
      .order('recebido_em', { ascending: true })
      .limit(200)
    if (error) throw error
    let casaram = 0
    for (const r of data || []) {
      const res = await processarWebhookNuvidio(admin, String(r.id)).catch((e: any) => ({ matched: false, erro: String(e?.message || e) }))
      if (res.matched) casaram += 1
    }
    revalidatePath('/rh/parceiros/config/provedores/nuvidio')
    return { success: true, total: (data || []).length, casaram }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
