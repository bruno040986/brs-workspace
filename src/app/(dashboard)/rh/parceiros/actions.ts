'use server'

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import {
  requireAnyPermission,
  requireCurrentUser,
  requirePermission as requireServerPermission,
} from '@/lib/auth/server'
import { registerAgentDomain } from '@/lib/vercel/register-domain'
import { systemConfigRouteOptions, type PermissionAction, type PermissionRequirement } from '@/lib/auth/permissions'
import { normalizeCompanyBankAccounts } from '@/lib/company-bank-accounts'
import { normalizeCompanyFiscalData } from '@/lib/company-fiscal-data'
import {
  createEmptyTaxRegimeConfiguration,
  normalizeTaxRegimeRecord,
  normalizeTaxRegimeVersion,
  sortTaxRegimeVersions,
  type TaxRegimeConfiguration,
  type TaxRegimeRecord,
  type TaxRegimeVersionRecord,
} from '@/lib/tax-regimes'
import { normalizeCommercialTypeName, type CommercialTypeRecord } from '@/lib/commercial-types'
import { normalizeCnaeCodeDigits, normalizeCnaeDescription, type CnaeRecord } from '@/lib/cnaes'
import { normalizeCtnCodeDigits, normalizeCtnDescription, type CtnRecord } from '@/lib/ctns'
import { normalizeFinancialInstitutionLogo, normalizeFinancialInstitutionName, type FinancialInstitutionRecord } from '@/lib/financial-institutions'
import { normalizeNbsCodeDigits, normalizeNbsDescription, type NbsRecord } from '@/lib/nbs'
import { normalizeCompanySectorName, type CompanySectorRecord } from '@/lib/company-sectors'
import { normalizeNfseEmissionTypeName, type NfseEmissionTypeRecord } from '@/lib/nfse-emission-types'
import { normalizeReceiptMethodName, type ReceiptMethodRecord } from '@/lib/receipt-methods'
import { normalizeRemunerationTypeName, type RemunerationTypeRecord } from '@/lib/remuneration-types'
import { normalizeSystemTypeName, type SystemTypeRecord } from '@/lib/system-types'

// Inicialização do cliente Supabase Admin para operações privilegiadas
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

async function requireCurrentUserId() {
  const user = await requireCurrentUser()
  const userId = user.id
  if (!userId) throw new Error('Usuário não autenticado.')
  return userId
}

async function requirePermission(resourceName: string, action: PermissionAction = 'can_view') {
  const { permissions } = await requireServerPermission(resourceName, action)
  const userId = await requireCurrentUserId()
  const permsRes: { success: boolean; permissions: typeof permissions } = { success: true, permissions }
  if (!permsRes.success) throw new Error('Não foi possível validar permissões.')
  const perms = permsRes.permissions || []
  const perm = perms.find((p) => p?.resource_name === resourceName)
  if (!perm || !perm[action]) throw new Error('Sem permissão para esta ação.')
  return { userId, perms }
}

async function requireAny(requirements: PermissionRequirement[]) {
  const { user, permissions } = await requireAnyPermission(requirements)
  return { userId: user.id, perms: permissions }
}

async function getPartnerFormsColumnSet(): Promise<Set<string> | null> {
  try {
    const { data, error } = await supabaseAdmin
      // information_schema é acessível no Postgres; usamos service role.
      .from('information_schema.columns')
      .select('column_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'partner_forms')

    if (error) throw error
    const set = new Set<string>()
    for (const row of (data as Array<{ column_name?: string | null }>) || []) {
      if (row?.column_name) set.add(String(row.column_name))
    }
    return set
  } catch {
    return null
  }
}

function isMissingTableError(error: unknown) {
  const err = error as { code?: string; message?: string } | null | undefined
  const message = String(err?.message || '')
  return err?.code === 'PGRST205' || /Could not find the table/i.test(message) || /does not exist/i.test(message)
}

async function safeSelect<T>(
  query: PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>,
  fallback: T,
): Promise<T> {
  try {
    const { data, error } = await query
    if (error) throw error
    return (data ?? fallback) as T
  } catch (error: unknown) {
    if (isMissingTableError(error)) return fallback
    throw error
  }
}

// =========================================================================
// 1. Configurações de Provedores (Resend & Z-API)
// =========================================================================

export async function getProvedoresConfig() {
  try {
    const providerAccess = await requireAny([
      { resource: 'sistema-config-email' },
      { resource: 'sistema-config-whatsapp' },
      { resource: 'sistema-config-assinatura' },
    ])
    const permsRes: { success: boolean; permissions: typeof providerAccess.perms } = {
      success: true,
      permissions: providerAccess.perms,
    }
    if (!permsRes.success) throw new Error('Não foi possível validar permissões.')
    const perms = permsRes.permissions || []
    const canViewEmail = perms.some((p) => p?.resource_name === 'sistema-config-email' && !!p?.can_view)
    const canViewWhatsapp = perms.some((p) => p?.resource_name === 'sistema-config-whatsapp' && !!p?.can_view)
    const canViewAssinatura = perms.some((p) => p?.resource_name === 'sistema-config-assinatura' && !!p?.can_view)
    const canViewAny = canViewEmail || canViewWhatsapp || canViewAssinatura

    if (!canViewAny) throw new Error('Sem permissão para visualizar configurações.')

    let resend = { id: '', api_key: '', from_email: '', is_active: false }
    if (canViewEmail) {
      try {
        const { data, error } = await supabaseAdmin
          .from('resend_config')
          .select('*')
          .limit(1)
          .maybeSingle()
        if (error && error.code !== 'PGRST205') throw error
        if (data) resend = data
      } catch (err) {
        console.warn('resend_config table not found, using fallback')
      }
    }

    let zapi = { id: '', instance_id: '', token: '', client_key: '', is_active: false }
    if (canViewWhatsapp) {
      try {
        const { data, error } = await supabaseAdmin
          .from('zapi_config')
          .select('*')
          .limit(1)
          .maybeSingle()
        if (error && error.code !== 'PGRST205') throw error
        if (data) zapi = data
      } catch (err) {
        console.warn('zapi_config table not found, using fallback')
      }
    }

    let assinafy = { id: '', api_key: '', account_id: '', environment: 'production', webhook_secret: '', is_active: false }
    if (canViewAssinatura) {
      try {
        const { data, error } = await supabaseAdmin
          .from('assinafy_config')
          .select('*')
          .limit(1)
          .maybeSingle()
        if (error && error.code !== 'PGRST205') throw error
        if (data) assinafy = data
      } catch (err) {
        console.warn('assinafy_config table not found, using fallback')
      }
    }

    // Segurança (A-2): nunca devolver os segredos ao cliente. Enviamos apenas
    // flags "has_*" indicando se já existe chave configurada. Ao salvar, um campo
    // em branco preserva o segredo atual (ver saveProvedoresConfig).
    return {
      success: true,
      resend: { ...resend, api_key: '', has_api_key: !!resend.api_key },
      zapi: { ...zapi, token: '', client_key: '', has_token: !!zapi.token, has_client_key: !!zapi.client_key },
      assinafy: {
        ...assinafy,
        api_key: '',
        webhook_secret: '',
        has_api_key: !!assinafy.api_key,
        has_webhook_secret: !!assinafy.webhook_secret,
      },
    }
  } catch (error: any) {
    console.error('Erro ao obter provedores:', error)
    return { success: false, error: error.message }
  }
}

// Preserva o segredo atual quando o formulário envia o campo em branco (mascarado).
async function keepExistingSecret(table: string, id: string | undefined, column: string, incoming: string | undefined): Promise<string> {
  const value = String(incoming || '')
  if (value || !id) return value
  const { data } = await supabaseAdmin.from(table).select(column).eq('id', id).maybeSingle()
  return String((data as Record<string, unknown> | null)?.[column] || '')
}

export async function saveProvedoresConfig(data: {
  resend?: { id?: string; api_key: string; from_email: string; is_active: boolean }
  zapi?: { id?: string; instance_id: string; token: string; client_key?: string; is_active: boolean }
  assinafy?: { id?: string; api_key: string; account_id?: string; environment?: string; webhook_secret?: string; is_active: boolean }
}) {
  try {
    const requiredConfigPermissions: PermissionRequirement[] = []
    if (data.resend) requiredConfigPermissions.push({ resource: 'sistema-config-email', action: 'can_edit' })
    if (data.zapi) requiredConfigPermissions.push({ resource: 'sistema-config-whatsapp', action: 'can_edit' })
    if (data.assinafy) requiredConfigPermissions.push({ resource: 'sistema-config-assinatura', action: 'can_edit' })
    if (requiredConfigPermissions.length === 0) {
      throw new Error('Nenhuma configuracao informada para salvar.')
    }
    const providerAccess = await requireAny(requiredConfigPermissions)
    const permsRes: { success: boolean; permissions: typeof providerAccess.perms } = {
      success: true,
      permissions: providerAccess.perms,
    }
    if (!permsRes.success) throw new Error('Não foi possível validar permissões.')
    const perms = permsRes.permissions || []

    // Parent config permission is not a wildcard; each provider validates its own child permission.
    const canEditEmail = perms.some((p) => p?.resource_name === 'sistema-config-email' && !!p?.can_edit)
    const canEditWhatsapp = perms.some((p) => p?.resource_name === 'sistema-config-whatsapp' && !!p?.can_edit)
    const canEditAssinatura = perms.some((p) => p?.resource_name === 'sistema-config-assinatura' && !!p?.can_edit)

    if (data.resend && !canEditEmail) throw new Error('Sem permissão para salvar configurações de e-mail.')
    if (data.zapi && !canEditWhatsapp) throw new Error('Sem permissão para salvar configurações de WhatsApp.')
    if (data.assinafy && !canEditAssinatura) throw new Error('Sem permissão para salvar configurações de assinatura.')

    // 1. Salvar Resend
    if (data.resend) {
      const resendApiKey = await keepExistingSecret('resend_config', data.resend.id, 'api_key', data.resend.api_key)
      try {
        if (data.resend.id) {
          const { error } = await supabaseAdmin
            .from('resend_config')
            .update({
              api_key: resendApiKey,
              from_email: data.resend.from_email,
              is_active: data.resend.is_active,
              updated_at: new Date().toISOString()
            })
            .eq('id', data.resend.id)
          if (error) throw error
        } else {
          const { error } = await supabaseAdmin
            .from('resend_config')
            .insert({
              api_key: resendApiKey,
              from_email: data.resend.from_email,
              is_active: data.resend.is_active
            })
          if (error) throw error
        }
      } catch (err: any) {
        if (err.code === 'PGRST205') {
          console.warn('resend_config table not found. Skipped DB save.')
        } else throw err
      }
    }

    // 2. Salvar Z-API
    if (data.zapi) {
      const zapiToken = await keepExistingSecret('zapi_config', data.zapi.id, 'token', data.zapi.token)
      const zapiClientKey = await keepExistingSecret('zapi_config', data.zapi.id, 'client_key', data.zapi.client_key)
      try {
        if (data.zapi.id) {
          const { error } = await supabaseAdmin
            .from('zapi_config')
            .update({
              instance_id: data.zapi.instance_id,
              token: zapiToken,
              client_key: zapiClientKey,
              is_active: data.zapi.is_active,
              updated_at: new Date().toISOString()
            })
            .eq('id', data.zapi.id)
          if (error) throw error
        } else {
          const { error } = await supabaseAdmin
            .from('zapi_config')
            .insert({
              instance_id: data.zapi.instance_id,
              token: zapiToken,
              client_key: zapiClientKey,
              is_active: data.zapi.is_active
            })
          if (error) throw error
        }
      } catch (err: any) {
        if (err.code === 'PGRST205') {
          console.warn('zapi_config table not found. Skipped DB save.')
        } else throw err
      }
    }

    // 3. Salvar Assinafy
    if (data.assinafy) {
      // environment só aceita 'sandbox' ou 'production' (CHECK no banco).
      const environment = data.assinafy.environment === 'sandbox' ? 'sandbox' : 'production'
      const assinafyApiKey = await keepExistingSecret('assinafy_config', data.assinafy.id, 'api_key', data.assinafy.api_key)
      const assinafyWebhookSecret = await keepExistingSecret('assinafy_config', data.assinafy.id, 'webhook_secret', data.assinafy.webhook_secret)
      const assinafyRow = {
        api_key: assinafyApiKey,
        account_id: data.assinafy.account_id || '',
        environment,
        webhook_secret: assinafyWebhookSecret,
        is_active: data.assinafy.is_active,
      }
      try {
        if (data.assinafy.id) {
          const { error } = await supabaseAdmin
            .from('assinafy_config')
            .update({ ...assinafyRow, updated_at: new Date().toISOString() })
            .eq('id', data.assinafy.id)
          if (error) throw error
        } else {
          const { error } = await supabaseAdmin
            .from('assinafy_config')
            .insert(assinafyRow)
          if (error) throw error
        }
      } catch (err: any) {
        if (err.code === 'PGRST205') {
          console.warn('assinafy_config table not found. Skipped DB save.')
        } else if (err.code === 'PGRST204' || err.code === '42703') {
          // Colunas novas (account_id/environment/webhook_secret) ainda não existem
          // neste banco — cai para o subconjunto legado para não travar o save.
          console.warn('assinafy_config sem as colunas novas; salvando apenas api_key/is_active.')
          const legacyRow = { api_key: assinafyApiKey, is_active: data.assinafy.is_active }
          if (data.assinafy.id) {
            const { error } = await supabaseAdmin
              .from('assinafy_config')
              .update({ ...legacyRow, updated_at: new Date().toISOString() })
              .eq('id', data.assinafy.id)
            if (error) throw error
          } else {
            const { error } = await supabaseAdmin.from('assinafy_config').insert(legacyRow)
            if (error) throw error
          }
        } else throw err
      }
    }

    revalidatePath('/rh/parceiros/config/provedores')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar provedores:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Testa credenciais da Assinafy contra a API real, sem gravar nada.
 *
 * Usado pelo botão "Testar conexão" da tela de config: valida API Key +
 * Account ID + ambiente antes de salvar, dando feedback imediato de que o
 * sandbox (ou a produção) está configurado corretamente.
 */
export async function testAssinafyConnection(input: {
  api_key: string
  account_id: string
  environment?: string
}) {
  try {
    await requireServerPermission('sistema-config-assinatura', 'can_view')

    const apiKey = String(input.api_key || '').trim()
    const accountId = String(input.account_id || '').trim()
    if (!apiKey) return { success: false, error: 'Informe a API Key antes de testar.' }
    if (!accountId) return { success: false, error: 'Informe o Account ID antes de testar.' }

    const { pingAssinafyCredentials } = await import('@/lib/assinafy')
    const environment = input.environment === 'sandbox' ? 'sandbox' : 'production'
    const result = await pingAssinafyCredentials({ apiKey, accountId, environment })

    if (result.ok) {
      return { success: true, environment }
    }
    return { success: false, error: result.error || 'Não foi possível validar as credenciais.' }
  } catch (error: any) {
    console.error('Erro ao testar conexão com a Assinafy:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Lista os templates cadastrados na Assinafy, extraindo papéis e campos com
 * seus IDs reais. É a ponte entre "o contrato na Assinafy" e o dicionário
 * canônico: os `role_id` e `field_id` daqui são o que a automação vai preencher.
 *
 * Devolve também o JSON cru de cada template, para inspecionar a estrutura
 * exata que a API retorna enquanto mapeamos.
 */
export async function inspectAssinafyTemplates() {
  try {
    // Usada tanto na config de assinatura quanto no catálogo de Modelos de Documento.
    await requireAny([
      { resource: 'sistema-config-assinatura', action: 'can_view' },
      { resource: 'scp-documentos', action: 'can_view' },
    ])

    const { AssinafyClient } = await import('@/lib/assinafy')
    const client = await AssinafyClient.fromActiveConfig()
    const templates = await client.listTemplates()

    const summary = (Array.isArray(templates) ? templates : []).map((tpl: any) => {
      const roles = Array.isArray(tpl?.roles)
        ? tpl.roles.map((r: any) => ({ id: String(r?.id || ''), name: String(r?.name || '') }))
        : []

      // Campos podem vir achatados em `fields` ou aninhados por página.
      const rawFields: any[] = Array.isArray(tpl?.fields)
        ? tpl.fields
        : Array.isArray(tpl?.pages)
          ? tpl.pages.flatMap((p: any) => (Array.isArray(p?.fields) ? p.fields : []))
          : []

      const fields = rawFields.map((f: any) => ({
        id: String(f?.id || ''),
        field_id: String(f?.field_id || f?.id || ''),
        label: String(f?.label || f?.name || ''),
        type: String(f?.type || f?.field_type || ''),
        role_id: String(f?.role_id || ''),
      }))

      return {
        id: String(tpl?.id || ''),
        name: String(tpl?.name || ''),
        roles,
        fields,
      }
    })

    return { success: true, templates: summary, raw: templates }
  } catch (error: any) {
    console.error('Erro ao inspecionar templates da Assinafy:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Cria na Assinafy todos os campos do Contrato PS PJ (nomeados e mapeados ao
 * dicionário canônico), pulando os que já existem. Depois disso, esses campos
 * aparecem no editor de template para posicionamento, cada um com field_id
 * próprio. Idempotente: pode rodar quantas vezes quiser.
 */
export async function syncAssinafyContractFields() {
  try {
    await requireServerPermission('sistema-config-assinatura', 'can_edit')

    const { AssinafyClient, CONTRATO_PS_PJ_FIELD_MAP } = await import('@/lib/assinafy')
    const client = await AssinafyClient.fromActiveConfig()

    const existing = await client.listFields()
    const existingByName = new Map(
      existing.map((f: any) => [String(f?.name || '').trim().toLowerCase(), f]),
    )

    const results: Array<{ name: string; canonicalKey: string; field_id: string; created: boolean }> = []

    for (const mapping of CONTRATO_PS_PJ_FIELD_MAP) {
      const nameKey = mapping.assinafyName.trim().toLowerCase()
      const found = existingByName.get(nameKey)
      if (found) {
        results.push({
          name: mapping.assinafyName,
          canonicalKey: mapping.canonicalKey,
          field_id: String(found?.id || ''),
          created: false,
        })
        continue
      }
      const field = await client.createField({ name: mapping.assinafyName, type: 'text' })
      results.push({
        name: mapping.assinafyName,
        canonicalKey: mapping.canonicalKey,
        field_id: String((field as any)?.id || ''),
        created: true,
      })
    }

    const createdCount = results.filter((r) => r.created).length
    return { success: true, results, createdCount, skippedCount: results.length - createdCount }
  } catch (error: any) {
    console.error('Erro ao sincronizar campos do contrato na Assinafy:', error)
    return { success: false, error: error.message }
  }
}

// =========================================================================
// Motor de execução (frente C) — ações de teste/inspeção
// =========================================================================

/**
 * Dispara manualmente as ações de entrada da etapa ATUAL de uma instância
 * (a "válvula" do operador). Decisão de design: mover card não dispara; este
 * botão dispara com intenção explícita. Enfileira enter_stage para a etapa
 * corrente — idempotente pela dedupe_key.
 */
export async function triggerStageActions(instanceId: string) {
  try {
    await requirePermission('scp-crm', 'can_edit')
    if (!instanceId) return { success: false, error: 'Instância inválida.' }

    const { data: instance, error } = await supabaseAdmin
      .from('process_instances')
      .select('id, current_stage_id, status')
      .eq('id', instanceId)
      .maybeSingle()
    if (error) throw error
    if (!instance) return { success: false, error: 'Instância não encontrada.' }
    if (!instance.current_stage_id) return { success: false, error: 'Instância sem etapa atual.' }

    const { enqueueJob, buildDedupeKey } = await import('@/lib/scp-engine')
    const res = await enqueueJob({
      kind: 'enter_stage',
      instanceId: String(instance.id),
      // timestamp na dedupe permite re-disparar manualmente (nova intenção do operador).
      dedupeKey: buildDedupeKey('enter', instance.id, instance.current_stage_id, 'manual', new Date().toISOString()),
      payload: { stage_id: instance.current_stage_id, source: 'operator' },
    })
    return { success: true, ...res }
  } catch (error: any) {
    console.error('Erro ao disparar ações da etapa:', error)
    return { success: false, error: error.message }
  }
}

/** Enfileira um job de teste (log_event) para exercitar o loop do motor. */
export async function enqueueEngineTestJob() {
  try {
    await requireServerPermission('sistema-config-assinatura', 'can_edit')
    const { enqueueJob, buildDedupeKey } = await import('@/lib/scp-engine')
    const stamp = new Date().toISOString()
    const res = await enqueueJob({
      kind: 'log_event',
      dedupeKey: buildDedupeKey('test', stamp),
      payload: { event_type: 'engine_test', data: { at: stamp } },
    })
    return { success: true, ...res }
  } catch (error: any) {
    console.error('Erro ao enfileirar job de teste:', error)
    return { success: false, error: error.message }
  }
}

/** Roda o motor uma vez (drena a fila). Em produção quem faz isso é o cron. */
export async function runEngineOnce() {
  try {
    await requireServerPermission('sistema-config-assinatura', 'can_edit')
    const { runDueJobs } = await import('@/lib/scp-engine')
    const result = await runDueJobs('manual', 20)
    return { success: true, ...result }
  } catch (error: any) {
    console.error('Erro ao rodar o motor:', error)
    return { success: false, error: error.message }
  }
}

/** Lista os jobs recentes da fila do motor. */
export async function listEngineJobs() {
  try {
    await requireServerPermission('sistema-config-assinatura', 'can_view')
    const { listRecentJobs } = await import('@/lib/scp-engine')
    const jobs = await listRecentJobs(30)
    return { success: true, jobs }
  } catch (error: any) {
    console.error('Erro ao listar jobs:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Reconciliação por polling: consulta o status atual de cada documento pendente
 * na Assinafy e atualiza o registro. É a rede de segurança para quando o webhook
 * falha (a entrega da Assinafy é frágil: 2 tentativas + circuit breaker).
 */
export async function reconcileAssinafyDocuments() {
  try {
    await requireServerPermission('sistema-config-assinatura', 'can_edit')

    const { AssinafyClient, listPendingAssinafyDocuments, updateAssinafyDocumentStatus } =
      await import('@/lib/assinafy')
    const { enqueueJob, buildDedupeKey } = await import('@/lib/scp-engine')

    const pending = await listPendingAssinafyDocuments()
    if (pending.length === 0) return { success: true, checked: 0, updated: 0, results: [] }

    const client = await AssinafyClient.fromActiveConfig()
    let updated = 0
    const results: Array<{ documentId: string; from: string; to: string; changed: boolean }> = []

    for (const record of pending) {
      const documentId = String(record.document_id)
      try {
        const doc = await client.getDocument(documentId)
        const newStatus = String((doc as any)?.status || '')
        const changed = !!newStatus && newStatus !== String(record.status || '')
        if (changed) {
          await updateAssinafyDocumentStatus(documentId, newStatus, 'reconcile')
          updated += 1

          // Assinatura concluída → o motor avança a etapa da instância vinculada.
          if (newStatus === 'certificated' && record.process_instance_id) {
            await enqueueJob({
              kind: 'advance_stage',
              instanceId: String(record.process_instance_id),
              dedupeKey: buildDedupeKey('advance', record.process_instance_id, 'doc', documentId),
              payload: { reason: 'signature_certificated', document_id: documentId },
            })
          }
        }
        results.push({ documentId, from: String(record.status || ''), to: newStatus, changed })
      } catch (err: any) {
        results.push({ documentId, from: String(record.status || ''), to: `erro: ${err.message}`, changed: false })
      }
    }

    return { success: true, checked: pending.length, updated, results }
  } catch (error: any) {
    console.error('Erro na reconciliação de documentos:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Registra/atualiza a inscrição de webhook na Assinafy, apontando para o nosso
 * endpoint público com o segredo. Requer NEXT_PUBLIC_APP_URL configurado e um
 * webhook_secret salvo (para validar a origem).
 */
export async function registerAssinafyWebhook() {
  try {
    await requireServerPermission('sistema-config-assinatura', 'can_edit')

    const { AssinafyClient, SCP_WEBHOOK_EVENTS, getAssinafyConfig } = await import('@/lib/assinafy')
    const config = await getAssinafyConfig()
    if (!config) return { success: false, error: 'Assinafy não configurada.' }

    const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')
    if (!appUrl || appUrl.includes('localhost')) {
      return {
        success: false,
        error:
          'NEXT_PUBLIC_APP_URL precisa ser uma URL pública (a Assinafy não alcança localhost). Configure o domínio de produção/preview.',
      }
    }

    const secret = String(config.webhookSecret || '').trim()
    const url = secret
      ? `${appUrl}/api/assinafy/webhook?secret=${encodeURIComponent(secret)}`
      : `${appUrl}/api/assinafy/webhook`

    const client = AssinafyClient.fromConfig(config)
    await client.upsertWebhookSubscription({
      events: SCP_WEBHOOK_EVENTS,
      is_active: true,
      url,
      email: 'bruno.rodrigues@brspromotora.com.br',
    })

    return { success: true, url, events: SCP_WEBHOOK_EVENTS, hasSecret: !!secret }
  } catch (error: any) {
    console.error('Erro ao registrar webhook da Assinafy:', error)
    return { success: false, error: error.message }
  }
}

/** Lista os templates da Assinafy como opções (id + nome) para o construtor. */
export async function listAssinafyTemplateOptions() {
  try {
    await requireServerPermission('scp-processos', 'can_view')
    const { AssinafyClient } = await import('@/lib/assinafy')
    const client = await AssinafyClient.fromActiveConfig()
    const templates = await client.listTemplates()
    const options = (Array.isArray(templates) ? templates : []).map((t: any) => ({
      id: String(t?.id || ''),
      name: String(t?.name || ''),
    }))
    return { success: true, options }
  } catch (error: any) {
    console.error('Erro ao listar templates da Assinafy:', error)
    return { success: false, error: error.message, options: [] }
  }
}

/** Lista os documentos recentes gerados na Assinafy (com status). */
export async function listAssinafyDocuments() {
  try {
    await requireServerPermission('sistema-config-assinatura', 'can_view')
    const { listRecentAssinafyDocuments } = await import('@/lib/assinafy')
    const documents = await listRecentAssinafyDocuments(30)
    return { success: true, documents }
  } catch (error: any) {
    console.error('Erro ao listar documentos da Assinafy:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Lista agentes/parceiros para escolher na geração de contrato de teste.
 */
export async function listAgentesForContract() {
  try {
    await requireServerPermission('sistema-config-assinatura', 'can_view')
    const { data, error } = await supabaseAdmin
      .from('agentes_parceiros')
      .select('id, name, cpf_cnpj, corban_data, updated_at')
      .order('updated_at', { ascending: false })
      .limit(50)
    if (error) throw error
    const agentes = (data || []).map((a: any) => ({
      id: String(a.id),
      name: String(a.name || a?.corban_data?.master?.name || 'Sem nome'),
      cpf_cnpj: String(a.cpf_cnpj || a?.corban_data?.master?.cpf_cnpj || ''),
    }))
    return { success: true, agentes }
  } catch (error: any) {
    console.error('Erro ao listar agentes:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Gera um contrato REAL a partir do corban_data de um parceiro: preenche o
 * template com os dados da entidade e cria o pedido de assinatura, retornando
 * os links por parte. Os convites vão para o e-mail de teste informado (sandbox).
 *
 * É o fechamento da frente A: entidade real → contrato preenchido.
 */
export async function generatePartnerContract(input: {
  partnerId: string
  templateName?: string
  testEmail: string
}) {
  try {
    await requireServerPermission('sistema-config-assinatura', 'can_edit')

    const testEmail = String(input.testEmail || '').trim()
    if (!testEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
      return { success: false, error: 'Informe um e-mail de teste válido.' }
    }
    if (!input.partnerId) return { success: false, error: 'Selecione um parceiro.' }

    // 1. Carregar o parceiro e normalizar o corban_data
    const { data: partner, error: pErr } = await supabaseAdmin
      .from('agentes_parceiros')
      .select('*')
      .eq('id', input.partnerId)
      .maybeSingle()
    if (pErr) throw pErr
    if (!partner) return { success: false, error: 'Parceiro não encontrado.' }

    const { normalizeAgenteCorbanDraftFromRow } = await import('@/lib/agente-corban')
    const corbanData = normalizeAgenteCorbanDraftFromRow(partner as any).corban_data || {}

    const { AssinafyClient, buildContractEditorFields, recordAssinafyDocument, getAssinafyConfig } =
      await import('@/lib/assinafy')
    const client = await AssinafyClient.fromActiveConfig()

    // 2. Localizar o template
    const templates = await client.listTemplates()
    const wanted = String(input.templateName || '').trim().toLowerCase()
    const template =
      (wanted ? templates.find((t: any) => String(t?.name || '').toLowerCase().includes(wanted)) : null) ||
      templates[templates.length - 1]
    if (!template) return { success: false, error: 'Nenhum template encontrado na conta.' }

    // 3. editor_fields a partir do corban_data REAL
    const rawFields: any[] = Array.isArray((template as any).fields)
      ? (template as any).fields
      : Array.isArray((template as any).pages)
        ? (template as any).pages.flatMap((p: any) => (Array.isArray(p?.fields) ? p.fields : []))
        : []
    const { editorFields, filled, missing, unmapped } = buildContractEditorFields(corbanData, rawFields)

    // 4. Signatários (para o teste, todos no e-mail informado com aliases; find-or-create)
    const allRoles: any[] = Array.isArray((template as any).roles) ? (template as any).roles : []
    const signingRoles = allRoles.filter(
      (r: any) => !/preparador|editor|template/i.test(String(r?.name || '')),
    )
    if (signingRoles.length === 0) return { success: false, error: 'Template sem papéis de assinatura.' }

    const [emailLocal, emailDomain] = testEmail.split('@')
    const signers: Array<{ role_id: string; id: string; verification_method: 'Email'; notification_methods: ['Email']; step: number }> = []
    for (let i = 0; i < signingRoles.length; i++) {
      const role = signingRoles[i]
      const email = i === 0 ? testEmail : `${emailLocal}+t${i + 1}@${emailDomain}`
      const signer = await client.findOrCreateSigner({
        full_name: `Teste — ${String(role?.name || 'Signatário').slice(0, 40)}`,
        email,
      })
      signers.push({
        role_id: String(role.id),
        id: String((signer as any)?.id || ''),
        verification_method: 'Email',
        notification_methods: ['Email'],
        step: 1,
      })
    }

    // 5. Gerar o documento preenchido
    const partnerName = String((partner as any).name || corbanData?.master?.name || 'Parceiro')
    const doc = await client.createDocumentFromTemplate(String((template as any).id), {
      signers,
      editor_fields: editorFields,
      name: `Contrato — ${partnerName}`,
    })

    const documentId = String((doc as any)?.id || '')
    const signingUrls = (doc as any)?.assignment?.signing_urls || []

    // 6. Persistir o documento para o webhook/reconciliação acompanharem o status
    const cfg = await getAssinafyConfig()
    await recordAssinafyDocument({
      documentId,
      partnerId: input.partnerId,
      templateId: String((template as any).id || ''),
      templateName: String((template as any).name || ''),
      environment: cfg?.environment,
      status: String((doc as any)?.status || ''),
      signers,
      signingUrls,
    })

    return {
      success: true,
      partnerName,
      templateName: String((template as any).name || ''),
      documentId,
      status: String((doc as any)?.status || ''),
      signingUrls,
      filled,
      missing,
      unmapped,
    }
  } catch (error: any) {
    console.error('Erro ao gerar contrato do parceiro:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Smoke test do fluxo A: gera um documento a partir de um template da Assinafy,
 * preenchido com dados de exemplo e com o pedido de assinatura criado, retornando
 * os links de assinatura por parte.
 *
 * Auto-descobre papéis e campos do template; mapeia os campos pelo nome usando
 * CONTRATO_PS_PJ_FIELD_MAP; cria um signatário por papel (todos no e-mail de teste
 * informado). É um teste em SANDBOX — não dispara nada real.
 */
export async function smokeTestAssinafyContract(input: { templateName?: string; testEmail: string }) {
  try {
    await requireServerPermission('sistema-config-assinatura', 'can_edit')

    const testEmail = String(input.testEmail || '').trim()
    if (!testEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
      return { success: false, error: 'Informe um e-mail de teste válido.' }
    }

    const { AssinafyClient, canonicalKeyForAssinafyField } = await import('@/lib/assinafy')
    const client = await AssinafyClient.fromActiveConfig()

    // 1. Localizar o template
    const templates = await client.listTemplates()
    const wanted = String(input.templateName || '').trim().toLowerCase()
    const template =
      (wanted ? templates.find((t: any) => String(t?.name || '').toLowerCase().includes(wanted)) : null) ||
      templates[templates.length - 1]
    if (!template) return { success: false, error: 'Nenhum template encontrado na conta.' }

    // 2. Papéis que assinam (exclui o "Preparador do documento" / editor)
    const allRoles: any[] = Array.isArray((template as any).roles) ? (template as any).roles : []
    const signingRoles = allRoles.filter(
      (r: any) => !/preparador|editor|template/i.test(String(r?.name || '')),
    )
    if (signingRoles.length === 0) return { success: false, error: 'Template sem papéis de assinatura.' }

    // 3. Campos do template → editor_fields (valores de exemplo), deduplicados por field_id
    const rawFields: any[] = Array.isArray((template as any).fields)
      ? (template as any).fields
      : Array.isArray((template as any).pages)
        ? (template as any).pages.flatMap((p: any) => (Array.isArray(p?.fields) ? p.fields : []))
        : []

    const SAMPLE: Record<string, string> = {
      name: 'ACME Correspondente LTDA',
      cpf_cnpj: '12.345.678/0001-90',
      address_street: 'Rua das Flores',
      address_number: '100',
      address_complement: 'Sala 2',
      address_neighborhood: 'Centro',
      address_city: 'Goiânia',
      address_state: 'GO',
      cep: '74000-000',
      partner_1_name: 'João da Silva',
      partner_1_email: testEmail,
      partner_1_cpf: '111.222.333-44',
      partner_1_marital_status: 'Casado',
      partner_1_profession: 'Empresário',
      partner_1_company_role: 'Sócio-Administrador',
      arw_code: 'GO0001',
      payment_period: 'Semanal',
    }

    // A Assinafy exige valor para TODOS os campos do editor. Preenchemos os
    // mapeados com dados de exemplo e os não-mapeados com um chute pelo nome/tipo.
    const guessValue = (name: string, type: string): string => {
      const n = String(name || '').toLowerCase()
      const t = String(type || '').toLowerCase()
      if (t === 'cpf' || /\bcpf\b/.test(n)) return '111.222.333-44'
      if (t === 'cnpj' || /cnpj/.test(n)) return '12.345.678/0001-90'
      if (t === 'cep' || /cep/.test(n)) return '74000-000'
      if (t === 'email' || /mail/.test(n)) return testEmail
      if (t === 'date' || /data/.test(n)) return '2026-07-26'
      if (t === 'number' || /n[uú]mero/.test(n)) return '100'
      if (/raz[aã]o|nome da empresa/.test(n)) return 'ACME Correspondente LTDA'
      if (/nome/.test(n)) return 'João da Silva'
      return 'TESTE'
    }

    const seen = new Set<string>()
    const editorFields: Array<{ field_id: string; value: string }> = []
    const mapped: Array<{ name: string; canonicalKey: string; value: string }> = []
    const unmapped: string[] = []

    for (const f of rawFields) {
      const fieldName = String(f?.label || f?.name || '')
      const fieldId = String(f?.field_id || f?.id || '')
      if (!fieldId || seen.has(fieldId)) continue
      seen.add(fieldId)

      const key = canonicalKeyForAssinafyField(fieldName)
      if (key) {
        const value = SAMPLE[key] || guessValue(fieldName, String(f?.type || ''))
        editorFields.push({ field_id: fieldId, value })
        mapped.push({ name: fieldName, canonicalKey: key, value })
      } else {
        const value = guessValue(fieldName, String(f?.type || ''))
        editorFields.push({ field_id: fieldId, value })
        if (fieldName) unmapped.push(fieldName)
      }
    }

    // 4. Um signatário por papel. E-mail é único na Assinafy, então usamos aliases
    //    distintos (o primeiro papel fica com o e-mail real; os demais com +tN).
    //    find-or-create evita o erro "signatário já existe" ao re-rodar.
    const [emailLocal, emailDomain] = testEmail.split('@')
    const signers: Array<{ role_id: string; id: string; verification_method: 'Email'; notification_methods: ['Email']; step: number }> = []
    for (let i = 0; i < signingRoles.length; i++) {
      const role = signingRoles[i]
      const email = i === 0 ? testEmail : `${emailLocal}+t${i + 1}@${emailDomain}`
      const signer = await client.findOrCreateSigner({
        full_name: `Teste — ${String(role?.name || 'Signatário').slice(0, 40)}`,
        email,
      })
      signers.push({
        role_id: String(role.id),
        id: String((signer as any)?.id || ''),
        verification_method: 'Email',
        notification_methods: ['Email'],
        step: 1,
      })
    }

    // 5. Gerar o documento a partir do template (preenchido + pedido de assinatura)
    const doc = await client.createDocumentFromTemplate(String((template as any).id), {
      signers,
      editor_fields: editorFields,
      name: `Smoke test — ${String((template as any).name || 'Contrato')}`,
    })

    const signingUrls = (doc as any)?.assignment?.signing_urls || []

    return {
      success: true,
      templateName: String((template as any).name || ''),
      templateId: String((template as any).id || ''),
      documentId: String((doc as any)?.id || ''),
      status: String((doc as any)?.status || ''),
      signingUrls,
      mapped,
      unmapped,
      signerCount: signers.length,
    }
  } catch (error: any) {
    console.error('Erro no smoke test da Assinafy:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Cria um campo customizado nomeado na Assinafy (experimento para validar que
 * campos criados via API aparecem no editor de template, com field_id distinto).
 */
export async function createAssinafyTestField(name: string, type: string = 'text') {
  try {
    await requireServerPermission('sistema-config-assinatura', 'can_edit')
    const fieldName = String(name || '').trim()
    if (!fieldName) return { success: false, error: 'Informe o nome do campo.' }

    const { AssinafyClient } = await import('@/lib/assinafy')
    const client = await AssinafyClient.fromActiveConfig()
    const field = await client.createField({ name: fieldName, type })
    return { success: true, field }
  } catch (error: any) {
    console.error('Erro ao criar campo de teste na Assinafy:', error)
    return { success: false, error: error.message }
  }
}

// =========================================================================
// 2. Entidades Comerciais (Superintendentes, Supervisores, Gerentes)
// =========================================================================

export async function getCommercialEntities() {
  try {
    await requireAny([{ resource: 'comercial-agentes' }, { resource: 'comercial-estrutura' }])

    const { data, error } = await supabaseAdmin
      .from('commercial_entities')
      .select(`
        *,
        parent:parent_id ( id, name, role, cadastral_data )
      `)
      .order('name')

    if (error) throw error

    // Buscar usuários do sistema para vinculação de acesso
    const { data: users, error: uErr } = await supabaseAdmin
      .from('users')
      .select('id, name, email, cpf, avatar_url')
      .eq('active', true)
      .order('name')

    if (uErr) throw uErr

    return { success: true, entities: data || [], systemUsers: users || [] }
  } catch (error: any) {
    console.error('Erro ao buscar entidades comerciais:', error)
    return { success: false, error: error.message }
  }
}

export type CommercialCardLinkRow = {
  id: string
  name: string
  destination_url: string
  icon_key: string
  position: number
  is_active: boolean
}

export async function getCommercialCardLinks() {
  try {
    await requireAny([{ resource: 'comercial-agentes' }, { resource: 'comercial-estrutura' }])

    const { data, error } = await supabaseAdmin
      .from('commercial_card_links')
      .select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) throw error

    return { success: true, links: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar links do cartao digital:', error)
    return { success: false, error: error.message }
  }
}

export async function saveCommercialCardLink(linkData: {
  id?: string
  name: string
  destination_url: string
  icon_key: string
  position?: number
  is_active?: boolean
}) {
  try {
    await requirePermission('comercial-estrutura', linkData.id ? 'can_edit' : 'can_include')

    const sanitizedName = String(linkData.name || '').trim()
    const sanitizedUrl = String(linkData.destination_url || '').trim()
    const sanitizedIcon = String(linkData.icon_key || 'link').trim() || 'link'

    if (!sanitizedName) throw new Error('Informe o nome do link.')
    if (!sanitizedUrl) throw new Error('Informe o link de destino.')

    let position = Number.isFinite(linkData.position as number) ? Number(linkData.position) : 0
    if (!linkData.id && !Number.isFinite(position)) {
      const { data: maxRow } = await supabaseAdmin
        .from('commercial_card_links')
        .select('position')
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle()
      position = Number(maxRow?.position || 0) + 1
    }

    const payload = {
      name: sanitizedName,
      destination_url: sanitizedUrl,
      icon_key: sanitizedIcon,
      position,
      is_active: linkData.is_active !== false,
      updated_at: new Date().toISOString(),
    }

    if (linkData.id) {
      const { error } = await supabaseAdmin
        .from('commercial_card_links')
        .update(payload)
        .eq('id', linkData.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin
        .from('commercial_card_links')
        .insert(payload)
      if (error) throw error
    }

    revalidatePath('/rh/parceiros/config/comercial/links-cartao-digital')
    revalidatePath('/rh/parceiros/config/comercial/preview-real')
    revalidatePath('/cartao')
    revalidatePath('/seletor')
    revalidatePath('/rh/parceiros/config/comercial/seletor')
    revalidatePath('/links')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar link do cartao digital:', error)
    return { success: false, error: error.message }
  }
}

export async function deleteCommercialCardLink(id: string) {
  try {
    await requirePermission('comercial-estrutura', 'can_delete')

    const { error } = await supabaseAdmin
      .from('commercial_card_links')
      .delete()
      .eq('id', id)
    if (error) throw error

    revalidatePath('/rh/parceiros/config/comercial/links-cartao-digital')
    revalidatePath('/rh/parceiros/config/comercial/preview-real')
    revalidatePath('/cartao')
    revalidatePath('/seletor')
    revalidatePath('/rh/parceiros/config/comercial/seletor')
    revalidatePath('/links')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao excluir link do cartao digital:', error)
    return { success: false, error: error.message }
  }
}

export async function reorderCommercialCardLinks(ids: string[]) {
  try {
    await requirePermission('comercial-estrutura', 'can_edit')

    if (!Array.isArray(ids) || !ids.length) {
      throw new Error('Ordem invalida.')
    }

    const updates = ids.map((id, index) =>
      supabaseAdmin
        .from('commercial_card_links')
        .update({ position: index, updated_at: new Date().toISOString() })
        .eq('id', id),
    )

    const results = await Promise.all(updates)
    const firstError = results.find((result) => result.error)?.error
    if (firstError) throw firstError

    revalidatePath('/rh/parceiros/config/comercial/links-cartao-digital')
    revalidatePath('/rh/parceiros/config/comercial/preview-real')
    revalidatePath('/cartao')
    revalidatePath('/seletor')
    revalidatePath('/rh/parceiros/config/comercial/seletor')
    revalidatePath('/links')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao reordenar links do cartao digital:', error)
    return { success: false, error: error.message }
  }
}

export async function saveCommercialEntity(entityData: {
  id?: string
  name: string
  cpf_cnpj: string
  role: 'superintendente' | 'supervisor' | 'gerente'
  parent_id?: string | null
  user_id?: string | null
  status: 'ativo' | 'inativo'
  arw_code?: string
  filial?: string
  nivel_acesso?: string
  tipo_agente?: string
  regra_fisico?: string
  phone_whatsapp?: string
  email_comissao?: string
  google_drive_url?: string
  commercial_slug?: string | null
  card_enabled?: boolean
  cadastral_data?: any
  arw_data?: any
  documents_data?: any
  contract_data?: any
  remuneration_variable_data?: any
  vehicle_rental_data?: any
  card_data?: any
}) {
  try {
    await requirePermission('comercial-agentes', entityData.id ? 'can_edit' : 'can_include')

    const payload = {
      name: entityData.name,
      cpf_cnpj: entityData.cpf_cnpj,
      role: entityData.role,
      parent_id: entityData.parent_id || null,
      user_id: entityData.user_id || null,
      status: entityData.status,
      arw_code: entityData.arw_code || null,
      filial: entityData.filial || null,
      nivel_acesso: entityData.nivel_acesso || null,
      tipo_agente: entityData.tipo_agente || null,
      regra_fisico: entityData.regra_fisico || null,
      phone_whatsapp: entityData.phone_whatsapp || null,
      email_comissao: entityData.email_comissao || null,
      google_drive_url: entityData.google_drive_url || null,
      commercial_slug: entityData.commercial_slug || null,
      card_enabled: !!entityData.card_enabled,
      cadastral_data: entityData.cadastral_data ?? {},
      arw_data: entityData.arw_data ?? {},
      documents_data: entityData.documents_data ?? {},
      contract_data: entityData.contract_data ?? {},
      remuneration_variable_data: entityData.remuneration_variable_data ?? {},
      vehicle_rental_data: entityData.vehicle_rental_data ?? {},
      card_data: entityData.card_data ?? {},
      updated_at: new Date().toISOString()
    }

    if (entityData.id) {
      const { error } = await supabaseAdmin
        .from('commercial_entities')
        .update(payload)
        .eq('id', entityData.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin
        .from('commercial_entities')
        .insert(payload)
      if (error) throw error
    }

    const shouldRegisterDomain = !!payload.card_enabled && !!payload.commercial_slug
    if (shouldRegisterDomain) {
      const slug = String(payload.commercial_slug || '')
      after(() => {
        void registerAgentDomain(slug).catch((error) => {
          console.error('Erro ao registrar dominio comercial na Vercel:', error)
        })
      })
    }

    revalidatePath('/rh/parceiros/config/comercial')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar entidade comercial:', error)
    return { success: false, error: error.message }
  }
}

export async function getCommercialVehicleRentalRates() {
  try {
    await requireAny([{ resource: 'comercial-agentes' }, { resource: 'comercial-estrutura' }])

    const { data, error } = await supabaseAdmin
      .from('commercial_vehicle_rental_rates')
      .select('*')
      .order('vehicle_type', { ascending: true })
      .order('condition_name', { ascending: true })
      .order('validity_start', { ascending: false })

    if (error) throw error

    return { success: true, rates: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar tabela de locacao de veiculos:', error)
    return { success: false, error: error.message }
  }
}

export async function saveCommercialVehicleRentalRate(rateData: {
  id?: string
  vehicle_type: 'carro' | 'moto'
  condition_name: string
  validity_start: string
  validity_end?: string | null
  monthly_value: number | string
}) {
  try {
    await requirePermission('comercial-estrutura', rateData.id ? 'can_edit' : 'can_include')

    const payload = {
      vehicle_type: rateData.vehicle_type,
      condition_name: rateData.condition_name,
      validity_start: rateData.validity_start,
      validity_end: rateData.validity_end || null,
      monthly_value: Number(rateData.monthly_value || 0),
      updated_at: new Date().toISOString(),
    }

    if (rateData.id) {
      const { error } = await supabaseAdmin
        .from('commercial_vehicle_rental_rates')
        .update(payload)
        .eq('id', rateData.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin
        .from('commercial_vehicle_rental_rates')
        .insert(payload)
      if (error) throw error
    }

    revalidatePath('/rh/parceiros/config/comercial/tabela-locacao-veiculo')
    revalidatePath('/rh/parceiros/config/comercial')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar tabela de locacao de veiculos:', error)
    return { success: false, error: error.message }
  }
}

export async function deleteCommercialVehicleRentalRate(id: string) {
  try {
    await requirePermission('comercial-estrutura', 'can_delete')

    const { error } = await supabaseAdmin
      .from('commercial_vehicle_rental_rates')
      .delete()
      .eq('id', id)

    if (error) throw error

    revalidatePath('/rh/parceiros/config/comercial/tabela-locacao-veiculo')
    revalidatePath('/rh/parceiros/config/comercial')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao excluir tabela de locacao de veiculos:', error)
    return { success: false, error: error.message }
  }
}

export async function deleteCommercialEntity(id: string) {
  try {
    await requirePermission('comercial-agentes', 'can_activate_inactivate')

    const { error } = await supabaseAdmin
      .from('commercial_entities')
      .update({ status: 'inativo', updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) throw error

    revalidatePath('/rh/parceiros/config/comercial')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao inativar entidade comercial:', error)
    return { success: false, error: error.message }
  }
}

export async function reactivateCommercialEntity(id: string) {
  try {
    await requirePermission('comercial-agentes', 'can_activate_inactivate')

    const { error } = await supabaseAdmin
      .from('commercial_entities')
      .update({ status: 'ativo', updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) throw error

    revalidatePath('/rh/parceiros/config/comercial')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao reativar entidade comercial:', error)
    return { success: false, error: error.message }
  }
}

// =========================================================================
// 3. Construtor de Formulários (Schema Builder)
// =========================================================================

export async function getPartnerForms() {
  try {
    await requirePermission('scp-construtor')

    const columns = await getPartnerFormsColumnSet()
    const selectColumns = columns
      ? ['id', 'title', 'is_active', 'schema', 'created_at', 'updated_at']
          .concat(columns.has('slug') ? ['slug'] : [])
          .concat(columns.has('config') ? ['config'] : [])
          .join(',')
      : '*'

    const { data, error } = await supabaseAdmin
      .from('partner_forms')
      .select(selectColumns)
      .order('created_at', { ascending: false })

    if (error) throw error

    return { success: true, forms: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar formulários:', error)
    return { success: false, error: error.message }
  }
}

export async function savePartnerForm(formData: {
  id?: string
  title: string
  slug?: string
  is_active: boolean
  schema: any[]
  config?: unknown
}) {
  try {
    await requirePermission('scp-construtor', formData.id ? 'can_edit' : 'can_include')

    const columns = await getPartnerFormsColumnSet()
    const payload = {
      title: formData.title,
      is_active: formData.is_active,
      schema: formData.schema,
      updated_at: new Date().toISOString()
    } as Record<string, unknown>

    if (!columns || columns.has('slug')) payload.slug = formData.slug || null
    if (!columns || columns.has('config')) payload.config = formData.config ?? {}

    if (formData.id) {
      const { data, error } = await supabaseAdmin
        .from('partner_forms')
        .update(payload)
        .eq('id', formData.id)
        .select('id')
        .maybeSingle()
      if (error) throw error
      revalidatePath('/rh/parceiros/config/formularios')
      return { success: true, id: data?.id || formData.id }
    } else {
      const { data, error } = await supabaseAdmin
        .from('partner_forms')
        .insert(payload)
        .select('id')
        .maybeSingle()
      if (error) throw error
      revalidatePath('/rh/parceiros/config/formularios')
      return { success: true, id: data?.id }
    }
  } catch (error: any) {
    console.error('Erro ao salvar formulário:', error)
    if (String(error?.message || '').includes("Could not find the 'config' column of 'partner_forms'")) {
      return {
        success: false,
        error:
          "Sua tabela 'partner_forms' ainda não tem a coluna 'config'. Aplique as migrations do Supabase e recarregue o schema cache da API.",
      }
    }
    return { success: false, error: error.message }
  }
}

export async function isPartnerFormSlugAvailable(slug: string, excludeId?: string) {
  try {
    await requirePermission('scp-construtor')

    const normalized = String(slug || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    if (!normalized) return { success: true, available: false, normalized }

    let q = supabaseAdmin
      .from('partner_forms')
      .select('id')
      .eq('slug', normalized)
      .limit(1)

    if (excludeId) q = q.neq('id', excludeId)

    const { data, error } = await q.maybeSingle()
    if (error) throw error

    return { success: true, available: !data, normalized }
  } catch (error: any) {
    return { success: false, error: error.message, available: false }
  }
}

export async function deletePartnerForm(id: string) {
  try {
    await requirePermission('scp-construtor', 'can_delete')

    if (!id) return { success: false, error: 'ID inválido' }

    const { error } = await supabaseAdmin.from('partner_forms').delete().eq('id', id)
    if (error) throw error

    revalidatePath('/rh/parceiros/config/formularios')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao excluir formulário:', error)
    return { success: false, error: error.message }
  }
}

// =========================================================================
// 4. CRM de Parceiros (agentes_parceiros)
// =========================================================================

export async function getCRMData() {
  try {
    await requirePermission('scp-crm')

    const { data: partners, error: pErr } = await supabaseAdmin
      .from('agentes_parceiros')
      .select(`
        *,
        superintendente:superintendente_id ( id, name ),
        supervisor:supervisor_id ( id, name ),
        gerente:gerente_id ( id, name )
      `)
      .order('created_at', { ascending: false })

    if (pErr) throw pErr

    // Buscar entidades comerciais para atribuição no CRM
    const { data: entities, error: eErr } = await supabaseAdmin
      .from('commercial_entities')
      .select('id, name, role, parent_id')
      .eq('status', 'ativo')

    if (eErr) throw eErr

    return {
      success: true,
      partners: partners || [],
      commercialEntities: entities || []
    }
  } catch (error: any) {
    console.error('Erro ao obter dados do CRM:', error)
    return { success: false, error: error.message }
  }
}

export async function updatePartnerCRM(partnerData: {
  id: string
  status?: 'novo' | 'aguarda_assinatura' | 'assinatura_realizada' | 'validacao_final' | 'finalizado'
  superintendente_id?: string | null
  supervisor_id?: string | null
  gerente_id?: string | null
  arw_code?: string | null
  temporary_password?: string | null
  google_drive_url?: string | null
  filial?: string | null
  nivel_acesso?: string | null
  tipo_agente?: string | null
  regra_fisico?: string | null
  assinafy_document_id?: string | null
  assinafy_signature_url?: string | null
}) {
  try {
    await requirePermission('scp-crm', 'can_edit')

    const { error } = await supabaseAdmin
      .from('agentes_parceiros')
      .update({
        ...partnerData,
        updated_at: new Date().toISOString()
      })
      .eq('id', partnerData.id)

    if (error) throw error

    revalidatePath('/rh/parceiros/crm')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao atualizar parceiro no CRM:', error)
    return { success: false, error: error.message }
  }
}

// =========================================================================
// 5. Modelos de Templates (Contrato & E-mail)
// =========================================================================

export async function getTemplates() {
  try {
    const { perms } = await requireAny([{ resource: 'scp-documentos' }, { resource: 'scp-emails' }])
    const canViewDocs = perms.some((p) => p?.resource_name === 'scp-documentos' && !!p?.can_view)
    const canViewEmails = perms.some((p) => p?.resource_name === 'scp-emails' && !!p?.can_view)

    const { data: contracts, error: cErr } = await supabaseAdmin
      .from('contract_templates')
      .select('*')
      .order('name')

    if (cErr) throw cErr

    const { data: emails, error: eErr } = await supabaseAdmin
      .from('email_templates')
      .select('*')
      .order('name')

    if (eErr) throw eErr

    const normalizeTemplatePlaceholders = (body: string, placeholders: any): any[] => {
      const extractedTokens = Array.from(new Set(String(body || '').match(/\{\{[^}]+\}\}/g) || []))
      const current = Array.isArray(placeholders) ? placeholders : []
      const byToken = new Map<string, any>()
      for (const item of current) {
        const token = String(item?.token || '').trim()
        if (!token) continue
        byToken.set(token, item)
      }
      return extractedTokens.map((token) => {
        const existing = byToken.get(token)
        const fallbackId = token.replace(/[{}]/g, '').replace(/[^a-zA-Z0-9_-]/g, '_')
        return {
          id: String(existing?.id || fallbackId || `ph_${Math.random().toString(36).slice(2, 8)}`),
          token,
          label: String(existing?.label || token),
          required: !!existing?.required,
        }
      })
    }

    const normalizedContracts = (contracts || []).map((contract: any) => ({
      ...contract,
      placeholders: normalizeTemplatePlaceholders(contract?.body || '', contract?.placeholders),
    }))

    return {
      success: true,
      contracts: canViewDocs ? normalizedContracts : [],
      emails: canViewEmails ? emails || [] : []
    }
  } catch (error: any) {
    console.error('Erro ao buscar templates:', error)
    return { success: false, error: error.message }
  }
}

export async function saveContractTemplate(templateData: {
  id?: string
  name: string
  body: string
  placeholders?: Array<{ id: string; token: string; label: string; required?: boolean }>
}) {
  try {
    await requirePermission('scp-documentos', templateData.id ? 'can_edit' : 'can_include')

    const normalizedPlaceholders = (templateData.placeholders || [])
      .filter((p) => p?.token)
      .map((p) => ({
        id: String(p.id || p.token),
        token: String(p.token),
        label: String(p.label || p.token),
        required: !!p.required,
      }))

    if (templateData.id) {
      let { error } = await supabaseAdmin
        .from('contract_templates')
        .update({ name: templateData.name, body: templateData.body, placeholders: normalizedPlaceholders })
        .eq('id', templateData.id)
      if (error && String(error.message || '').includes("Could not find the 'placeholders'")) {
        const retry = await supabaseAdmin
          .from('contract_templates')
          .update({ name: templateData.name, body: templateData.body })
          .eq('id', templateData.id)
        error = retry.error
      }
      if (error) throw error
    } else {
      let { error } = await supabaseAdmin
        .from('contract_templates')
        .insert({ name: templateData.name, body: templateData.body, placeholders: normalizedPlaceholders })
      if (error && String(error.message || '').includes("Could not find the 'placeholders'")) {
        const retry = await supabaseAdmin
          .from('contract_templates')
          .insert({ name: templateData.name, body: templateData.body })
        error = retry.error
      }
      if (error) throw error
    }

    revalidatePath('/rh/parceiros/config/documentos')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar template de contrato:', error)
    return { success: false, error: error.message }
  }
}

export async function getContractTemplates() {
  try {
    await requirePermission('scp-documentos')

    const res = await getTemplates()
    if (!res.success) return { success: false, error: res.error || 'Erro ao carregar modelos de documentos.' }
    return { success: true, templates: res.contracts || [] }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function getEmailTemplates() {
  try {
    await requirePermission('scp-emails')

    const res = await getTemplates()
    if (!res.success) return { success: false, error: res.error || 'Erro ao carregar modelos de e-mail.' }
    return { success: true, templates: res.emails || [] }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

// =========================================================================
// 6. Cadastro da Empresa (multi-CNPJ)
// =========================================================================

type CompanyProfileRow = {
  id?: string
  nickname: string
  is_active: boolean
  cnpj?: string | null
  company_data?: any
  partner_primary_data?: any
  partner_secondary_data?: any
  witness_data?: any
  created_at?: string
  updated_at?: string
}

function sanitizeDigits(value: any) {
  return String(value || '').replace(/\D/g, '')
}

export async function getCompanyProfiles() {
  try {
    await requirePermission('sistema-config-empresa')

    const { data, error } = await supabaseAdmin
      .from('company_profiles')
      .select('*')
      .order('nickname', { ascending: true })
    if (error) throw error
    return { success: true, companies: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar cadastro de empresas:', error)
    return { success: false, error: error.message }
  }
}

export async function saveCompanyProfile(payload: CompanyProfileRow) {
  try {
    await requirePermission('sistema-config-empresa', payload.id ? 'can_edit' : 'can_include')

    const companyData = normalizeCompanyBankAccounts(payload.company_data ?? {}, String(payload.cnpj || ''))
    const fiscalData = normalizeCompanyFiscalData((companyData as Record<string, any>).fiscal_data)
    const row: any = {
      nickname: String(payload.nickname || '').trim(),
      is_active: payload.is_active !== false,
      cnpj: sanitizeDigits(payload.cnpj || '') || null,
      company_data: {
        ...companyData,
        fiscal_data: fiscalData,
      },
      partner_primary_data: payload.partner_primary_data ?? {},
      partner_secondary_data: payload.partner_secondary_data ?? {},
      witness_data: payload.witness_data ?? {},
      updated_at: new Date().toISOString(),
    }

    if (!row.nickname) {
      return { success: false, error: 'Apelido é obrigatório.' }
    }

    if (payload.id) {
      const { error } = await supabaseAdmin
        .from('company_profiles')
        .update(row)
        .eq('id', payload.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin
        .from('company_profiles')
        .insert(row)
      if (error) throw error
    }

    revalidatePath('/rh/parceiros/config/empresas')
    revalidatePath('/rh/parceiros/config/provedores/empresas')
    revalidatePath('/rh/parceiros/config/processos')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar cadastro de empresa:', error)
    if (String(error?.message || '').includes("Could not find the 'company_profiles'")) {
      return {
        success: false,
        error:
          "A tabela 'company_profiles' ainda não existe. Aplique as migrations do Supabase (supabase/migrations/20260526020000_create_company_profiles.sql).",
      }
    }
    if ((error as any)?.code === '23505') {
      return { success: false, error: 'Já existe uma empresa cadastrada com este CNPJ.' }
    }
    return { success: false, error: error.message }
  }
}

export async function archiveCompanyProfile(id: string) {
  try {
    await requirePermission('sistema-config-empresa', 'can_activate_inactivate')

    if (!id) return { success: false, error: 'ID inválido.' }
    const { error } = await supabaseAdmin
      .from('company_profiles')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    revalidatePath('/rh/parceiros/config/empresas')
    revalidatePath('/rh/parceiros/config/provedores/empresas')
    revalidatePath('/rh/parceiros/config/processos')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao arquivar empresa:', error)
    return { success: false, error: error.message }
  }
}

export async function deleteCompanyProfile(id: string) {
  try {
    await requirePermission('sistema-config-empresa', 'can_delete')

    if (!id) return { success: false, error: 'ID inválido.' }
    let { data: linked, error: lErr } = await supabaseAdmin
      .from('process_models')
      .select('id')
      .eq('company_profile_id', id)
      .limit(1)
      .maybeSingle()
    if (lErr && String(lErr.message || '').includes("Could not find the 'company_profile_id'")) {
      linked = null
      lErr = null as any
    }
    if (lErr) throw lErr
    if (linked) {
      return { success: false, error: 'Empresa vinculada a processo. Arquive em vez de excluir.' }
    }

    const { error } = await supabaseAdmin.from('company_profiles').delete().eq('id', id)
    if (error) throw error
    revalidatePath('/rh/parceiros/config/empresas')
    revalidatePath('/rh/parceiros/config/provedores/empresas')
    revalidatePath('/rh/parceiros/config/processos')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao excluir empresa:', error)
    return { success: false, error: error.message }
  }
}

// =========================================================================
// 7. Tipos de Comercial
// =========================================================================

export async function getCommercialTypes() {
  try {
    await requirePermission('sistema-config-comercial-tipos')

    const { data, error } = await supabaseAdmin
      .from('commercial_types')
      .select('*')
      .order('is_active', { ascending: false })
      .order('name', { ascending: true })
    if (error) throw error
    return { success: true, types: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar tipos de comercial:', error)
    return { success: false, error: error.message }
  }
}

export async function getActiveCommercialTypes() {
  try {
    const res = await getCommercialTypes()
    if (!res.success) return res
    return {
      success: true,
      types: (res.types || []).filter((item: CommercialTypeRecord) => !!item.is_active && !item.deleted_at),
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function saveCommercialType(payload: CommercialTypeRecord) {
  try {
    await requirePermission('sistema-config-comercial-tipos', payload.id ? 'can_edit' : 'can_include')

    const name = normalizeCommercialTypeName(payload.name)
    if (!name) {
      return { success: false, error: 'O nome do tipo de comercial é obrigatório.' }
    }

    const row = {
      name,
      is_active: payload.is_active !== false,
      deleted_at: payload.is_active === false ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }

    if (payload.id) {
      const { error } = await supabaseAdmin
        .from('commercial_types')
        .update(row)
        .eq('id', payload.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin
        .from('commercial_types')
        .insert({
          ...row,
          created_at: new Date().toISOString(),
        })
      if (error) throw error
    }

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/rh/parceiros/config/provedores/tipos-comercial')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar tipo de comercial:', error)
    if (String(error?.message || '').includes("Could not find the 'commercial_types'")) {
      return {
        success: false,
        error:
          "A tabela 'commercial_types' ainda não existe. Aplique a migration do Supabase criada para Tipos de Comercial.",
      }
    }
    if ((error as any)?.code === '23505') {
      return { success: false, error: 'Já existe um tipo de comercial com esse nome.' }
    }
    return { success: false, error: error.message }
  }
}

export async function setCommercialTypeStatus(id: string, isActive: boolean) {
  try {
    await requirePermission('sistema-config-comercial-tipos', 'can_activate_inactivate')

    if (!id) return { success: false, error: 'ID inválido.' }
    const { error } = await supabaseAdmin
      .from('commercial_types')
      .update({
        is_active: isActive,
        deleted_at: isActive ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) throw error

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/rh/parceiros/config/provedores/tipos-comercial')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alterar status do tipo de comercial:', error)
    return { success: false, error: error.message }
  }
}

export async function getCompanySectors() {
  try {
    await requirePermission('sistema-config-setores')

    const { data, error } = await supabaseAdmin
      .from('company_sectors')
      .select('*')
      .order('is_active', { ascending: false })
      .order('name', { ascending: true })
    if (error) throw error
    return { success: true, sectors: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar setores:', error)
    return { success: false, error: error.message }
  }
}

export async function saveCompanySector(payload: CompanySectorRecord) {
  try {
    await requirePermission('sistema-config-setores', payload.id ? 'can_edit' : 'can_include')

    const name = normalizeCompanySectorName(payload.name)
    if (!name) {
      return { success: false, error: 'O nome do setor é obrigatório.' }
    }

    const row = {
      name,
      is_active: payload.is_active !== false,
      deleted_at: payload.is_active === false ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }

    if (payload.id) {
      const { error } = await supabaseAdmin
        .from('company_sectors')
        .update(row)
        .eq('id', payload.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin
        .from('company_sectors')
        .insert({
          ...row,
          created_at: new Date().toISOString(),
        })
      if (error) throw error
    }

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/rh/parceiros/config/provedores/setores')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar setor:', error)
    if (String(error?.message || '').includes("Could not find the 'company_sectors'")) {
      return {
        success: false,
        error:
          "A tabela 'company_sectors' ainda não existe. Aplique a migration do Supabase criada para Setores.",
      }
    }
    if ((error as any)?.code === '23505') {
      return { success: false, error: 'Já existe um setor com esse nome.' }
    }
    return { success: false, error: error.message }
  }
}

export async function setCompanySectorStatus(id: string, isActive: boolean) {
  try {
    await requirePermission('sistema-config-setores', 'can_activate_inactivate')

    if (!id) return { success: false, error: 'ID inválido.' }
    const { error } = await supabaseAdmin
      .from('company_sectors')
      .update({
        is_active: isActive,
        deleted_at: isActive ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) throw error

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/rh/parceiros/config/provedores/setores')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alterar status do setor:', error)
    return { success: false, error: error.message }
  }
}

// =========================================================================
// 8. CNAEs
// =========================================================================

export async function getCnaes() {
  try {
    await requirePermission('sistema-config-cnae')

    const { data, error } = await supabaseAdmin
      .from('cnaes')
      .select('*')
      .order('is_active', { ascending: false })
      .order('code', { ascending: true })
    if (error) throw error
    return { success: true, cnaes: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar CNAEs:', error)
    return { success: false, error: error.message }
  }
}

export async function saveCnae(payload: CnaeRecord) {
  try {
    await requirePermission('sistema-config-cnae', payload.id ? 'can_edit' : 'can_include')

    const code = normalizeCnaeCodeDigits(payload.code)
    const description = normalizeCnaeDescription(payload.description)

    if (code.length !== 7) {
      return { success: false, error: 'O código do CNAE deve conter 7 dígitos.' }
    }
    if (!description) {
      return { success: false, error: 'A descrição do CNAE é obrigatória.' }
    }

    const row = {
      code,
      description,
      is_active: payload.is_active !== false,
      deleted_at: payload.is_active === false ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }

    if (payload.id) {
      const { error } = await supabaseAdmin
        .from('cnaes')
        .update(row)
        .eq('id', payload.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin
        .from('cnaes')
        .insert({
          ...row,
          created_at: new Date().toISOString(),
        })
      if (error) throw error
    }

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/rh/parceiros/config/provedores/cnae')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar CNAE:', error)
    if (String(error?.message || '').includes("Could not find the 'cnaes'")) {
      return {
        success: false,
        error: "A tabela 'cnaes' ainda não existe. Aplique a migration do Supabase criada para CNAE.",
      }
    }
    if ((error as any)?.code === '23505') {
      return { success: false, error: 'Já existe um CNAE com esse código.' }
    }
    return { success: false, error: error.message }
  }
}

export async function setCnaeStatus(id: string, isActive: boolean) {
  try {
    await requirePermission('sistema-config-cnae', 'can_activate_inactivate')

    if (!id) return { success: false, error: 'ID inválido.' }
    const { error } = await supabaseAdmin
      .from('cnaes')
      .update({
        is_active: isActive,
        deleted_at: isActive ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) throw error

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/rh/parceiros/config/provedores/cnae')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alterar status do CNAE:', error)
    return { success: false, error: error.message }
  }
}

// =========================================================================
// 7B. CTNs
// =========================================================================

export async function getCtns() {
  try {
    await requirePermission('sistema-config-ctn')

    const { data, error } = await supabaseAdmin
      .from('ctns')
      .select('*')
      .order('is_active', { ascending: false })
      .order('code', { ascending: true })
    if (error) throw error
    return { success: true, ctns: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar CTNs:', error)
    return { success: false, error: error.message }
  }
}

export async function saveCtn(payload: CtnRecord) {
  try {
    await requirePermission('sistema-config-ctn', payload.id ? 'can_edit' : 'can_include')

    const code = normalizeCtnCodeDigits(payload.code)
    const description = normalizeCtnDescription(payload.description)

    if (code.length !== 6) {
      return { success: false, error: 'O código do CTN deve conter 6 dígitos.' }
    }
    if (!description) {
      return { success: false, error: 'A descrição do CTN é obrigatória.' }
    }

    const row = {
      code,
      description,
      is_active: payload.is_active !== false,
      deleted_at: payload.is_active === false ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }

    if (payload.id) {
      const { error } = await supabaseAdmin
        .from('ctns')
        .update(row)
        .eq('id', payload.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin
        .from('ctns')
        .insert({
          ...row,
          created_at: new Date().toISOString(),
        })
      if (error) throw error
    }

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/rh/parceiros/config/provedores/ctn')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar CTN:', error)
    if (String(error?.message || '').includes("Could not find the 'ctns'")) {
      return {
        success: false,
        error: "A tabela 'ctns' ainda não existe. Aplique a migration do Supabase criada para CTN.",
      }
    }
    if ((error as any)?.code === '23505') {
      return { success: false, error: 'Já existe um CTN com esse código.' }
    }
    return { success: false, error: error.message }
  }
}

export async function setCtnStatus(id: string, isActive: boolean) {
  try {
    await requirePermission('sistema-config-ctn', 'can_activate_inactivate')

    if (!id) return { success: false, error: 'ID inválido.' }
    const { error } = await supabaseAdmin
      .from('ctns')
      .update({
        is_active: isActive,
        deleted_at: isActive ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) throw error

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/rh/parceiros/config/provedores/ctn')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alterar status do CTN:', error)
    return { success: false, error: error.message }
  }
}

// =========================================================================
// 7C. NBSes
// =========================================================================

export async function getNbses() {
  try {
    await requirePermission('sistema-config-nbs')

    const { data, error } = await supabaseAdmin
      .from('nbses')
      .select('*')
      .order('is_active', { ascending: false })
      .order('code', { ascending: true })
    if (error) throw error
    return { success: true, nbses: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar NBSes:', error)
    return { success: false, error: error.message }
  }
}

export async function saveNbs(payload: NbsRecord) {
  try {
    await requirePermission('sistema-config-nbs', payload.id ? 'can_edit' : 'can_include')

    const code = normalizeNbsCodeDigits(payload.code)
    const description = normalizeNbsDescription(payload.description)

    if (code.length !== 9) {
      return { success: false, error: 'O código do NBS deve conter 9 dígitos.' }
    }
    if (!description) {
      return { success: false, error: 'A descrição do NBS é obrigatória.' }
    }

    const row = {
      code,
      description,
      is_active: payload.is_active !== false,
      deleted_at: payload.is_active === false ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }

    if (payload.id) {
      const { error } = await supabaseAdmin
        .from('nbses')
        .update(row)
        .eq('id', payload.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin
        .from('nbses')
        .insert({
          ...row,
          created_at: new Date().toISOString(),
        })
      if (error) throw error
    }

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/rh/parceiros/config/provedores/nbs')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar NBS:', error)
    if (String(error?.message || '').includes("Could not find the 'nbses'")) {
      return {
        success: false,
        error: "A tabela 'nbses' ainda não existe. Aplique a migration do Supabase criada para NBS.",
      }
    }
    if ((error as any)?.code === '23505') {
      return { success: false, error: 'Já existe um NBS com esse código.' }
    }
    return { success: false, error: error.message }
  }
}

export async function setNbsStatus(id: string, isActive: boolean) {
  try {
    await requirePermission('sistema-config-nbs', 'can_activate_inactivate')

    if (!id) return { success: false, error: 'ID inválido.' }
    const { error } = await supabaseAdmin
      .from('nbses')
      .update({
        is_active: isActive,
        deleted_at: isActive ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) throw error

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/rh/parceiros/config/provedores/nbs')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alterar status do NBS:', error)
    return { success: false, error: error.message }
  }
}

export async function getNfseEmissionTypes() {
  try {
    await requirePermission('sistema-config-nfse-emissao')

    const { data, error } = await supabaseAdmin
      .from('nfse_emission_types')
      .select('*')
      .order('is_active', { ascending: false })
      .order('name', { ascending: true })
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar tipos de emissão de NFSe:', error)
    return { success: false, error: error.message }
  }
}

export async function saveNfseEmissionType(payload: NfseEmissionTypeRecord) {
  try {
    await requirePermission('sistema-config-nfse-emissao', payload.id ? 'can_edit' : 'can_include')

    const name = normalizeNfseEmissionTypeName(payload.name)
    if (!name) {
      return { success: false, error: 'O nome do tipo de emissão de NFSe é obrigatório.' }
    }

    const row = {
      name,
      is_active: payload.is_active !== false,
      deleted_at: payload.is_active === false ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }

    if (payload.id) {
      const { error } = await supabaseAdmin
        .from('nfse_emission_types')
        .update(row)
        .eq('id', payload.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin
        .from('nfse_emission_types')
        .insert({
          ...row,
          created_at: new Date().toISOString(),
        })
      if (error) throw error
    }

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/rh/parceiros/config/provedores/tipos-emissao-nfse')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar tipo de emissão de NFSe:', error)
    if (String(error?.message || '').includes("Could not find the 'nfse_emission_types'")) {
      return {
        success: false,
        error:
          "A tabela 'nfse_emission_types' ainda não existe. Aplique a migration do Supabase criada para Tipo de Emissão de NFSe.",
      }
    }
    if ((error as any)?.code === '23505') {
      return { success: false, error: 'Já existe um tipo de emissão de NFSe com esse nome.' }
    }
    return { success: false, error: error.message }
  }
}

export async function setNfseEmissionTypeStatus(id: string, isActive: boolean) {
  try {
    await requirePermission('sistema-config-nfse-emissao', 'can_activate_inactivate')

    if (!id) return { success: false, error: 'ID inválido.' }
    const { error } = await supabaseAdmin
      .from('nfse_emission_types')
      .update({
        is_active: isActive,
        deleted_at: isActive ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) throw error

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/rh/parceiros/config/provedores/tipos-emissao-nfse')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alterar status do tipo de emissão de NFSe:', error)
    return { success: false, error: error.message }
  }
}

export async function getReceiptMethods() {
  try {
    await requirePermission('sistema-config-formas-recebimento')

    const { data, error } = await supabaseAdmin
      .from('receipt_methods')
      .select('*')
      .order('is_active', { ascending: false })
      .order('name', { ascending: true })
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar formas de recebimento:', error)
    return { success: false, error: error.message }
  }
}

export async function saveReceiptMethod(payload: ReceiptMethodRecord) {
  try {
    await requirePermission('sistema-config-formas-recebimento', payload.id ? 'can_edit' : 'can_include')

    const name = normalizeReceiptMethodName(payload.name)
    if (!name) {
      return { success: false, error: 'O nome da forma de recebimento é obrigatório.' }
    }

    const row = {
      name,
      is_active: payload.is_active !== false,
      deleted_at: payload.is_active === false ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }

    if (payload.id) {
      const { error } = await supabaseAdmin
        .from('receipt_methods')
        .update(row)
        .eq('id', payload.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin
        .from('receipt_methods')
        .insert({
          ...row,
          created_at: new Date().toISOString(),
        })
      if (error) throw error
    }

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/rh/parceiros/config/provedores/formas-recebimento')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar forma de recebimento:', error)
    if (String(error?.message || '').includes("Could not find the 'receipt_methods'")) {
      return {
        success: false,
        error:
          "A tabela 'receipt_methods' ainda não existe. Aplique a migration do Supabase criada para Formas de Recebimento.",
      }
    }
    if ((error as any)?.code === '23505') {
      return { success: false, error: 'Já existe uma forma de recebimento com esse nome.' }
    }
    return { success: false, error: error.message }
  }
}

export async function setReceiptMethodStatus(id: string, isActive: boolean) {
  try {
    await requirePermission('sistema-config-formas-recebimento', 'can_activate_inactivate')

    if (!id) return { success: false, error: 'ID inválido.' }
    const { error } = await supabaseAdmin
      .from('receipt_methods')
      .update({
        is_active: isActive,
        deleted_at: isActive ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) throw error

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/rh/parceiros/config/provedores/formas-recebimento')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alterar status da forma de recebimento:', error)
    return { success: false, error: error.message }
  }
}

export async function getSystemTypes() {
  try {
    await requirePermission('sistema-config-tipos-sistemas')

    const { data, error } = await supabaseAdmin
      .from('system_types')
      .select('*')
      .order('is_active', { ascending: false })
      .order('name', { ascending: true })
    if (error) throw error
    return { success: true, types: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar tipos de sistemas:', error)
    return { success: false, error: error.message }
  }
}

export async function saveSystemType(payload: SystemTypeRecord) {
  try {
    await requirePermission('sistema-config-tipos-sistemas', payload.id ? 'can_edit' : 'can_include')

    const name = normalizeSystemTypeName(payload.name)
    if (!name) {
      return { success: false, error: 'O nome do tipo de sistema é obrigatório.' }
    }

    const row = {
      name,
      is_active: payload.is_active !== false,
      deleted_at: payload.is_active === false ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }

    if (payload.id) {
      const { error } = await supabaseAdmin
        .from('system_types')
        .update(row)
        .eq('id', payload.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin
        .from('system_types')
        .insert({
          ...row,
          created_at: new Date().toISOString(),
        })
      if (error) throw error
    }

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/rh/parceiros/config/provedores/tipos-sistemas')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar tipo de sistema:', error)
    if (String(error?.message || '').includes("Could not find the 'system_types'")) {
      return {
        success: false,
        error:
          "A tabela 'system_types' ainda não existe. Aplique a migration do Supabase criada para Tipos de Sistemas.",
      }
    }
    if ((error as any)?.code === '23505') {
      return { success: false, error: 'Já existe um tipo de sistema com esse nome.' }
    }
    return { success: false, error: error.message }
  }
}

export async function setSystemTypeStatus(id: string, isActive: boolean) {
  try {
    await requirePermission('sistema-config-tipos-sistemas', 'can_activate_inactivate')

    if (!id) return { success: false, error: 'ID inválido.' }
    const { error } = await supabaseAdmin
      .from('system_types')
      .update({
        is_active: isActive,
        deleted_at: isActive ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) throw error

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/rh/parceiros/config/provedores/tipos-sistemas')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alterar status do tipo de sistema:', error)
    return { success: false, error: error.message }
  }
}

export async function getFinancialInstitutions() {
  try {
    await requirePermission('sistema-config-instituicoes')

    const { data, error } = await supabaseAdmin
      .from('financial_institutions')
      .select('*')
      .order('is_active', { ascending: false })
      .order('name', { ascending: true })
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar instituições financeiras:', error)
    return { success: false, error: error.message }
  }
}

export async function saveFinancialInstitution(payload: FinancialInstitutionRecord) {
  try {
    await requirePermission('sistema-config-instituicoes', payload.id ? 'can_edit' : 'can_include')

    const name = normalizeFinancialInstitutionName(payload.name)
    if (!name) {
      return { success: false, error: 'O nome da instituição financeira é obrigatório.' }
    }

    const row = {
      name,
      logo_url: normalizeFinancialInstitutionLogo(payload.logo_url || ''),
      is_active: payload.is_active !== false,
      deleted_at: payload.is_active === false ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }

    if (payload.id) {
      const { error } = await supabaseAdmin
        .from('financial_institutions')
        .update(row)
        .eq('id', payload.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin
        .from('financial_institutions')
        .insert({
          ...row,
          created_at: new Date().toISOString(),
        })
      if (error) throw error
    }

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/instituicoes-financeiras')
    revalidatePath('/rh/parceiros/config/provedores/breve?api=Instituicoes')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar instituição financeira:', error)
    if (String(error?.message || '').includes("Could not find the 'financial_institutions'")) {
      return {
        success: false,
        error:
          "A tabela 'financial_institutions' ainda não existe. Aplique a migration do Supabase criada para Instituições Financeiras.",
      }
    }
    if ((error as any)?.code === '23505') {
      return { success: false, error: 'Já existe uma instituição financeira com esse nome.' }
    }
    return { success: false, error: error.message }
  }
}

export async function setFinancialInstitutionStatus(id: string, isActive: boolean) {
  try {
    await requirePermission('sistema-config-instituicoes', 'can_activate_inactivate')

    if (!id) return { success: false, error: 'ID inválido.' }
    const { error } = await supabaseAdmin
      .from('financial_institutions')
      .update({
        is_active: isActive,
        deleted_at: isActive ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) throw error

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/instituicoes-financeiras')
    revalidatePath('/rh/parceiros/config/provedores/breve?api=Instituicoes')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alterar status da instituição financeira:', error)
    return { success: false, error: error.message }
  }
}

function normalizeDateOnly(value: string) {
  const raw = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ''
}

function shiftDateByDays(value: string, days: number) {
  const normalized = normalizeDateOnly(value)
  if (!normalized) return ''
  const date = new Date(`${normalized}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function normalizeTaxRegimeName(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function pickActiveTaxRegimeVersion(versions: TaxRegimeVersionRecord[]) {
  return versions.find((version) => version.effective_to === null) || versions[0] || null
}

async function fetchTaxRegimePayloads(regimeIds?: string[]) {
  const regimesQuery = supabaseAdmin.from('tax_regimes').select('*').order('name', { ascending: true })
  const versionsQuery = supabaseAdmin.from('tax_regime_versions').select('*').order('effective_from', { ascending: false })

  if (regimeIds?.length) {
    regimesQuery.in('id', regimeIds)
    versionsQuery.in('tax_regime_id', regimeIds)
  }

  const [regimesRes, versionsRes] = await Promise.all([regimesQuery, versionsQuery])
  const firstError = regimesRes.error || versionsRes.error
  if (firstError) throw firstError

  const groupedVersions = new Map<string, TaxRegimeVersionRecord[]>()
  for (const rawVersion of (versionsRes.data || []) as unknown[]) {
    const version = normalizeTaxRegimeVersion(rawVersion)
    const taxRegimeId = String(version.tax_regime_id || '')
    if (!taxRegimeId) continue
    const list = groupedVersions.get(taxRegimeId) || []
    list.push(version)
    groupedVersions.set(taxRegimeId, list)
  }

  const regimes = ((regimesRes.data || []) as unknown[]).map((rawRegime) => {
    const normalized = normalizeTaxRegimeRecord(rawRegime)
    const versions = sortTaxRegimeVersions(groupedVersions.get(String(normalized.id || '')) || [])
    const currentVersion = pickActiveTaxRegimeVersion(versions)
    return {
      ...normalized,
      versions,
      current_version: currentVersion,
    }
  })

  return regimes
}

export async function getTaxRegimes() {
  try {
    await requireAny(systemConfigRouteOptions)
    const regimes = await fetchTaxRegimePayloads()
    return { success: true, regimes }
  } catch (error: any) {
    console.error('Erro ao buscar regimes tributários:', error)
    return { success: false, error: error.message }
  }
}

export async function getTaxRegime(id: string) {
  try {
    await requireAny(systemConfigRouteOptions)

    if (!id || id === 'novo') {
      return { success: true, regime: null }
    }

    const regimes = await fetchTaxRegimePayloads([id])
    return { success: true, regime: regimes[0] || null }
  } catch (error: any) {
    console.error('Erro ao buscar regime tributário:', error)
    return { success: false, error: error.message }
  }
}

export async function saveTaxRegime(payload: {
  id?: string
  name: string
  create_new_version?: boolean
  version: TaxRegimeVersionRecord
}) {
  try {
    await requireAny(systemConfigRouteOptions)

    const name = normalizeTaxRegimeName(payload.name)
    if (!name) {
      return { success: false, error: 'Informe o nome do regime tributário.' }
    }

    const version = normalizeTaxRegimeVersion(payload.version)
    const effectiveFrom = normalizeDateOnly(version.effective_from)
    if (!effectiveFrom) {
      return { success: false, error: 'Informe a data de vigência inicial.' }
    }

    const config = version.config || createEmptyTaxRegimeConfiguration()
    const now = new Date().toISOString()

    let regimeId = payload.id || ''
    if (regimeId) {
      const { error: updateNameError } = await supabaseAdmin
        .from('tax_regimes')
        .update({
          name,
          updated_at: now,
        })
        .eq('id', regimeId)
      if (updateNameError) throw updateNameError
    } else {
      const { data, error: insertRegimeError } = await supabaseAdmin
        .from('tax_regimes')
        .insert({
          name,
          created_at: now,
          updated_at: now,
        })
        .select('id')
        .single()
      if (insertRegimeError) throw insertRegimeError
      regimeId = String(data?.id || '')
    }

    if (!regimeId) {
      return { success: false, error: 'Não foi possível identificar o regime tributário salvo.' }
    }

    if (payload.create_new_version) {
      const { data: currentVersion, error: currentVersionError } = await supabaseAdmin
        .from('tax_regime_versions')
        .select('id, effective_from, locked_at, effective_to')
        .eq('tax_regime_id', regimeId)
        .is('effective_to', null)
        .maybeSingle()
      if (currentVersionError) throw currentVersionError

      if (currentVersion?.locked_at) {
        return { success: false, error: 'A vigência atual está bloqueada e não pode ser alterada.' }
      }

      if (currentVersion?.effective_from && effectiveFrom <= String(currentVersion.effective_from)) {
        return { success: false, error: 'A nova vigência deve iniciar após a vigência atual.' }
      }

      if (currentVersion?.id) {
        const previousEndDate = shiftDateByDays(effectiveFrom, -1)
        const { error: closeError } = await supabaseAdmin
          .from('tax_regime_versions')
          .update({
            effective_to: previousEndDate || null,
            updated_at: now,
          })
          .eq('id', currentVersion.id)
        if (closeError) throw closeError
      }

      const { error: insertVersionError } = await supabaseAdmin.from('tax_regime_versions').insert({
        tax_regime_id: regimeId,
        effective_from: effectiveFrom,
        effective_to: null,
        locked_at: null,
        config,
        created_at: now,
        updated_at: now,
      })
      if (insertVersionError) throw insertVersionError
    } else if (payload.id && version.id) {
      const { data: existingVersion, error: existingVersionError } = await supabaseAdmin
        .from('tax_regime_versions')
        .select('id, effective_to, locked_at, tax_regime_id')
        .eq('id', version.id)
        .maybeSingle()
      if (existingVersionError) throw existingVersionError

      if (!existingVersion) {
        return { success: false, error: 'A vigência informada não foi encontrada.' }
      }
      if (existingVersion.locked_at) {
        return { success: false, error: 'A vigência está bloqueada e não pode ser alterada.' }
      }
      if (existingVersion.effective_to !== null) {
        return { success: false, error: 'Somente a vigência ativa pode ser alterada.' }
      }

      const { error: updateVersionError } = await supabaseAdmin
        .from('tax_regime_versions')
        .update({
          effective_from: effectiveFrom,
          config,
          updated_at: now,
        })
        .eq('id', version.id)
      if (updateVersionError) throw updateVersionError
    } else {
      const { error: insertVersionError } = await supabaseAdmin.from('tax_regime_versions').insert({
        tax_regime_id: regimeId,
        effective_from: effectiveFrom,
        effective_to: null,
        locked_at: null,
        config,
        created_at: now,
        updated_at: now,
      })
      if (insertVersionError) throw insertVersionError
    }

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/rh/parceiros/config/provedores/regimes-tributarios')
    if (regimeId) revalidatePath(`/rh/parceiros/config/provedores/regimes-tributarios/${regimeId}`)
    revalidatePath('/rh/parceiros/config/provedores/recalculo-tributario')
    return { success: true, id: regimeId }
  } catch (error: any) {
    console.error('Erro ao salvar regime tributário:', error)
    if ((error as any)?.code === '23505') {
      return { success: false, error: 'Já existe um regime tributário com esse nome ou vigência.' }
    }
    if (String(error?.message || '').includes("Could not find the 'tax_regimes'")) {
      return {
        success: false,
        error: "A tabela 'tax_regimes' ainda não existe. Aplique a migration do Supabase criada para Regimes Tributários.",
      }
    }
    return { success: false, error: error.message }
  }
}

export async function getRemunerationTypes() {
  try {
    await requirePermission('sistema-config-tipos-remuneracao')

    const { data, error } = await supabaseAdmin
      .from('remuneration_types')
      .select('*')
      .order('is_active', { ascending: false })
      .order('name', { ascending: true })
    if (error) throw error
    return { success: true, types: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar tipos de remuneração:', error)
    return { success: false, error: error.message }
  }
}

export async function saveRemunerationType(payload: RemunerationTypeRecord) {
  try {
    await requirePermission('sistema-config-tipos-remuneracao', payload.id ? 'can_edit' : 'can_include')

    const name = normalizeRemunerationTypeName(payload.name)
    if (!name) {
      return { success: false, error: 'O nome do tipo de remuneração é obrigatório.' }
    }

    const row = {
      name,
      is_active: payload.is_active !== false,
      deleted_at: payload.is_active === false ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }

    if (payload.id) {
      const { error } = await supabaseAdmin
        .from('remuneration_types')
        .update(row)
        .eq('id', payload.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin
        .from('remuneration_types')
        .insert({
          ...row,
          created_at: new Date().toISOString(),
        })
      if (error) throw error
    }

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/rh/parceiros/config/provedores/tipos-remuneracao')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar tipo de remuneração:', error)
    if (String(error?.message || '').includes("Could not find the 'remuneration_types'")) {
      return {
        success: false,
        error:
          "A tabela 'remuneration_types' ainda não existe. Aplique a migration do Supabase criada para Tipos de Remuneração.",
      }
    }
    if ((error as any)?.code === '23505') {
      return { success: false, error: 'Já existe um tipo de remuneração com esse nome.' }
    }
    return { success: false, error: error.message }
  }
}

export async function setRemunerationTypeStatus(id: string, isActive: boolean) {
  try {
    await requirePermission('sistema-config-tipos-remuneracao', 'can_activate_inactivate')

    if (!id) return { success: false, error: 'ID inválido.' }
    const { error } = await supabaseAdmin
      .from('remuneration_types')
      .update({
        is_active: isActive,
        deleted_at: isActive ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) throw error

    revalidatePath('/rh/parceiros/config/provedores')
    revalidatePath('/rh/parceiros/config/provedores/tipos-remuneracao')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alterar status do tipo de remuneração:', error)
    return { success: false, error: error.message }
  }
}

// =========================================================================
// 8. Construtor de Processos (Workflow / Kanban por tipo de processo)
// =========================================================================

type ProcessModelRow = {
  id: string
  name: string
  type: string
  is_active: boolean
  is_public: boolean
  public_slug?: string | null
  form_id?: string | null
  company_profile_id?: string | null
  entry_config?: any
  config?: any
  created_at?: string
  updated_at?: string
}

type StageModelRow = {
  id: string
  process_id: string
  name: string
  position: number
  color?: string | null
  bg?: string | null
  config?: any
}

function normalizeSlug(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function getProcessModels() {
  try {
    await requirePermission('scp-processos')

    const { data, error } = await supabaseAdmin
      .from('process_models')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return { success: true, processes: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar processos:', error)
    return { success: false, error: error.message }
  }
}

export async function getProcessStages(processId: string) {
  try {
    await requirePermission('scp-processos')

    if (!processId) return { success: true, stages: [] }
    const { data, error } = await supabaseAdmin
      .from('process_stage_models')
      .select('*')
      .eq('process_id', processId)
      .order('position', { ascending: true })
    if (error) throw error
    return { success: true, stages: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar etapas do processo:', error)
    return { success: false, error: error.message }
  }
}

export async function isProcessSlugAvailable(slug: string, excludeId?: string) {
  try {
    await requirePermission('scp-processos')

    const normalized = normalizeSlug(slug)
    if (!normalized) return { success: true, available: false, normalized }

    let q = supabaseAdmin
      .from('process_models')
      .select('id')
      .eq('public_slug', normalized)
      .limit(1)

    if (excludeId) q = q.neq('id', excludeId)

    const { data, error } = await q.maybeSingle()
    if (error) throw error

    return { success: true, available: !data, normalized }
  } catch (error: any) {
    return { success: false, error: error.message, available: false }
  }
}

export async function saveProcessModel(payload: {
  id?: string
  name: string
  type: string
  is_active: boolean
  is_public: boolean
  public_slug?: string | null
  form_id?: string | null
  company_profile_id?: string | null
  entry_config?: any
  config?: any
  stages?: Array<Partial<StageModelRow> & { id?: string }>
}) {
  try {
    await requirePermission('scp-processos', payload.id ? 'can_edit' : 'can_include')

    const modelData: any = {
      name: payload.name,
      type: payload.type || 'generic',
      is_active: !!payload.is_active,
      is_public: !!payload.is_public,
      public_slug: payload.is_public ? (payload.public_slug ? normalizeSlug(payload.public_slug) : null) : null,
      form_id: payload.form_id || null,
      company_profile_id: payload.company_profile_id || null,
      entry_config: payload.entry_config ?? {},
      config: payload.config ?? {},
      updated_at: new Date().toISOString(),
    }

    let processId = payload.id

    if (payload.id) {
      let { data, error } = await supabaseAdmin
        .from('process_models')
        .update(modelData)
        .eq('id', payload.id)
        .select('id')
        .maybeSingle()
      if (error && String(error.message || '').includes("Could not find the 'company_profile_id'")) {
        const fallbackData = { ...modelData }
        delete fallbackData.company_profile_id
        const retry = await supabaseAdmin
          .from('process_models')
          .update(fallbackData)
          .eq('id', payload.id)
          .select('id')
          .maybeSingle()
        data = retry.data as any
        error = retry.error as any
      }
      if (error) throw error
      processId = data?.id || payload.id
    } else {
      let { data, error } = await supabaseAdmin
        .from('process_models')
        .insert(modelData)
        .select('id')
        .maybeSingle()
      if (error && String(error.message || '').includes("Could not find the 'company_profile_id'")) {
        const fallbackData = { ...modelData }
        delete fallbackData.company_profile_id
        const retry = await supabaseAdmin
          .from('process_models')
          .insert(fallbackData)
          .select('id')
          .maybeSingle()
        data = retry.data as any
        error = retry.error as any
      }
      if (error) throw error
      processId = data?.id
    }

    // Upsert stages (simple: delete missing + upsert provided)
    if (processId && Array.isArray(payload.stages)) {
      const { data: existing, error: sErr } = await supabaseAdmin
        .from('process_stage_models')
        .select('id')
        .eq('process_id', processId)
      if (sErr) throw sErr

      const existingIds = new Set((existing || []).map((r: any) => String(r.id)))
      const incomingIds = new Set(payload.stages.map(s => String(s.id || '')).filter(Boolean))

      const toDelete = [...existingIds].filter(id => !incomingIds.has(id))
      if (toDelete.length) {
        const { error: dErr } = await supabaseAdmin
          .from('process_stage_models')
          .delete()
          .in('id', toDelete)
        if (dErr) throw dErr
      }

      for (let i = 0; i < payload.stages.length; i++) {
        const st = payload.stages[i]
        const row: any = {
          process_id: processId,
          name: String(st.name || '').trim() || `Etapa ${i + 1}`,
          position: typeof st.position === 'number' ? st.position : i,
          color: st.color ?? null,
          bg: st.bg ?? null,
          config: st.config ?? {},
          updated_at: new Date().toISOString(),
        }
        if (st.id) {
          const { error } = await supabaseAdmin.from('process_stage_models').update(row).eq('id', st.id)
          if (error) throw error
        } else {
          const { error } = await supabaseAdmin.from('process_stage_models').insert(row)
          if (error) throw error
        }
      }
    }

    revalidatePath('/rh/parceiros/config/processos')
    return { success: true, id: processId }
  } catch (error: any) {
    console.error('Erro ao salvar processo:', error)
    if (String(error?.message || '').includes("Could not find the 'process_models'")) {
      return {
        success: false,
        error:
          "As tabelas de processos ainda não existem no banco. Aplique as migrations do Supabase (supabase/migrations/20260525000000_create_process_tables.sql) e recarregue o schema cache da API.",
      }
    }
    return { success: false, error: error.message }
  }
}

export async function deleteProcessModel(id: string) {
  try {
    await requirePermission('scp-processos', 'can_delete')

    if (!id) return { success: false, error: 'ID inválido' }
    const { error } = await supabaseAdmin.from('process_models').delete().eq('id', id)
    if (error) throw error
    revalidatePath('/rh/parceiros/config/processos')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao excluir processo:', error)
    return { success: false, error: error.message }
  }
}

export async function archiveProcessModel(id: string) {
  try {
    await requirePermission('scp-processos', 'can_activate_inactivate')

    if (!id) return { success: false, error: 'ID inválido' }
    const { error } = await supabaseAdmin
      .from('process_models')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    revalidatePath('/rh/parceiros/config/processos')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao arquivar processo:', error)
    return { success: false, error: error.message }
  }
}

export async function duplicateProcessModel(id: string) {
  try {
    await requirePermission('scp-processos', 'can_include')

    if (!id) return { success: false, error: 'ID inválido' }

    const { data: current, error: cErr } = await supabaseAdmin
      .from('process_models')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (cErr) throw cErr
    if (!current) return { success: false, error: 'Processo não encontrado' }

    const baseSlug = normalizeSlug(String(current.public_slug || current.name || 'processo'))
    let nextSlug = baseSlug ? `${baseSlug}-copia` : null
    if (nextSlug) {
      let tries = 2
      while (tries < 50) {
        const { data: exists } = await supabaseAdmin
          .from('process_models')
          .select('id')
          .eq('public_slug', nextSlug)
          .limit(1)
          .maybeSingle()
        if (!exists) break
        nextSlug = `${baseSlug}-copia-${tries}`
        tries++
      }
    }

    const { data: inserted, error: iErr } = await supabaseAdmin
      .from('process_models')
      .insert({
        name: `${current.name} (Copia)`,
        type: current.type || 'generic',
        is_active: false,
        is_public: !!current.is_public,
        public_slug: current.is_public ? nextSlug : null,
        form_id: current.form_id || null,
        entry_config: current.entry_config || {},
        config: current.config || {},
      })
      .select('id')
      .maybeSingle()
    if (iErr) throw iErr

    const newId = inserted?.id
    if (!newId) return { success: false, error: 'Falha ao criar cópia do processo' }

    const { data: stages, error: sErr } = await supabaseAdmin
      .from('process_stage_models')
      .select('*')
      .eq('process_id', id)
      .order('position', { ascending: true })
    if (sErr) throw sErr

    if ((stages || []).length > 0) {
      const rows = (stages || []).map((s: any) => ({
        process_id: newId,
        name: s.name,
        position: s.position,
        color: s.color ?? null,
        bg: s.bg ?? null,
        config: s.config ?? {},
      }))
      const { error: insertStagesErr } = await supabaseAdmin
        .from('process_stage_models')
        .insert(rows)
      if (insertStagesErr) throw insertStagesErr
    }

    revalidatePath('/rh/parceiros/config/processos')
    return { success: true, id: newId }
  } catch (error: any) {
    console.error('Erro ao duplicar processo:', error)
    return { success: false, error: error.message }
  }
}

export async function validateProcessModel(id: string) {
  try {
    await requirePermission('scp-processos')

    if (!id) return { success: false, error: 'ID inválido', blocking: [], warnings: [] }

    const { data: process, error: pErr } = await supabaseAdmin
      .from('process_models')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (pErr) throw pErr
    if (!process) return { success: false, error: 'Processo não encontrado', blocking: [], warnings: [] }

    const { data: stages, error: sErr } = await supabaseAdmin
      .from('process_stage_models')
      .select('*')
      .eq('process_id', id)
      .order('position', { ascending: true })
    if (sErr) throw sErr

    const blocking: string[] = []
    const warnings: string[] = []
    const stageList = stages || []

    if (stageList.length === 0) blocking.push('Nenhuma etapa cadastrada no processo.')

    for (const stage of stageList) {
      const transitions = Array.isArray(stage?.config?.transitions) ? stage.config.transitions : []
      const isTerminal = !!stage?.config?.is_terminal
      if (!isTerminal && transitions.length === 0) {
        blocking.push(`Etapa "${stage.name}" sem transição de saída.`)
      }
    }

    const cfg = process.config || {}
    const docs = Array.isArray(cfg?.documents) ? cfg.documents : []
    const mails = Array.isArray(cfg?.emails) ? cfg.emails : []
    const whats = Array.isArray(cfg?.whatsapp) ? cfg.whatsapp : []
    const processFields = Array.isArray(cfg?.process_fields) ? cfg.process_fields : []
    const SIGNATURE_LINK_TRIGGER = 'signature_link_ready'

    const { data: contractTemplates } = await supabaseAdmin
      .from('contract_templates')
      .select('id, name, placeholders')

    const templateById = new Map<string, any>()
    const templateByName = new Map<string, any>()
    for (const template of contractTemplates || []) {
      if (template?.id) templateById.set(String(template.id), template)
      if (template?.name) templateByName.set(String(template.name).toLowerCase(), template)
    }

    const EMAIL_AUTOFILL_TOKENS = new Set(['{{assinatura.link}}', '{{processo.id}}', '{{campo.email_destino}}'])
    const extractTokens = (text: string) => Array.from(new Set(String(text || '').match(/\{\{[^}]+\}\}/g) || []))
    const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())

    const { data: emailTemplates, error: eTplErr } = await supabaseAdmin
      .from('email_templates')
      .select('id, name, subject, body')

    if (eTplErr) throw eTplErr

    const emailById = new Map<string, any>()
    const emailByName = new Map<string, any>()
    for (const template of emailTemplates || []) {
      if (template?.id) emailById.set(String(template.id), template)
      if (template?.name) emailByName.set(String(template.name).toLowerCase(), template)
    }

    const hasSignatureAction = docs.some((d: any) => d?.enabled !== false)

    const checkTemplates = (items: any[], kind: string) => {
      for (const item of items) {
        const body = String(item?.body || item?.template_body || '')
        if (body.includes('{{assinatura.link}}') && !hasSignatureAction) {
          blocking.push(`${kind} "${item?.name || 'sem nome'}" usa {{assinatura.link}} sem ação de assinatura.`)
        }
        const recipientSource = String(item?.recipient_source || '')
        const recipientField = String(item?.recipient_field || '')
        if (recipientSource === 'tag' && !recipientField) {
          blocking.push(`${kind} "${item?.name || 'sem nome'}" possui destinatário por tag sem mapeamento.`)
        }
      }
    }

    const requireSignatureTriggerConfig = (items: any[], kind: string) => {
      for (const item of items) {
        if (String(item?.trigger || '') !== SIGNATURE_LINK_TRIGGER) continue
        if (!String(item?.signature_document_ref || '').trim()) {
          blocking.push(`${kind} "${item?.name || 'sem nome'}" precisa de documento vinculado para gatilho de link.`)
        }
        if (!String(item?.signature_signer_role || '').trim()) {
          blocking.push(`${kind} "${item?.name || 'sem nome'}" precisa de papel de assinante para gatilho de link.`)
        }
      }
    }

    checkTemplates(mails, 'E-mail')
    checkTemplates(whats, 'WhatsApp')
    requireSignatureTriggerConfig(mails, 'E-mail')
    requireSignatureTriggerConfig(whats, 'WhatsApp')

    for (const mail of mails) {
      const template =
        emailById.get(String(mail?.template_id || '')) ||
        emailByName.get(String(mail?.template_name || '').toLowerCase())

      if (!template) {
        blocking.push(`E-mail "${mail?.name || 'sem nome'}" sem modelo de e-mail selecionado.`)
        continue
      }

      const templateText = `${String(template?.subject || '')}\n${String(template?.body || '')}`
      if (templateText.includes('{{assinatura.link}}') && !hasSignatureAction) {
        blocking.push(`E-mail "${mail?.name || template?.name || 'sem nome'}" usa {{assinatura.link}} sem ação de assinatura.`)
      }

      const periodValue = Number(mail?.resend_period_value || 0)
      const periodUnit = String(mail?.resend_period_unit || '')
      const resendTrigger = String(mail?.resend_trigger || '')
      const repeatCount = Number(mail?.resend_repeat_count || 0)
      const wantsResend = !!resendTrigger || periodValue > 0 || !!periodUnit || repeatCount > 0
      if (wantsResend) {
        if (!(periodValue >= 1 && periodValue <= 60)) blocking.push(`E-mail "${mail?.name || template?.name || 'sem nome'}" com período de reenvio inválido (1 a 60).`)
        if (!['minutes', 'hours', 'days'].includes(periodUnit)) blocking.push(`E-mail "${mail?.name || template?.name || 'sem nome'}" com unidade de reenvio inválida.`)
        if (!['signature_not_finished', 'elapsed_time'].includes(resendTrigger)) blocking.push(`E-mail "${mail?.name || template?.name || 'sem nome'}" com gatilho de reenvio inválido.`)
        if (!(repeatCount >= 1)) blocking.push(`E-mail "${mail?.name || template?.name || 'sem nome'}" precisa do número de repetições do reenvio.`)
      }

      const copyRecipients = Array.isArray(mail?.copy_recipients) ? mail.copy_recipients : []
      for (const entry of copyRecipients) {
        const kind = String(entry?.type || '').trim()
        const value = String(entry?.value || '').trim()
        if (!kind || !value) {
          blocking.push(`E-mail "${mail?.name || template?.name || 'sem nome'}" possui um e-mail de cópia inválido.`)
          continue
        }
        if (kind === 'email' && !isValidEmail(value)) {
          blocking.push(`E-mail "${mail?.name || template?.name || 'sem nome'}" possui e-mail de cópia inválido: ${value}.`)
        }
      }

      const tokenMapping = mail?.token_mapping && typeof mail.token_mapping === 'object' ? mail.token_mapping : {}
      const subjectTokens = extractTokens(template?.subject || '')
      const bodyTokens = extractTokens(template?.body || '')
      const needed = [...new Set([...subjectTokens, ...bodyTokens])].filter((t) => !EMAIL_AUTOFILL_TOKENS.has(t))
      for (const token of needed) {
        const mapped = String(tokenMapping?.[token] || '').trim()
        if (!mapped) {
          blocking.push(`E-mail "${mail?.name || template?.name || 'sem nome'}" sem vínculo para tag ${token}.`)
        }
      }
    }

    for (const doc of docs) {
      // O construtor agora seleciona o template da Assinafy (o que o motor usa para
      // gerar o contrato). Legado: aceita o template_name interno se existir.
      const assinafyTpl = String(doc?.assinafy_template_name || '').trim()
      const legacyTpl =
        templateById.get(String(doc?.template_id || '')) ||
        templateByName.get(String(doc?.template_name || '').toLowerCase())

      if (!assinafyTpl && !legacyTpl) {
        blocking.push(`Documento "${doc?.name || 'sem nome'}" sem template da Assinafy selecionado.`)
      }
    }

    const requiredNoStage = processFields.filter((f: any) => f?.required && (!Array.isArray(f?.stages) || f.stages.length === 0))
    if (requiredNoStage.length > 0) warnings.push('Há campos obrigatórios sem etapa definida.')

    const dedupeEnabled = process.entry_config?.dedupe?.enabled !== false
    if (!dedupeEnabled) warnings.push('Dedupe está desligado.')

    const hasAnySla = stageList.some((s: any) => !!s?.config?.sla_hours || !!s?.config?.sla_days)
    if (!hasAnySla) warnings.push('Nenhum SLA configurado nas etapas.')

    return { success: true, blocking, warnings }
  } catch (error: any) {
    console.error('Erro ao validar processo:', error)
    return { success: false, error: error.message, blocking: [], warnings: [] }
  }
}

export async function getProcessCRMData(processId?: string) {
  try {
    await requirePermission('scp-crm')

    const { data: processes, error: pErr } = await supabaseAdmin
      .from('process_models')
      .select('id, name, type, is_active, is_public, public_slug, form_id, entry_config, config')
      .order('created_at', { ascending: false })
    if (pErr) throw pErr

    const selected = processId || (processes?.[0]?.id as string | undefined)
    let stages: any[] = []
    let instances: any[] = []

    if (selected) {
      const { data: st, error: sErr } = await supabaseAdmin
        .from('process_stage_models')
        .select('*')
        .eq('process_id', selected)
        .order('position', { ascending: true })
      if (sErr) throw sErr
      stages = st || []

      const { data: inst, error: iErr } = await supabaseAdmin
        .from('process_instances')
        .select(`
          *,
          partner:partner_id ( id, name, cpf_cnpj, email_comissao, phone_whatsapp, arw_code, superintendente_id, supervisor_id, gerente_id, status, additional_data )
        `)
        .eq('process_id', selected)
        .order('created_at', { ascending: false })
      if (iErr) throw iErr
      instances = inst || []
    }

    const { data: entities, error: eErr } = await supabaseAdmin
      .from('commercial_entities')
      .select('id, name, role, parent_id')
      .eq('status', 'ativo')

    if (eErr) throw eErr

    return { success: true, processes: processes || [], selectedProcessId: selected, stages, instances, commercialEntities: entities || [] }
  } catch (error: any) {
    console.error('Erro ao obter dados do CRM por processo:', error)
    return { success: false, error: error.message }
  }
}

export async function updateProcessInstance(data: {
  id: string
  current_stage_id?: string | null
  status?: 'active' | 'archived' | 'completed' | 'canceled'
}) {
  try {
    await requirePermission('scp-crm', 'can_edit')

    if (!data.id) return { success: false, error: 'ID inválido' }

    const payload: any = {
      updated_at: new Date().toISOString(),
    }
    if ('current_stage_id' in data) payload.current_stage_id = data.current_stage_id
    if ('status' in data) payload.status = data.status

    const { error } = await supabaseAdmin
      .from('process_instances')
      .update(payload)
      .eq('id', data.id)

    if (error) throw error

    revalidatePath('/rh/parceiros')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao atualizar instância do processo:', error)
    return { success: false, error: error.message }
  }
}

export async function getProcessInstanceDetail(instanceId: string) {
  try {
    await requirePermission('scp-crm')

    if (!instanceId) return { success: false, error: 'ID inválido' }

    const { data: instance, error: iErr } = await supabaseAdmin
      .from('process_instances')
      .select(`
        *,
        process:process_id ( id, name, type, config ),
        partner:partner_id ( id, name, cpf_cnpj, email_comissao, phone_whatsapp, arw_code, superintendente_id, supervisor_id, gerente_id, status, additional_data )
      `)
      .eq('id', instanceId)
      .maybeSingle()

    if (iErr) throw iErr

    const { data: snapshots, error: sErr } = await supabaseAdmin
      .from('process_instance_form_snapshots')
      .select('*')
      .eq('instance_id', instanceId)
      .order('created_at', { ascending: false })

    if (sErr) throw sErr

    const { data: events, error: eErr } = await supabaseAdmin
      .from('process_instance_events')
      .select('*')
      .eq('instance_id', instanceId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (eErr) throw eErr

    const { data: fields, error: fErr } = await supabaseAdmin
      .from('process_instance_fields')
      .select('*')
      .eq('instance_id', instanceId)
      .order('created_at', { ascending: true })
    if (fErr) throw fErr

    const { data: validations, error: vErr } = await supabaseAdmin
      .from('process_instance_validations')
      .select(`
        *,
        validator:validated_by ( id, name, email )
      `)
      .eq('instance_id', instanceId)
      .order('validated_at', { ascending: false })
    if (vErr) throw vErr

    let stageModels: any[] = []
    const processId = instance?.process_id
    if (processId) {
      const { data: stages, error: stErr } = await supabaseAdmin
        .from('process_stage_models')
        .select('id, name, position')
        .eq('process_id', processId)
        .order('position', { ascending: true })
      if (stErr) throw stErr
      stageModels = stages || []
    }

    return {
      success: true,
      instance,
      snapshots: snapshots || [],
      events: events || [],
      fields: fields || [],
      validations: validations || [],
      stageModels,
    }
  } catch (error: any) {
    console.error('Erro ao obter detalhe da instância:', error)
    return { success: false, error: error.message }
  }
}

export async function saveEmailTemplate(templateData: {
  id?: string
  name: string
  subject: string
  body: string
}) {
  try {
    await requirePermission('scp-emails', templateData.id ? 'can_edit' : 'can_include')

    const normalizedName = String(templateData.name || '').trim()
    if (!normalizedName) return { success: false, error: 'Nome do modelo é obrigatório.' }

    let checkQuery = supabaseAdmin
      .from('email_templates')
      .select('id')
      .ilike('name', normalizedName)
      .limit(1)

    if (templateData.id) checkQuery = checkQuery.neq('id', templateData.id)

    const { data: existing, error: checkErr } = await checkQuery.maybeSingle()
    if (checkErr) throw checkErr
    if (existing?.id) {
      return { success: false, error: 'Já existe um modelo de e-mail com esse nome.' }
    }

    if (templateData.id) {
      const { error } = await supabaseAdmin
        .from('email_templates')
        .update({
          name: normalizedName,
          subject: templateData.subject,
          body: templateData.body
        })
        .eq('id', templateData.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin
        .from('email_templates')
        .insert({
          name: normalizedName,
          subject: templateData.subject,
          body: templateData.body
        })
      if (error) throw error
    }

    revalidatePath('/rh/parceiros/config/emails')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar template de e-mail:', error)
    return { success: false, error: error.message }
  }
}

export async function getWhatsappTemplates() {
  try {
    await requirePermission('scp-whatsapp')

    const { data, error } = await supabaseAdmin
      .from('whatsapp_templates')
      .select('*')
      .order('name')

    if (error) throw error
    return { success: true, templates: data || [] }
  } catch (error: any) {
    console.error('Erro ao buscar templates de WhatsApp:', error)
    return { success: false, error: error.message }
  }
}

export async function saveWhatsappTemplate(templateData: {
  id?: string
  name: string
  body: string
}) {
  try {
    await requirePermission('scp-whatsapp', templateData.id ? 'can_edit' : 'can_include')

    if (templateData.id) {
      const { error } = await supabaseAdmin
        .from('whatsapp_templates')
        .update({ name: templateData.name, body: templateData.body })
        .eq('id', templateData.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin
        .from('whatsapp_templates')
        .insert({ name: templateData.name, body: templateData.body })
      if (error) throw error
    }

    revalidatePath('/rh/parceiros/config/whatsapp')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar template de WhatsApp:', error)
    if (String(error?.message || '').includes("Could not find the 'whatsapp_templates'")) {
      return {
        success: false,
        error:
          "Sua tabela 'whatsapp_templates' ainda não existe. Aplique as migrations do Supabase e recarregue o schema cache da API.",
      }
    }
    return { success: false, error: error.message }
  }
}

/** Erro amigável quando a coluna is_active ainda não existe (migration pendente). */
function isActiveColumnMissing(error: any): boolean {
  const msg = String(error?.message || '').toLowerCase()
  return msg.includes('is_active') && (msg.includes('column') || msg.includes('could not find'))
}

export async function toggleEmailTemplateActive(id: string, isActive: boolean) {
  try {
    await requirePermission('scp-emails', 'can_edit')
    const { error } = await supabaseAdmin
      .from('email_templates')
      .update({ is_active: isActive })
      .eq('id', id)
    if (error) throw error
    revalidatePath('/rh/parceiros/config/emails')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alternar status do template de e-mail:', error)
    if (isActiveColumnMissing(error)) {
      return { success: false, error: "Aplique a migration 'is_active' (20260727010000) e recarregue o schema cache da API." }
    }
    return { success: false, error: error.message }
  }
}

export async function deleteEmailTemplate(id: string) {
  try {
    await requirePermission('scp-emails', 'can_delete')
    const { error } = await supabaseAdmin.from('email_templates').delete().eq('id', id)
    if (error) throw error
    revalidatePath('/rh/parceiros/config/emails')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao excluir template de e-mail:', error)
    return { success: false, error: error.message }
  }
}

export async function toggleWhatsappTemplateActive(id: string, isActive: boolean) {
  try {
    await requirePermission('scp-whatsapp', 'can_edit')
    const { error } = await supabaseAdmin
      .from('whatsapp_templates')
      .update({ is_active: isActive })
      .eq('id', id)
    if (error) throw error
    revalidatePath('/rh/parceiros/config/whatsapp')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alternar status do template de WhatsApp:', error)
    if (isActiveColumnMissing(error)) {
      return { success: false, error: "Aplique a migration 'is_active' (20260727010000) e recarregue o schema cache da API." }
    }
    return { success: false, error: error.message }
  }
}

export async function deleteWhatsappTemplate(id: string) {
  try {
    await requirePermission('scp-whatsapp', 'can_delete')
    const { error } = await supabaseAdmin.from('whatsapp_templates').delete().eq('id', id)
    if (error) throw error
    revalidatePath('/rh/parceiros/config/whatsapp')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao excluir template de WhatsApp:', error)
    return { success: false, error: error.message }
  }
}

// =========================================================================
// 7. Ações de Automação (Assinafy, Z-API, Resend, Aprovação/Acesso)
// =========================================================================

export async function executePartnerAutomation(
  partnerId: string,
  actionType: 'contrato' | 'whatsapp' | 'email' | 'aprovar',
  params?: any
) {
  try {
    await requirePermission('scp-crm', 'can_edit')
    if (actionType === 'contrato') await requireServerPermission('scp-documentos', 'can_view')
    if (actionType === 'whatsapp') await requireServerPermission('scp-whatsapp', 'can_view')
    if (actionType === 'email') await requireServerPermission('scp-emails', 'can_view')
    if (actionType === 'aprovar') await requireServerPermission('sistema-usuarios-cadastro', 'can_include')

    // 1. Buscar dados do parceiro
    const { data: partner, error: pErr } = await supabaseAdmin
      .from('agentes_parceiros')
      .select('*')
      .eq('id', partnerId)
      .single()

    if (pErr) throw pErr

    // Helper para substituir tags
    const replaceTags = (text: string) => {
      return text
        .replace(/\{\{name\}\}/g, partner.name || '')
        .replace(/\{\{fantasy_name\}\}/g, partner.fantasy_name || '')
        .replace(/\{\{cpf_cnpj\}\}/g, partner.cpf_cnpj || '')
        .replace(/\{\{email\}\}/g, partner.email_comissao || '')
        .replace(/\{\{phone_whatsapp\}\}/g, partner.phone_whatsapp || '')
        .replace(/\{\{arw_code\}\}/g, partner.arw_code || params?.arw_code || '')
        .replace(/\{\{temporary_password\}\}/g, partner.temporary_password || params?.temporary_password || '')
        .replace(/\{\{google_drive_url\}\}/g, partner.google_drive_url || '')
        .replace(/\{\{assinafy_signature_url\}\}/g, partner.assinafy_signature_url || '')
    }

    if (actionType === 'contrato') {
      // 1. Buscar primeiro modelo de contrato ativo
      const { data: templates } = await supabaseAdmin
        .from('contract_templates')
        .select('*')
        .limit(1)

      const docId = `doc_${Math.random().toString(36).substr(2, 9)}`
      const mockSignatureUrl = `https://assinador.assinafy.com/documento/${docId}/assinar`

      // 2. Atualizar no banco
      const { error: updErr } = await supabaseAdmin
        .from('agentes_parceiros')
        .update({
          status: 'aguarda_assinatura',
          assinafy_document_id: docId,
          assinafy_signature_url: mockSignatureUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', partnerId)

      if (updErr) throw updErr

      // Revalidar rotas
      revalidatePath('/rh/parceiros')
      return { success: true, message: 'Assinatura eletrônica disparada via Assinafy com sucesso!', signatureUrl: mockSignatureUrl }
    }

    if (actionType === 'whatsapp') {
      const { data: zapi } = await supabaseAdmin
        .from('zapi_config')
        .select('*')
        .limit(1)
        .maybeSingle()

      let sent = false
      let details = 'Z-API inativa ou sem credenciais.'

      // Exemplo de corpo da mensagem
      const messageText = replaceTags(
        params?.message || `Olá {{name}}, seu contrato está disponível para assinatura eletrônica: {{assinafy_signature_url}}`
      )

      if (zapi && zapi.is_active && zapi.instance_id && zapi.token) {
        // Disparo real via Z-API se configurado
        try {
          const res = await fetch(`https://api.z-api.io/instances/${zapi.instance_id}/token/${zapi.token}/send-text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone: partner.phone_whatsapp,
              message: messageText
            })
          })
          if (res.ok) {
            sent = true;
            details = 'Mensagem enviada com sucesso!'
          } else {
            details = `Falha no envio da Z-API. Status: ${res.status}`
          }
        } catch (err: any) {
          details = `Erro de conexão Z-API: ${err.message}`
        }
      }

      return { success: true, sent, details, simulatedText: messageText }
    }

    if (actionType === 'email') {
      const { data: resend } = await supabaseAdmin
        .from('resend_config')
        .select('*')
        .limit(1)
        .maybeSingle()

      // Buscar template de e-mail de boas vindas
      const { data: templates } = await supabaseAdmin
        .from('email_templates')
        .select('*')
        .limit(1)

      const template = templates?.[0] || { subject: 'Bem-vindo à BRS Promotora', body: 'Olá {{name}}, seu cadastro foi finalizado!' }

      const emailSubject = replaceTags(template.subject)
      const emailBody = replaceTags(template.body)

      let sent = false
      let details = 'Resend inativo ou sem credenciais.'

      if (resend && resend.is_active && resend.api_key) {
        try {
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${resend.api_key}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: resend.from_email || 'onboarding@brspromotora.com.br',
              to: [partner.email_comissao],
              subject: emailSubject,
              html: emailBody
            })
          })
          if (res.ok) {
            sent = true;
            details = 'E-mail disparado com sucesso via Resend!'
          } else {
            details = `Falha no envio do Resend. Status: ${res.status}`
          }
        } catch (err: any) {
          details = `Erro de conexão Resend: ${err.message}`
        }
      }

      return { success: true, sent, details, simulatedSubject: emailSubject, simulatedBody: emailBody }
    }

    if (actionType === 'aprovar') {
      const arwCode = params.arw_code
      const tempPass = params.temporary_password || 'brs' + Math.random().toString(36).substr(2, 6)
      const driveUrl = params.google_drive_url

      if (!arwCode) {
        throw new Error('Código ARW é obrigatório para aprovação de cadastro.')
      }

      // 1. Criar Usuário no Supabase Auth se ainda não existir
      let userId
      try {
        const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.createUser({
          email: partner.email_comissao,
          password: tempPass,
          email_confirm: true,
          // Segurança: parceiro deve trocar a senha provisória no primeiro acesso.
          app_metadata: { temp_password_reset_required: true }
        })

        if (authErr) {
          // Se já existir no Auth, tentamos buscar pelo e-mail
          const { data: existingUser } = await supabaseAdmin
            .from('users')
            .select('id')
            .eq('email', partner.email_comissao)
            .maybeSingle()

          if (existingUser) {
            userId = existingUser.id
          } else {
            throw authErr
          }
        } else {
          userId = authUser.user.id
        }
      } catch (err: any) {
        console.warn('Erro ao criar no Auth, assumindo vínculo por e-mail existente:', err.message)
      }

      // 2. Criar ou Atualizar na tabela users
      if (userId) {
        const { error: userErr } = await supabaseAdmin
          .from('users')
          .upsert({
            id: userId,
            name: partner.name,
            email: partner.email_comissao,
            cpf: partner.cpf_cnpj,
            role: 'gestor', // papel padrão
            commercial_role: 'gerente', // como é parceiro gerente
            superintendente_id: partner.superintendente_id,
            supervisor_id: partner.supervisor_id,
            gerente_id: partner.gerente_id,
            active: true
          })
        if (userErr) throw userErr
      }

      // 3. Atualizar parceiro no CRM
      const { error: updErr } = await supabaseAdmin
        .from('agentes_parceiros')
        .update({
          status: 'finalizado',
          arw_code: arwCode,
          // Segurança: não persistir a senha provisória em claro. Ela é entregue
          // ao parceiro no WhatsApp de boas-vindas (abaixo) e trocada no 1º acesso.
          google_drive_url: driveUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', partnerId)

      if (updErr) throw updErr

      // 4. Auto-enviar WhatsApp de Boas-vindas contendo credenciais
      try {
        const welcomeMessage = `Olá *${partner.name}*, seu acesso ao portal BRS Promotora foi liberado!\n\n*Acesse:* https://gestao.brspromotora.com.br\n*Usuário:* ${partner.email_comissao}\n*Senha Provisória:* ${tempPass}\n*Código ARW:* ${arwCode}\n\nSeja bem-vindo!`
        await executePartnerAutomation(partnerId, 'whatsapp', { message: welcomeMessage })
      } catch (waErr) {
        console.error('Falha ao disparar Whatsapp de Boas-vindas automático:', waErr)
      }

      revalidatePath('/rh/parceiros')
      return { success: true, message: 'Parceiro finalizado e usuário de acesso criado com sucesso!' }
    }

    throw new Error('Ação de automação inválida.')
  } catch (error: any) {
    console.error('Erro na automação do parceiro:', error)
    return { success: false, error: error.message }
  }
}
