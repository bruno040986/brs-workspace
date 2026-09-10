/**
 * Client admin (service role) compartilhado pelas actions de Convênios da
 * Fase 2 (documentos, FAQ). Mesma configuração usada em bc-actions.ts e
 * cadastros-actions.ts — extraído aqui só pra não repetir o boilerplate nos
 * dois arquivos novos.
 */
import { createClient } from '@supabase/supabase-js'

export const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})
