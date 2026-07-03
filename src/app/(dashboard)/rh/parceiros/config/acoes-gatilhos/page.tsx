import { redirect } from 'next/navigation'
import { getCurrentUserEffectivePermissions } from '@/lib/auth/server'
import { hasScpAutomationLibraryAccess } from '@/lib/auth/permissions'
import { getScpAutomationLibrary } from '../../actions'
import ScpAcoesGatilhosClient from './_components/ScpAcoesGatilhosClient'

export const dynamic = 'force-dynamic'

export default async function AcoesGatilhosPage() {
  const permissions = await getCurrentUserEffectivePermissions()
  if (!hasScpAutomationLibraryAccess(permissions)) {
    redirect('/acesso-negado')
  }

  const result = await getScpAutomationLibrary()

  return (
    <ScpAcoesGatilhosClient
      initialActions={result.success ? result.actions : []}
      initialTriggers={result.success ? result.triggers : []}
      initialError={result.success ? null : result.error || 'Erro ao carregar a biblioteca de automações.'}
    />
  )
}
