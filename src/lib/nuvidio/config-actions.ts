'use server'

/**
 * Card "Nuvidio" em Provedores e APIs — permissão `sistema-config-nuvidio`.
 * Credenciais (API KEY/SECRET) cifradas no cofre; write-only na UI.
 */

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
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
