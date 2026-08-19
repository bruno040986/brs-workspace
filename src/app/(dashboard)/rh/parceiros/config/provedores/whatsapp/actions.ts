'use server'

/**
 * Ações de configuração das instâncias Z-API (Configurações → API WhatsApp).
 * Permissão: sistema-config-whatsapp. Segredos nunca voltam ao cliente.
 */

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import {
  ZapiClient,
  applyWebhookChanges,
  buildOurWebhookUrl,
  describeWebhooks,
  getInstanceById,
  isZapiOnline,
  listInstances,
  planWebhookChanges,
  toPublicInstance,
  type WebhookAction,
  type WebhookChange,
  type WebhookState,
  type ZapiInstancePublic,
  type ZapiWebhookKind,
} from '@/lib/zapi'

const RESOURCE = 'sistema-config-whatsapp'
const PAGE_PATH = '/rh/parceiros/config/provedores/whatsapp'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

export type ZapiInstanceInput = {
  id?: string
  name: string
  instance_id: string
  token?: string
  client_token?: string
  /** Ao editar: limpa o Client-Token salvo (campo em branco por padrão preserva). */
  clear_client_token?: boolean
  is_active: boolean
  is_default: boolean
}

export async function listZapiInstances(): Promise<
  { success: true; items: ZapiInstancePublic[]; webhookBase: string } | { success: false; error: string; items: [] }
> {
  try {
    await requirePermission(RESOURCE, 'can_view')
    const rows = await listInstances()
    return { success: true, items: rows.map(toPublicInstance), webhookBase: buildOurWebhookUrl('') }
  } catch (error: any) {
    console.error('Erro ao listar instâncias Z-API:', error)
    return { success: false, error: error.message, items: [] }
  }
}

export async function saveZapiInstance(input: ZapiInstanceInput) {
  try {
    await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')
    const name = String(input.name || '').trim()
    const instanceId = String(input.instance_id || '').trim()
    if (!name) throw new Error('Informe um nome para a instância.')
    if (!instanceId) throw new Error('Informe o ID da instância Z-API.')

    let token = String(input.token || '').trim()
    let clientToken = String(input.client_token || '').trim()

    if (input.id) {
      const current = await getInstanceById(input.id)
      if (!current) throw new Error('Instância não encontrada.')
      // Campo em branco preserva o segredo atual.
      if (!token) token = current.token
      if (!clientToken) clientToken = input.clear_client_token ? '' : current.client_token
    }
    if (!token) throw new Error('Informe o token da instância.')

    if (input.is_default) {
      // Só uma padrão: desmarca as demais antes.
      await supabaseAdmin.from('zapi_instances').update({ is_default: false }).eq('is_default', true)
    }

    const row = {
      name,
      instance_id: instanceId,
      token,
      client_token: clientToken,
      is_active: !!input.is_active,
      is_default: !!input.is_default,
    }

    let savedId = input.id || ''
    if (input.id) {
      const { error } = await supabaseAdmin.from('zapi_instances').update(row).eq('id', input.id)
      if (error) throw error
    } else {
      const { data, error } = await supabaseAdmin.from('zapi_instances').insert(row).select('id').single()
      if (error) throw error
      savedId = data.id
    }

    revalidatePath(PAGE_PATH)
    return { success: true, id: savedId }
  } catch (error: any) {
    console.error('Erro ao salvar instância Z-API:', error)
    if (String(error?.code) === '23505') {
      return { success: false, error: 'Já existe uma instância com esse ID.' }
    }
    return { success: false, error: error.message }
  }
}

export async function deleteZapiInstance(id: string) {
  try {
    await requirePermission(RESOURCE, 'can_delete')
    const { count } = await supabaseAdmin
      .from('wa_campaigns')
      .select('id', { count: 'exact', head: true })
      .eq('instance_id', id)
      .in('status', ['running', 'paused', 'scheduled'])
    if ((count || 0) > 0) throw new Error('Há campanhas ativas usando esta instância. Finalize-as antes de excluir.')
    const { error } = await supabaseAdmin.from('zapi_instances').delete().eq('id', id)
    if (error) throw error
    revalidatePath(PAGE_PATH)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao excluir instância Z-API:', error)
    return { success: false, error: error.message }
  }
}

export async function setZapiInstanceActive(id: string, isActive: boolean) {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const { error } = await supabaseAdmin.from('zapi_instances').update({ is_active: isActive }).eq('id', id)
    if (error) throw error
    revalidatePath(PAGE_PATH)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function setZapiInstanceDefault(id: string) {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    await supabaseAdmin.from('zapi_instances').update({ is_default: false }).eq('is_default', true)
    const { error } = await supabaseAdmin.from('zapi_instances').update({ is_default: true }).eq('id', id)
    if (error) throw error
    revalidatePath(PAGE_PATH)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

/**
 * Testa a conexão: GET status + GET device. Aceita credenciais avulsas (antes
 * de salvar) ou o id de uma instância salva (cacheia o resultado).
 */
export async function testZapiInstance(input: { id?: string; instance_id?: string; token?: string; client_token?: string }) {
  try {
    await requirePermission(RESOURCE, 'can_view')
    let client: ZapiClient
    let savedId: string | null = null
    if (input.id) {
      const row = await getInstanceById(input.id)
      if (!row) throw new Error('Instância não encontrada.')
      // Permite sobrepor credenciais digitadas (ainda não salvas) sobre as salvas.
      client = ZapiClient.forCredentials({
        instanceId: input.instance_id || row.instance_id,
        token: input.token || row.token,
        clientToken: input.client_token !== undefined && input.client_token !== '' ? input.client_token : row.client_token,
      })
      savedId = row.id
    } else {
      client = ZapiClient.forCredentials({
        instanceId: String(input.instance_id || ''),
        token: String(input.token || ''),
        clientToken: String(input.client_token || ''),
      })
    }

    const status = await client.getStatus()
    let device: any = null
    try {
      device = await client.getDevice()
    } catch {
      device = null
    }
    if (savedId) {
      await supabaseAdmin
        .from('zapi_instances')
        .update({ last_status: status, last_device: device, last_checked_at: new Date().toISOString() })
        .eq('id', savedId)
      revalidatePath(PAGE_PATH)
    }
    return { success: true, online: isZapiOnline(status), status, device }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export type WebhookOverview = {
  states: WebhookState[]
  ourUrl: string
  me: Record<string, unknown> | null
}

export async function readZapiInstanceWebhooks(id: string): Promise<{ success: true; overview: WebhookOverview } | { success: false; error: string }> {
  try {
    await requirePermission(RESOURCE, 'can_view')
    const row = await getInstanceById(id)
    if (!row) throw new Error('Instância não encontrada.')
    const client = ZapiClient.fromInstance(row)
    const me = await client.getMe()
    const states = describeWebhooks(me, row)
    const safeMe: Record<string, unknown> = { ...me }
    delete safeMe.token
    return { success: true, overview: { states, ourUrl: buildOurWebhookUrl(row.webhook_key), me: safeMe } }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

/** Devolve o plano (sem executar) para o usuário confirmar. */
export async function planZapiInstanceWebhooks(id: string, action: WebhookAction, kinds?: ZapiWebhookKind[]) {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const row = await getInstanceById(id)
    if (!row) throw new Error('Instância não encontrada.')
    const client = ZapiClient.fromInstance(row)
    const me = await client.getMe()
    const states = describeWebhooks(me, row)
    const changes = planWebhookChanges(states, row, action, kinds)
    return { success: true, changes }
  } catch (error: any) {
    return { success: false, error: error.message, changes: [] as WebhookChange[] }
  }
}

export async function applyZapiInstanceWebhooks(id: string, changes: WebhookChange[]) {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const row = await getInstanceById(id)
    if (!row) throw new Error('Instância não encontrada.')
    if (!Array.isArray(changes) || changes.length === 0) throw new Error('Nenhuma alteração para aplicar.')
    // Segurança: só aceitamos alterações cujo destino é a nossa URL ou uma
    // restauração para a URL de relay guardada.
    const ourUrl = buildOurWebhookUrl(row.webhook_key)
    for (const c of changes) {
      if (c.action === 'restore') {
        const relay = String(row.webhook_relay_urls?.[c.kind] || '')
        if (c.toUrl !== relay) throw new Error(`Restauração inválida para ${c.kind}.`)
      } else if (c.toUrl !== ourUrl) {
        throw new Error(`Destino inválido para ${c.kind}.`)
      }
    }
    const client = ZapiClient.fromInstance(row)
    const result = await applyWebhookChanges(client, row, changes)
    const { error } = await supabaseAdmin.from('zapi_instances').update(result.patch).eq('id', id)
    if (error) throw error
    revalidatePath(PAGE_PATH)
    return { success: true, applied: result.applied.length, failed: result.failed }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

/** Envia uma mensagem de teste pela instância (registrada como source 'test'). */
export async function sendZapiTestMessage(id: string, phone: string, message: string) {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const row = await getInstanceById(id)
    if (!row) throw new Error('Instância não encontrada.')
    const { sendAndLog } = await import('@/lib/zapi')
    const res = await sendAndLog({
      instance: row,
      phone,
      source: 'test',
      block: { type: 'text', body: String(message || 'Teste de conexão BRS Gestão ✅') },
      refs: { createdBy: user.id },
    })
    if (!res.ok) throw new Error(res.error)
    return { success: true, messageId: res.result.messageId }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
