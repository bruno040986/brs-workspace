'use server'

/** Card "API Meta" — permissão `sistema-config-api-meta`. Token write-only. */
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { lerMetaCapiPublica, salvarMetaCapi, testarConexaoMeta, type MetaCapiPublica } from './config'

const RESOURCE = 'sistema-config-api-meta'
const ROTA = '/rh/parceiros/config/provedores/api-meta'

export async function getMetaCapiConfig(): Promise<{ success: boolean; data?: MetaCapiPublica; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    return { success: true, data: await lerMetaCapiPublica() }
  } catch {
    return { success: false, error: 'Sem permissão ou erro ao carregar.' }
  }
}

export async function saveMetaCapiConfig(input: { token?: string; testEventCode?: string; datasetId: string; datasetNome?: string }): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const r = await salvarMetaCapi(input, user.id)
    if (!r.ok) return { success: false, error: r.erro }
    revalidatePath(ROTA)
    return { success: true }
  } catch {
    return { success: false, error: 'Sem permissão ou erro ao salvar.' }
  }
}

export async function testMetaCapiConnection(): Promise<{ ok: boolean; detalhe: string }> {
  try {
    await requirePermission(RESOURCE)
    return await testarConexaoMeta()
  } catch {
    return { ok: false, detalhe: 'Sem permissão ou erro no teste.' }
  }
}
