import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/server'
import { clienteChatwootBrs } from '@/lib/central-conversas/conta-brs'
import { sincronizarAgentesBrs } from '@/lib/central-conversas/provisionar-agentes'

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
