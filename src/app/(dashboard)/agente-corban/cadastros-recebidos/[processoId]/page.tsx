import { redirect, notFound } from 'next/navigation'
import { getCurrentUserEffectivePermissions } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/permissions'
import { getProcesso } from '../actions'
import ProcessoOnboardingClient from '../_components/ProcessoOnboardingClient'

export const dynamic = 'force-dynamic'

export default async function ProcessoCadastroRecebidoPage({
  params,
}: {
  params: Promise<{ processoId: string }>
}) {
  const { processoId } = await params

  const permissions = await getCurrentUserEffectivePermissions()
  if (!hasPermission(permissions, 'agente-corban-cadastros-recebidos', 'can_view')) {
    redirect('/acesso-negado')
  }

  const result = await getProcesso(processoId)
  if (!result.success) {
    notFound()
  }

  return <ProcessoOnboardingClient initialData={result} />
}
