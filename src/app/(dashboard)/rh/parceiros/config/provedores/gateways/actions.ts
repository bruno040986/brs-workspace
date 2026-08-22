'use server'

/**
 * Config dos Gateways de Pagamento Pix (Mercado Pago / AbacatePay).
 * Credenciais NUNCA saem inteiras para o browser — a leitura devolve só
 * "preenchido + últimos 4 caracteres"; salvar campo vazio preserva o valor
 * existente. Permissão: sistema-config-gateways.
 */

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { GATEWAY_CAMPOS } from '@/lib/gateways'

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

const PERMISSION_RESOURCE = 'sistema-config-gateways'

type CredencialMascarada = { key: string; preenchido: boolean; mascarado: string }

function mascarar(valor: string): string {
  const texto = String(valor || '')
  if (!texto) return ''
  if (texto.length <= 4) return '••••'
  return `••••${texto.slice(-4)}`
}

export async function getGateways() {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const { data, error } = await supabaseAdmin
      .from('gateway_pagamentos')
      .select('id, nome, ativo, modo, credenciais, taxa_percentual_bps, taxa_fixa_centavos, atualizado_em')
      .order('nome')
    if (error) throw error

    const items = (data || []).map((row: any) => {
      const campos = GATEWAY_CAMPOS[String(row.id)] || []
      const credenciais: CredencialMascarada[] = campos.map((campo) => {
        const valor = String(row.credenciais?.[campo.key] || '')
        return { key: campo.key, preenchido: Boolean(valor), mascarado: mascarar(valor) }
      })
      return {
        id: String(row.id),
        nome: String(row.nome),
        ativo: row.ativo === true,
        modo: row.modo === 'producao' ? 'producao' : 'teste',
        taxa_percentual_bps: row.taxa_percentual_bps === null ? null : Number(row.taxa_percentual_bps),
        taxa_fixa_centavos: row.taxa_fixa_centavos === null ? null : Number(row.taxa_fixa_centavos),
        atualizado_em: row.atualizado_em,
        credenciais,
      }
    })

    return { success: true, items }
  } catch (error: any) {
    console.error('Erro ao listar gateways:', error)
    return { success: false, error: error.message }
  }
}

export async function saveGateway(payload: {
  id: string
  ativo: boolean
  modo: string
  taxa_percentual_bps?: number | null
  taxa_fixa_centavos?: number | null
  /** Só os campos que o operador digitou; vazio/ausente preserva o salvo. */
  credenciais?: Record<string, string>
}) {
  try {
    const { user } = await requirePermission(PERMISSION_RESOURCE, 'can_edit')

    const id = String(payload.id || '').trim()
    const camposValidos = GATEWAY_CAMPOS[id]
    if (!camposValidos) return { success: false, error: 'Gateway desconhecido.' }

    const { data: atual, error: atualError } = await supabaseAdmin
      .from('gateway_pagamentos')
      .select('credenciais')
      .eq('id', id)
      .maybeSingle()
    if (atualError) throw atualError
    if (!atual) return { success: false, error: 'Gateway não encontrado.' }

    const credenciais: Record<string, string> = { ...(atual.credenciais as Record<string, string> | null || {}) }
    for (const campo of camposValidos) {
      const novoValor = String(payload.credenciais?.[campo.key] || '').trim()
      if (novoValor) credenciais[campo.key] = novoValor
    }

    const taxaPercentual =
      payload.taxa_percentual_bps === null || payload.taxa_percentual_bps === undefined
        ? null
        : Math.max(0, Math.round(Number(payload.taxa_percentual_bps)))
    const taxaFixa =
      payload.taxa_fixa_centavos === null || payload.taxa_fixa_centavos === undefined
        ? null
        : Math.max(0, Math.round(Number(payload.taxa_fixa_centavos)))

    if (payload.ativo === true) {
      const faltando = camposValidos.filter((campo) => !String(credenciais[campo.key] || '').trim())
      if (faltando.length > 0) {
        return {
          success: false,
          error: `Preencha as credenciais antes de ativar: ${faltando.map((campo) => campo.label).join(', ')}.`,
        }
      }
    }

    const { error } = await supabaseAdmin
      .from('gateway_pagamentos')
      .update({
        ativo: payload.ativo === true,
        modo: payload.modo === 'producao' ? 'producao' : 'teste',
        credenciais,
        taxa_percentual_bps: taxaPercentual,
        taxa_fixa_centavos: taxaFixa,
        atualizado_em: new Date().toISOString(),
        atualizado_por: user.id,
      })
      .eq('id', id)
    if (error) throw error

    revalidatePath('/rh/parceiros/config/provedores/gateways')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar gateway:', error)
    return { success: false, error: error.message }
  }
}

export async function limparCredencialGateway(id: string, campoKey: string) {
  try {
    const { user } = await requirePermission(PERMISSION_RESOURCE, 'can_edit')

    const campos = GATEWAY_CAMPOS[String(id)]
    if (!campos?.some((campo) => campo.key === campoKey)) {
      return { success: false, error: 'Campo inválido.' }
    }

    const { data: atual, error: atualError } = await supabaseAdmin
      .from('gateway_pagamentos')
      .select('credenciais, ativo')
      .eq('id', id)
      .maybeSingle()
    if (atualError) throw atualError
    if (!atual) return { success: false, error: 'Gateway não encontrado.' }

    const credenciais = { ...(atual.credenciais as Record<string, string> | null || {}) }
    delete credenciais[campoKey]

    const { error } = await supabaseAdmin
      .from('gateway_pagamentos')
      .update({
        credenciais,
        // Sem credencial completa o gateway não pode ficar ativo.
        ativo: atual.ativo === true && Object.keys(credenciais).length > 0 ? atual.ativo : false,
        atualizado_em: new Date().toISOString(),
        atualizado_por: user.id,
      })
      .eq('id', id)
    if (error) throw error

    revalidatePath('/rh/parceiros/config/provedores/gateways')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao limpar credencial do gateway:', error)
    return { success: false, error: error.message }
  }
}
