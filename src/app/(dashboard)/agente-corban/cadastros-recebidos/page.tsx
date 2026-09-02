import { redirect } from 'next/navigation'
import { getCurrentUserEffectivePermissions } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/permissions'
import { getCadastrosRecebidosList } from './actions'
import CadastrosRecebidosListClient from './_components/CadastrosRecebidosListClient'

export const dynamic = 'force-dynamic'

export default async function CadastrosRecebidosPage() {
  const permissions = await getCurrentUserEffectivePermissions()
  if (!hasPermission(permissions, 'agente-corban-cadastros-recebidos', 'can_view')) {
    redirect('/acesso-negado')
  }

  const result = await getCadastrosRecebidosList()

  return (
    <CadastrosRecebidosListClient
      initialItems={result.success ? result.items : []}
      initialSemProcesso={result.success ? result.semProcesso : []}
    />
  )
}
