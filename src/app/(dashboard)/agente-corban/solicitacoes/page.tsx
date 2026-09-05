import { redirect } from 'next/navigation'
import { getCurrentUserEffectivePermissions } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/permissions'
import { getSolicitacoesList } from './actions'
import { SolicitacoesListClient } from './SolicitacoesListClient'

export const dynamic = 'force-dynamic'

export default async function SolicitacoesAtualizacaoCadastralPage() {
  const permissions = await getCurrentUserEffectivePermissions()
  if (!hasPermission(permissions, 'agente-corban-solicitacoes', 'can_view')) {
    redirect('/acesso-negado')
  }
  const result = await getSolicitacoesList()
  return <SolicitacoesListClient initialItems={result.items} />
}
