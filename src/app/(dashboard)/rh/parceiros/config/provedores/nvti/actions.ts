'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { getNvtiConfig, saveNvtiConfig } from '@/lib/nvti/config'
import { gerarToken } from '@/lib/nvti/client'
import { normalizeTiers } from '@/lib/nvti/pricing'
import type { NvtiMetodo, NvtiPriceTier } from '@/lib/nvti/types'

function getReadableErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

export type NvtiConfigView = {
  id: string
  usuario: string
  cliente: string
  metodo: NvtiMetodo
  monthly_cap_brl: number
  user_monthly_cap_brl: number
  cache_days: number
  price_tiers: NvtiPriceTier[]
  is_active: boolean
  has_credentials: boolean
  token_generated_at: string | null
  can_edit: boolean
}

export async function getNvtiConfigView(): Promise<NvtiConfigView> {
  const { permissions } = await requirePermission('sistema-config-nvti', 'can_view')
  const canEdit = permissions.some(
    (permission) => permission.resource_name === 'sistema-config-nvti' && Boolean(permission.can_edit),
  )
  const config = await getNvtiConfig()
  return {
    id: config.id,
    usuario: config.usuario,
    cliente: config.cliente,
    metodo: config.metodo,
    monthly_cap_brl: config.monthly_cap_brl,
    user_monthly_cap_brl: config.user_monthly_cap_brl,
    cache_days: config.cache_days,
    price_tiers: config.price_tiers,
    is_active: config.is_active,
    has_credentials: config.has_credentials,
    token_generated_at: config.token_generated_at,
    can_edit: canEdit,
  }
}

export async function updateNvtiConfig(formData: FormData) {
  await requirePermission('sistema-config-nvti', 'can_edit')

  const id = String(formData.get('id') || '')
  const usuario = String(formData.get('usuario') || '').trim()
  const senha = String(formData.get('senha') || '')
  const cliente = String(formData.get('cliente') || '').trim()
  const metodo = (String(formData.get('metodo') || 'NVBOOK_CEL_OBG') === 'NvBookCelObWhats'
    ? 'NvBookCelObWhats'
    : 'NVBOOK_CEL_OBG') as NvtiMetodo
  const cacheDays = Number.parseInt(String(formData.get('cache_days') || '30'), 10)
  const isActive = String(formData.get('is_active') || 'true') === 'true'

  if (!usuario) throw new Error('Informe o usuário da conta Nova Vida TI.')
  if (!cliente) throw new Error('Informe o cliente da conta Nova Vida TI.')
  if (!id && !senha.trim()) throw new Error('Informe a senha no primeiro cadastro.')
  if (!Number.isFinite(cacheDays) || cacheDays < 0) throw new Error('Informe um número válido de dias de cache.')

  let tiers: unknown = undefined
  const tiersRaw = String(formData.get('price_tiers') || '')
  if (tiersRaw) {
    try {
      tiers = JSON.parse(tiersRaw)
    } catch {
      throw new Error('Tabela de preço inválida.')
    }
  }

  try {
    const result = await saveNvtiConfig({
      id: id || undefined,
      usuario,
      senha,
      cliente,
      metodo,
      cache_days: cacheDays,
      price_tiers: normalizeTiers(tiers),
      is_active: isActive,
    })
    revalidatePath('/rh/parceiros/config/provedores/nvti')
    return { success: true, id: result.id }
  } catch (error) {
    throw new Error(getReadableErrorMessage(error, 'Não foi possível salvar a configuração da Nova Vida TI.'))
  }
}

export async function testarConexaoNvti(): Promise<{ ok: boolean; message: string }> {
  await requirePermission('sistema-config-nvti', 'can_view')
  const config = await getNvtiConfig()
  if (!config.has_credentials) {
    return { ok: false, message: 'Cadastre usuário, senha e cliente antes de testar.' }
  }
  try {
    const token = await gerarToken({ usuario: config.usuario, senha: config.senha, cliente: config.cliente })
    return { ok: true, message: `Conexão OK — token gerado (${token.slice(0, 8)}…, validade de 24h).` }
  } catch (error) {
    return { ok: false, message: getReadableErrorMessage(error, 'Falha ao gerar token na Nova Vida TI.') }
  }
}
