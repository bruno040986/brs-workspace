'use server'

/**
 * Card "Figurinhas/GIFs" em Provedores e APIs — permissão
 * `sistema-config-figurinhas-gifs`. Chave write-only; testar roda no
 * servidor (a chave do cofre não existe no ambiente local, só na Vercel).
 */
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { lerGiphyConfigPublica, salvarGiphyConfig, testarConexaoGiphy, type GiphyConfigPublica } from './client'

const RESOURCE = 'sistema-config-figurinhas-gifs'
const ROTA = '/rh/parceiros/config/provedores/figurinhas-gifs'

export async function getGiphyConfig(): Promise<{ success: boolean; data?: GiphyConfigPublica; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    return { success: true, data: await lerGiphyConfigPublica() }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function saveGiphyConfig(input: { apiKey?: string; rating: 'g' | 'pg' | 'pg-13'; isActive: boolean }): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    await salvarGiphyConfig({ ...input, updatedBy: user.id })
    revalidatePath(ROTA)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function testGiphyConnection(): Promise<{ ok: boolean; detalhe: string }> {
  try {
    await requirePermission(RESOURCE)
    return await testarConexaoGiphy()
  } catch (err) {
    return { ok: false, detalhe: err instanceof Error ? err.message : String(err) }
  }
}
