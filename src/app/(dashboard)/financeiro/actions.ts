'use server'

/**
 * Portal Financeiro — Conta Virtual do Portal Parceiro.
 * Spec: brs-portal-parceiro/docs/SPEC-FINANCEIRO-CONTA-VIRTUAL.md
 *
 * Toda mutação de saldo passa pela função atômica parceiro_aplicar_lancamento
 * (SECURITY DEFINER, service_role) — nunca gravar ledger/saldo direto.
 */

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
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

const PERMISSION_RESOURCE = 'financeiro-conta-parceiros'

const DOMINIO_PARCEIRO = '@parceiro.brspromotora.com.br'

function emailDoCodigo(codigo: string) {
  return `${codigo.trim().toLowerCase()}${DOMINIO_PARCEIRO}`
}

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

export type ParceiroResolvido = {
  userId: string
  codigo: string
  nome: string
  agenteParceiroId: string | null
  saldoCentavos: number
}

/**
 * Resolve um parceiro pelo código ARW: primeiro pelo vínculo
 * agentes_parceiros.auth_user_id, senão pelo e-mail sintético no Auth.
 */
export async function resolverParceiro(codigo: string) {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const codigoLimpo = String(codigo || '').trim().toLowerCase()
    if (!/^[a-z0-9]{2,20}$/.test(codigoLimpo)) {
      return { success: false, error: 'Código ARW inválido (2 a 20 letras/números).' }
    }

    const { data: agente } = await supabaseAdmin
      .from('agentes_parceiros')
      .select('id, name, fantasy_name, auth_user_id, arw_code')
      .ilike('arw_code', codigoLimpo)
      .maybeSingle()

    let userId = agente?.auth_user_id ? String(agente.auth_user_id) : null
    if (!userId) {
      userId = await findAuthUserIdByEmail(emailDoCodigo(codigoLimpo))
    }
    if (!userId) {
      return { success: false, error: `Nenhum login provisionado para o código "${codigoLimpo}".` }
    }

    const { data: carteira } = await supabaseAdmin
      .from('parceiro_carteiras')
      .select('saldo_centavos')
      .eq('user_id', userId)
      .maybeSingle()

    const parceiro: ParceiroResolvido = {
      userId,
      codigo: codigoLimpo,
      nome: String(agente?.fantasy_name || agente?.name || emailDoCodigo(codigoLimpo)),
      agenteParceiroId: agente?.id ? String(agente.id) : null,
      saldoCentavos: Number(carteira?.saldo_centavos || 0),
    }
    return { success: true, parceiro }
  } catch (error: any) {
    console.error('Erro ao resolver parceiro:', error)
    return { success: false, error: error.message }
  }
}

// ----------------------------------------------------------------------------
// Lançamento manual
// ----------------------------------------------------------------------------
export async function lancarManual(payload: {
  userId: string
  tipo: 'credito' | 'debito'
  valorCentavos: number
  motivo: string
}) {
  try {
    const { user } = await requirePermission(PERMISSION_RESOURCE, 'can_include')

    if (!payload.userId) return { success: false, error: 'Parceiro inválido.' }
    if (payload.tipo !== 'credito' && payload.tipo !== 'debito') {
      return { success: false, error: 'Tipo inválido.' }
    }
    const valor = Math.round(Number(payload.valorCentavos))
    if (!Number.isFinite(valor) || valor <= 0) return { success: false, error: 'Informe um valor maior que zero.' }
    const motivo = String(payload.motivo || '').trim()
    if (!motivo) return { success: false, error: 'O motivo é obrigatório (aparece no extrato do parceiro).' }

    const { data: saldo, error } = await supabaseAdmin.rpc('parceiro_aplicar_lancamento', {
      p_user_id: payload.userId,
      p_tipo: payload.tipo,
      p_valor_centavos: valor,
      p_motivo: motivo,
      p_origem: 'manual',
      p_referencia_tipo: 'ajuste',
      p_referencia_id: null,
      p_criado_por: user.id,
    })
    if (error) {
      if (String(error.message || '').includes('saldo insuficiente')) {
        return { success: false, error: 'Saldo insuficiente para esse débito.' }
      }
      throw error
    }

    revalidatePath('/financeiro/conta-parceiros')
    return { success: true, saldoCentavos: Number(saldo) }
  } catch (error: any) {
    console.error('Erro no lançamento manual:', error)
    return { success: false, error: error.message }
  }
}

// ----------------------------------------------------------------------------
// Saques
// ----------------------------------------------------------------------------
async function anexarParceiros(rows: Array<{ user_id: string }>) {
  const userIds = Array.from(new Set(rows.map((row) => String(row.user_id))))
  const porUsuario = new Map<string, { codigo: string; nome: string }>()
  if (!userIds.length) return porUsuario

  const { data: agentes } = await supabaseAdmin
    .from('agentes_parceiros')
    .select('auth_user_id, name, fantasy_name, arw_code')
    .in('auth_user_id', userIds)
  for (const agente of agentes || []) {
    porUsuario.set(String(agente.auth_user_id), {
      codigo: String(agente.arw_code || '').toLowerCase(),
      nome: String(agente.fantasy_name || agente.name || ''),
    })
  }
  // Sem vínculo no cadastro: deriva o código do e-mail sintético.
  for (const userId of userIds) {
    if (porUsuario.has(userId)) continue
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(userId)
      const email = String(data?.user?.email || '')
      porUsuario.set(userId, {
        codigo: email.endsWith(DOMINIO_PARCEIRO) ? email.slice(0, -DOMINIO_PARCEIRO.length) : '',
        nome: email,
      })
    } catch {
      porUsuario.set(userId, { codigo: '', nome: userId })
    }
  }
  return porUsuario
}

export async function getSaques(status?: string) {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    let query = supabaseAdmin
      .from('parceiro_saques')
      .select('*')
      .order('criado_em', { ascending: true })
      .limit(300)
    if (status) query = query.eq('status', status)
    const { data, error } = await query
    if (error) throw error

    const rows = data || []
    const parceiros = await anexarParceiros(rows as Array<{ user_id: string }>)
    const items = rows.map((row: any) => ({
      ...row,
      parceiro: parceiros.get(String(row.user_id)) || { codigo: '', nome: '' },
    }))
    return { success: true, items }
  } catch (error: any) {
    console.error('Erro ao listar saques:', error)
    return { success: false, error: error.message }
  }
}

export async function aprovarSaque(saqueId: string, observacao?: string) {
  try {
    const { user } = await requirePermission(PERMISSION_RESOURCE, 'can_edit')

    const { data: saque, error: saqueError } = await supabaseAdmin
      .from('parceiro_saques')
      .select('id, user_id, valor_centavos, chave_pix, status')
      .eq('id', saqueId)
      .maybeSingle()
    if (saqueError) throw saqueError
    if (!saque) return { success: false, error: 'Saque não encontrado.' }
    if (saque.status !== 'pendente') return { success: false, error: 'Este saque já foi resolvido.' }

    // 1. Débito atômico (falhou = não muda status).
    const { error: rpcError } = await supabaseAdmin.rpc('parceiro_aplicar_lancamento', {
      p_user_id: saque.user_id,
      p_tipo: 'debito',
      p_valor_centavos: saque.valor_centavos,
      p_motivo: `Saque Pix para ${saque.chave_pix}`,
      p_origem: 'sistema',
      p_referencia_tipo: 'saque',
      p_referencia_id: saque.id,
      p_criado_por: user.id,
    })
    if (rpcError) {
      if (String(rpcError.message || '').includes('saldo insuficiente')) {
        return { success: false, error: 'Saldo insuficiente — o parceiro movimentou a conta depois do pedido. Recuse ou aguarde.' }
      }
      throw rpcError
    }

    // 2. Marca como pago (guard por status).
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('parceiro_saques')
      .update({
        status: 'pago',
        observacao: String(observacao || '').trim() || null,
        resolvido_em: new Date().toISOString(),
        resolvido_por: user.id,
      })
      .eq('id', saqueId)
      .eq('status', 'pendente')
      .select('id')
    if (updateError) throw updateError
    if (!updated?.length) {
      console.error(`Saque ${saqueId}: débito aplicado mas status não era mais pendente — verificar ledger.`)
      return { success: false, error: 'Conflito de concorrência ao marcar o saque — verifique o extrato do parceiro.' }
    }

    revalidatePath('/financeiro/saques')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao aprovar saque:', error)
    return { success: false, error: error.message }
  }
}

export async function recusarSaque(saqueId: string, observacao?: string) {
  try {
    const { user } = await requirePermission(PERMISSION_RESOURCE, 'can_edit')

    const { data: updated, error } = await supabaseAdmin
      .from('parceiro_saques')
      .update({
        status: 'recusado',
        observacao: String(observacao || '').trim() || null,
        resolvido_em: new Date().toISOString(),
        resolvido_por: user.id,
      })
      .eq('id', saqueId)
      .eq('status', 'pendente')
      .select('id')
    if (error) throw error
    if (!updated?.length) return { success: false, error: 'Este saque já foi resolvido.' }

    revalidatePath('/financeiro/saques')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao recusar saque:', error)
    return { success: false, error: error.message }
  }
}

// ----------------------------------------------------------------------------
// Histórico
// ----------------------------------------------------------------------------
export async function getHistorico(filtros?: {
  codigoParceiro?: string
  dataInicio?: string
  dataFim?: string
}) {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    let userIdFiltro: string | null = null
    const codigo = String(filtros?.codigoParceiro || '').trim().toLowerCase()
    if (codigo) {
      const res = await resolverParceiro(codigo)
      if (!res.success || !res.parceiro) return { success: true, lancamentos: [], saques: [] }
      userIdFiltro = res.parceiro.userId
    }

    let lancamentosQuery = supabaseAdmin
      .from('parceiro_lancamentos')
      .select('*')
      .eq('origem', 'manual')
      .order('criado_em', { ascending: false })
      .limit(200)
    let saquesQuery = supabaseAdmin
      .from('parceiro_saques')
      .select('*')
      .in('status', ['pago', 'recusado', 'cancelado'])
      .order('resolvido_em', { ascending: false })
      .limit(200)

    if (userIdFiltro) {
      lancamentosQuery = lancamentosQuery.eq('user_id', userIdFiltro)
      saquesQuery = saquesQuery.eq('user_id', userIdFiltro)
    }
    if (filtros?.dataInicio) {
      lancamentosQuery = lancamentosQuery.gte('criado_em', `${filtros.dataInicio}T00:00:00Z`)
      saquesQuery = saquesQuery.gte('criado_em', `${filtros.dataInicio}T00:00:00Z`)
    }
    if (filtros?.dataFim) {
      lancamentosQuery = lancamentosQuery.lte('criado_em', `${filtros.dataFim}T23:59:59Z`)
      saquesQuery = saquesQuery.lte('criado_em', `${filtros.dataFim}T23:59:59Z`)
    }

    const [lancamentosRes, saquesRes] = await Promise.all([lancamentosQuery, saquesQuery])
    if (lancamentosRes.error) throw lancamentosRes.error
    if (saquesRes.error) throw saquesRes.error

    const todos = [...(lancamentosRes.data || []), ...(saquesRes.data || [])] as Array<{ user_id: string }>
    const parceiros = await anexarParceiros(todos)

    // Nomes de quem executou (usuários internos).
    const internosIds = Array.from(
      new Set(
        [
          ...(lancamentosRes.data || []).map((row: any) => row.criado_por),
          ...(saquesRes.data || []).map((row: any) => row.resolvido_por),
        ].filter(Boolean).map(String),
      ),
    )
    const internosPorId = new Map<string, string>()
    if (internosIds.length) {
      const { data: internos } = await supabaseAdmin.from('users').select('id, name').in('id', internosIds)
      for (const interno of internos || []) internosPorId.set(String(interno.id), String(interno.name || ''))
    }

    const lancamentos = (lancamentosRes.data || []).map((row: any) => ({
      ...row,
      parceiro: parceiros.get(String(row.user_id)) || { codigo: '', nome: '' },
      criado_por_nome: row.criado_por ? internosPorId.get(String(row.criado_por)) || '' : '',
    }))
    const saques = (saquesRes.data || []).map((row: any) => ({
      ...row,
      parceiro: parceiros.get(String(row.user_id)) || { codigo: '', nome: '' },
      resolvido_por_nome: row.resolvido_por ? internosPorId.get(String(row.resolvido_por)) || '' : '',
    }))

    return { success: true, lancamentos, saques }
  } catch (error: any) {
    console.error('Erro no histórico da conta virtual:', error)
    return { success: false, error: error.message }
  }
}
