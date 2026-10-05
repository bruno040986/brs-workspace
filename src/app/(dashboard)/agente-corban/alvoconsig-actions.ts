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
import { provisionarContaChatDoParceiro } from '@/lib/central-conversas/provisionar-parceiro'
import { STATUS_FUNCIONALIDADE } from '@/lib/alvoconsig/funcionalidades'

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
        .select('agente_parceiro_id, habilitado, max_atendentes, max_instancias_receptivas, max_instancias_disparo, disparo_min_instancias, disparo_min_templates_por_instancia, habilitado_em, ia_agente_status, ia_agente_ate, site_os_consig_status, site_os_consig_ate')
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
  maxInstanciasReceptivas?: number
  maxInstanciasDisparo?: number
  disparoMinInstancias?: number
  disparoMinTemplatesPorInstancia?: number
  /** Funcionalidades (status desligado|teste|pago + data AAAA-MM-DD "válido até"). Omitido = não altera. */
  iaAgenteStatus?: string
  iaAgenteAte?: string | null
  siteOsConsigStatus?: string
  siteOsConsigAte?: string | null
}) {
  try {
    const { user } = await requirePermission(PERMISSION_RESOURCE, 'can_edit')
    if (!payload.agenteParceiroId) return { success: false, error: 'Agente inválido.' }

    const maxAtendentes = Math.max(0, Math.min(500, Number.parseInt(String(payload.maxAtendentes), 10) || 0))
    const clamp = (v: unknown, min: number, max: number, def: number) => {
      const n = Number.parseInt(String(v), 10)
      return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def
    }
    const maxInstanciasReceptivas = clamp(payload.maxInstanciasReceptivas, 0, 20, 2)
    const maxInstanciasDisparo = clamp(payload.maxInstanciasDisparo, 0, 50, 10)
    const disparoMinInstancias = clamp(payload.disparoMinInstancias, 1, 50, 3)
    const disparoMinTemplatesPorInstancia = clamp(payload.disparoMinTemplatesPorInstancia, 1, 20, 3)
    let avisoChat: string | null = null

    // Funcionalidades: valida status e data; "até" vale até o fim do dia (Brasília).
    const funcionalidade = (status: unknown, ate: unknown, nome: string) => {
      if (status === undefined) return { ok: true as const, cols: null }
      if (!(STATUS_FUNCIONALIDADE as readonly string[]).includes(String(status))) {
        return { ok: false as const, error: `Status inválido em "${nome}".` }
      }
      if (status === 'desligado') return { ok: true as const, cols: { status, ate: null } }
      const d = String(ate ?? '').trim()
      if (!d) {
        if (status === 'teste') return { ok: false as const, error: `Informe a data "válido até" do teste em "${nome}".` }
        return { ok: true as const, cols: { status, ate: null } }
      }
      const iso = `${d}T23:59:59-03:00`
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(new Date(iso).getTime())) {
        return { ok: false as const, error: `Data inválida em "${nome}".` }
      }
      return { ok: true as const, cols: { status, ate: iso } }
    }
    const fIa = funcionalidade(payload.iaAgenteStatus, payload.iaAgenteAte, 'Agente de IA')
    if (!fIa.ok) return { success: false, error: fIa.error }
    const fSite = funcionalidade(payload.siteOsConsigStatus, payload.siteOsConsigAte, 'Site OS-Consig')
    if (!fSite.ok) return { success: false, error: fSite.error }

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

      // Chat Integrado: a conta Chatwoot do parceiro nasce AQUI, na habilitação
      // (decisão 29/08/2026) — o parceiro entra no CRM e só lê os QR Codes.
      // Best-effort: se o Chatwoot estiver fora, habilita mesmo assim e avisa;
      // o CRM cria a conta sozinho na primeira abertura, como fallback.
      try {
        await provisionarContaChatDoParceiro(payload.agenteParceiroId)
      } catch (chatError) {
        console.error('Chat Integrado: falha ao provisionar conta do parceiro na habilitação:', chatError)
        avisoChat = 'Habilitado, mas a conta do Chat Integrado não pôde ser criada agora (Chatwoot indisponível). O CRM tenta de novo na primeira abertura.'
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
      max_instancias_receptivas: maxInstanciasReceptivas,
      max_instancias_disparo: maxInstanciasDisparo,
      disparo_min_instancias: disparoMinInstancias,
      disparo_min_templates_por_instancia: disparoMinTemplatesPorInstancia,
    }
    if (fIa.cols) {
      row.ia_agente_status = fIa.cols.status
      row.ia_agente_ate = fIa.cols.ate
    }
    if (fSite.cols) {
      row.site_os_consig_status = fSite.cols.status
      row.site_os_consig_ate = fSite.cols.ate
    }
    if (payload.habilitado && !atual?.habilitado) {
      row.habilitado_por = user.id
      row.habilitado_em = new Date().toISOString()
    }

    const { error } = await supabaseAdmin
      .from('crm_parceiro_config')
      .upsert(row, { onConflict: 'agente_parceiro_id' })
    if (error) throw error

    return { success: true, aviso: avisoChat || undefined }
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
