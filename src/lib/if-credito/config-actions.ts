'use server'

/**
 * Config "APIs de Instituições Financeiras de Crédito" — card por IF
 * (análogo aos Gateways de Pagamento), credenciais no cofre AES.
 * Permissão: `sistema-config-if-credito`. Fatia 2 do plano de Propostas de
 * Crédito (ver docs/ROTEIRO-PROPOSTAS-CREDITO-FATIAS-2-3.md) — só CRUD da
 * config; NENHUMA chamada externa (OAuth/RS256/webhook = Fatia 4).
 */
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'
import { cifrarTexto } from '@/lib/central-conversas/cofre'

const RESOURCE = 'sistema-config-if-credito'

export type InstituicaoConfigResumo = {
  id: string
  name: string
  logo_url: string
  temConfig: boolean
  ativo: boolean
}

export async function listarInstituicoesConfig(): Promise<{ success: boolean; data?: InstituicaoConfigResumo[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const admin = await createAdminClient()
    const [{ data: instituicoes, error: e1 }, { data: configs, error: e2 }] = await Promise.all([
      admin.from('financial_institutions').select('id, name, logo_url').is('deleted_at', null).eq('is_active', true).order('name'),
      admin.from('if_credito_config').select('instituicao_financeira_id, ativo'),
    ])
    if (e1) throw e1
    if (e2) throw e2
    const configPorIf = new Map((configs || []).map((c: any) => [String(c.instituicao_financeira_id), Boolean(c.ativo)]))
    const data: InstituicaoConfigResumo[] = (instituicoes || []).map((i: any) => ({
      id: String(i.id),
      name: String(i.name || ''),
      logo_url: String(i.logo_url || ''),
      temConfig: configPorIf.has(String(i.id)),
      ativo: configPorIf.get(String(i.id)) || false,
    }))
    return { success: true, data }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export type ConfigIFPublica = {
  instituicao_financeira_id: string
  ambiente: 'producao' | 'homologacao'
  base_url: string
  client_id: string
  simulacao_ttl_horas: number
  ativo: boolean
  token_expira_em: string | null
  temClientSecret: boolean
  temChavePrivada: boolean
  temChavePublicaEmpresa: boolean
  temChavePublicaApi: boolean
}

export async function lerConfigIF(instituicaoId: string): Promise<{ success: boolean; data?: ConfigIFPublica; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    if (!instituicaoId) throw new Error('Instituição inválida.')
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('if_credito_config')
      .select('*')
      .eq('instituicao_financeira_id', instituicaoId)
      .maybeSingle()
    if (error) throw error
    const row: any = data || {}
    return {
      success: true,
      data: {
        instituicao_financeira_id: instituicaoId,
        ambiente: (row.ambiente || 'homologacao') as 'producao' | 'homologacao',
        base_url: String(row.base_url || ''),
        client_id: String(row.client_id || ''),
        simulacao_ttl_horas: Number(row.simulacao_ttl_horas) || 24,
        ativo: Boolean(row.ativo),
        token_expira_em: row.token_expira_em || null,
        temClientSecret: Boolean(row.client_secret_enc),
        temChavePrivada: Boolean(row.empresa_private_key_enc),
        temChavePublicaEmpresa: Boolean(row.empresa_public_key_enc),
        temChavePublicaApi: Boolean(row.api_public_key_enc),
      },
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function salvarConfigIF(input: {
  instituicao_financeira_id: string
  ambiente: 'producao' | 'homologacao'
  base_url?: string
  client_id?: string
  client_secret?: string
  empresa_private_key?: string
  empresa_public_key?: string
  api_public_key?: string
  simulacao_ttl_horas: number
  ativo: boolean
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    if (!input.instituicao_financeira_id) throw new Error('Selecione a instituição financeira.')
    if (!['producao', 'homologacao'].includes(input.ambiente)) throw new Error('Ambiente inválido.')
    const ttl = Math.round(Number(input.simulacao_ttl_horas))
    if (!Number.isFinite(ttl) || ttl < 1 || ttl > 168) throw new Error('TTL da simulação deve ser entre 1 e 168 horas.')

    const admin = await createAdminClient()
    // Só grava os campos secretos quando vierem preenchidos — em branco
    // mantém o valor cifrado já salvo (upsert não toca colunas ausentes).
    const row: Record<string, unknown> = {
      instituicao_financeira_id: input.instituicao_financeira_id,
      ambiente: input.ambiente,
      base_url: String(input.base_url || '').trim(),
      client_id: String(input.client_id || '').trim(),
      simulacao_ttl_horas: ttl,
      ativo: Boolean(input.ativo),
      updated_at: new Date().toISOString(),
    }
    if (input.client_secret?.trim()) row.client_secret_enc = cifrarTexto(input.client_secret.trim())
    if (input.empresa_private_key?.trim()) row.empresa_private_key_enc = cifrarTexto(input.empresa_private_key.trim())
    if (input.empresa_public_key?.trim()) row.empresa_public_key_enc = cifrarTexto(input.empresa_public_key.trim())
    if (input.api_public_key?.trim()) row.api_public_key_enc = cifrarTexto(input.api_public_key.trim())

    const { error } = await admin.from('if_credito_config').upsert(row, { onConflict: 'instituicao_financeira_id' })
    if (error) throw error

    revalidatePath('/rh/parceiros/config/provedores/if-credito')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
