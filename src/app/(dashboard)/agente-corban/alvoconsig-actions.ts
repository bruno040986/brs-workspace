'use server'

/**
 * Aba "AlvoConsig" do editor do Agente Corban.
 *
 * Habilitar o AlvoConsig = toggle + quantidade de atendentes. O MASTER é
 * SEMPRE o login único do parceiro (aba Acesso): e-mail sintético
 * <arw_code>@parceiro.brspromotora.com.br, mesma credencial do ARW e do
 * Portal Parceiro — nada de nome/e-mail/senha na aba (decisão Bruno
 * 23/08/2026). Ao habilitar, o master é vinculado automaticamente em
 * crm_usuarios e o vínculo agentes_parceiros.auth_user_id é preenchido.
 */

import { createClient } from '@supabase/supabase-js'
import { requirePermission } from '@/lib/auth/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
)

const PERMISSION_RESOURCE = 'comercial-agentes'
const DOMINIO_PARCEIRO = '@parceiro.brspromotora.com.br'

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const target = email.trim().toLowerCase()
  let page = 1
  while (page <= 20) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const users = data?.users || []
    for (const user of users) {
      if (String(user.email || '').toLowerCase() === target) return user.id
    }
    if (users.length < 200) return null
    page += 1
  }
  return null
}

export async function getAlvoconsigConfig(agenteParceiroId: string) {
  try {
    await requirePermission(PERMISSION_RESOURCE)
    if (!agenteParceiroId) return { success: false, error: 'Agente inválido.' }

    const [configRes, usuariosRes, agenteRes] = await Promise.all([
      supabaseAdmin
        .from('crm_parceiro_config')
        .select('agente_parceiro_id, habilitado, max_atendentes, habilitado_em')
        .eq('agente_parceiro_id', agenteParceiroId)
        .maybeSingle(),
      supabaseAdmin
        .from('crm_usuarios')
        .select('id, nome, email, papel, ativo, auth_user_id, created_at')
        .eq('agente_parceiro_id', agenteParceiroId)
        .order('papel', { ascending: false })
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('agentes_parceiros')
        .select('id, arw_code, auth_user_id')
        .eq('id', agenteParceiroId)
        .maybeSingle(),
    ])

    if (configRes.error) throw configRes.error
    if (usuariosRes.error) throw usuariosRes.error

    const arwCode = String(agenteRes.data?.arw_code || '').trim().toLowerCase()
    let loginProvisionado = Boolean(agenteRes.data?.auth_user_id)
    if (!loginProvisionado && arwCode) {
      loginProvisionado = Boolean(await findAuthUserIdByEmail(`${arwCode}${DOMINIO_PARCEIRO}`))
    }

    return {
      success: true,
      config: configRes.data || null,
      usuarios: usuariosRes.data || [],
      arwCode,
      loginProvisionado,
    }
  } catch (error: any) {
    console.error('Erro ao carregar config AlvoConsig do agente:', error)
    return { success: false, error: error.message }
  }
}

export async function salvarAlvoconsigConfig(payload: {
  agenteParceiroId: string
  habilitado: boolean
  maxAtendentes: number
}) {
  try {
    const { user } = await requirePermission(PERMISSION_RESOURCE, 'can_edit')
    if (!payload.agenteParceiroId) return { success: false, error: 'Agente inválido.' }

    const maxAtendentes = Math.max(0, Math.min(500, Number.parseInt(String(payload.maxAtendentes), 10) || 0))

    if (payload.habilitado) {
      // Master = login único do parceiro (aba Acesso). Valida e vincula.
      const { data: agente, error: agenteError } = await supabaseAdmin
        .from('agentes_parceiros')
        .select('id, name, fantasy_name, representante_legal, arw_code, auth_user_id')
        .eq('id', payload.agenteParceiroId)
        .maybeSingle()
      if (agenteError) throw agenteError
      if (!agente) return { success: false, error: 'Agente não encontrado.' }

      const arwCode = String(agente.arw_code || '').trim().toLowerCase()
      if (!arwCode) {
        return { success: false, error: 'Preencha o Código ARW na aba Acesso antes de habilitar o AlvoConsig.' }
      }

      const emailSintetico = `${arwCode}${DOMINIO_PARCEIRO}`
      let authUserId = agente.auth_user_id ? String(agente.auth_user_id) : null
      if (!authUserId) {
        authUserId = await findAuthUserIdByEmail(emailSintetico)
      }
      if (!authUserId) {
        return {
          success: false,
          error: `O login do parceiro (código ${arwCode.toUpperCase()}) ainda não foi provisionado. Conclua o provisionamento do acesso (aba Acesso / validação do cadastro) antes de habilitar.`,
        }
      }

      // Garante que esse login não é usuário do CRM de OUTRO parceiro.
      const { data: existente } = await supabaseAdmin
        .from('crm_usuarios')
        .select('id, agente_parceiro_id')
        .eq('auth_user_id', authUserId)
        .maybeSingle()
      if (existente && String(existente.agente_parceiro_id) !== String(payload.agenteParceiroId)) {
        return { success: false, error: 'Esse login já é usuário do CRM de outro parceiro.' }
      }

      const nomeMaster = String(agente.representante_legal || agente.fantasy_name || agente.name || arwCode.toUpperCase()).trim()

      const { error: masterError } = await supabaseAdmin.from('crm_usuarios').upsert(
        {
          auth_user_id: authUserId,
          agente_parceiro_id: payload.agenteParceiroId,
          papel: 'master',
          nome: nomeMaster,
          email: emailSintetico,
          ativo: true,
          created_by: user.id,
        },
        { onConflict: 'auth_user_id' },
      )
      if (masterError) throw masterError

      // Backfill do vínculo login ↔ cadastro (usado pelo portal e pelo saque).
      if (!agente.auth_user_id) {
        await supabaseAdmin
          .from('agentes_parceiros')
          .update({ auth_user_id: authUserId })
          .eq('id', payload.agenteParceiroId)
          .is('auth_user_id', null)
      }
    }

    const { data: atual } = await supabaseAdmin
      .from('crm_parceiro_config')
      .select('habilitado')
      .eq('agente_parceiro_id', payload.agenteParceiroId)
      .maybeSingle()

    const row: Record<string, unknown> = {
      agente_parceiro_id: payload.agenteParceiroId,
      habilitado: payload.habilitado === true,
      max_atendentes: maxAtendentes,
    }
    if (payload.habilitado && !atual?.habilitado) {
      row.habilitado_por = user.id
      row.habilitado_em = new Date().toISOString()
    }

    const { error } = await supabaseAdmin
      .from('crm_parceiro_config')
      .upsert(row, { onConflict: 'agente_parceiro_id' })
    if (error) throw error

    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar config AlvoConsig:', error)
    return { success: false, error: error.message }
  }
}

export async function setUsuarioCrmAtivo(usuarioId: string, ativo: boolean) {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_edit')
    if (!usuarioId) return { success: false, error: 'Usuário inválido.' }

    const { error } = await supabaseAdmin
      .from('crm_usuarios')
      .update({ ativo: ativo === true })
      .eq('id', usuarioId)
    if (error) throw error
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alterar status do usuário CRM:', error)
    return { success: false, error: error.message }
  }
}
