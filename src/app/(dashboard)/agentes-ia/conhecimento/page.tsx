import { getCurrentUserEffectivePermissions } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/permissions'
import { carregarConhecimento } from '../actions'
import ConhecimentoClient from '../_components/ConhecimentoClient'

export const dynamic = 'force-dynamic'

export default async function ConhecimentoPage() {
  const [secoes, permissoes] = await Promise.all([carregarConhecimento(), getCurrentUserEffectivePermissions()])
  return <ConhecimentoClient secoes={secoes} podeEditar={hasPermission(permissoes, 'comercial-agentes-ia', 'can_edit')} />
}
