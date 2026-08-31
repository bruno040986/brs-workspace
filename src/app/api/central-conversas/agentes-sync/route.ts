import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { ChatwootConta } from '@/lib/central-conversas/chatwoot'
import { decifrarTexto } from '@/lib/central-conversas/cofre'
import { sincronizarAgentesBrs } from '@/lib/central-conversas/provisionar-agentes'

async function clienteChatwootBrs(): Promise<ChatwootConta | null> {
  const admin = await createAdminClient()
  const { data } = await admin.from('chat_contas').select('chatwoot_account_id, token_cifrado').eq('owner_tipo', 'brs').maybeSingle()
  if (!data) return null
  return new ChatwootConta(Number(data.chatwoot_account_id), decifrarTexto(String(data.token_cifrado)))
}

export const dynamic = 'force-dynamic'

/**
 * Manutenção da Central de Conversas: força a sincronização de usuários do
 * Workspace (permissão `conversas`) → agentes da conta BRS no Chatwoot e
 * devolve o relatório — inclusive os erros, que no fluxo normal ficam só no
 * log do servidor. Gated pela permissão de configuração da Central.
 */
export async function GET() {
  try {
    await requirePermission('central-conversas', 'can_view')
    const cli = await clienteChatwootBrs()
    if (!cli) return NextResponse.json({ erro: 'Chatwoot não provisionado.' }, { status: 400 })
    const relatorio = await sincronizarAgentesBrs(cli)
    const agentes = await cli.agentes()
    return NextResponse.json({ ...relatorio, agentes: agentes.map((a) => ({ id: a.id, name: a.name, email: a.email })) })
  } catch (err) {
    return NextResponse.json({ erro: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
