// Acesso interno à conta BRS do Chatwoot. NÃO é arquivo 'use server': estas
// funções leem chat_contas com service_role e não podem virar Server Actions
// chamáveis por qualquer sessão. O token cifrado nunca sai deste módulo.
import { createAdminClient } from '@/lib/supabase/server'
import { decifrarTexto } from './cofre'
import { ChatwootConta } from './chatwoot'

export async function contaBrs() {
  const admin = await createAdminClient()
  const { data } = await admin.from('chat_contas').select('id, nome, chatwoot_account_id').eq('owner_tipo', 'brs').maybeSingle()
  return data
}

export async function clienteChatwootBrs(): Promise<ChatwootConta | null> {
  const admin = await createAdminClient()
  const { data } = await admin.from('chat_contas').select('chatwoot_account_id, token_cifrado').eq('owner_tipo', 'brs').maybeSingle()
  if (!data) return null
  return new ChatwootConta(Number(data.chatwoot_account_id), decifrarTexto(String(data.token_cifrado)))
}
