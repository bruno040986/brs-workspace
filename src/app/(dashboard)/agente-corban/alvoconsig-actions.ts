'use server'

/**
 * Aba "AlvoConsig" do editor do Agente Corban.
 *
 * Habilita o CRM AlvoConsig para o parceiro (crm_parceiro_config) e gerencia o
 * usuário MASTER (crm_usuarios, papel 'master'). Com o CRM habilitado:
 * - o card AlvoConsig aparece no Portal Parceiro do parceiro;
 * - o master loga via SSO e pode criar atendentes dentro do CRM;
 * - o parceiro passa a aparecer na Alocação de Lotes (/alvoconsig).
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

function normalizeEmail(value: string) {
  return String(value || '').trim().toLowerCase()
}

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const target = normalizeEmail(email)
  let page = 1
  while (page <= 20) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const users = data?.users || []
    for (const user of users) {
      if (normalizeEmail(user.email || '') === target) return user.id
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

    const [configRes, mastersRes] = await Promise.all([
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
    ])

    if (configRes.error) throw configRes.error
    if (mastersRes.error) throw mastersRes.error

    return {
      success: true,
      config: configRes.data || null,
      usuarios: mastersRes.data || [],
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

export async function criarMasterAlvoconsig(payload: {
  agenteParceiroId: string
  nome: string
  email: string
  senha: string
}) {
  try {
    const { user } = await requirePermission(PERMISSION_RESOURCE, 'can_edit')

    if (!payload.agenteParceiroId) return { success: false, error: 'Agente inválido.' }
    const nome = String(payload.nome || '').trim()
    const email = normalizeEmail(payload.email)
    const senha = String(payload.senha || '')
    if (!nome) return { success: false, error: 'Informe o nome do master.' }
    if (!email || !email.includes('@')) return { success: false, error: 'Informe um e-mail válido.' }

    // 1. Resolve (ou cria) o usuário no Supabase Auth.
    let authUserId: string | null = null
    if (senha) {
      if (senha.length < 8) return { success: false, error: 'A senha deve ter ao menos 8 caracteres.' }
      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: senha,
        email_confirm: true,
        // Segurança: master deve trocar a senha provisória no primeiro acesso.
        // external: usuário do CRM não entra no espelho interno public.users
        // e é bloqueado pelo middleware do Workspace.
        app_metadata: { temp_password_reset_required: true, external: 'alvoconsig' },
      })
      if (createError) {
        authUserId = await findAuthUserIdByEmail(email)
        if (!authUserId) throw createError
      } else {
        authUserId = created.user?.id || null
      }
    } else {
      // Sem senha: vincula um login já existente (ex.: provisionado pelo portal).
      authUserId = await findAuthUserIdByEmail(email)
      if (!authUserId) {
        return { success: false, error: 'Nenhum login encontrado com esse e-mail. Informe uma senha provisória para criar o acesso.' }
      }
    }
    if (!authUserId) return { success: false, error: 'Falha ao resolver o login do master.' }

    // 2. Garante que esse login não está vinculado a OUTRO parceiro.
    const { data: existente } = await supabaseAdmin
      .from('crm_usuarios')
      .select('id, agente_parceiro_id, papel')
      .eq('auth_user_id', authUserId)
      .maybeSingle()
    if (existente && String(existente.agente_parceiro_id) !== String(payload.agenteParceiroId)) {
      return { success: false, error: 'Esse e-mail já é usuário do CRM de outro parceiro.' }
    }

    // 3. Upsert do vínculo master.
    const { error: upsertError } = await supabaseAdmin
      .from('crm_usuarios')
      .upsert(
        {
          auth_user_id: authUserId,
          agente_parceiro_id: payload.agenteParceiroId,
          papel: 'master',
          nome,
          email,
          ativo: true,
          created_by: user.id,
        },
        { onConflict: 'auth_user_id' },
      )
    if (upsertError) throw upsertError

    return { success: true }
  } catch (error: any) {
    console.error('Erro ao criar master AlvoConsig:', error)
    if (String(error?.message || '').toLowerCase().includes('password')) {
      return { success: false, error: 'Senha recusada pelo provedor de auth (mínimo 8 caracteres).' }
    }
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
