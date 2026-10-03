/* eslint-disable @typescript-eslint/no-explicit-any */
import { createAdminClient } from '@/lib/supabase/server'

/** Fail-closed: erro na RPC conta como limite estourado. */
export async function limiteTentar(chave: string, limite: number, janelaSeg: number): Promise<boolean> {
  try {
    const admin: any = await createAdminClient()
    const { data, error } = await admin.rpc('promocao_limite_tentar', { p_chave: chave, p_limite: limite, p_janela_seg: janelaSeg })
    if (error) return false
    return data === true
  } catch {
    return false
  }
}
