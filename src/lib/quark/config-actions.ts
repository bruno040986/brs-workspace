'use server'

/**
 * Card "QuarkRH" em Provedores e APIs — permissão `sistema-config-quarkrh`.
 * Token write-only; explorar/testar rodam no servidor (a chave do cofre não
 * existe no ambiente local, só na Vercel).
 */
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import {
  explorarEndpoints,
  lerQuarkConfigPublica,
  salvarQuarkConfig,
  testarConexaoQuark,
  type QuarkConfigPublica,
  type SondaResultado,
} from './client'

export async function getQuarkConfig(): Promise<{ success: boolean; data?: QuarkConfigPublica; error?: string }> {
  try {
    await requirePermission('sistema-config-quarkrh')
    return { success: true, data: await lerQuarkConfigPublica() }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function saveQuarkConfig(input: { authToken?: string; baseUrl?: string; isActive: boolean }): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermission('sistema-config-quarkrh', 'can_edit')
    await salvarQuarkConfig({ ...input, updatedBy: user.id })
    revalidatePath('/rh/parceiros/config/provedores/quarkrh')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function testQuarkConnection(): Promise<{ ok: boolean; detalhe: string }> {
  try {
    await requirePermission('sistema-config-quarkrh')
    return await testarConexaoQuark()
  } catch (err: any) {
    return { ok: false, detalhe: err.message }
  }
}

/** Sonda os endpoints candidatos — resultado vai pra tela pro Bruno me copiar. */
export async function explorarQuarkEndpoints(): Promise<{ success: boolean; data?: SondaResultado[]; error?: string }> {
  try {
    await requirePermission('sistema-config-quarkrh', 'can_edit')
    return { success: true, data: await explorarEndpoints() }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
